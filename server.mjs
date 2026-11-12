// Dynasty Lab local server: static UI + data files + dynasty market values API.
// Usage: node server.mjs   (then open http://localhost:5178)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { marketValues } from './pipeline/values.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'data', 'out');
const PORT = Number(process.env.PORT) || 5178;
const TYPES = { '.webmanifest': 'application/manifest+json', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

function serveFile(res, base, rel) {
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, { error: 'not found' });
  send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
}

// ---------- data rebuild ----------
let build = { running: false, log: '', finished: null, ok: null, reason: null };
function rebuild(reason = 'manual') {
  if (build.running) return;
  build = { running: true, log: '', finished: null, ok: null, reason, started: new Date().toISOString() };
  const child = spawn(process.execPath, ['--max-old-space-size=4096', path.join(ROOT, 'pipeline', 'build.mjs')], { cwd: ROOT });
  const add = d => { build.log = (build.log + d.toString()).slice(-6000); };
  child.stdout.on('data', add); child.stderr.on('data', add);
  child.on('close', code => {
    build.running = false; build.ok = code === 0; build.finished = new Date().toISOString();
    console.log(`[data] ${reason} rebuild ${build.ok ? 'finished' : 'FAILED (will retry later)'} at ${new Date().toLocaleString()}`);
  });
}

// ---------- automatic weekly refresh ----------
// The NFL week wraps up with Monday Night Football, and nflverse publishes overnight, so by default the data
// is considered out of date every Tuesday at 10:00 local time. Override with UPDATE_DAY (0=Sun…6=Sat) / UPDATE_HOUR.
const UPDATE_DAY = Number(process.env.UPDATE_DAY ?? 2);
const UPDATE_HOUR = Number(process.env.UPDATE_HOUR ?? 10);
const RETRY_AFTER_FAILURE_MS = 3 * 3600e3;

function lastCutoff(now = new Date()) {
  const d = new Date(now);
  d.setHours(UPDATE_HOUR, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - UPDATE_DAY + 7) % 7));
  if (d > now) d.setDate(d.getDate() - 7);
  return d;
}
const nextCutoff = () => { const d = lastCutoff(); d.setDate(d.getDate() + 7); return d; };
const dataTime = () => { try { return fs.statSync(path.join(OUT, 'players.json')).mtime; } catch { return null; } };
const isStale = () => { const t = dataTime(); return !t || t < lastCutoff(); };

let lastAutoAttempt = 0;
function autoUpdate() {
  if (build.running || !isStale()) return;
  // after a failed run (e.g. offline), wait before trying again
  if (lastAutoAttempt && build.ok === false && Date.now() - lastAutoAttempt < RETRY_AFTER_FAILURE_MS) return;
  lastAutoAttempt = Date.now();
  const t = dataTime();
  console.log(t ? `[data] Data from ${t.toLocaleString()} is older than this week's update (${lastCutoff().toLocaleString()}) — refreshing…`
    : '[data] No data yet — building it now (about 30 seconds)…');
  rebuild(t ? 'weekly' : 'first-run');
}
const status = () => ({ ...build, generated: dataTime(), stale: isStale(), nextUpdate: nextCutoff(), schedule: { day: UPDATE_DAY, hour: UPDATE_HOUR } });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/values') {
      const qb = url.searchParams.get('qb') === '2' ? 2 : 1;
      const ppr = ['0', '0.5', '1'].includes(url.searchParams.get('ppr')) ? Number(url.searchParams.get('ppr')) : 1;
      const teams = Math.min(32, Math.max(8, Number(url.searchParams.get('teams')) || 12));
      return send(res, 200, await marketValues({ qb, ppr, teams }));
    }
    if (url.pathname === '/api/rebuild' && req.method === 'POST') { rebuild('manual'); return send(res, 202, status()); }
    if (url.pathname === '/api/status') return send(res, 200, status());
    if (url.pathname.startsWith('/data/')) return serveFile(res, OUT, url.pathname.slice(6));
    return serveFile(res, PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

// Check at startup (catches up after the PC was off or the app was closed), then every 15 minutes.
autoUpdate();
setInterval(autoUpdate, 15 * 60e3);
server.listen(PORT, () => {
  console.log(`Dynasty Lab running at http://localhost:${PORT}`);
  console.log(`[data] Auto-update: every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][UPDATE_DAY]} at ${UPDATE_HOUR}:00 — next ${nextCutoff().toLocaleString()}`);
});
