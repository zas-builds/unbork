// Test fixtures, built in memory rather than committed as files.
//
// Every key here is fabricated and belongs to no account: the JWTs carry the
// signature "FAKEsignatureNotValid" and the rest are invented strings. They
// are assembled from parts at run time so that no key-shaped literal is ever
// stored in this repository, which is what secret scanners look for.

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role) =>
  b64({ alg: 'HS256', typ: 'JWT' }) + '.' +
  b64({ iss: 'supabase', ref: 'examplefakeproject', role, iat: 1700000000, exp: 2000000000 }) + '.' +
  'FAKEsignatureNotValid000000000';

export const KEYS = {
  serviceRole: jwt('service_role'),
  anon: jwt('anon'),
  supabaseSecret: 'sb' + '_secret_' + 'FAKEaaaaaaaaaaaaaaaaaaaa1234',
  supabasePublishable: 'sb' + '_publishable_' + 'FAKEdddddddddddddddddd',
  stripeSecret: 'sk' + '_live_' + 'FAKEbbbbbbbbbbbbbbbbbbbb',
  stripePublishable: 'pk' + '_live_' + 'FAKE0000000000000000000',
  openai: 'sk-' + 'proj-' + 'FAKEcccccccccccccccccccccccccccc',
  firebase: 'AIza' + 'FAKE0000000000000000000000000000000',
};

export const badHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Leaky demo app</title></head>
<body>
<div id="root"></div>
<script>
  window.__CONFIG__ = { adminKey: "${KEYS.supabaseSecret}" };
</script>
<script type="module" crossorigin src="/assets/index-bad.js"></script>
</body></html>`;

export const badJs = `const SUPABASE_URL = "https://examplefakeproject.supabase.co";
const SUPABASE_ADMIN = "${KEYS.serviceRole}";
const SUPABASE_ANON = "${KEYS.anon}";
const STRIPE_PK = "${KEYS.stripePublishable}";
const STRIPE_SK = "${KEYS.stripeSecret}";
const OPENAI = "${KEYS.openai}";
export { SUPABASE_URL, SUPABASE_ADMIN, SUPABASE_ANON, STRIPE_PK, STRIPE_SK, OPENAI };`;

// Spinner class names (sk-chase, skeleton) are here on purpose: they start
// like an OpenAI key and must not be reported as one.
export const okHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Tidy demo app</title>
<style>.sk-chase{animation:sk-chase 2.5s infinite}.skeleton-loader{opacity:.4}</style>
</head>
<body>
<div id="root" class="sk-chase"></div>
<script>window.firebaseConfig = { apiKey: "${KEYS.firebase}" };</script>
<script type="module" crossorigin src="/assets/index-ok.js"></script>
</body></html>`;

export const okJs = `const SUPABASE_URL = "https://examplefakeproject.supabase.co";
const SUPABASE_ANON = "${KEYS.anon}";
const PUBLISHABLE = "${KEYS.supabasePublishable}";
const STRIPE_PK = "${KEYS.stripePublishable}";
const spinnerClasses = ["sk-chase", "sk-chase-dot", "skeleton"];
export { SUPABASE_URL, SUPABASE_ANON, PUBLISHABLE, STRIPE_PK, spinnerClasses };`;

export const ROUTES = {
  '/bad': ['text/html', badHtml],
  '/assets/index-bad.js': ['text/javascript', badJs],
  '/ok': ['text/html', okHtml],
  '/assets/index-ok.js': ['text/javascript', okJs],
};
