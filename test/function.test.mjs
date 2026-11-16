import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/scan.mjs';

const req = (url, init) => new Request(url, init);

test('no address given gives a plain 400', async () => {
  const res = await handler(req('https://unbork.test/api/scan'));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /paste your site address/i);
});

test('an address only the server could reach is refused', async () => {
  const res = await handler(req('https://unbork.test/api/scan?url=http://169.254.169.254/'));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /only reachable from your own machine/i);
});

test('POST is accepted and the browser preflight answered', async () => {
  const res = await handler(req('https://unbork.test/api/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'http://127.0.0.1:1/' }),
  }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /only reachable from your own machine/i);

  const pre = await handler(req('https://unbork.test/api/scan', { method: 'OPTIONS' }));
  assert.equal(pre.status, 204);
});

test('other methods are turned away', async () => {
  const res = await handler(req('https://unbork.test/api/scan', { method: 'DELETE' }));
  assert.equal(res.status, 405);
});

test('the answer is JSON and never cached', async () => {
  const res = await handler(req('https://unbork.test/api/scan'));
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});
