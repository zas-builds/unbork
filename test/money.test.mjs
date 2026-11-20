// The pricing and refund pages are promises to a stranger about money, so they
// are held to stricter rules than ordinary copy: one price, stated the same way
// everywhere, a refund window that matches the terms, no claim that anything is
// on sale while it is not, and every competitor figure linked to the page it
// came from.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pricing = readFileSync('public/pricing.html', 'utf8');
const refunds = readFileSync('public/refunds.html', 'utf8');
const home = readFileSync('public/index.html', 'utf8');
const terms = readFileSync('public/terms.html', 'utf8');
const toml = readFileSync('netlify.toml', 'utf8');

// The decided price, in one place. Changing it here should break every page
// that disagrees, which is the point.
const INR = '&#8377;799';
const USD = '$9';

test('every page states the same price', () => {
  for (const [name, html] of [['pricing', pricing], ['home', home], ['refunds', refunds]]) {
    assert.ok(html.includes(INR), `${name} must show the rupee price`);
    assert.ok(html.includes(USD), `${name} must show the dollar price`);
  }
  // No stray older price anywhere.
  for (const html of [pricing, home, refunds]) {
    assert.doesNotMatch(html, /\$(19|29|39|49)\b(?![^<]*<\/t[dh]>)/, 'an old price is still on the page');
  }
});

test('nothing claims to be on sale while payments are off', () => {
  for (const [name, html] of [['pricing', pricing], ['home', home]]) {
    assert.match(html, /not on sale yet/i, `${name} must say plainly that it is not on sale`);
    assert.doesNotMatch(html, /<button[^>]*class="btn"[^>]*>(Buy|Pay|Unlock)/i, `${name} must not offer a live buy button`);
  }
  assert.match(pricing, /<button class="btn" type="button" disabled>/, 'the buy button stays disabled');
});

test('the refund window is seven days and says so everywhere', () => {
  assert.match(refunds, /within seven days/);
  assert.match(pricing, /seven days/);
  assert.match(refunds, /do not have to give a reason/i);
  // The terms must point at both money pages rather than describing them.
  assert.match(terms, /href="\/pricing"/);
  assert.match(terms, /href="\/refunds"/);
});

test('every competitor figure carries the page it came from', () => {
  const rows = pricing.split('<tbody>')[1].split('</tbody>')[0].split('</tr>');
  const priced = rows.filter((r) => /\$\d/.test(r));
  assert.ok(priced.length >= 3, 'the comparison must cover more than one alternative');
  for (const row of priced) {
    if (/Unbork/.test(row)) continue;
    assert.match(row, /href="https:\/\/[^"]+"/, `a priced comparison row with no source: ${row.slice(0, 60)}`);
  }
  assert.match(pricing, /read on 20 November 2026/, 'the page must date its competitor figures');
});

test('nothing is left unfinished except the operator details we are waiting on', () => {
  for (const [name, html] of [['pricing', pricing], ['refunds', refunds]]) {
    assert.doesNotMatch(html, /\[to be decided\]|lorem ipsum|placeholder text/i, `${name} has an unfinished marker`);
  }
  // The yellow placeholders are deliberate and only for the operator details.
  for (const m of refunds.matchAll(/class="todo">([^<]*)/g)) {
    assert.match(m[1], /to be added/, 'a placeholder that is not an operator detail');
  }
  assert.doesNotMatch(pricing, /class="todo"/, 'the pricing page needs no placeholder');
});

test('both pages are served at their clean address', () => {
  for (const path of ['/pricing', '/refunds']) {
    assert.ok(toml.includes(`from = "${path}"`), `${path} has no redirect`);
    assert.ok(toml.includes(`to = "${path}.html"`), `${path} does not point at its file`);
  }
});

test('the report sets expectations with our own measured numbers', () => {
  const app = readFileSync('public/assets/app.js', 'utf8');
  assert.match(app, /function normalResult/, 'the report must explain what a normal result looks like');
  assert.match(app, /30 published Lovable apps/, 'that explanation must cite the study');
  assert.match(app, /18 November 2026/, 'and date it');
  // Three cases: clean, breakage-free but paperwork missing, and something broken.
  assert.equal((app.match(/class: 'normal'/g) || []).length, 3);
});
