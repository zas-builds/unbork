// Netlify Function at /api/stats. Returns how many checks have been run and
// nothing else: see lib/counter.mjs for what is stored and what is not.
// Public on purpose. There is nothing in it to hide, and a number anyone can
// read keeps us honest when we quote it.

import { openStore, readStats } from '../../lib/counter.mjs';

export const config = {
  path: '/api/stats',
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};

export default async function handler(request) {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false, error: 'Use GET.' }), {
      status: 405,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  let stats = null;
  try {
    stats = await readStats(await openStore());
  } catch {
    stats = null;
  }
  const body = stats
    ? { ok: true, counts: 'checks per day only, nothing about sites or visitors', ...stats }
    : { ok: false, error: 'Counting is not available on this deploy.' };
  return new Response(JSON.stringify(body), {
    status: stats ? 200 : 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    },
  });
}
