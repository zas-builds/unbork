// One scan, start to finish. Pure apart from the fetch it is given, so the
// tests can run it against fixtures with no network.

import { fetchSite } from './fetchSite.mjs';
import { KEY_CHECK } from './checks/keys.mjs';
import { buildReport } from './report.mjs';

export const CHECKS = [KEY_CHECK];

export async function runScan(input, opts = {}) {
  const site = await fetchSite(input, opts);
  if (!site.ok) return { ok: false, error: site.error, url: site.url || null };
  const results = CHECKS.map((c) => c.run(site));
  return buildReport(site, results);
}
