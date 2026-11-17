// Fetches a live page and the JavaScript files it loads, with hard limits so
// one scan can never outrun the hosting platform's function timeout.

import { normaliseUrl, isPrivateHost } from './url.mjs';
import { safeFetch } from './safeFetch.mjs';

export const LIMITS = {
  totalMs: 8000,        // whole scan budget, well inside any platform timeout
  pageMs: 6000,         // one page fetch
  assetMs: 4000,        // one JavaScript file
  probeMs: 2500,        // the deep-link probe
  maxBytes: 3_000_000,  // per response
  maxScripts: 8,        // JavaScript files fetched per scan
};

// An address that cannot exist on anyone's site, used to see what the host
// does with an unknown path. Random so it cannot be cached or special-cased.
export function probePath() {
  return `/unbork-check-${Math.random().toString(36).slice(2, 10)}`;
}

async function getWithLimit(url, { ms, maxBytes, signalDeadline, fetchImpl, allowLocal = false }) {
  const ctrl = new AbortController();
  const budget = Math.max(0, Math.min(ms, signalDeadline - Date.now()));
  if (budget === 0) return { url, error: 'out-of-time' };
  const timer = setTimeout(() => ctrl.abort(), budget);
  try {
    const res = await safeFetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'UnborkSiteChecker/0.2 (+https://unbork.netlify.app)', accept: 'text/html,application/javascript,*/*;q=0.8' },
    }, { allowLocal, fetchImpl });
    const bytes = await readCapped(res, maxBytes + 1);
    const body = new TextDecoder('utf-8', { fatal: false })
      .decode(bytes.length > maxBytes ? bytes.subarray(0, maxBytes) : bytes);
    const headers = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    return { url, finalUrl: res.url || url, status: res.status, headers, setCookies, body, bytes: bytes.length, truncated: bytes.length > maxBytes };
  } catch (err) {
    const code = err && (err.code || (err.cause && err.cause.code));
    const name = err && err.name === 'AbortError' ? 'timeout'
      : (code === 'EBLOCKED' || code === 'EPRIVATE') ? 'blocked'
      : code === 'EREDIRECTS' ? 'redirects' : 'unreachable';
    return { url, error: name, message: err && err.message ? String(err.message).slice(0, 200) : '' };
  } finally {
    clearTimeout(timer);
  }
}

// Reads a body but stops once it has enough, so a huge file cannot fill memory.
async function readCapped(res, cap) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const all = new Uint8Array(await res.arrayBuffer());
    return all.length > cap ? all.subarray(0, cap) : all;
  }
  const reader = res.body.getReader();
  const chunks = []; let total = 0;
  while (total < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); total += value.length;
  }
  try { await reader.cancel(); } catch { /* already finished */ }
  const out = new Uint8Array(Math.min(total, cap)); let o = 0;
  for (const c of chunks) { const n = Math.min(c.length, out.length - o); out.set(c.subarray(0, n), o); o += n; if (o >= out.length) break; }
  return out;
}

// Pulls <script src> values out of HTML without a parser dependency.
export function scriptUrls(html, baseUrl) {
  const out = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = (m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (!src) continue;
    try {
      const abs = new URL(src, baseUrl);
      if (abs.protocol !== 'https:' && abs.protocol !== 'http:') continue;
      if (!out.includes(abs.toString())) out.push(abs.toString());
    } catch { /* ignore a src we cannot resolve */ }
  }
  return out;
}

export function inlineScripts(html) {
  const out = [];
  const re = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) if (m[1] && m[1].trim()) out.push(m[1]);
  return out;
}

export async function fetchSite(input, { allowLocal = false, fetchImpl, limits = LIMITS } = {}) {
  const started = Date.now();
  const deadline = started + limits.totalMs;
  const n = normaliseUrl(input, { allowLocal });
  if (n.error) return { ok: false, error: n.error };

  const page = await getWithLimit(n.url, {
    ms: limits.pageMs, maxBytes: limits.maxBytes, signalDeadline: deadline, fetchImpl, allowLocal,
  });
  if (page.error) {
    const why = page.error === 'timeout'
      ? 'Your site took too long to answer, so we could not check it. Try again in a minute.'
      : page.error === 'blocked'
        ? 'That address leads somewhere private, so we will not open it. Paste the public address of your live site.'
        : page.error === 'redirects'
          ? 'That address sends us round more than five redirects, so we stopped. Paste the address your site finally lands on.'
          : 'We could not open that address. Check it opens in your own browser, exactly as you pasted it.';
    return { ok: false, error: why, reason: page.error, url: n.url };
  }

  // Asked before the bundles, because it is small and the deep-link answer
  // should not be lost to a site with eight big JavaScript files.
  const base = new URL(page.finalUrl || n.url);
  const probeUrl = new URL(probePath(), base.origin).toString();
  const probe = await getWithLimit(probeUrl, {
    ms: limits.probeMs, maxBytes: limits.maxBytes, signalDeadline: deadline, fetchImpl, allowLocal,
  });

  const assets = [];
  const wanted = scriptUrls(page.body, page.finalUrl || n.url)
    .filter((u) => { try { return allowLocal || !isPrivateHost(new URL(u).hostname); } catch { return false; } })
    .slice(0, limits.maxScripts);

  for (const u of wanted) {
    if (Date.now() > deadline - 300) { assets.push({ url: u, error: 'out-of-time' }); continue; }
    assets.push(await getWithLimit(u, {
      ms: limits.assetMs, maxBytes: limits.maxBytes, signalDeadline: deadline, fetchImpl, allowLocal,
    }));
  }

  // Apps split their code, and a privacy or terms page is often its own small
  // file that is only loaded when someone opens it. Its name is in the main
  // bundle, so a few of those are fetched too: the legal check needs them.
  const legalChunks = [];
  const seen = new Set(assets.map((a) => a.url));
  for (const a of assets) {
    if (a.error || !a.body) continue;
    const re = /["'`(\/]([\w./-]*?(?:privacy|terms|legal|cookie|refund|policy|policies|impressum|imprint)[\w.-]*\.js)["'`)]/gi;
    let m;
    while ((m = re.exec(a.body)) !== null && legalChunks.length < 3) {
      let abs;
      try { abs = new URL(m[1], a.url); } catch { continue; }
      if (abs.origin !== base.origin || seen.has(abs.toString())) continue;
      seen.add(abs.toString());
      legalChunks.push(abs.toString());
    }
  }
  const extra = [];
  for (const u of legalChunks) {
    if (Date.now() > deadline - 300) break;
    extra.push(await getWithLimit(u, {
      ms: limits.assetMs, maxBytes: limits.maxBytes, signalDeadline: deadline, fetchImpl, allowLocal,
    }));
  }

  return {
    ok: true,
    setCookies: page.setCookies || [],
    legalAssets: extra,
    requestedUrl: n.url,
    finalUrl: page.finalUrl || n.url,
    status: page.status,
    headers: page.headers,
    html: page.body,
    htmlBytes: page.bytes,
    inline: inlineScripts(page.body),
    assets,
    probe,
    scriptsFound: scriptUrls(page.body, page.finalUrl || n.url).length,
    scriptsFetched: assets.filter((a) => !a.error).length,
    ms: Date.now() - started,
  };
}
