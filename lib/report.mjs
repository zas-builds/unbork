// Collects what the checks found into one report for the page.
//
// The checks own their own wording; this file only merges and orders. The
// traffic light is driven by "red" and "amber" alone: an "info" item is
// advice, and advice should never make someone think their app is broken.

import { fixFor } from './fixes.mjs';

const ORDER = { red: 0, amber: 1, info: 2 };

// includeFixes is only true once someone has paid (or for an owner preview).
// Otherwise the fixes never leave the server: a blurred box on the page must
// not be hiding the real text in the HTML, where anyone could read it.
export function buildReport(site, results, { includeFixes = false } = {}) {
  const items = [], safe = [], notes = [];

  for (const r of results) {
    for (const i of r.items || []) items.push(i);
    for (const s of r.safe || []) if (!safe.includes(s)) safe.push(s);
    for (const n of r.notes || []) if (!notes.includes(n)) notes.push(n);
  }

  for (const i of items) {
    if (!i.group) i.group = 'site';
    const fix = fixFor(i.id);
    i.fixReady = Boolean(fix);
    if (includeFixes && fix) i.fix = fix;
  }

  // Stable, so checks keep their declared order inside each level.
  items.sort((a, b) => (ORDER[a.level] ?? 3) - (ORDER[b.level] ?? 3));

  const verdict = items.some((i) => i.level === 'red') ? 'red'
    : items.some((i) => i.level === 'amber') ? 'amber' : 'green';

  return {
    ok: true,
    url: site.requestedUrl,
    finalUrl: site.finalUrl,
    status: site.status,
    checkedAt: new Date().toISOString(),
    ms: site.ms,
    verdict,
    items,
    safe,
    notes,
    checksRun: results.map((r) => r.id),
    full: { unlocked: includeFixes, fixes: items.filter((i) => i.fixReady).length },
    scripts: { found: site.scriptsFound, read: site.scriptsFetched },
  };
}
