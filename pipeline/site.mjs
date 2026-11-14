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

// Every deploy gets its own id. GitHub Pages lets browsers cache every file for 10 minutes, so a visit right after
// a deploy could otherwise run the old code against the new data (or the reverse). The id goes on the page, the
// stylesheet and every script import; data requests and data/site.json carry it too (see index.html's loader and
// public/js/version.js).
const V = `${(process.env.GITHUB_SHA || 'local').slice(0, 7)}-${Date.now().toString(36)}`;
const IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"?]+\.js)\2/g;
let stamped = 0;
const stampImports = dir => {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, d.name);
    if (d.isDirectory()) { stampImports(file); continue; }
    if (!d.name.endsWith('.js')) continue;
    const src = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, src.replace(IMPORT, (m, pre, q, spec) => { stamped++; return `${pre}${q}${spec}?v=${V}${q}`; }));
  }
};
stampImports(path.join(SITE, 'js'));
if (!stamped) throw new Error('No script imports were versioned; check the IMPORT pattern in pipeline/site.mjs');
const INDEX = path.join(SITE, 'index.html');
let html = fs.readFileSync(INDEX, 'utf8');
for (const [a, b] of [['<html lang="en">', `<html lang="en" data-deploy="${V}">`], ['href="css/app.css" id="app-css"', `href="css/app.css?v=${V}" id="app-css"`]]) {
  if (!html.includes(a)) throw new Error(`public/index.html no longer contains ${a}; update pipeline/site.mjs`);
  html = html.replace(a, b);
}
fs.writeFileSync(INDEX, html);
fs.mkdirSync(path.join(SITE, 'data', 'values'), { recursive: true });
const PRIVATE_FILES = new Set(['idmap.json', 'pahowdy.json']);
for (const f of fs.readdirSync(OUT)) {
  // personal-use sources (Pahowdy's database) stay on your computer: never copied to the website
  if (f.endsWith('.json') && !PRIVATE_FILES.has(f)) fs.copyFileSync(path.join(OUT, f), path.join(SITE, 'data', f));
}
// full college careers (split files)
if (fs.existsSync(path.join(OUT, 'college'))) fs.cpSync(path.join(OUT, 'college'), path.join(SITE, 'data', 'college'), { recursive: true });

// Pre-built market values for every format the app offers.
let n = 0;
for (const qb of STATIC_QB) for (const ppr of STATIC_PPR) for (const teams of STATIC_TEAMS) {
  const v = await marketValues({ qb, ppr, teams });
  fs.writeFileSync(path.join(SITE, 'data', 'values', `${qb}_${ppr}_${teams}.json`), JSON.stringify(v));
  n++;
  await new Promise(r => setTimeout(r, 250)); // be polite to the FantasyCalc API
}
fs.writeFileSync(path.join(SITE, 'data', 'site.json'), JSON.stringify({ static: true, built: new Date().toISOString(), teams: STATIC_TEAMS, v: V }));
fs.writeFileSync(path.join(SITE, '.nojekyll'), '');
const size = dir => fs.readdirSync(dir, { withFileTypes: true }).reduce((s, d) => s + (d.isDirectory() ? size(path.join(dir, d.name)) : fs.statSync(path.join(dir, d.name)).size), 0);
console.log(`Site built in site/ — deploy ${V}, ${stamped} script imports versioned, ${n} value files, ${(size(SITE) / 1e6).toFixed(1)} MB total`);
