// One scan, start to finish. Pure apart from the fetch it is given, so the
// tests can run it against fixtures with no network.

import { fetchSite } from './fetchSite.mjs';
import { KEY_CHECK } from './checks/keys.mjs';
import { PAGE_LOADS_CHECK } from './checks/pageLoads.mjs';
import { SETTINGS_CHECK } from './checks/settings.mjs';
import { DEEP_LINK_CHECK } from './checks/deepLinks.mjs';
import { HEADERS_CHECK } from './checks/headers.mjs';
import { LEGAL_CHECK } from './checks/legal.mjs';
import { buildReport } from './report.mjs';

// Order matters: this is the order the cards appear in within each level.
// Can it load at all, is anything leaking, is it wired up, does it hold
// together, then the nice-to-haves.
export const CHECKS = [
  PAGE_LOADS_CHECK,
  KEY_CHECK,
  SETTINGS_CHECK,
  DEEP_LINK_CHECK,
  LEGAL_CHECK,
  HEADERS_CHECK,
];

export async function runScan(input, opts = {}) {
  const site = await fetchSite(input, opts);
  if (!site.ok) return { ok: false, error: site.error, url: site.url || null };
  const results = CHECKS.map((c) => c.run(site));
  return buildReport(site, results, { includeFixes: Boolean(opts.includeFixes) });
}
