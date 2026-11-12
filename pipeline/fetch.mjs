// Download + disk-cache helper for remote data files.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const NFLVERSE = 'https://github.com/nflverse/nflverse-data/releases/download';

/** Fetch a URL to the cache. maxAgeHours controls refresh; returns local path (or null on 404). */
export async function cached(url, name, maxAgeHours = 12) {
  const file = path.join(CACHE_DIR, name);
  if (fs.existsSync(file)) {
    const ageH = (Date.now() - fs.statSync(file).mtimeMs) / 36e5;
    if (ageH < maxAgeHours) return file;
  }
  process.stdout.write(`  ↓ ${name} ... `);
  const res = await fetch(url, { headers: { 'User-Agent': 'dynasty-lab/1.0' } });
  if (res.status === 404) { console.log('not found'); return null; }
  if (!res.ok) {
    if (fs.existsSync(file)) { console.log(`HTTP ${res.status}, using stale cache`); return file; }
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
  return file;
}

export const nflverse = (tag, file, maxAgeHours) => cached(`${NFLVERSE}/${tag}/${file}`, file, maxAgeHours);

export async function cachedJSON(url, name, maxAgeHours = 6) {
  const f = await cached(url, name, maxAgeHours);
  return f ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

/** Minimal RFC4180 CSV parser -> array of objects. Handles .gz files. */
export function readCSV(file) {
  let txt = fs.readFileSync(file);
  if (file.endsWith('.gz')) txt = zlib.gunzipSync(txt);
  txt = txt.toString('utf8');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) {
      if (c === '"') { if (txt[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && txt[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => {
    const v = r[i];
    if (v === undefined || v === 'NA' || v === '') return [h, null];
    const n = Number(v);
    return [h, Number.isFinite(n) && /^-?[\d.]+(e-?\d+)?$/i.test(v) ? n : v];
  })));
}
