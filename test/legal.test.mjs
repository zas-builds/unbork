import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEGAL_CHECK } from '../lib/checks/legal.mjs';
import { RULES, staleRules } from '../lib/rules.mjs';

const site = (html, js = '', extra = {}) => ({
  finalUrl: 'https://x.test/', html,
  assets: js ? [{ url: 'https://x.test/assets/index.js', body: js, status: 200 }] : [],
  legalAssets: [], setCookies: [], ...extra,
});
const ids = (r) => r.items.map((i) => i.id);

test('tracking with no consent tool is flagged, with the official source', () => {
  const r = LEGAL_CHECK.run(site('<div id="root"></div><script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC"></script>'));
  const item = r.items.find((i) => i.id === 'tracking-without-consent');
  assert.ok(item);
  assert.equal(item.level, 'amber');
  assert.match(item.plain, /Google Analytics/);
  assert.match(item.sources[0].url, /^https:\/\/ico\.org\.uk\//);
});

test('a consent tool turns the flag into a note, never a finding', () => {
  const r = LEGAL_CHECK.run(site('<script src="https://consent.cookiebot.com/uc.js"></script><script src="https://www.googletagmanager.com/gtag/js?id=G-ABC"></script><a href="/privacy">Privacy</a>'));
  assert.ok(!ids(r).includes('tracking-without-consent'));
  assert.ok(r.notes.some((n) => /refuse cookies/.test(n)));
});

test('a route to /privacy in the bundle counts as a policy', () => {
  const r = LEGAL_CHECK.run(site('<div id="root"></div>', 'const routes=[{path:"/privacy",element:P},{path:"/login"}];const f=`<input type="email">`;'));
  assert.ok(!ids(r).includes('no-privacy-policy'));
  assert.ok(r.safe.some((s) => /links to a privacy policy/.test(s)));
});

test('sign-in with no policy anywhere is amber; a brochure site is only info', () => {
  const withLogin = LEGAL_CHECK.run(site('<div id="root"></div>', 'await supabase.auth.signInWithPassword({email,password});'));
  assert.equal(withLogin.items.find((i) => i.id === 'no-privacy-policy').level, 'amber');
  const brochure = LEGAL_CHECK.run(site('<h1>Hello</h1><p>We make chairs.</p>'));
  assert.equal(brochure.items.find((i) => i.id === 'no-privacy-policy').level, 'info');
  assert.equal(brochure.level, 'green', 'advice must not change the light');
});

test('Razorpay with missing pages names exactly what is missing', () => {
  const r = LEGAL_CHECK.run(site('<script src="https://checkout.razorpay.com/v1/checkout.js"></script><a href="/privacy-policy">Privacy</a><a href="mailto:a@b.c">Mail</a>'));
  const item = r.items.find((i) => i.id === 'payment-pages-missing');
  assert.equal(item.level, 'amber');
  assert.match(item.plain, /terms and conditions/);
  assert.match(item.plain, /refund/);
  assert.doesNotMatch(item.plain, /a privacy policy/);
  assert.match(item.sources[0].url, /razorpay\.com\/docs/);
});

test('a tracking cookie set on arrival is reported by name', () => {
  const r = LEGAL_CHECK.run(site('<p>x</p>', '', { setCookies: ['_ga=GA1.1.1; Path=/', 'session=abc; HttpOnly'] }));
  const item = r.items.find((i) => i.id === 'tracking-cookie-on-arrival');
  assert.match(item.plain, /_ga/);
  assert.doesNotMatch(item.plain, /session/);
});

test('legal findings are never red', () => {
  const r = LEGAL_CHECK.run(site('<script src="https://connect.facebook.net/en_US/fbevents.js"></script><script src="https://js.stripe.com/v3"></script><input type="password">'));
  assert.ok(r.items.length >= 3);
  assert.ok(r.items.every((i) => i.level !== 'red'));
  assert.ok(r.items.every((i) => i.group === 'legal'));
});

test('every legal source is official https and recently verified', () => {
  for (const [id, r] of Object.entries(RULES)) {
    assert.match(r.url, /^https:\/\//, id);
    assert.ok(r.law && r.says && r.applies, id);
  }
  assert.deepEqual(staleRules(new Date('2026-11-18')), []);
});

test('every finding the checks can produce has a paid fix written', async () => {
  const { readFile } = await import('node:fs/promises');
  const { FIXES } = await import('../lib/fixes.mjs');
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(new URL('../lib/checks/', import.meta.url));
  const ids = new Set();
  for (const f of files) {
    const src = await readFile(new URL(`../lib/checks/${f}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/\bid:\s*'([a-z0-9-]+)'/g)) ids.add(m[1]);
    for (const m of src.matchAll(/kind:\s*'([a-z0-9-]+)'/g)) ids.add(m[1]);
  }
  const checkIds = new Set(['deep-links', 'connection', 'keys-in-javascript', 'page-loads', 'settings-filled', 'legal-basics']);
  const fine = new Set(['supabase-publishable', 'stripe-publishable', 'google-browser-key', 'supabase-anon']);
  for (const id of ids) {
    if (checkIds.has(id) && id !== 'deep-links') continue;
    if (fine.has(id)) continue;
    assert.ok(FIXES[id], `no fix written for ${id}`);
  }
});

test('a report never carries the paid fixes unless asked to', async () => {
  const { buildReport } = await import('../lib/report.mjs');
  const site = { requestedUrl: 'https://x.test/', finalUrl: 'https://x.test/', status: 200, ms: 1, scriptsFound: 0, scriptsFetched: 0 };
  const results = [{ id: 'deep-links', items: [{ id: 'deep-links', level: 'red', headline: 'h', plain: 'p', where: [] }] }];
  const free = buildReport(site, JSON.parse(JSON.stringify(results)));
  assert.equal(free.items[0].fix, undefined);
  assert.equal(free.items[0].fixReady, true);
  assert.equal(JSON.stringify(free).includes('index.html with status 200'), false);
  const paid = buildReport(site, JSON.parse(JSON.stringify(results)), { includeFixes: true });
  assert.ok(paid.items[0].fix.prompt.length > 50);
});
