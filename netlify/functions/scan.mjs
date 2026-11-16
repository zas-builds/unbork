// Netlify Function (v2 style: default export, Request in, Response out).
// Served at /.netlify/functions/scan, and at /api/scan via netlify.toml.
//
// All of the work lives in ../../lib so it can be tested without a network or
// a deploy. This file only translates between HTTP and runScan().

import { runScan } from '../../lib/scan.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  },
});

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
      },
    });
  }

  let target = null;
  if (request.method === 'GET') {
    target = new URL(request.url).searchParams.get('url');
  } else if (request.method === 'POST') {
    try {
      const body = await request.json();
      target = body && typeof body.url === 'string' ? body.url : null;
    } catch { target = null; }
  } else {
    return json({ ok: false, error: 'Use GET or POST.' }, 405);
  }

  if (!target) return json({ ok: false, error: 'Please paste your site address.' }, 400);

  try {
    const report = await runScan(target);
    return json(report, report.ok ? 200 : 400);
  } catch (err) {
    // Never leak internals to the page; the message is for the person, not a developer.
    return json({
      ok: false,
      error: 'Something went wrong at our end while checking your site. Please try again.',
      reason: err && err.name ? String(err.name) : 'error',
    }, 500);
  }
}
