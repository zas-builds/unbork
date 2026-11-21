// Taking money is the part of Unbork where a mistake costs somebody real
// money, so these tests are stricter than the rest. Three things have to hold:
// nothing unlocks without a signature Razorpay made, nothing unlocks for the
// wrong amount, and nothing about anybody's address is stored in the process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  PRICES, paymentsConfig, paymentsReady, currencyFor, priceFor,
  linkSignature, verifyLinkCallback, verifyWebhook, unlockFromWebhook,
  linkBody, createPaymentLink,
} from '../lib/payments.mjs';
import {
  canonicalAddress, addressKey, referenceFor, keyFromReference,
  stillValid, recordFor, grant, isUnlocked, UNLOCK_DAYS, KEY_CHARS,
} from '../lib/unlocks.mjs';

const SECRET = 'EnLs21M47BllR3X8PSFtjtbd';
const PEPPER = 'a'.repeat(40);

const ready = {
  UNBORK_PAYMENTS: 'on',
  RAZORPAY_KEY_ID: 'rzp_test_abc123',
  RAZORPAY_KEY_SECRET: SECRET,
  RAZORPAY_WEBHOOK_SECRET: 'whsec_example_value',
  UNBORK_UNLOCK_SECRET: PEPPER,
};

// Razorpay's own documentation prints this worked example alongside its SDK
// helpers, but never writes out the order the four values are joined in. The
// order in lib/payments.mjs was proved against this example rather than
// guessed, and this test is what keeps it proved.
// razorpay.com/docs/payments/payment-links/apis, read 21 Nov 2026.
const DOC_EXAMPLE = {
  payment_link_id: 'plink_IH3cNucfVEgV68',
  payment_link_reference_id: 'TSsd1989',
  payment_link_status: 'paid',
  razorpay_payment_id: 'pay_IH3d0ara9bSsjQ',
  signature: '07ae18789e35093e51d0a491eb9922646f3f82773547e5b0f67ee3f2d3bf7d5b',
};

test("our signature matches Razorpay's documented example", () => {
  assert.equal(linkSignature(DOC_EXAMPLE, SECRET), DOC_EXAMPLE.signature);
});

function callback(overrides = {}) {
  const key = addressKey('https://myapp.lovable.app', PEPPER).key;
  const fields = {
    payment_link_id: 'plink_TestLink0001',
    payment_link_reference_id: referenceFor(key),
    payment_link_status: 'paid',
    razorpay_payment_id: 'pay_TestPayment01',
    ...overrides,
  };
  return {
    razorpay_payment_link_id: fields.payment_link_id,
    razorpay_payment_link_reference_id: fields.payment_link_reference_id,
    razorpay_payment_link_status: fields.payment_link_status,
    razorpay_payment_id: fields.razorpay_payment_id,
    razorpay_signature: linkSignature(fields, SECRET),
  };
}

test('a properly signed, paid callback unlocks that address and nothing else', () => {
  const params = callback();
  const got = verifyLinkCallback(params, SECRET);
  assert.equal(got.ok, true);
  assert.equal(got.key, addressKey('https://myapp.lovable.app', PEPPER).key);
  assert.equal(got.ref, 'pay_TestPayment01');
  assert.notEqual(got.key, addressKey('https://someoneelse.lovable.app', PEPPER).key);
});

test('a callback with no signature, a wrong one, or the wrong secret unlocks nothing', () => {
  const params = callback();
  assert.equal(verifyLinkCallback({ ...params, razorpay_signature: '' }, SECRET).why, 'missing');
  assert.equal(verifyLinkCallback({ ...params, razorpay_signature: 'f'.repeat(64) }, SECRET).why, 'bad-signature');
  assert.equal(verifyLinkCallback(params, 'a-different-secret').why, 'bad-signature');
  assert.equal(verifyLinkCallback(params, '').why, 'no-secret');
});

test('changing any signed value breaks the signature', () => {
  const params = callback();
  for (const field of [
    'razorpay_payment_link_id',
    'razorpay_payment_link_reference_id',
    'razorpay_payment_link_status',
    'razorpay_payment_id',
  ]) {
    const tampered = { ...params, [field]: 'pay_SomethingElse1' };
    assert.notEqual(verifyLinkCallback(tampered, SECRET).ok, true, `${field} was accepted after being changed`);
  }
});

test('a payment that did not complete unlocks nothing, however well signed', () => {
  for (const status of ['partially_paid', 'cancelled', 'expired', 'created']) {
    const got = verifyLinkCallback(callback({ payment_link_status: status }), SECRET);
    assert.equal(got.ok, false);
    assert.equal(got.why, 'not-paid');
  }
});

test('a reference that is not one of ours is refused before anything else', () => {
  for (const ref of ['TSsd1989', '', 'x'.repeat(32), 'abc', 'f'.repeat(31)]) {
    const got = verifyLinkCallback(callback({ payment_link_reference_id: ref }), SECRET);
    assert.equal(got.ok, false);
  }
});

function webhookEvent(overrides = {}) {
  const key = addressKey('https://myapp.lovable.app', PEPPER).key;
  return {
    event: 'payment_link.paid',
    payload: {
      payment_link: {
        entity: {
          id: 'plink_TestLink0001',
          reference_id: referenceFor(key),
          status: 'paid',
          amount: PRICES.INR.amount,
          amount_paid: PRICES.INR.amount,
          currency: 'INR',
          ...(overrides.link || {}),
        },
      },
      payment: { entity: { id: 'pay_TestPayment01', ...(overrides.payment || {}) } },
    },
    ...(overrides.top || {}),
  };
}

test('a webhook signed with the webhook secret is accepted, and a changed body is not', () => {
  const body = JSON.stringify(webhookEvent());
  const sig = createHmac('sha256', 'whsec_example_value').update(body).digest('hex');
  assert.equal(verifyWebhook(body, sig, 'whsec_example_value'), true);
  assert.equal(verifyWebhook(body + ' ', sig, 'whsec_example_value'), false);
  assert.equal(verifyWebhook(body, sig, 'another-secret'), false);
  assert.equal(verifyWebhook(body, '', 'whsec_example_value'), false);
  assert.equal(verifyWebhook(body, sig, ''), false);
});

test('a paid webhook for the full amount unlocks that address', () => {
  const got = unlockFromWebhook(webhookEvent());
  assert.equal(got.ok, true);
  assert.equal(got.key, addressKey('https://myapp.lovable.app', PEPPER).key);
  assert.equal(got.ref, 'pay_TestPayment01');
});

test('a webhook for the wrong amount buys nothing', () => {
  assert.equal(unlockFromWebhook(webhookEvent({ link: { amount: 100, amount_paid: 100 } })).why, 'wrong-amount');
  assert.equal(unlockFromWebhook(webhookEvent({ link: { amount_paid: 100 } })).why, 'short-paid');
  assert.equal(unlockFromWebhook(webhookEvent({ link: { currency: 'EUR' } })).why, 'wrong-amount');
  assert.equal(unlockFromWebhook(webhookEvent({ link: { status: 'partially_paid' } })).why, 'not-paid');
});

test('only the paid event unlocks anything', () => {
  for (const event of ['payment_link.partially_paid', 'payment_link.expired', 'payment.failed', '']) {
    assert.equal(unlockFromWebhook(webhookEvent({ top: { event } })).ok, false);
  }
  assert.equal(unlockFromWebhook({}).ok, false);
  assert.equal(unlockFromWebhook({ event: 'payment_link.paid' }).why, 'incomplete');
});

test('payments stay off until all four settings are present', () => {
  assert.equal(paymentsReady(paymentsConfig({})), false);
  assert.equal(paymentsReady(paymentsConfig(ready)), true);
  for (const missing of ['UNBORK_PAYMENTS', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'UNBORK_UNLOCK_SECRET']) {
    const env = { ...ready };
    delete env[missing];
    assert.equal(paymentsReady(paymentsConfig(env)), false, `${missing} alone did not switch payments off`);
  }
  // A secret too short to be worth having counts as absent.
  assert.equal(paymentsReady(paymentsConfig({ ...ready, UNBORK_UNLOCK_SECRET: 'short' })), false);
});

test('the server picks the currency, and dollars need international switched on', () => {
  const home = paymentsConfig(ready);
  const abroad = paymentsConfig({ ...ready, UNBORK_INTERNATIONAL: 'on' });
  assert.equal(currencyFor('IN', home), 'INR');
  assert.equal(currencyFor('IN', abroad), 'INR');
  assert.equal(currencyFor('GB', home), 'INR');
  assert.equal(currencyFor('GB', abroad), 'USD');
  assert.equal(currencyFor('', home), 'INR');
  assert.equal(priceFor('INR').label, '₹799');
  assert.equal(priceFor('USD').label, '$9');
  assert.equal(priceFor('EUR'), null);
});

test('the price in the code is the price on the pricing page', () => {
  assert.equal(PRICES.INR.amount, 79900);
  assert.equal(PRICES.USD.amount, 900);
});

test('the same address written differently is the same report', () => {
  const forms = ['myapp.lovable.app', 'https://myapp.lovable.app', 'https://MyApp.Lovable.app/', 'https://myapp.lovable.app/?ref=x'];
  const keys = new Set(forms.map((f) => addressKey(f, PEPPER).key));
  assert.equal(keys.size, 1);
  assert.notEqual(addressKey('https://myapp.lovable.app/admin', PEPPER).key, addressKey('https://myapp.lovable.app', PEPPER).key);
});

test('what we store cannot be read back as an address', () => {
  const key = addressKey('https://myapp.lovable.app', PEPPER).key;
  assert.equal(key.length, KEY_CHARS);
  assert.match(key, /^[0-9a-f]+$/);
  assert.equal(key.includes('lovable'), false);
  // A different pepper gives a different key, so the file alone is not enough.
  assert.notEqual(addressKey('https://myapp.lovable.app', 'b'.repeat(40)).key, key);
  // The stored record holds a payment reference and two dates, nothing else.
  const record = recordFor('pay_TestPayment01');
  assert.deepEqual(Object.keys(record).sort(), ['expiresAt', 'paidAt', 'ref']);
  assert.equal(JSON.stringify(record).includes('lovable'), false);
});

test('no key at all without a long secret', () => {
  assert.equal(addressKey('myapp.lovable.app', '').error, 'no-secret');
  assert.equal(addressKey('myapp.lovable.app', 'tooshort').error, 'no-secret');
  assert.ok(canonicalAddress('not a url at all ???').error);
});

test('two attempts at the same address get different references and the same key', () => {
  const key = addressKey('https://myapp.lovable.app', PEPPER).key;
  const a = referenceFor(key), b = referenceFor(key);
  assert.notEqual(a, b);
  assert.equal(keyFromReference(a), key);
  assert.equal(keyFromReference(b), key);
  assert.equal(keyFromReference('TSsd1989'), null);
  assert.equal(keyFromReference(''), null);
});

test('an unlock lasts seven days and not a minute longer', () => {
  const now = new Date('2026-11-21T04:00:00.000Z');
  const record = recordFor('pay_TestPayment01', now);
  assert.equal(record.expiresAt, '2026-11-28T04:00:00.000Z');
  assert.equal(UNLOCK_DAYS, 7);
  assert.equal(stillValid(record, new Date('2026-11-27T23:59:00.000Z')), true);
  assert.equal(stillValid(record, new Date('2026-11-28T04:00:01.000Z')), false);
  assert.equal(stillValid({ ref: 'pay_x', expiresAt: 'whenever' }, now), false);
  assert.equal(stillValid({ expiresAt: record.expiresAt }, now), false);
  assert.equal(stillValid(null, now), false);
});

test('the same payment arriving twice does not move the expiry', async () => {
  const kept = new Map();
  const store = {
    async get(key) { return kept.has(key) ? JSON.parse(kept.get(key)) : null; },
    async setJSON(key, value) { kept.set(key, JSON.stringify(value)); },
  };
  const key = addressKey('https://myapp.lovable.app', PEPPER).key;
  await grant(store, key, 'pay_TestPayment01', new Date('2026-11-21T04:00:00.000Z'));
  const first = kept.get(key);
  await grant(store, key, 'pay_TestPayment01', new Date('2026-11-23T04:00:00.000Z'));
  assert.equal(kept.get(key), first);
  // A different payment for the same address does start a new window.
  await grant(store, key, 'pay_TestPayment02', new Date('2026-11-23T04:00:00.000Z'));
  assert.notEqual(kept.get(key), first);
});

test('with no store at all, nothing is unlocked and nothing throws', async () => {
  assert.equal(await isUnlocked('https://myapp.lovable.app', PEPPER), false);
  assert.equal(await isUnlocked('not a url', PEPPER), false);
  assert.equal(await isUnlocked('https://myapp.lovable.app', 'tooshort'), false);
});

test('the payment link we ask for emails nobody and cannot be part paid', () => {
  const now = new Date('2026-11-21T04:00:00.000Z');
  const body = linkBody({ amount: 79900, currency: 'INR', reference: 'f'.repeat(32), callbackUrl: 'https://example.test/api/unlock', now });
  assert.equal(body.notify.email, false);
  assert.equal(body.notify.sms, false);
  assert.equal(body.reminder_enable, false);
  assert.equal(body.accept_partial, false);
  assert.equal(body.callback_method, 'get');
  assert.equal(body.amount, 79900);
  assert.equal(body.currency, 'INR');
  assert.equal(body.expire_by, Math.floor(now.getTime() / 1000) + 86400);
  // Razorpay is never told whose site it was.
  assert.equal(JSON.stringify(body).includes('lovable'), false);
  assert.equal('customer' in body, false);
});

test('creating a link sends Basic auth and returns the address to pay at', async () => {
  const seen = {};
  const fakeFetch = async (url, init) => {
    seen.url = url; seen.init = init;
    return { ok: true, status: 200, async text() { return JSON.stringify({ id: 'plink_abc', short_url: 'https://rzp.io/i/abc' }); } };
  };
  const got = await createPaymentLink(paymentsConfig(ready), { amount: 79900, currency: 'INR', reference: 'f'.repeat(32), callbackUrl: 'https://example.test/api/unlock' }, fakeFetch);
  assert.equal(got.ok, true);
  assert.equal(got.payUrl, 'https://rzp.io/i/abc');
  assert.equal(seen.url, 'https://api.razorpay.com/v1/payment_links/');
  assert.equal(seen.init.method, 'POST');
  const expected = `Basic ${Buffer.from(`rzp_test_abc123:${SECRET}`).toString('base64')}`;
  assert.equal(seen.init.headers.authorization, expected);
});

test('a refusal or a nonsense answer from Razorpay is not treated as a sale', async () => {
  const refused = async () => ({ ok: false, status: 400, async text() { return JSON.stringify({ error: { description: 'reference_id is not unique' } }); } });
  assert.equal((await createPaymentLink(paymentsConfig(ready), { amount: 1, currency: 'INR', reference: 'f'.repeat(32), callbackUrl: 'https://x.test/api/unlock' }, refused)).ok, false);

  const junk = async () => ({ ok: true, status: 200, async text() { return 'not json'; } });
  assert.equal((await createPaymentLink(paymentsConfig(ready), { amount: 1, currency: 'INR', reference: 'f'.repeat(32), callbackUrl: 'https://x.test/api/unlock' }, junk)).ok, false);

  const httpLink = async () => ({ ok: true, status: 200, async text() { return JSON.stringify({ id: 'plink_abc', short_url: 'http://rzp.io/i/abc' }); } });
  assert.equal((await createPaymentLink(paymentsConfig(ready), { amount: 1, currency: 'INR', reference: 'f'.repeat(32), callbackUrl: 'https://x.test/api/unlock' }, httpLink)).ok, false);

  const dead = async () => { throw new Error('network'); };
  assert.equal((await createPaymentLink(paymentsConfig(ready), { amount: 1, currency: 'INR', reference: 'f'.repeat(32), callbackUrl: 'https://x.test/api/unlock' }, dead)).ok, false);
});

// The endpoints themselves. The important case is the one that is live today:
// with nothing configured, none of this does anything at all.
import checkout from '../netlify/functions/checkout.mjs';
import unlock from '../netlify/functions/unlock.mjs';
import webhook from '../netlify/functions/razorpay-webhook.mjs';

const KEYS = ['UNBORK_PAYMENTS', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'UNBORK_UNLOCK_SECRET', 'UNBORK_INTERNATIONAL'];
function withEnv(values, fn) {
  const saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  for (const [k, v] of Object.entries(values)) process.env[k] = v;
  return (async () => {
    try { return await fn(); } finally {
      for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  })();
}

const post = (url, body) => new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('with payments off, checkout says so and asks Razorpay for nothing', async () => {
  await withEnv({}, async () => {
    const res = await checkout(post('https://unbork.test/api/checkout', { url: 'https://myapp.lovable.app' }));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /not on sale yet/i);
  });
});

test('with payments off, the webhook refuses everything', async () => {
  await withEnv({}, async () => {
    assert.equal((await webhook(post('https://unbork.test/api/razorpay/webhook', {}))).status, 503);
  });
});

test('a webhook with a wrong signature is refused even when payments are on', async () => {
  await withEnv(ready, async () => {
    const res = await webhook(new Request('https://unbork.test/api/razorpay/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'f'.repeat(64) },
      body: JSON.stringify(webhookEvent()),
    }));
    assert.equal(res.status, 401);
  });
});

test('a webhook with no signature header at all is refused', async () => {
  await withEnv(ready, async () => {
    assert.equal((await webhook(post('https://unbork.test/api/razorpay/webhook', webhookEvent()))).status, 401);
  });
});

test('visiting the unlock address by hand unlocks nothing', async () => {
  await withEnv(ready, async () => {
    const res = await unlock(new Request('https://unbork.test/api/unlock'));
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), 'https://unbork.test/?paid=bad');
  });
  await withEnv(ready, async () => {
    const forged = new URLSearchParams({
      razorpay_payment_link_id: 'plink_TestLink0001',
      razorpay_payment_link_reference_id: referenceFor(addressKey('https://myapp.lovable.app', PEPPER).key),
      razorpay_payment_link_status: 'paid',
      razorpay_payment_id: 'pay_TestPayment01',
      razorpay_signature: 'a'.repeat(64),
    });
    const res = await unlock(new Request(`https://unbork.test/api/unlock?${forged}`));
    assert.equal(res.headers.get('location'), 'https://unbork.test/?paid=bad');
  });
});

test('with payments off, a report still comes back and still has no fixes in it', async () => {
  await withEnv({}, async () => {
    const res = await checkout(new Request('https://unbork.test/api/checkout', { method: 'GET' }));
    assert.equal(res.status, 405);
  });
});

test('the checkout endpoint refuses an address it would not scan', async () => {
  await withEnv(ready, async () => {
    const res = await checkout(post('https://unbork.test/api/checkout', { url: 'http://127.0.0.1/' }));
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /only reachable from your own machine/i);
  });
});

// A tool that checks other people's privacy policies cannot have a policy that
// no longer matches its own code. These are the claims the code above makes.
import { readFileSync } from 'node:fs';

test('the privacy policy describes what the unlock actually stores', () => {
  const privacy = readFileSync('public/privacy.html', 'utf8');
  for (const claim of [
    'Razorpay',
    'one-way hash',
    'seven days',
    'payment reference',
    'razorpay.com/privacy',
  ]) {
    assert.ok(privacy.includes(claim), `the privacy policy does not mention ${claim}`);
  }
  // The page used to say this, and the payment flow makes it untrue.
  assert.equal(privacy.includes('uses no local storage'), false);
  // It must not promise that card details reach us, or that we keep nothing.
  assert.ok(privacy.includes('never reach us'));
});

test('the terms point at what a paid report covers', () => {
  const terms = readFileSync('public/terms.html', 'utf8');
  assert.ok(terms.includes('Razorpay'));
  assert.ok(terms.includes('/privacy#paid'));
});
