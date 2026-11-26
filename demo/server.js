// Tiny demo backend for the broken landing page. No dependencies.
// POST /api/lead  -> stores the lead (with UTM) and answers {ok:true}
// GET|POST /collect -> fake Google Ads / GA4 conversion endpoint (204)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'site', 'public');
const port = Number(process.env.PORT || 4321);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

if (!fs.existsSync(root)) {
  console.log('demo/site is missing, run: npm run demo:reset');
  process.exit(1);
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  if (url.pathname === '/api/lead' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      let lead = {};
      try { lead = JSON.parse(body || '{}'); } catch {}
      const ok = lead.name && lead.phone;
      console.log(ok ? '\x1b[32m📥 Lead received\x1b[0m' : '\x1b[31m⚠ Bad lead\x1b[0m', JSON.stringify(lead));
      res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify(ok ? { ok: true } : { ok: false, error: 'name and phone required' }));
    });
    return;
  }

  if (url.pathname === '/collect') {
    const p = url.searchParams.get('p'); const e = url.searchParams.get('e');
    const lead = !/page_?view|hit/i.test(e || '');
    console.log(lead ? '\x1b[36m💰 Conversion\x1b[0m' : '\x1b[2m👁  pageview\x1b[0m', `${p} → ${e}`);
    res.writeHead(204); res.end();
    return;
  }

  // Simulates a slow third-party CDN for vendor scripts.
  if (url.pathname.startsWith('/vendor/')) {
    setTimeout(() => serveStatic(url, res), 3000);
    return;
  }

  serveStatic(url, res);
}).listen(port, () => console.log(`Demo landing: http://localhost:${port}`));

function serveStatic(url, res) {
  const file = path.normalize(path.join(root, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('Not found');
    return;
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}
