import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { normaliseUrl, isPrivateHost } from '../lib/url.mjs';
import { findKeys } from '../lib/checks/keys.mjs';
import { runScan } from '../lib/scan.mjs';
import { KEYS, okHtml, okJs, ROUTES } from './fixtures.mjs';

const SERVICE_ROLE_JWT = KEYS.serviceRole;

// Serves the fixtures over real HTTP so the fetching code is exercised, not
// mocked. By default it behaves like a correctly configured host for a
// single-page app: an unknown path gets the app shell, not an error. Pass
// { fallback: null } for a host that has no such rule.
const SHELL = '<!doctype html><html><body><div id="root"></div><script src="/assets/app.js"></script></body></html>';

async function startFixtureServer({ fallback = SHELL } = {}) {
  const routes = ROUTES;
  const server = createServer((req, res) => {
    const hit = routes[req.url.split('?')[0]];
    if (!hit) {
      if (fallback) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fallback); return; }
      res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>Not found</h1>'); return;
    }
    res.writeHead(200, { 'content-type': hit[0] });
    res.end(hit[1]);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, stop: () => new Promise((r) => server.close(r)) };
}

test('normaliseUrl fills in https and explains what it rejects', () => {
  assert.equal(normaliseUrl('myapp.lovable.app').url, 'https://myapp.lovable.app/');
  assert.equal(normaliseUrl(' https://a.b/c#top ').url, 'https://a.b/c');
  assert.match(normaliseUrl('').error, /paste your site address/i);
  assert.match(normaliseUrl('notahost').error, /missing its ending/i);
  assert.match(normaliseUrl('javascript:alert(1)').error, /http or https/i);
  assert.match(normaliseUrl('data:text/html,<b>hi').error, /http or https/i);
  assert.match(normaliseUrl('file:///etc/passwd').error, /http or https/i);
  // A host with a port is not a scheme.
  assert.equal(normaliseUrl('myapp.fly.dev:8080/app').url, 'https://myapp.fly.dev:8080/app');
  assert.match(normaliseUrl('http://localhost:3000').error, /only reachable from your own machine/i);
  assert.match(normaliseUrl('http://192.168.0.5').error, /only reachable from your own machine/i);
  assert.equal(normaliseUrl('http://127.0.0.1:8080', { allowLocal: true }).error, undefined);
});

test('private hosts are recognised', () => {
  for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', 'metadata.google.internal']) {
    assert.equal(isPrivateHost(h), true, h);
  }
  for (const h of ['example.com', 'myapp.lovable.app', '8.8.8.8', '172.32.0.1']) {
    assert.equal(isPrivateHost(h), false, h);
  }
});

test('a service role key is found and its role read from the token', () => {
  const found = findKeys([{ where: 'app.js', text: `const k="${SERVICE_ROLE_JWT}"` }]);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'supabase-service-role');
  assert.equal(found[0].level, 'red');
  assert.equal(found[0].role, 'service_role');
  assert.ok(!found[0].masked.includes('service_role'), 'the key itself must not be echoed back');
});

test('spinner class names and public keys are not reported as secrets', () => {
  const found = findKeys([
    { where: 'ok.html', text: okHtml },
    { where: 'ok.js', text: okJs },
  ]);
  assert.equal(found.filter((f) => f.level === 'red').length, 0);
  assert.equal(found.filter((f) => f.level === 'amber').length, 0);
  const kinds = found.map((f) => f.kind).sort();
  assert.deepEqual(kinds, ['google-browser-key', 'stripe-publishable', 'supabase-anon', 'supabase-publishable']);
});

test('end to end: a leaky site comes back red, in plain English, with no key echoed', async () => {
  const srv = await startFixtureServer();
  try {
    const r = await runScan(`${srv.base}/bad`, { allowLocal: true });
    assert.equal(r.ok, true);
    assert.equal(r.verdict, 'red');
    // Advice-level items are tested separately; this test is about the keys.
    const headlines = r.items.filter((i) => i.level !== 'info').map((i) => i.headline).sort();
    assert.deepEqual(headlines, [
      'Anyone who opens your site can take over your database',
      'Your AI key is in your site\u2019s code',
      'Your live Stripe key is in your site\u2019s code',
    ]);
    const db = r.items.find((i) => /take over your database/.test(i.headline));
    assert.deepEqual(db.kinds.sort(), ['supabase-secret', 'supabase-service-role'], 'both database keys read as one problem');
    assert.ok(db.where.some((w) => w.includes('/assets/index-bad.js')));
    assert.ok(db.where.some((w) => w.endsWith('/bad')));
    assert.equal(db.where.length, 2, 'each place listed once');
    const json = JSON.stringify(r);
    assert.ok(!json.includes(SERVICE_ROLE_JWT), 'full key must never leave the function');
    assert.ok(!json.includes(KEYS.stripeSecret));
    assert.ok(!json.includes(KEYS.openai));
    assert.equal(r.scripts.read, 1);
  } finally { await srv.stop(); }
});

test('end to end: a tidy site comes back green and says why the public keys are fine', async () => {
  const srv = await startFixtureServer();
  try {
    const r = await runScan(`${srv.base}/ok`, { allowLocal: true });
    assert.equal(r.verdict, 'green');
    assert.equal(r.items.filter((i) => i.level !== 'info').length, 0);
    assert.ok(r.safe.some((s) => /no key that lets a stranger act as you/i.test(s)));
    assert.ok(r.safe.some((s) => /anon key/i.test(s)));
  } finally { await srv.stop(); }
});

test('an address that does not answer gives a plain message, not a crash', async () => {
  const r = await runScan('http://127.0.0.1:1/', { allowLocal: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /could not open that address/i);
});

test('a private address is refused before any request is made', async () => {
  let called = false;
  const r = await runScan('http://169.254.169.254/latest/meta-data/', {
    fetchImpl: () => { called = true; throw new Error('should not be called'); },
  });
  assert.equal(r.ok, false);
  assert.equal(called, false);
});
