// The counter has one job and one promise: count checks, store nothing else.
// These tests hold it to both, and prove two checks at the same moment do not
// lose a count.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bump, isoDay, recordScan, readStats } from '../lib/counter.mjs';

// A stand-in for Netlify Blobs: same conditional-write contract (etag in,
// { modified: false } out when somebody else wrote first).
function fakeStore() {
  const state = { value: null, etag: null, writes: 0, reads: 0, raw: [] };
  return {
    state,
    async getWithMetadata(key, opts) {
      state.reads += 1;
      if (state.value === null) return null;
      return { data: JSON.parse(state.value), etag: state.etag };
    },
    async get(key, opts) {
      return state.value === null ? null : JSON.parse(state.value);
    },
    async setJSON(key, value, opts = {}) {
      state.writes += 1;
      if (opts.onlyIfNew && state.value !== null) return { modified: false };
      if (opts.onlyIfMatch && opts.onlyIfMatch !== state.etag) return { modified: false };
      state.value = JSON.stringify(value);
      state.raw.push(state.value);
      state.etag = `e${state.writes}`;
      return { modified: true };
    },
  };
}

test('a check adds one to today, and to the total', async () => {
  const store = fakeStore();
  const day = new Date('2026-11-18T04:05:06Z');
  assert.equal(await recordScan(store, 'ok', day), true);
  assert.equal(await recordScan(store, 'ok', day), true);
  assert.equal(await recordScan(store, 'failed', day), true);
  const stats = await readStats(store, 14, day);
  assert.deepEqual(stats.today, { ok: 2, failed: 1 });
  assert.deepEqual(stats.total, { ok: 2, failed: 1 });
  assert.deepEqual(Object.keys(stats.days), ['2026-11-18']);
});

test('two checks at the same moment both get counted', async () => {
  const store = fakeStore();
  const day = new Date('2026-11-18T04:05:06Z');
  await recordScan(store, 'ok', day);
  // Both read the same value, so one write is refused and has to try again.
  const [a, b] = await Promise.all([
    recordScan(store, 'ok', day),
    recordScan(store, 'ok', day),
  ]);
  assert.equal(a, true);
  assert.equal(b, true);
  const stats = await readStats(store, 14, day);
  assert.equal(stats.today.ok, 3, 'no count may be lost to a race');
});

test('nothing but dates and counts is ever stored', async () => {
  const store = fakeStore();
  await recordScan(store, 'ok', new Date('2026-11-18T04:05:06Z'));
  await recordScan(store, 'failed', new Date('2026-11-19T22:00:00Z'));
  const stored = JSON.parse(store.state.value);
  assert.deepEqual(Object.keys(stored).sort(), ['days', 'total']);
  for (const [key, value] of Object.entries(stored.days)) {
    assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(Object.keys(value).sort(), ['failed', 'ok']);
    for (const n of Object.values(value)) assert.equal(typeof n, 'number');
  }
  // No clock time, no address, no identifier, anywhere in the stored bytes.
  const text = store.state.value;
  assert.doesNotMatch(text, /http|\d{2}:\d{2}|ip|agent|referer/i);
});

test('only the last 90 days are kept', () => {
  let value = null;
  for (let i = 0; i < 95; i += 1) {
    const day = new Date(Date.UTC(2026, 0, 1) + i * 86400000);
    value = bump(value, isoDay(day), 'ok');
  }
  assert.equal(Object.keys(value.days).length, 90);
  assert.equal(value.total.ok, 95, 'the total survives the trim');
});

test('a store that is missing or broken never breaks a check', async () => {
  assert.equal(await recordScan(null, 'ok'), false);
  const angry = {
    async getWithMetadata() { throw new Error('no store here'); },
    async setJSON() { throw new Error('no store here'); },
  };
  await assert.rejects(() => recordScan(angry, 'ok'));
  const { recordScanQuietly } = await import('../lib/counter.mjs');
  assert.equal(typeof await recordScanQuietly('ok'), 'boolean');
});
