// Taking one payment for one report, with Razorpay, and nothing else.
//
// Nothing in this file does anything until four environment variables exist on
// the host: UNBORK_PAYMENTS=on, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and
// UNBORK_UNLOCK_SECRET. Until then paymentsReady() is false, the two payment
// endpoints answer "not on sale yet", and the live site behaves exactly as it
// does today. That is deliberate: the code can be finished, reviewed and
// tested before anyone has an account, and switching it on is one screen of
// typing rather than a day of work.
//
// Why Payment Links and not Razorpay's own checkout window: the checkout
// window is a third-party script, and loading one would mean widening our own
// content security policy, on a site whose whole job is telling people to
// tighten theirs. A Payment Link sends the payer to Razorpay's own page and
// brings them back, so our pages stay free of anybody else's JavaScript.
//
// What Razorpay is told: an amount, a currency, and a reference that is the
// one-way hash of the address (see lib/unlocks.mjs). It is never told which
// site was checked. We send it no name, no email and no phone number, because
// we do not have any, and notifications are switched off so that nothing is
// ever emailed or texted to anybody on our behalf.

import { createHmac } from 'node:crypto';
import { sameHex, keyFromReference, MIN_SECRET } from './unlocks.mjs';

export const API = 'https://api.razorpay.com/v1/payment_links/';

// The price decided on 19 November, in the smallest unit of each currency, as
// Razorpay's API expects (docs.razorpay.com, api/payments/payment-links).
export const PRICES = {
  INR: { amount: 79900, label: '₹799' },
  USD: { amount: 900, label: '$9' },
};

export function paymentsConfig(env = {}) {
  const keyId = String(env.RAZORPAY_KEY_ID || '').trim();
  const keySecret = String(env.RAZORPAY_KEY_SECRET || '').trim();
  const pepper = String(env.UNBORK_UNLOCK_SECRET || '');
  return {
    on: String(env.UNBORK_PAYMENTS || '').toLowerCase() === 'on',
    keyId,
    keySecret,
    webhookSecret: String(env.RAZORPAY_WEBHOOK_SECRET || '').trim(),
    pepper,
    // Razorpay does not take cards from abroad until a separate activation
    // request is approved, so dollar links are refused until we are told the
    // account can actually accept one.
    international: String(env.UNBORK_INTERNATIONAL || '').toLowerCase() === 'on',
  };
}

export function paymentsReady(config) {
  return Boolean(config.on && config.keyId && config.keySecret && config.pepper.length >= MIN_SECRET);
}

// The server picks the currency, never the page, so the price cannot be
// changed by editing a request. An unknown country is treated as abroad,
// which is the common case for us, and falls back to rupees when dollar
// payments are not switched on.
export function currencyFor(countryCode, config) {
  const country = String(countryCode || '').toUpperCase();
  if (country === 'IN') return 'INR';
  return config.international ? 'USD' : 'INR';
}

export function priceFor(currency) {
  const price = PRICES[currency];
  if (!price) return null;
  return { currency, amount: price.amount, label: price.label };
}

// Razorpay sends these five values back on the address we gave it. The first
// four are the payload, in this order, and the fifth is the HMAC-SHA256 of it
// keyed with our API secret
// (razorpay.com/docs/payments/payment-links/apis, Verify Signature, read
// 21 Nov 2026). The order is not written out on that page, so it was proved
// against the worked example printed there; the same example is a test.
export function linkSignature(fields, secret) {
  const payload = [
    fields.payment_link_id,
    fields.payment_link_reference_id,
    fields.payment_link_status,
    fields.razorpay_payment_id,
  ].map((v) => String(v == null ? '' : v)).join('|');
  return createHmac('sha256', String(secret)).update(payload).digest('hex');
}

// Everything that has to be true before a report is unlocked by a payer coming
// back to the site. "paid" matters as much as the signature: a link we created
// cannot be part-paid, because accept_partial is false, so any other status is
// a payment that did not complete.
export function verifyLinkCallback(params, secret) {
  if (!secret) return { ok: false, why: 'no-secret' };
  const id = String(params.razorpay_payment_link_id || '');
  const ref = String(params.razorpay_payment_link_reference_id || '');
  const status = String(params.razorpay_payment_link_status || '');
  const payment = String(params.razorpay_payment_id || '');
  const given = String(params.razorpay_signature || '');
  if (!id || !ref || !status || !payment || !given) return { ok: false, why: 'missing' };
  const key = keyFromReference(ref);
  if (!key) return { ok: false, why: 'bad-reference' };
  if (!/^pay_[A-Za-z0-9]{8,32}$/.test(payment)) return { ok: false, why: 'bad-payment-id' };
  const expected = linkSignature({
    payment_link_id: id,
    payment_link_reference_id: ref,
    payment_link_status: status,
    razorpay_payment_id: payment,
  }, secret);
  if (!sameHex(expected, given)) return { ok: false, why: 'bad-signature' };
  if (status !== 'paid') return { ok: false, why: 'not-paid' };
  return { ok: true, key, ref: payment };
}

// A webhook is the half of this that does not depend on the payer's browser
// coming back. Razorpay signs the raw body with the webhook secret and sends
// the result in X-Razorpay-Signature
// (razorpay.com/docs/webhooks/validate-test, read 21 Nov 2026).
export function verifyWebhook(rawBody, signature, secret) {
  if (!secret) return false;
  const expected = createHmac('sha256', String(secret)).update(String(rawBody)).digest('hex');
  return sameHex(expected, signature);
}

// What a payment_link.paid webhook has to contain before it unlocks anything.
// The amount is checked against our own price table rather than trusted, so a
// link created elsewhere for one rupee cannot buy a report.
export function unlockFromWebhook(body) {
  const event = body && body.event;
  if (event !== 'payment_link.paid') return { ok: false, why: 'ignored' };
  const link = body.payload && body.payload.payment_link && body.payload.payment_link.entity;
  const payment = body.payload && body.payload.payment && body.payload.payment.entity;
  if (!link || !payment) return { ok: false, why: 'incomplete' };
  const key = keyFromReference(link.reference_id);
  if (!key) return { ok: false, why: 'bad-reference' };
  if (String(link.status || '') !== 'paid') return { ok: false, why: 'not-paid' };
  const price = priceFor(String(link.currency || ''));
  if (!price || Number(link.amount) !== price.amount) return { ok: false, why: 'wrong-amount' };
  if (Number(link.amount_paid) < price.amount) return { ok: false, why: 'short-paid' };
  const id = String(payment.id || '');
  if (!/^pay_[A-Za-z0-9]{8,32}$/.test(id)) return { ok: false, why: 'bad-payment-id' };
  return { ok: true, key, ref: id };
}

export function linkBody({ amount, currency, reference, callbackUrl, now = new Date() }) {
  return {
    amount,
    currency,
    accept_partial: false,
    reference_id: reference,
    description: 'Unbork full report: fix steps and paste-ready prompts for one site',
    // Razorpay can email and text the payer for us. We have nobody's email or
    // phone number and we do not send email, so both are off and no reminders
    // are scheduled.
    notify: { sms: false, email: false },
    reminder_enable: false,
    callback_url: callbackUrl,
    callback_method: 'get',
    // Unix seconds. A link nobody uses stops working the same day, so an old
    // one cannot be handed round later.
    expire_by: Math.floor(now.getTime() / 1000) + 24 * 60 * 60,
  };
}

export async function createPaymentLink(config, options, fetchImpl = fetch) {
  const auth = Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetchImpl(API, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
      body: JSON.stringify(linkBody(options)),
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* handled below */ }
    if (!res.ok || !body) {
      return { ok: false, status: res.status, why: (body && body.error && body.error.description) || 'razorpay-refused' };
    }
    const payUrl = String(body.short_url || '');
    if (!/^https:\/\/[^\s]+$/.test(payUrl)) return { ok: false, why: 'no-link' };
    return { ok: true, payUrl, id: String(body.id || '') };
  } catch {
    return { ok: false, why: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
