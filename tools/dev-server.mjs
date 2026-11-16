// Local dev server: serves public/ and answers /api/scan, so the page can be
// tried against fixtures without deploying. Not used in production.
//   node tools/dev-server.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { runScan } from '../lib/scan.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const port = Number(process.argv[2] || 8787);

createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${port}`);
  if (u.pathname === '/api/scan') {
    const report = await runScan(u.searchParams.get('url'), { allowLocal: true });
    res.writeHead(report.ok ? 200 : 400, { 'content-type': 'application/json' });
    res.end(JSON.stringify(report));
    return;
  }
  const file = u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\/+/, '');
  try {
    const body = await readFile(join(root, file));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`dev server on http://127.0.0.1:${port}`));
