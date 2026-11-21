// Who has paid, stored so that nobody reading the file can tell whose site it
// was.
//
// Unbork has no accounts, so the only thing that can connect a payment to a
// report is the address itself. Storing the address would undo the promise the
// privacy policy makes, so we store a one-way hash of it instead: HMAC-SHA256
// with a secret that lives only in the server's environment. Given the file,
// you cannot work backwards to the address without that secret, and given the
// address we can always work forwards to find the record.
//
// Shape of one record:
//   { ref: "pay_XXXXXXXXXXXX", paidAt: "2026-11-21T04:00:00.000Z",
//     expiresAt: "2026-11-28T04:00:00.000Z" }
//
// That is the whole of it. No address, no email, no name, no IP, no amount, no
// row of anybody's data. "ref" is the payment reference, which is what a
// refund needs and what proves to us that a payment existed.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { normaliseUrl } from './url.mjs';

export const STORE_NAME = 'unbork-unlocks';
export const UNLOCK_DAYS = 7;

// A secret shorter than this is treated as absent, so a half-filled
// environment variable can never produce weak, reversible hashes.
export const MIN_SECRET = 32;

// One address, written one way. "MyApp.Lovable.app/" and
// "https://myapp.lovable.app" are the same report, so they get the same key.
// The query string is dropped: it is not part of which site was checked.
export function canonicalAddress(input) {
  const { url, error } = normaliseUrl(input);
  if (error) return { error };
  const u = new URL(url);
  u.hash = '';
  u.search = '';
  u.hostname = u.hostname.toLowerCase();
  let path = u.pathname.replace(/\/+$/, '');
  return { address: `${u.protocol}//${u.host}${path}` };
}

// 24 hex characters, which is 96 bits of the HMAC. The full 64 would be
// tidier, but this key travels to Razorpay as a payment link's reference_id,
// and Razorpay documents that field as a short business reference without
// stating a maximum length anywhere we could find. Rather than guess, we stay
// well inside any plausible limit. 96 bits is still far more than enough for
// the number of addresses this will ever see.
export const KEY_CHARS = 24;
export const NONCE_CHARS = 8;

export function addressKey(input, secret) {
  if (!secret || String(secret).length < MIN_SECRET) return { error: 'no-secret' };
  const { address, error } = canonicalAddress(input);
  if (error) return { error };
  const full = createHmac('sha256', String(secret)).update(address).digest('hex');
  return { key: full.slice(0, KEY_CHARS) };
}

// Razorpay requires a payment link's reference to be unique, and somebody who
// starts a payment, gives up and tries again needs a second link for the same
// address. So the reference is the address key followed by eight random
// characters: unique every time, and the key is always the first 24.
export function referenceFor(key) {
  return `${key}${randomBytes(NONCE_CHARS / 2).toString('hex')}`;
}

export function keyFromReference(reference) {
  const r = String(reference || '').toLowerCase();
  if (!new RegExp(`^[0-9a-f]{${KEY_CHARS + NONCE_CHARS}}$`).test(r)) return null;
  return r.slice(0, KEY_CHARS);
}

export function expiresAt(now = new Date()) {
  return new Date(now.getTime() + UNLOCK_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// Pure, so the rules about what counts as paid can be tested without a store.
export function stillValid(record, now = new Date()) {
  if (!record || typeof record !== 'object') return false;
  if (typeof record.ref !== 'string' || !record.ref) return false;
  const until = Date.parse(record.expiresAt);
  if (!Number.isFinite(until)) return false;
  return until > now.getTime();
}

export function recordFor(ref, now = new Date()) {
  return { ref: String(ref).slice(0, 64), paidAt: now.toISOString(), expiresAt: expiresAt(now) };
}

export async function openStore() {
  try {
    const mod = await import('@netlify/blobs');
    if (!mod || typeof mod.getStore !== 'function') return null;
    return mod.getStore({ name: STORE_NAME, consistency: 'strong' });
  } catch {
    return null;
  }
}

// Granting is idempotent on purpose. The same payment reaches us twice, once
// when the payer comes back to the site and once by webhook, and whichever
// arrives second must not shorten or extend what the first one gave.
export async function grant(store, key, ref, now = new Date()) {
  if (!store || !key) return false;
  const existing = await read(store, key, now);
  if (existing && existing.ref === String(ref)) return true;
  await store.setJSON(key, recordFor(ref, now));
  return true;
}

async function read(store, key, now) {
  try {
    const got = await store.get(key, { type: 'json' });
    if (stillValid(got, now)) return got;
    // An unlock that has run out unlocks nothing, so there is no reason to
    // keep it. Deleting it here means expired records clear themselves out
    // rather than sitting in the store for ever.
    if (got) { try { await store.delete(key); } catch { /* next time */ } }
    return null;
  } catch {
    return null;
  }
}

// Never let a storage wobble unlock something that was not paid for, and never
// let one break a free report either: on any error this returns false and the
// visitor simply sees the free report they already had.
export async function isUnlocked(input, secret, now = new Date()) {
  const { key, error } = addressKey(input, secret);
  if (error) return false;
  try {
    const store = await openStore();
    if (!store) return false;
    return Boolean(await read(store, key, now));
  } catch {
    return false;
  }
}

// Constant-time comparison of two hex strings of the same length.
export function sameHex(a, b) {
  const x = String(a || ''), y = String(b || '');
  if (x.length !== y.length || !x.length) return false;
  if (!/^[0-9a-f]+$/i.test(x) || !/^[0-9a-f]+$/i.test(y)) return false;
  return timingSafeEqual(Buffer.from(x.toLowerCase(), 'hex'), Buffer.from(y.toLowerCase(), 'hex'));
}
