// App state, data loading, and derived player rows (market + model values).
import { labValue, fundamentals, ageOf, ageScore, pointsFromBox, PRESETS } from './model.js';

const LS = 'dynastylab.v1';
const saved = (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } })();

export const S = {
  mode: 'server', site: null,
  data: null, meta: null, byId: new Map(), rowById: new Map(),
  values: null, valuesKey: '',
  settings: { qb: 1, scoring: 'ppr', teams: 12, anWeight: 0.3, ageTilt: 0, theme: 'auto', ...(saved.settings || {}) },
  sleeperUser: saved.sleeperUser || '', sleeperUserId: saved.sleeperUserId || null,
  leagueId: saved.leagueId || null, league: null,
  version: 0,
  logs: {},
};

export function persist() {
  try { localStorage.setItem(LS, JSON.stringify({ settings: S.settings, sleeperUser: S.sleeperUser, sleeperUserId: S.sleeperUserId, leagueId: S.leagueId })); } catch { /* storage unavailable */ }
}
export const bump = () => { S.version++; };

export const pprParam = () => {
  const sc = S.settings.scoring;
  if (sc === 'league' && S.league) { const rec = S.league.scoring.rec ?? 0; return rec >= 0.75 ? 1 : rec >= 0.25 ? 0.5 : 0; }
  return sc === 'std' ? 0 : sc === 'half' ? 0.5 : 1;
};

/** 'server' when running on your PC (npm start), 'static' on the shareable website. */
export async function detectMode() {
  try {
    const r = await fetch('data/site.json', { cache: 'no-store' });
    if (r.ok) { S.site = await r.json(); S.mode = 'static'; return; }
  } catch { /* fall through */ }
  S.mode = 'server';
}

export async function loadData() {
  const r = await fetch('data/players.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('Data not built yet');
  S.data = await r.json();
  S.meta = S.data.meta;
  S.byId.clear();
  const now = new Date();
  for (const p of S.data.players) { p.age = ageOf(p.birth, now); S.byId.set(p.id, p); }
  S.logs = {};
  bump();
}

export async function loadValues() {
  const qb = S.settings.qb, ppr = pprParam();
  let teams = S.settings.teams;
  if (S.mode === 'static') {
    const sizes = S.site?.teams || [12];
    teams = sizes.reduce((best, t) => (Math.abs(t - teams) < Math.abs(best - teams) ? t : best), sizes[0]);
  }
  const key = `${qb}|${ppr}|${teams}`;
  if (S.valuesKey === key && S.values) return;
  const r = await fetch(S.mode === 'static' ? `data/values/${qb}_${ppr}_${teams}.json` : `api/values?qb=${qb}&ppr=${ppr}&teams=${teams}`);
  if (!r.ok) throw new Error('Could not load market values');
  S.values = await r.json();
  S.valuesKey = key;
  bump();
}

export async function loadLogs(season) {
  if (!S.logs[season]) {
    const r = await fetch(`data/logs_${season}.json`);
    S.logs[season] = r.ok ? await r.json() : {};
  }
  return S.logs[season];
}

// ---------- scoring ----------
export function scoringLabel() {
  const sc = S.settings.scoring;
  if (sc === 'league' && S.league) return 'League scoring';
  return { ppr: 'PPR', half: 'Half PPR', std: 'Standard' }[sc] || 'PPR';
}
export function seasonPoints(p, s) {
  if (!s) return null;
  const sc = S.settings.scoring;
  if (sc === 'league' && S.league) return pointsFromBox(s.box, S.league.scoring, p.pos);
  return s.fp[sc] ?? s.fp.ppr;
}
export function ppg(p, s) { return s && s.g ? seasonPoints(p, s) / s.g : null; }
/** Weekly points from a game-log row: [wk, opp, std, ppr, rec, ...] */
export function weekPoints(p, row) {
  const sc = S.settings.scoring;
  if (sc === 'league' && S.league) {
    const sc2 = S.league.scoring, k = key => sc2[key] || 0;
    const [, , , , rec, , reyd, retd, car, ruyd, rutd, cmp, att, pyd, ptd, int] = row;
    let pts = rec * k('rec') + reyd * k('rec_yd') + retd * k('rec_td') + car * k('rush_att') + ruyd * k('rush_yd') + rutd * k('rush_td')
      + pyd * k('pass_yd') + ptd * k('pass_td') + int * k('pass_int') + cmp * k('pass_cmp') + att * k('pass_att');
    if (p.pos === 'TE') pts += rec * k('bonus_rec_te');
    if (p.pos === 'RB') pts += rec * k('bonus_rec_rb');
    if (p.pos === 'WR') pts += rec * k('bonus_rec_wr');
    return pts;
  }
  const std = row[2], ppr = row[3], rec = row[4];
  return sc === 'std' ? std : sc === 'half' ? std + 0.5 * rec : ppr;
}

export function latestSeason(p) {
  const yrs = Object.keys(p.seasons).map(Number).sort((a, b) => b - a);
  return yrs[0] ?? null;
}
export function curPPG(p) {
  const cur = p.seasons[S.meta.current];
  if (cur && cur.g) return { v: ppg(p, cur), season: S.meta.current, g: cur.g };
  const prev = p.seasons[S.meta.current - 1];
  if (prev && prev.g) return { v: ppg(p, prev), season: S.meta.current - 1, g: prev.g };
  return { v: null, season: null, g: 0 };
}
/** Rest-of-season points per game: this season blended with last season (4-game prior). */
export function projPPG(p) {
  const cur = p.seasons[S.meta.current], prev = p.seasons[S.meta.current - 1];
  const a = cur && cur.g ? ppg(p, cur) : null;
  const b = prev && prev.g >= 4 ? ppg(p, prev) : null;
  if (a != null && b != null) return (cur.g * a + 4 * b) / (cur.g + 4);
  if (a != null) return a;
  return b != null ? b * 0.9 : 0;
}

// ---------- rows: one per player with market + model values ----------
let cache = null, cacheV = -1;
export function rows() {
  if (cache && cacheV === S.version) return cache;
  const V = S.values?.players || {};
  const list = [];
  for (const p of S.data.players) {
    const v = p.sid ? V[p.sid] : null;
    const cp = curPPG(p);
    list.push({ p, v, market: v?.market || 0, ageS: ageScore(p.pos, p.age), ppg: cp.v, ppgSeason: cp.season, proj: projPPG(p) });
  }
  const fund = fundamentals(list, S.meta.current);
  S.fundFit = fund.alpha;
  for (const r of list) {
    const f = fund.get(r);
    r.edge = f ? f.edge : null;
    r.fundPct = f?.fundPct ?? null; r.mktPct = f?.mktPct ?? null;
    const { value, mult } = labValue(r.market, r.edge, r.p.age, r.p.pos, S.settings);
    r.lab = value; r.mult = mult;
  }
  const valued = list.filter(r => r.market > 0);
  valued.sort((a, b) => b.market - a.market).forEach((r, i) => { r.mktRank = i + 1; });
  valued.sort((a, b) => b.lab - a.lab).forEach((r, i) => { r.labRank = i + 1; });
  const pc = {}, mc = {};
  for (const r of valued) { pc[r.p.pos] = (pc[r.p.pos] || 0) + 1; r.posRank = pc[r.p.pos]; }
  for (const r of [...valued].sort((a, b) => b.market - a.market)) { mc[r.p.pos] = (mc[r.p.pos] || 0) + 1; r.mktPosRank = mc[r.p.pos]; }
  for (const r of list) {
    r.signal = !r.market || r.p.an == null ? null : r.mult >= 1.1 ? 'buy' : r.mult <= 0.9 ? 'sell' : 'hold';
  }
  cache = list; cacheV = S.version;
  S.rowById = new Map(list.map(r => [r.p.id, r]));
  return list;
}

// season positional finish under the active scoring
const finishCache = new Map();
export function finish(p, season) {
  const key = `${season}|${S.version}`;
  if (!finishCache.has(key)) {
    const m = new Map(), byPos = {};
    for (const q of S.data.players) {
      const s = q.seasons[season];
      if (!s || !s.g) continue;
      (byPos[q.pos] ||= []).push([q.id, seasonPoints(q, s)]);
    }
    for (const arr of Object.values(byPos)) arr.sort((a, b) => b[1] - a[1]).forEach(([id], i) => m.set(id, i + 1));
    finishCache.set(key, m);
  }
  return finishCache.get(key).get(p.id) ?? null;
}

// ---------- Sleeper ----------
const SL = 'https://api.sleeper.app/v1';
export async function sleeper(path) {
  const r = await fetch(SL + path);
  if (!r.ok) throw new Error(`Sleeper returned ${r.status}`);
  return r.json();
}
export async function findLeagues(username) {
  const u = await sleeper(`/user/${encodeURIComponent(username.trim())}`);
  if (!u || !u.user_id) throw new Error(`No Sleeper user named “${username}”`);
  S.sleeperUser = u.username || username; S.sleeperUserId = u.user_id; persist();
  const seasons = [S.meta.current, S.meta.current + 1];
  const lists = await Promise.all(seasons.map(y => sleeper(`/user/${u.user_id}/leagues/nfl/${y}`).catch(() => [])));
  const seen = new Set();
  return lists.flat().filter(l => l && !seen.has(l.league_id) && seen.add(l.league_id));
}
export async function loadLeague(id) {
  const [info, rosters, users, traded] = await Promise.all([
    sleeper(`/league/${id}`), sleeper(`/league/${id}/rosters`), sleeper(`/league/${id}/users`), sleeper(`/league/${id}/traded_picks`),
  ]);
  if (!info) throw new Error('League not found');
  const slots = info.roster_positions || [];
  const superflex = slots.includes('SUPER_FLEX') || slots.filter(x => x === 'QB').length >= 2;
  S.league = { info, rosters: rosters || [], users: users || [], traded: traded || [], scoring: { ...PRESETS.ppr, ...(info.scoring_settings || {}) }, slots, superflex };
  S.leagueId = id;
  S.settings.qb = superflex ? 2 : 1;
  S.settings.teams = Math.min(32, Math.max(8, info.total_rosters || 12));
  S.settings.scoring = 'league';
  persist(); bump();
  await loadValues();
}
export function unlinkLeague() {
  S.league = null; S.leagueId = null;
  if (S.settings.scoring === 'league') S.settings.scoring = 'ppr';
  persist(); bump();
}
