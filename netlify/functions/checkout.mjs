// Start a payment for one report. Served at /api/checkout.
//
// Takes the address the person just checked, asks Razorpay for a payment link
// for it, and hands back the link for the browser to follow. Razorpay is given
// a one-way hash of the address, never the address.
//
// While payments are switched off (see lib/payments.mjs) this answers 503 with
// a plain sentence, which is what the live site does today.

import { paymentsConfig, paymentsReady, currencyFor, priceFor, createPaymentLink } from '../../lib/payments.mjs';
import { addressKey, referenceFor } from '../../lib/unlocks.mjs';
import { normaliseUrl } from '../../lib/url.mjs';

export const config = {
  path: '/api/checkout',
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

export default async function handler(request, context) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405);

  const settings = paymentsConfig(process.env);
  if (!paymentsReady(settings)) {
    return json({ ok: false, error: 'The full report is not on sale yet.' }, 503);
  }

  const type = request.headers.get('content-type') || '';
  if (!/application\/json/i.test(type)) return json({ ok: false, error: 'Send JSON.' }, 415);
  const raw = await request.text();
  if (raw.length > 4096) return json({ ok: false, error: 'That is too long to be a web address.' }, 413);
  let target = null;
  try {
    const body = JSON.parse(raw);
    target = body && typeof body.url === 'string' ? body.url : null;
  } catch { target = null; }

  const checked = normaliseUrl(target || '');
  if (checked.error) return json({ ok: false, error: checked.error }, 400);

  const { key, error } = addressKey(checked.url, settings.pepper);
  if (error) return json({ ok: false, error: 'The full report is not on sale yet.' }, 503);

  // The server decides the currency from where the request came from, so the
  // price cannot be changed by editing what the page sends.
  const country = context && context.geo && context.geo.country ? context.geo.country.code : '';
  const price = priceFor(currencyFor(country, settings));
  if (!price) return json({ ok: false, error: 'We cannot take a payment for that country yet.' }, 503);

  const origin = new URL(request.url).origin;
  const link = await createPaymentLink(settings, {
    amount: price.amount,
    currency: price.currency,
    reference: referenceFor(key),
    callbackUrl: `${origin}/api/unlock`,
  });

  if (!link.ok) {
    return json({ ok: false, error: 'We could not start the payment. Nothing has been charged. Please try again in a minute.' }, 502);
  }
  return json({ ok: true, payUrl: link.payUrl, price: price.label });
}
