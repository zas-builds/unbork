// The paid part of a report: for each problem, what to do, in order, and a
// prompt to paste into the tool that built the app (Lovable, Bolt, Cursor or
// similar). Not sent to the page until payment is live.
//
// House rules for every prompt: tell the builder what to change and what not
// to touch, never ask it to paste a secret into chat, and end with a way to
// check the fix worked.

const KEY_LEAK = (name, where) => ({
  steps: [
    `Treat the ${name} as stolen: create a new one in ${where} and delete the old one. Hiding the old key does not help, because it has already been published.`,
    'Move every use of the new key into server-side code (a Supabase Edge Function, a Netlify or Vercel function, or your backend), stored as an environment secret.',
    'Publish again, then run Unbork again to confirm the key is gone.',
  ],
  prompt: `My published app exposes a ${name} in its front-end JavaScript. Please:
1. Find every place the front end uses this key and move that logic into a server-side function, reading the key from an environment secret. Do not put the key in any file that is sent to the browser, including .env files with a VITE_, NEXT_PUBLIC_ or REACT_APP_ prefix.
2. Change the front end to call that function instead.
3. Do not ask me to paste the key into this chat. Tell me where to add it as a secret myself.
4. List every file you changed, and confirm no ${name} remains in client-side code.`,
});

export const FIXES = {
  'server-error': {
    steps: ['Open your host’s deploy log and read the last error.', 'Redeploy the last version that worked, then fix forward.', 'Run Unbork again.'],
    prompt: 'My published app returns a 5xx server error on its home page. Here is the end of the deploy log: [paste the last 20 lines]. Explain the cause in plain English, fix it with the smallest change possible, and tell me how to confirm it is fixed.',
  },
  'not-found': {
    steps: ['Check the address is the one your host shows as live.', 'Check the publish folder is set to the build output (often dist or build).', 'Redeploy and run Unbork again.'],
    prompt: 'My app’s live address returns 404 instead of the app. Check the build settings: the build command, and that the publish directory is the build output folder (for Vite it is dist). Tell me exactly which settings to change in my host and why.',
  },
  'missing-script': {
    steps: ['Trigger a fresh deploy so the page and its files come from the same build.', 'Clear any CDN cache your host offers.', 'Run Unbork again.'],
    prompt: 'My live page asks for JavaScript files that return 404, so visitors see a blank page. Check the build output and the base path setting (Vite base, or homepage in package.json) so the page asks for files that exist after deploy. Change only what is needed and tell me how to verify.',
  },
  'nothing-to-render': {
    steps: ['Set your host’s publish folder to the built output, not the project root.', 'Redeploy and run Unbork again.'],
    prompt: 'My live page is an empty shell with no JavaScript loaded. I think the host is publishing the source folder instead of the built one. Tell me the correct build command and publish directory for this project, and anything else needed for the page to load.',
  },
  'supabase-service-role': KEY_LEAK('Supabase service role key', 'Supabase: Project Settings, then API Keys'),
  'supabase-secret': KEY_LEAK('Supabase secret key', 'Supabase: Project Settings, then API Keys'),
  'stripe-secret': KEY_LEAK('Stripe live secret key', 'the Stripe Dashboard: Developers, then API keys'),
  'stripe-test-secret': KEY_LEAK('Stripe test secret key', 'the Stripe Dashboard in test mode: Developers, then API keys'),
  'openai': KEY_LEAK('OpenAI API key', 'the OpenAI platform: API keys'),
  'openai-project': KEY_LEAK('OpenAI API key', 'the OpenAI platform: API keys'),
  'anthropic': KEY_LEAK('Anthropic API key', 'the Claude Console: API keys'),
  'sendgrid': KEY_LEAK('SendGrid API key', 'SendGrid: Settings, then API Keys'),
  'resend': KEY_LEAK('Resend API key', 'Resend: API Keys'),
  'private-key-block': KEY_LEAK('private key', 'whatever service issued it'),
  'supabase-unknown-role': {
    steps: ['Find out which role this key carries in Supabase.', 'If it is anything other than anon, replace it and move its use server-side.'],
    prompt: 'My front end contains a Supabase key whose role is not "anon". Find where it is used, explain what that role can do, and if it bypasses row level security, move that use into a Supabase Edge Function and use the anon or publishable key in the browser.',
  },
  'placeholder-settings': {
    steps: ['Fill in the missing settings in your host’s environment variables.', 'Rebuild and redeploy: these values are baked in at build time.', 'Run Unbork again.'],
    prompt: 'My published app still contains placeholder settings (like YOUR_SUPABASE_URL or undefined) instead of real values. List every environment variable the front end needs, which ones must be set in my host before building, and confirm none of them is a secret that should not be in the browser.',
  },
  'local-address': {
    steps: ['Replace the localhost address with your live API address, set as an environment variable.', 'Redeploy and run Unbork again.'],
    prompt: 'My published front end fetches data from http://localhost. Replace that with an environment variable for the API address, set the right value for production, and tell me where to set it in my host.',
  },
  'deep-links': {
    steps: ['Add a rewrite so every path serves index.html (Netlify: a _redirects file with /* /index.html 200; Vercel: a rewrite in vercel.json).', 'Redeploy, then refresh a page inside the app to check.'],
    prompt: 'My single-page app shows a 404 when someone refreshes a page or opens a shared link. Add the correct fallback rewrite for my host so every path serves index.html with status 200, without breaking real files or API routes. Tell me which host you configured it for and how to test it.',
  },
  'no-https': {
    steps: ['Turn on HTTPS in your host’s domain settings.', 'Turn on "force HTTPS" so http visits redirect.'],
    prompt: 'My site is served over plain http. Tell me the exact steps in my host to issue a certificate and force all traffic to https.',
  },
  'headers': {
    steps: ['Add the missing headers in your host’s headers file (Netlify: _headers; Vercel: vercel.json).', 'Redeploy and run Unbork again.'],
    prompt: 'Add these response headers to every page of my site, using my host’s headers configuration: Strict-Transport-Security: max-age=31536000; includeSubDomains, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: strict-origin-when-cross-origin. Do not add a Content-Security-Policy without asking me first, as it can break the app.',
  },
  'no-privacy-policy': {
    steps: ['List what your app actually collects and which services receive it (database, analytics, email, payments).', 'Write a privacy policy that says exactly that, at a page like /privacy, and link it in the footer and next to every form.', 'Have someone qualified read it if you handle sensitive data or serve the EU.'],
    prompt: 'Add a Privacy Policy page at /privacy and link it from the footer and from every sign-up or contact form. Before writing it, read the code and list every piece of personal data the app collects, where it is stored, and every third-party service that receives it, and show me that list first so I can correct it. Then write the policy covering: who runs the app and how to contact them, what is collected and why, the legal basis, who receives it, how long it is kept, and how people can access or delete their data. Mark anything you are unsure about as [CHECK] rather than guessing.',
  },
  'tracking-without-consent': {
    steps: ['Add a consent banner with equal "Accept" and "Reject" buttons.', 'Load analytics and advertising scripts only after a visitor accepts.', 'Test in a private window: refuse, then check no tracking cookies appear.'],
    prompt: 'My site loads analytics or advertising scripts before visitors agree. Add a cookie consent banner with Accept and Reject buttons of equal prominence, store the choice, and load these scripts only after Accept: [list the tools]. Remove them from index.html and load them from code that checks the stored choice. Add a "Cookie settings" link in the footer to change the choice later.',
  },
  'tracking-cookie-on-arrival': {
    steps: ['Stop the server or edge code setting the cookie on the first response.', 'Set it only after the visitor accepts cookies.'],
    prompt: 'My server sets a tracking cookie on the first response, before visitors can consent. Find where this cookie is set (server, edge middleware or hosting config), and change it so it is only set after a stored consent choice of Accept.',
  },
  'payment-pages-missing': {
    steps: ['Create the missing pages with your real business details.', 'Link all of them in the footer.', 'For Razorpay, add the links in the Razorpay Dashboard under business website details.'],
    prompt: 'Add these pages to my site and link them in the footer: Terms and Conditions, Cancellation and Refund Policy (with a concrete refund timeline), Privacy Policy, and Contact Us (business name, email, and address). Use placeholders like [BUSINESS NAME] for anything you do not know rather than inventing details, and list the placeholders for me at the end.',
  },
  'ccpa-optout-missing': {
    steps: ['Check whether your business meets the CCPA thresholds.', 'If it does, add a "Do Not Sell or Share My Personal Information" link and honour Global Privacy Control.'],
    prompt: 'Add a footer link titled exactly "Do Not Sell or Share My Personal Information" that opens a page where a visitor can opt out, and stop loading advertising pixels for visitors who opt out or whose browser sends the Global Privacy Control signal.',
  },
  'no-terms': {
    steps: ['Write terms that match how your service actually works.', 'Link them in the footer and at sign-up.'],
    prompt: 'Add a Terms of Service page at /terms and link it from the footer and the sign-up form. Base it on how the app actually works (read the code first), use [CHECK] for anything you are unsure of, and do not invent company details.',
  },
};

export function fixFor(id) {
  return FIXES[id] || null;
}
