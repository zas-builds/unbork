import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { runScan } from '../lib/scan.mjs';
import { probePath } from '../lib/fetchSite.mjs';
import { singlePageApp, emptyMount, visibleText, looksLikeSameApp } from '../lib/shell.mjs';
import { ROUTES, spaHtml, plainHtml, okHtml } from './fixtures.mjs';

// A host that can be told how to answer an unknown path, which is the whole
// difference between a working single-page app and a broken one.
const SHELL = '<!doctype html><html><body><div id="root"></div><script src="/assets/app.js"></script></body></html>';

async function host({ fallback = null, headers = {}, gone = [] } = {}) {
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (gone.includes(path)) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>Not found</h1>'); return; }
    const hit = ROUTES[path];
    if (!hit) {
      if (fallback) { res.writeHead(200, { 'content-type': 'text/html', ...headers }); res.end(fallback); return; }
      res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>Not found</h1>'); return;
    }
    res.writeHead(200, { 'content-type': hit[0], ...headers });
    res.end(hit[1]);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, stop: () => new Promise((r) => server.close(r)) };
}

const scan = (base, path, opts) => runScan(`${base}${path}`, { allowLocal: true, ...opts });
const find = (r, re) => r.items.find((i) => re.test(i.headline));

test('the probe asks for a path nobody could have', () => {
  const a = probePath(), b = probePath();
  assert.match(a, /^\/unbork-check-[a-z0-9]+$/);
  assert.notEqual(a, b, 'a fixed path could be cached or special-cased');
});

test('a single-page app is told apart from an ordinary page', () => {
  assert.equal(emptyMount(spaHtml), 'root');
  assert.equal(emptyMount(plainHtml), null);
  assert.equal(singlePageApp({ html: spaHtml, scriptsFound: 1, inline: [] }).isSpa, true);
  assert.equal(singlePageApp({ html: plainHtml, scriptsFound: 0, inline: [] }).isSpa, false);
  // Text with no script is not an app, and a script with real text is not a shell.
  assert.ok(visibleText(plainHtml).length > 120);
  assert.equal(singlePageApp({ html: okHtml, scriptsFound: 1, inline: ['x'] }).isSpa, true);
});

test('an app shell is recognised whether it matches exactly or by its bundle', () => {
  assert.equal(looksLikeSameApp(spaHtml, spaHtml), true);
  assert.equal(looksLikeSameApp(SHELL, spaHtml), true, 'same mount and a script is enough');
  assert.equal(looksLikeSameApp('<h1>Not found</h1>', spaHtml), false);
  assert.equal(looksLikeSameApp(SHELL, plainHtml), false, 'an ordinary page has no shell to match');
});

test('a single-page app on a host with no rewrite rule is reported red', async () => {
  const srv = await host({ fallback: null });
  try {
    const r = await scan(srv.base, '/spa');
    assert.equal(r.verdict, 'red');
    const item = find(r, /Refreshing or sharing/);
    assert.ok(item, 'the deep-link problem should be reported');
    assert.match(item.plain, /not found/i);
    assert.ok(item.where[0].includes('/unbork-check-'));
  } finally { await srv.stop(); }
});

test('the same app on a host that serves the shell is reported as working', async () => {
  const srv = await host({ fallback: SHELL });
  try {
    const r = await scan(srv.base, '/spa');
    assert.equal(r.verdict, 'green');
    assert.equal(find(r, /Refreshing or sharing/), undefined);
    assert.ok(r.safe.some((s) => /keep working when someone refreshes/i.test(s)));
  } finally { await srv.stop(); }
});

test('an ordinary page answering not found is correct, not a fault', async () => {
  const srv = await host({ fallback: null });
  try {
    const r = await scan(srv.base, '/plain');
    assert.equal(r.verdict, 'green');
    assert.equal(find(r, /Refreshing or sharing/), undefined);
    assert.ok(r.safe.some((s) => /that is what should happen/i.test(s)));
  } finally { await srv.stop(); }
});

test('settings left unfilled are reported, and a local address separately', async () => {
  const srv = await host({ fallback: SHELL });
  try {
    const r = await scan(srv.base, '/unset');
    assert.equal(r.verdict, 'red');
    const blank = find(r, /settings? left blank/);
    assert.ok(blank, 'the undefined database address should be reported');
    assert.equal(blank.level, 'red');
    assert.ok(blank.where.some((w) => w.includes('/assets/index-unset.js')));
    // Two placeholders, one cause, one card.
    assert.equal(r.items.filter((i) => /settings? left blank/.test(i.headline)).length, 1);
    assert.equal(blank.list.length, 2, 'each placeholder listed inside the one card');
    const local = find(r, /asks your own computer for data/);
    assert.ok(local, 'a localhost API address should be reported');
    assert.equal(local.level, 'amber', 'left-over test code is not an emergency');
    // The red card must come first: it is the one that matters.
    assert.equal(r.items[0].level, 'red');
  } finally { await srv.stop(); }
});

test('a page whose bundle is missing is reported as a blank page', async () => {
  const srv = await host({ fallback: null, gone: ['/assets/index-gone.js'] });
  try {
    const r = await scan(srv.base, '/stale');
    const item = find(r, /file your app needs is missing/i);
    assert.ok(item);
    assert.equal(item.level, 'red');
    assert.ok(item.where[0].includes('404'), 'the report should say what the host answered');
    assert.match(item.plain, /blank or half-drawn/);
    assert.match(item.plain, /That file is your app/, 'one missing file reads as one file');
  } finally { await srv.stop(); }
});

test('an empty shell with no JavaScript at all is reported', async () => {
  const srv = await host({ fallback: SHELL });
  try {
    const r = await scan(srv.base, '/empty');
    const item = find(r, /nothing on it/);
    assert.ok(item);
    assert.equal(item.level, 'red');
    assert.match(item.plain, /built files, not the source/);
  } finally { await srv.stop(); }
});

test('missing security headers are advice only and never change the verdict', async () => {
  const bare = await host({ fallback: null });
  try {
    const r = await scan(bare.base, '/plain');
    const advice = r.items.filter((i) => i.level === 'info');
    assert.equal(advice.length, 1, 'all of it in one card, not one card each');
    assert.equal(advice[0].list.length, 3);
    assert.equal(r.verdict, 'green', 'advice must not make a working site look broken');
  } finally { await bare.stop(); }

  const tidy = await host({
    fallback: null,
    headers: {
      'strict-transport-security': 'max-age=31536000',
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
    },
  });
  try {
    const r = await scan(tidy.base, '/plain');
    assert.equal(r.items.filter((i) => i.level === 'info').length, 0);
    assert.ok(r.safe.some((s) => /security headers we look for are all in place/i.test(s)));
  } finally { await tidy.stop(); }
});

test('a bare mention of localhost is not reported, only one used as an address', async () => {
  const srv = await host({ fallback: SHELL });
  try {
    // What real Lovable bundles contain: a comparison, not a call.
    const r = await scan(srv.base, '/spa');
    assert.equal(find(r, /own computer/), undefined);
  } finally { await srv.stop(); }

  const { SETTINGS_CHECK } = await import('../lib/checks/settings.mjs');
  const site = (text) => ({ finalUrl: 'https://x.test/', html: '', assets: [{ url: 'https://x.test/a.js', body: text, status: 200 }] });
  const fires = (text) => SETTINGS_CHECK.run(site(text)).items.some((i) => /own computer/.test(i.headline));
  assert.equal(fires('const isDev = location.origin === "http://localhost:5173";'), false, 'a development check is not a fault');
  assert.equal(fires('if (url.startsWith("http://localhost")) return true;'), false);
  assert.equal(fires('const API_URL = "http://localhost:3000/api";'), true);
  assert.equal(fires('fetch("http://localhost:8000/items")'), true);
  assert.equal(fires('{ baseURL: "http://127.0.0.1:4000" }'), true);
});

test('a content security policy counts instead of X-Frame-Options', async () => {
  const srv = await host({ fallback: null, headers: { 'content-security-policy': "frame-ancestors 'none'" } });
  try {
    const r = await scan(srv.base, '/plain');
    const advice = r.items.find((i) => i.level === 'info');
    assert.ok(advice.list.every((t) => !/other websites loading your app/.test(t)));
  } finally { await srv.stop(); }
});

test('every check runs, and a broken site reports all of its problems at once', async () => {
  const srv = await host({ fallback: null, gone: ['/assets/index-gone.js'] });
  try {
    const r = await scan(srv.base, '/stale');
    assert.deepEqual(r.checksRun, ['page-loads', 'keys-in-javascript', 'settings-filled', 'deep-links', 'connection']);
    assert.ok(find(r, /file your app needs is missing/i), 'the missing bundle');
    assert.ok(find(r, /Refreshing or sharing/), 'and the deep links, in the same report');
    assert.equal(r.verdict, 'red');
  } finally { await srv.stop(); }
});
