// Netlify Function (v2: default export, Request in, Response out), served at
// /api/scan. All the work lives in ../../lib so it can be tested without a
// network or a deploy; this file only deals with HTTP.

import { runScan } from '../../lib/scan.mjs';
import { recordScanQuietly } from '../../lib/counter.mjs';

// Netlify enforces this before the function runs, on every plan:
// docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/
export const config = {
  path: '/api/scan',
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};

const SECURITY = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY },
});

// Only an owner preview can see the paid fixes before payments exist. The key
// lives in a Netlify environment variable; with none set, nothing unlocks.
function previewUnlocked(request) {
  const key = process.env.UNBORK_PREVIEW_KEY;
  const given = request.headers.get('x-unbork-preview') || '';
  if (!key || key.length < 24 || given.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// A whole report is a few kilobytes of plain English. ?view=summary returns
// just the verdict and the names of what was found, which is what counting
// across many sites needs. It strips information out, never adds any.
function summarise(report) {
  return {
    ok: true,
    url: report.url,
    status: report.status,
    verdict: report.verdict,
    found: report.items.map((i) => ({ id: i.id, level: i.level })),
    scripts: report.scripts,
    ms: report.ms,
  };
}

export default async function handler(request) {
  let target = null;
  let view = '';
  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    target = params.get('url');
    view = params.get('view') || '';
  } else if (request.method === 'POST') {
    const type = request.headers.get('content-type') || '';
    if (!/application\/json/i.test(type)) return json({ ok: false, error: 'Send JSON.' }, 415);
    const raw = await request.text();
    if (raw.length > 4096) return json({ ok: false, error: 'That is too long to be a web address.' }, 413);
    try {
      const body = JSON.parse(raw);
      target = body && typeof body.url === 'string' ? body.url : null;
    } catch { target = null; }
  } else {
    return json({ ok: false, error: 'Use GET or POST.' }, 405);
  }

  if (!target) return json({ ok: false, error: 'Please paste your site address.' }, 400);
  if (target.length > 2048) return json({ ok: false, error: 'That is too long to be a web address.' }, 400);

  try {
    const report = await runScan(target, { includeFixes: previewUnlocked(request) });
    // One number per day, nothing about the site or the visitor. See
    // lib/counter.mjs. Summary scans are ours: nothing on the site asks for
    // that view, so counting them would only flatter us.
    if (view !== 'summary') await recordScanQuietly(report.ok ? 'ok' : 'failed');
    if (view === 'summary' && report.ok) return json(summarise(report));
    return json(report, report.ok ? 200 : 400);
  } catch (err) {
    await recordScanQuietly('failed');
    // Never leak internals: the message is for the person, not a developer.
    return json({ ok: false, error: 'Something went wrong at our end while checking your site. Please try again.' }, 500);
  }
}
