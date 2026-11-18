// The guide pages are the first thing a stranger reads, and they make factual
// claims. These tests hold them to the house rules: one answer in the first
// lines, a canonical address, machine-readable question and answer, every
// source an official https page, and no placeholder left in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = 'public/guides';
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.html'));

// Sources a guide is allowed to cite: the official text or the company's own
// documentation, never a blog. Adding one here is a deliberate act.
const ALLOWED = [
  'https://docs.netlify.com/',
  'https://vercel.com/docs/',
  'https://supabase.com/docs/',
  'https://ico.org.uk/',
  'https://eur-lex.europa.eu/',
  'https://www.meity.gov.in/',
  'https://oag.ca.gov/',
];

test('there are three guides', () => {
  assert.equal(FILES.length, 3);
});

for (const file of FILES) {
  const html = readFileSync(`${DIR}/${file}`, 'utf8');
  const slug = file.replace(/\.html$/, '');

  test(`${slug}: answers in its first lines and is findable`, () => {
    assert.match(html, /<link rel="canonical" href="https:\/\/[^"]+\/guides\/[a-z0-9-]+">/);
    assert.match(html, /<h1>[^<]*\?<\/h1>/, 'the heading is the question itself');
    const firstPara = html.split('<p class="updated">')[1].split('</p>')[1];
    assert.match(firstPara.slice(0, 400), /<strong>Short answer:<\/strong>/);
  });

  test(`${slug}: question and answer are machine readable`, () => {
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/)[1]);
    const faq = ld['@graph'].find((n) => n['@type'] === 'FAQPage');
    assert.ok(faq, 'a guide must publish its question and answer as FAQPage');
    const q = faq.mainEntity[0];
    assert.match(q.name, /\?$/);
    assert.ok(q.acceptedAnswer.text.length > 120, 'the answer must be a real answer');
  });

  test(`${slug}: every source is official, and nothing is left unfinished`, () => {
    const own = new URL(html.match(/<link rel="canonical" href="([^"]+)">/)[1]).origin;
    const links = [...html.matchAll(/href="(http[^"]+)"/g)].map((m) => m[1])
      .filter((l) => !l.startsWith(own));
    for (const link of links) {
      assert.ok(ALLOWED.some((a) => link.startsWith(a)), `unapproved source: ${link}`);
    }
    assert.ok(links.length >= 1, 'a factual guide cites at least one source');
    assert.doesNotMatch(html, /\[to be added\]|TODO|class="todo"|lorem/i);
  });
}
