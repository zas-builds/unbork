# Unbork

Internal repository. Private.

Unbork checks a live website from outside and reports, in plain English, what
is broken, what is leaking and which legal basics are missing. The free check
shows every problem; the paid full report (not live yet) adds fix steps and a
paste-ready prompt per problem.

## Layout

- `public/` static site: landing page and report (`index.html`, `assets/`),
  `privacy.html`, `terms.html`, SEO files. No build step, no third-party
  requests, strict CSP set in `netlify.toml`.
- `netlify/functions/scan.mjs` the one endpoint, `/api/scan`, rate limited to
  10 checks per minute per IP.
- `lib/` all logic, no platform code:
  - `safeFetch.mjs` fetching pasted addresses safely: redirects re-checked hop
    by hop, private and reserved IPs refused at connect time, web ports only.
  - `fetchSite.mjs` page, scripts, deep-link probe and legal page chunks, with
    time and size caps.
  - `checks/` page loads, keys, settings, deep links, legal basics, headers.
  - `rules.mjs` every legal source, official URLs only, with the date verified.
  - `fixes.mjs` the paid content. Never sent to the browser unless
    `includeFixes` is set (owner preview key in `UNBORK_PREVIEW_KEY`).
- `test/` `npm test`, no network needed.
- `tools/dev-server.mjs` local server; `tools/audit-rules.mjs` lists legal
  sources due for a re-check (`npm run audit-rules`).

## Rules for changing checks

1. A finding ships only if it can be proved from what the host sends.
2. Calibrate every new check against at least five real live sites before it
   ships. A finding that fires on healthy sites does not ship.
3. Legal findings are never red, never say "compliant", and always cite a
   source from `rules.mjs`. Re-verify sources at least every 90 days.
