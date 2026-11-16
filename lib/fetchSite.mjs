// Fetches a live page and the JavaScript files it loads, with hard limits so
// one scan can never outrun the hosting platform's function timeout.

import { normaliseUrl, isPrivateHost } from './url.mjs';

export const LIMITS = {
  totalMs: 8000,        // whole scan budget, well inside any platform timeout
  pageMs: 6000,         // one page fetch
  assetMs: 4000,        // one JavaScript file
  maxBytes: 3_000_000,  // per response
  maxScripts: 8,        // JavaScript files fetched per scan
};

async function getWithLimit(url, { ms, maxBytes, signalDeadline, fetchImpl = fetch }) {
  const ctrl = new AbortController();
  const budget = Math.max(0, Math.min(ms, signalDeadline - Date.now()));
  if (budget === 0) return { url, error: 'out-of-time' };
  const timer = setTimeout(() => ctrl.abort(), budget);
  try {
    const res = await fetchImpl(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': 'UnborkSiteChecker/0.1 (+https://github.com/zas-builds/unbork)' },
    });
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const body = new TextDecoder('utf-8', { fatal: false })
      .decode(bytes.length > maxBytes ? bytes.subarray(0, maxBytes) : bytes);
    const headers = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    return { url, finalUrl: res.url || url, status: res.status, headers, body, bytes: bytes.length, truncated: bytes.length > maxBytes };
  } catch (err) {
    const name = err && err.name === 'AbortError' ? 'timeout' : 'unreachable';
    return { url, error: name, message: err && err.message ? String(err.message).slice(0, 200) : '' };
  } finally {
    clearTimeout(timer);
  }
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

export async function fetchSite(input, { allowLocal = false, fetchImpl = fetch, limits = LIMITS } = {}) {
  const started = Date.now();
  const deadline = started + limits.totalMs;
  const n = normaliseUrl(input, { allowLocal });
  if (n.error) return { ok: false, error: n.error };

  const page = await getWithLimit(n.url, {
    ms: limits.pageMs, maxBytes: limits.maxBytes, signalDeadline: deadline, fetchImpl,
  });
  if (page.error) {
    const why = page.error === 'timeout'
      ? 'Your site took too long to answer, so we could not check it. Try again in a minute.'
      : 'We could not open that address. Check it opens in your own browser, exactly as you pasted it.';
    return { ok: false, error: why, reason: page.error, url: n.url };
  }

  const assets = [];
  const wanted = scriptUrls(page.body, page.finalUrl || n.url)
    .filter((u) => { try { return allowLocal || !isPrivateHost(new URL(u).hostname); } catch { return false; } })
    .slice(0, limits.maxScripts);

  for (const u of wanted) {
    if (Date.now() > deadline - 300) { assets.push({ url: u, error: 'out-of-time' }); continue; }
    assets.push(await getWithLimit(u, {
      ms: limits.assetMs, maxBytes: limits.maxBytes, signalDeadline: deadline, fetchImpl,
    }));
  }

  return {
    ok: true,
    requestedUrl: n.url,
    finalUrl: page.finalUrl || n.url,
    status: page.status,
    headers: page.headers,
    html: page.body,
    htmlBytes: page.bytes,
    inline: inlineScripts(page.body),
    assets,
    scriptsFound: scriptUrls(page.body, page.finalUrl || n.url).length,
    scriptsFetched: assets.filter((a) => !a.error).length,
    ms: Date.now() - started,
  };
}
