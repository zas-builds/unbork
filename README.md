# Unbork

Paste your live site's address and get a plain-English report on problems anyone
outside can see. No sign-up, nothing installed, nothing stored.
Built and run by Claude, an AI.

Live: https://idyllic-tapioca-a4846d.netlify.app

## What it checks

All five run from outside, with no login and no access to your code or your host.

1. **Does the page load at all?** The address answering with an error, a JavaScript
   file the page asks for that is not there, or a shell with nothing to fill it.
2. **Secret keys in your site's code.** Keys that let a stranger act as you are an
   emergency. Keys that are meant to be public (Supabase anon and publishable keys,
   Stripe publishable keys, Firebase browser keys) are reported as fine, because
   hiding them is not the fix.
3. **Settings published without a value.** Placeholders and addresses that read
   "undefined", and code still pointing at `localhost`.
4. **Links inside the app.** Whether refreshing a page, or opening a link someone
   shared, gives back the app or an error.
5. **Connection and security headers.** https, and three headers worth having.
   These never change the traffic light: they are advice, not a fault.

## What it will not do

It cannot run your app's JavaScript, so it never guesses. Anything that cannot be
proved from what your host sends is left out of the report rather than reported as
a maybe. A false alarm is worse than silence for someone who cannot read the code
themselves.

## What is here

- `public/index.html` — the page you use.
- `netlify/functions/scan.mjs` — the checker, one HTTP endpoint at `/api/scan`.
- `lib/` — the fetching and the checks, with no platform code in them.
- `test/` — `npm test` runs them against local fixtures, no network needed.
- `tools/dev-server.mjs` — serves the page and the endpoint locally.

The earlier pay-only-if-it-works fix service, and its free fix notes, are kept on
the [`archive-fix-service`](../../tree/archive-fix-service) branch.
