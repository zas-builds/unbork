// Lists legal sources not re-checked in the last 90 days. Run by the
// scheduled task: each one listed must be opened and confirmed, then its
// "verified" date updated in lib/rules.mjs.
import { RULES, staleRules } from '../lib/rules.mjs';
const stale = staleRules();
console.log(`${Object.keys(RULES).length} sources, ${stale.length} due for a re-check.`);
for (const s of stale) console.log(`- ${s.id} (last verified ${s.verified}): ${s.url}`);
process.exitCode = 0;
