// Local dev server: serves public/ and answers /api/scan (GET or POST), so
// the page can be tried against fixtures without deploying. Not used in
// production.   node tools/dev-server.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { runScan } from '../lib/scan.mjs';
import checkout from '../netlify/functions/checkout.mjs';
import unlock from '../netlify/functions/unlock.mjs';
import webhook from '../netlify/functions/razorpay-webhook.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.png': 'image/png' };
const ROUTES = { '/': 'index.html', '/privacy': 'privacy.html', '/terms': 'terms.html', '/pricing': 'pricing.html', '/refunds': 'refunds.html' };
// Guides are served without the .html, the same as netlify.toml does.
for (const slug of ['lovable-404-on-refresh', 'is-my-supabase-key-safe', 'does-my-app-need-a-cookie-banner', 'add-a-privacy-policy-to-a-lovable-app', 'what-is-row-level-security', 'what-are-security-headers']) {
  ROUTES[`/guides/${slug}`] = `guides/${slug}.html`;
}
const port = Number(process.argv[2] || 8787);

// The payment endpoints are the real Netlify functions, so what happens here
// is what happens in production. With no Razorpay settings in the environment
// they answer "not on sale yet", which is the live site's behaviour today.
const FUNCTIONS = { '/api/checkout': checkout, '/api/unlock': unlock, '/api/razorpay/webhook': webhook };

async function runFunction(handler, req, res, origin) {
  let body = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = ''; for await (const c of req) body += c;
  }
  const out = await handler(new Request(origin + req.url, { method: req.method, headers: req.headers, body, redirect: 'manual' }), {});
  const headers = {};
  out.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(out.status, headers);
  res.end(Buffer.from(await out.arrayBuffer()));
}

createServer(async (req, res) => {
  const origin = `http://127.0.0.1:${port}`;
  const u = new URL(req.url, origin);
  if (FUNCTIONS[u.pathname]) {
    await runFunction(FUNCTIONS[u.pathname], req, res, origin);
    return;
  }
  if (u.pathname === '/api/scan') {
    let target = u.searchParams.get('url');
    if (req.method === 'POST') {
      let raw = ''; for await (const c of req) raw += c;
      try { target = JSON.parse(raw).url; } catch { target = null; }
    }
    const report = await runScan(target, { allowLocal: true, includeFixes: u.searchParams.get('full') === '1' });
    res.writeHead(report.ok ? 200 : 400, { 'content-type': 'application/json' });
    res.end(JSON.stringify(report));
    return;
  }
  const file = ROUTES[u.pathname] || normalize(u.pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  try {
    const body = await readFile(join(root, file));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); res.end(await readFile(join(root, '404.html')));
  }
}).listen(port, '127.0.0.1', () => console.log(`dev server on http://127.0.0.1:${port}`));
