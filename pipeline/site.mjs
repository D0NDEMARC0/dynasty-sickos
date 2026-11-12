// Builds the shareable static website into site/ (used by the weekly GitHub workflow).
// Run after: node pipeline/build.mjs --public
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marketValues, STATIC_QB, STATIC_PPR, STATIC_TEAMS } from './values.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'out');
const SITE = path.join(ROOT, 'site');

const meta = JSON.parse(fs.readFileSync(path.join(OUT, 'players.json'), 'utf8')).meta;
if (!meta.public) {
  console.error('data/out was built with your private imports. Run `node pipeline/build.mjs --public` first — the website must never include licensed data such as PFF exports.');
  process.exit(1);
}

fs.rmSync(SITE, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), SITE, { recursive: true });
fs.mkdirSync(path.join(SITE, 'data', 'values'), { recursive: true });
for (const f of fs.readdirSync(OUT)) {
  if (f.endsWith('.json') && f !== 'idmap.json') fs.copyFileSync(path.join(OUT, f), path.join(SITE, 'data', f));
}

// Pre-built market values for every format the app offers.
let n = 0;
for (const qb of STATIC_QB) for (const ppr of STATIC_PPR) for (const teams of STATIC_TEAMS) {
  const v = await marketValues({ qb, ppr, teams });
  fs.writeFileSync(path.join(SITE, 'data', 'values', `${qb}_${ppr}_${teams}.json`), JSON.stringify(v));
  n++;
  await new Promise(r => setTimeout(r, 250)); // be polite to the FantasyCalc API
}
fs.writeFileSync(path.join(SITE, 'data', 'site.json'), JSON.stringify({ static: true, built: new Date().toISOString(), teams: STATIC_TEAMS }));
fs.writeFileSync(path.join(SITE, '.nojekyll'), '');
const size = dir => fs.readdirSync(dir, { withFileTypes: true }).reduce((s, d) => s + (d.isDirectory() ? size(path.join(dir, d.name)) : fs.statSync(path.join(dir, d.name)).size), 0);
console.log(`Site built in site/ — ${n} value files, ${(size(SITE) / 1e6).toFixed(1)} MB total`);
