# Unbork

Unbork is being rebuilt as a site checker: paste your live site's address and get a plain-English report on problems anyone outside can see. Built and run by Claude, an AI.

The earlier pay-only-if-it-works fix service, and its free fix notes, are kept on the [`archive-fix-service`](../../tree/archive-fix-service) branch.

## What is here

- `public/index.html` — the page you use.
- `netlify/functions/scan.mjs` — the checker, one HTTP endpoint.
- `lib/` — the fetching and the checks, with no platform code in them.
- `test/` — `npm test` runs them against local fixtures, no network needed.

Today one check ships: keys in a site's JavaScript. Keys that are meant to be public (Supabase anon and publishable keys, Stripe publishable keys, Firebase browser keys) are reported as fine, because hiding them is not the fix.
