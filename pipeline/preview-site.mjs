// Serves the built site/ folder under /dynasty-lab/ — the same layout GitHub Pages uses — for local testing.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const BASE = '/dynasty-lab/';
const PORT = Number(process.env.PORT) || 5179;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/' || url.pathname === '/dynasty-lab') { res.writeHead(302, { Location: BASE }); return res.end(); }
  if (!url.pathname.startsWith(BASE)) { res.writeHead(404); return res.end('Not found'); }
  let file = path.normalize(path.join(SITE, decodeURIComponent(url.pathname.slice(BASE.length)) || 'index.html'));
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!file.startsWith(SITE) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(PORT, () => console.log(`Static site preview at http://localhost:${PORT}${BASE}`));
