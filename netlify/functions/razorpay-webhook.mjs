// Razorpay telling us a payment link was paid. Served at /api/razorpay/webhook.
//
// This exists because the other half of the flow depends on the payer's
// browser coming back to the site, and browsers get closed. Razorpay signs the
// raw body with the webhook secret; we recompute that signature before
// believing anything, and we check the amount against our own price table
// rather than trusting the number in the message.
//
// Granting the same payment twice is harmless: lib/unlocks.mjs keeps the first
// record, so whichever of the two paths arrives second changes nothing.

import { paymentsConfig, paymentsReady, verifyWebhook, unlockFromWebhook } from '../../lib/payments.mjs';
import { openStore, grant } from '../../lib/unlocks.mjs';

export const config = {
  path: '/api/razorpay/webhook',
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['domain'] },
};

const reply = (status, body = '') => new Response(body, {
  status,
  headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
});

export default async function handler(request) {
  if (request.method !== 'POST') return reply(405);

  const settings = paymentsConfig(process.env);
  if (!paymentsReady(settings) || !settings.webhookSecret) return reply(503);

  const raw = await request.text();
  if (raw.length > 200_000) return reply(413);
  if (!verifyWebhook(raw, request.headers.get('x-razorpay-signature'), settings.webhookSecret)) {
    return reply(401);
  }

  let body = null;
  try { body = JSON.parse(raw); } catch { return reply(400); }

  const found = unlockFromWebhook(body);
  // Razorpay retries anything that is not answered with a 2xx, so an event we
  // deliberately ignore is still a success as far as it is concerned.
  if (!found.ok) return reply(200, found.why);

  try {
    const store = await openStore();
    if (!store) return reply(500);
    await grant(store, found.key, found.ref);
  } catch {
    return reply(500);
  }
  return reply(200, 'ok');
}
