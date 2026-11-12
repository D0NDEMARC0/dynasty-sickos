// Data pipeline: pulls nflverse + Sleeper data, computes advanced metrics, writes data/out/*.json
// Usage: node pipeline/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from './load.mjs';
import { buildSeason, ROUTE_RATE } from './season.mjs';
import { scoreSeason, blendScores, MODEL } from './score.mjs';
import { loadImports, applyImport, nameKey } from './imports.mjs';
import { buildCollege } from './college.mjs';
import { teamSeason, assembleTeams } from './teams.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'data', 'out');
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const state = await L.sleeperState();
const CURRENT = Number(state.season_type === 'regular' || state.season_type === 'post' ? state.season : state.previous_season);
const SEASONS = [CURRENT - 3, CURRENT - 2, CURRENT - 1, CURRENT];
log(`Current season ${CURRENT}, week ${state.week}. Seasons: ${SEASONS.join(', ')}`);

log('Loading player directories…');
const [sleeper, ids, nfl] = await Promise.all([L.sleeperPlayers(), L.idMap(), L.nflPlayers()]);
const nflBy = new Map(nfl.map(p => [p.gsis_id, p]));
const gsis2sid = new Map(), pfr2gsis = new Map(), pff2gsis = new Map(), fp2sid = {};
for (const r of ids) {
  if (r.gsis_id && r.sleeper_id) gsis2sid.set(r.gsis_id, String(r.sleeper_id));
  if (r.pfr_id && r.gsis_id) pfr2gsis.set(r.pfr_id, r.gsis_id);
  if (r.pff_id && r.gsis_id) pff2gsis.set(String(r.pff_id), r.gsis_id);
  if (r.fantasypros_id && r.sleeper_id) fp2sid[r.fantasypros_id] = String(r.sleeper_id);
}
for (const p of Object.values(sleeper)) if (p.gsis) gsis2sid.set(p.gsis, p.sid);
for (const p of nfl) {
  if (p.pfr_id && p.gsis_id) pfr2gsis.set(p.pfr_id, p.gsis_id);
  if (p.pff_id && p.gsis_id && !pff2gsis.has(String(p.pff_id))) pff2gsis.set(String(p.pff_id), p.gsis_id);
}

const FANTASY = new Set(['QB', 'RB', 'WR', 'TE']);
const posCache = new Map();
const posOf = gsis => {
  if (posCache.has(gsis)) return posCache.get(gsis);
  const sid = gsis2sid.get(gsis);
  let pos = sid && sleeper[sid] ? sleeper[sid].pos : null;
  if (!pos) { const n = nflBy.get(gsis)?.position; pos = n === 'FB' ? 'RB' : n; }
  pos = FANTASY.has(pos) ? pos : null;
  posCache.set(gsis, pos);
  return pos;
};

// ---------- licensed data imports (data/imports/*.csv) ----------
const sid2gsis = new Map([...gsis2sid].map(([g, s]) => [s, g]));
const nameIdx = new Map();
const addName = (name, gsis, pos, team) => {
  if (!name || !gsis) return;
  const k = nameKey(name);
  if (!nameIdx.has(k)) nameIdx.set(k, []);
  const list = nameIdx.get(k);
  if (!list.some(x => x.gsis === gsis)) list.push({ gsis, pos, team });
};
const fpos = p => (p === 'FB' ? 'RB' : p);
for (const p of Object.values(sleeper)) addName(p.name, p.gsis || sid2gsis.get(p.sid), p.pos, p.team);
for (const p of nfl) if (FANTASY.has(fpos(p.position)) && (p.last_season ?? 9999) >= SEASONS[0] - 1) addName(p.display_name, p.gsis_id, fpos(p.position), p.latest_team);
const TEAM_ALIAS = { LAR: 'LA', JAC: 'JAX', WSH: 'WAS', LVR: 'LV', OAK: 'LV', SD: 'LAC', STL: 'LA', ARZ: 'ARI', BLT: 'BAL', CLV: 'CLE', HST: 'HOU' };
const GSIS_RE = /^00-\d{7}$/;
const nameOfGsis = g => nflBy.get(g)?.display_name || sleeper[gsis2sid.get(g)]?.name || '';
const resolve = ({ gsis, sleeper: sl, pffId, name, team, pos }) => {
  if (gsis && GSIS_RE.test(String(gsis).trim())) return String(gsis).trim();
  if (pffId != null) {
    const raw = String(pffId).trim();
    if (GSIS_RE.test(raw)) return raw;
    if (pff2gsis.has(raw)) {
      // trust the ID unless the row's name clearly belongs to someone else
      const g = pff2gsis.get(raw);
      if (!name || nameKey(nameOfGsis(g)) === nameKey(name)) return g;
      return byName(name, team, pos) || g;
    }
  }
  if (sl != null && sid2gsis.has(String(sl))) return sid2gsis.get(String(sl));
  return byName(name, team, pos);
};
function byName(name, team, pos) {
  let cands = nameIdx.get(nameKey(name)) || [];
  const P = pos ? fpos(String(pos).toUpperCase().replace('HB', 'RB')) : null;
  if (cands.length > 1 && P) cands = cands.filter(c => c.pos === P);
  const T = team ? TEAM_ALIAS[String(team).toUpperCase()] || String(team).toUpperCase() : null;
  if (cands.length > 1 && T) { const t = cands.filter(c => c.team === T); if (t.length) cands = t; }
  return cands.length === 1 ? cands[0].gsis : null;
}
// --public: build for the shareable website. Licensed imports (e.g. PFF) are never included there.
const PUBLIC_BUILD = process.argv.includes('--public');
const imports = PUBLIC_BUILD ? { rows: new Map(), files: [] } : loadImports({ current: CURRENT, resolve });
if (PUBLIC_BUILD) log('Public build: skipping data/imports');
for (const f of imports.files) log(f.error ? `  import ${f.file}: ${f.error}` : `  import ${f.file} (${f.src}): ${f.matched} matched, ${f.unmatched} unmatched; fields: ${f.fields.join(', ')}`);

log('Loading Next Gen Stats…');
const [ngsRec, ngsRush, ngsPass] = await Promise.all([L.ngs('receiving'), L.ngs('rushing'), L.ngs('passing')]);

const seasonOut = {};   // season -> Map(gsis -> stats)
const logsOut = {};
const teamStats = {};   // season -> team matchup stats
const meta = { seasons: SEASONS, current: CURRENT, week: state.week, teamGames: {}, routeSource: {}, routeDiag: {} };
let priorSkew = null, priorPosSkew = null;

for (const season of SEASONS) {
  log(`Season ${season}: downloading…`);
  const [plays, part, ftn, snaps, weekly, adv] = await Promise.all([
    L.pbp(season, CURRENT), L.participation(season, CURRENT), L.ftn(season, CURRENT), L.snapCounts(season, CURRENT), L.weeklyStats(season, CURRENT),
    L.pfrAdvanced(season, CURRENT),
  ]);
  if (!plays || !weekly) { log(`  skipping ${season} (no data)`); continue; }
  log(`  ${plays.length} plays, participation=${part ? part.size : 'none'}, ftn=${ftn ? ftn.size : 'none'}, snaps=${snaps ? snaps.length : 'none'}`);
  const res = buildSeason({ season, plays, part, ftn, snaps, weekly, pfr2gsis, posOf, priorSkew, priorPosSkew, ngsRec, ngsRush, ngsPass });
  // PFR advanced: contact yards, broken tackles, bad throws, pressures
  const r3 = x => Math.round(x * 1000) / 1000, r2 = x => Math.round(x * 100) / 100;
  if (adv) for (const [pfr, a] of adv) {
    const g = pfr2gsis.get(pfr), s = g && res.players.get(g);
    if (!s) continue;
    if (a.car >= 10) { s.ybco = r2(a.ybc / a.car); s.yaco = r2(a.yaco / a.car); }
    const touches = (s.box.car || 0) + (s.box.rec || 0);
    s.bt = a.rushBt + a.recBt;
    s.btr = touches >= 10 ? r3(s.bt / touches) : null;
    if (s.box.att >= 20) s.bad = r3(a.badThrows / s.box.att);
    if (s.press == null && s.db >= 20 && a.pressured) s.press = r3(a.pressured / s.db);
  }
  // licensed imports override estimates (e.g. real PFF route counts)
  let applied = 0;
  for (const [g, s] of res.players) { const ext = imports.rows.get(g)?.get(season); if (ext) { applyImport(s, ext); applied++; } }
  if (applied) log(`  applied imported data to ${applied} players`);
  // expected fantasy points (ffopportunity, PPR) and points over expected, per game
  const ep = await L.expectedPoints(season, CURRENT).catch(e => { log('  expected points unavailable:', e.message); return null; });
  let xn = 0;
  if (ep) for (const [g, e] of ep) { const s = res.players.get(g); if (!s?.g) continue; s.xfp = r2(e.xfp / s.g); s.fpoe = r2((e.fp - e.xfp) / s.g); xn++; }
  if (ep) log(`  expected fantasy points: ${xn} players`);
  teamStats[season] = teamSeason({ plays, weekly, part, players: res.players, adv, pfr2gsis, posOf });
  scoreSeason(res.players, posOf, res.teamGames);
  seasonOut[season] = res.players;
  logsOut[season] = res.logs;
  meta.teamGames[season] = res.teamGames;
  meta.routeSource[season] = part ? 'participation' : 'snap-estimate';
  if (res.diag) { meta.routeDiag[season] = res.diag; log(`  route estimator check vs actual: ${(res.diag.mape * 100).toFixed(1)}% avg error over ${res.diag.players} players`); }
  if (part) { priorSkew = res.skew; priorPosSkew = res.posSkew; }
  log(`  ${res.players.size} players aggregated (team games: ${res.teamGames})`);
}

// ---------- assemble player records ----------
log('Assembling players…');
const seasonsDesc = [...SEASONS].reverse().filter(s => seasonOut[s]);
const players = new Map();
const idFor = gsis => gsis2sid.get(gsis) || `g_${gsis}`;

function bioFrom(sid, gsis) {
  const sp = sid ? sleeper[sid] : null;
  const np = gsis ? nflBy.get(gsis) : null;
  return {
    id: sid || `g_${gsis}`, sid: sid || null, gsis: gsis || sp?.gsis || null,
    name: sp?.name || np?.display_name || 'Unknown', pos: sp?.pos || (np?.position === 'FB' ? 'RB' : np?.position),
    team: sp ? sp.team : np?.latest_team || null,
    birth: sp?.birth || np?.birth_date || null,
    draft: np?.draft_year ? { y: np.draft_year, r: np.draft_round, p: np.draft_pick } : null,
    rookie: np?.rookie_season ?? null,
    college: sp?.college || np?.college_name || null,
    ht: np?.height ?? (sp?.ht ? Number(sp.ht) : null), wt: np?.weight ?? (sp?.wt ? Number(sp.wt) : null),
    hs: np?.headshot || null, espn: np?.espn_id ? String(np.espn_id) : null, inj: sp?.inj || null, yexp: sp?.yexp ?? np?.years_of_experience ?? null,
    depth: sp?.depth ?? null, active: sp ? sp.active : true, seasons: {},
  };
}

for (const season of seasonsDesc) {
  for (const [gsis, s] of seasonOut[season]) {
    const id = idFor(gsis);
    if (!players.has(id)) players.set(id, bioFrom(gsis2sid.get(gsis), gsis));
    players.get(id).seasons[season] = s;
  }
}
// rostered/active players without stats (rookies, depth) so league rosters always resolve
for (const sp of Object.values(sleeper)) {
  if (players.has(sp.sid)) continue;
  if (!sp.active || !sp.team) continue;
  players.set(sp.sid, bioFrom(sp.sid, sp.gsis));
}
for (const p of players.values()) {
  p.an = blendScores(p.seasons, seasonsDesc);
  const [a, b] = seasonsDesc;
  const sa = p.seasons[a], sb = p.seasons[b];
  p.anTrend = sa?.score != null && sb?.score != null && sa.g >= 4 && sb.g >= 4 ? sa.score - sb.score : null;
}

const list = [...players.values()].filter(p => FANTASY.has(p.pos));
meta.generated = new Date().toISOString();
meta.model = MODEL;
meta.routeRate = ROUTE_RATE;
meta.count = list.length;
meta.imports = imports.files;
meta.public = PUBLIC_BUILD;

fs.writeFileSync(path.join(OUT, 'players.json'), JSON.stringify({ meta, players: list }));
for (const season of seasonsDesc) {
  const obj = {};
  for (const [gsis, rows] of logsOut[season]) obj[idFor(gsis)] = rows;
  fs.writeFileSync(path.join(OUT, `logs_${season}.json`), JSON.stringify(obj));
}
fs.writeFileSync(path.join(OUT, 'idmap.json'), JSON.stringify({ fp2sid }));
// team matchups: fantasy points allowed, funnels, coverage, offensive lines
const teamsOut = assembleTeams(teamStats, CURRENT);
fs.writeFileSync(path.join(OUT, 'teams.json'), JSON.stringify({ ...teamsOut, generated: new Date().toISOString() }));
log(`Team matchups: ${Object.keys(teamsOut.teams).length} teams (${teamsOut.season}; coverage ${teamsOut.covSeason ?? '—'}, pressure ${teamsOut.pressSeason ?? '—'})`);
// ---------- college football + prospects ----------
try {
  log('College football & prospects…');
  // private sources (Pahowdy's database) only for the copy on your computer, never for the public website
  await buildCollege({ current: CURRENT, nflBy, gsis2sid, out: OUT, log, privateSources: !PUBLIC_BUILD });
} catch (e) {
  log('  college data unavailable this run (NFL data still built):', e.message);
}
const size = fs.statSync(path.join(OUT, 'players.json')).size;
log(`Done. ${list.length} players → data/out/players.json (${(size / 1e6).toFixed(2)} MB)`);
