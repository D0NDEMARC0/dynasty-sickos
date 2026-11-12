// Local importer for licensed data exports (PFF Premium Stats CSVs, or any provider you have rights to).
// Drop CSV files into data/imports/. Files stay on this machine; nothing here is uploaded or published.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCSV } from './fetch.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const IMPORT_DIR = path.join(__dirname, '..', 'data', 'imports');

const norm = h => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');

// canonical field -> accepted header spellings (normalized). First match wins.
const ALIASES = {
  name: ['player', 'playername', 'name', 'fullname', 'playerfullname'],
  pffId: ['playerid', 'pffid', 'pffplayerid'],
  gsis: ['gsisid', 'gsis', 'playergsisid', 'nflid'],
  sleeper: ['sleeperid'],
  team: ['teamname', 'team', 'tm', 'teamabbr', 'teamabbreviation'],
  pos: ['position', 'pos'],
  season: ['season', 'year'],
  games: ['playergamecount', 'games', 'gp', 'g'],
  routes: ['routes', 'routesrun', 'rts', 'totalroutes', 'rr'],
  yprr: ['yprr', 'yardsperrouterun', 'ydsrr', 'yrr', 'ydsperroute', 'yardsperroute'],
  tprr: ['tprr', 'targetsperrouterun', 'tgtrr', 'tgtsrr', 'targetsperroute'],
  routeRate: ['routerate', 'routeparticipation', 'routepct', 'routeparticipationrate'],
  sep: ['avgseparation', 'separation', 'sep', 'avgsep', 'targetseparation', 'separationscore'],
  grade: ['gradesoffense', 'offensegrade', 'offgrade', 'overallgrade', 'grade'],
  routeGrade: ['gradespassroute', 'receivinggrade', 'routegrade', 'passroutegrade'],
  runGrade: ['gradesrun', 'rushinggrade', 'rungrade'],
  passGrade: ['gradespass', 'passinggrade', 'passgrade'],
  yco: ['ycoattempt', 'yardsaftercontactperattempt', 'ycoatt', 'ycoa', 'yacoatt'],
  mtf: ['avoidedtackles', 'missedtacklesforced', 'mtf', 'forcedmissedtackles'],
  elusive: ['elusiverating', 'elusive'],
  breakaway: ['breakawaypercent', 'breakawaypct', 'breakawayrate'],
  slot: ['slotrate', 'slotpct', 'slotsnaprate'],
  contested: ['contestedcatchrate', 'contestedcatchpct', 'contestedcatchpercent'],
  drop: ['droprate', 'droppct', 'droppercent'],
  btt: ['bttrate', 'bigtimethrowrate', 'bigtimethrowpct'],
  twp: ['twprate', 'turnoverworthyplayrate', 'turnoverworthypct'],
  p2s: ['pressuretosackrate', 'pressuretosackpct'],
  acc: ['accuracypercent', 'adjustedcompletionpercentage', 'accuracy'],
  winRate: ['routewinrate', 'winrate', 'winpct'],
};
// Fields reported as percentages by most providers; stored as fractions.
const RATE = new Set(['routeRate', 'slot', 'contested', 'drop', 'btt', 'twp', 'p2s', 'acc', 'breakaway', 'tprr', 'winRate']);

function headerMap(headers) {
  const byNorm = new Map(headers.map(h => [norm(h), h]));
  const map = {};
  for (const [field, alts] of Object.entries(ALIASES)) {
    const hit = alts.find(a => byNorm.has(a));
    if (hit) map[field] = byNorm.get(hit);
  }
  return map;
}

const toNum = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[%,]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const toRate = v => { const n = toNum(v); return n == null ? null : n > 1.5 ? n / 100 : n; };

export const nameKey = s => String(s || '').toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z]/g, '');

/**
 * @returns {{ rows: Map<string, Map<number, object>>, files: object[] }}  gsis -> season -> imported fields
 */
export function loadImports({ current, resolve }) {
  const files = [];
  const rows = new Map();
  if (!fs.existsSync(IMPORT_DIR)) return { rows, files };
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : /\.csv$/i.test(d.name) ? [path.join(dir, d.name)] : []);
  for (const file of walk(IMPORT_DIR)) {
    const rel = path.relative(IMPORT_DIR, file);
    let data;
    try { data = readCSV(file); } catch (e) { files.push({ file: rel, error: e.message }); continue; }
    if (!data.length) { files.push({ file: rel, error: 'empty file' }); continue; }
    const H = headerMap(Object.keys(data[0]));
    const isPFF = /pff/i.test(rel) || ('grade' in H && H.grade === 'grades_offense') || Object.keys(data[0]).includes('franchise_id');
    const src = isPFF ? 'PFF' : (rel.split(/[\\/]/)[0].replace(/\.csv$/i, '') || 'Import');
    const yearInName = rel.match(/(20\d{2})/);
    const fields = Object.keys(H).filter(k => !['name', 'pffId', 'gsis', 'sleeper', 'team', 'pos', 'season', 'games'].includes(k));
    let matched = 0, unmatched = 0;
    for (const r of data) {
      const season = toNum(r[H.season]) || (yearInName ? Number(yearInName[1]) : current);
      const gsis = resolve({
        gsis: r[H.gsis], sleeper: r[H.sleeper], pffId: isPFF ? r[H.pffId] : null,
        name: r[H.name], team: r[H.team], pos: r[H.pos],
      });
      if (!gsis) { unmatched++; continue; }
      matched++;
      const rec = { src };
      for (const f of fields) {
        const v = RATE.has(f) ? toRate(r[H[f]]) : toNum(r[H[f]]);
        if (v != null) rec[f] = v;
      }
      if (!rows.has(gsis)) rows.set(gsis, new Map());
      const bySeason = rows.get(gsis);
      bySeason.set(season, { ...(bySeason.get(season) || {}), ...rec, src: bySeason.get(season)?.src && bySeason.get(season).src !== src ? `${bySeason.get(season).src}+${src}` : src });
    }
    files.push({ file: rel, src, matched, unmatched, fields });
  }
  return { rows, files };
}

/** Apply imported values to a season stat line. Real route counts replace the estimates. */
export function applyImport(s, ext) {
  s.ext = ext;
  let routes = ext.routes ?? null;
  if (routes == null && ext.yprr && s.box?.reyd) routes = s.box.reyd / ext.yprr;
  if (routes && routes > 0) {
    const old = s.routes;
    s.routes = Math.round(routes);
    s.routesEst = false;
    s.routesSrc = ext.src;
    const r3 = x => Math.round(x * 1000) / 1000;
    s.yprr = ext.yprr != null ? Math.round(ext.yprr * 100) / 100 : r3(s.box.reyd / routes);
    s.tprr = ext.tprr != null ? r3(ext.tprr) : r3(s.box.tgt / routes);
    s.fdrr = r3(s.box.refd / routes);
    if (ext.routeRate != null) s.rp = r3(ext.routeRate);
    else if (old > 0 && s.rp != null) s.rp = r3(Math.min(1, s.rp * (routes / old)));
  }
  if (ext.sep != null && s.sep == null) s.sep = ext.sep;
}
