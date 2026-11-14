// College football: per-player college seasons (box score + advanced/EPA), combine athleticism, draft capital,
// and a Prospect Score for the incoming class and recent rookie classes.
// Free, keyless sources: sportsdataverse (ESPN college data incl. EPA) + nflverse (combine, draft picks, players).
import fs from 'node:fs';
import path from 'node:path';
import { cached, cachedJSON, nflverse, readCSV } from './fetch.mjs';
import { readParquet } from './load.mjs';
import { nameKey } from './imports.mjs';
import { fitDraftModel, ridge, spearman } from './draftmodel.mjs';
import { loadPahowdy, slimPahowdy, PAHOWDY } from './pahowdy.mjs';
import { wikiPlayers, recentViews, historyViews, avgViews, findArticles } from './wiki.mjs';
import { mockConsensus, MOCK_INDEX_URL } from './mocks.mjs';
import { fileURLToPath } from 'node:url';

// pre-draft Wikipedia pageviews of past classes (CC0 Wikimedia data), committed so builds don't re-fetch history
const WIKI_SEED = fileURLToPath(new URL('./wiki_history.json', import.meta.url));

const SDV = 'https://github.com/sportsdataverse/sportsdataverse-data/releases/download';
const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);
const CLASS_NUM = { FR: 1, SO: 2, JR: 3, SR: 4 };
// College route data isn't public: estimated routes = team dropbacks in games played x position route rate.
export const COLLEGE_ROUTE_RATE = { WR: 0.95, TE: 0.8, RB: 0.55, QB: 0 };
const num = v => { if (v == null || v === '') return 0; const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const rd = (x, d = 3) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const div = (a, b) => (b > 0 ? a / b : null);
const posOf = p => (p === 'FB' ? 'RB' : p);
const schoolKey = s => String(s || '').toLowerCase().replace(/\bstate\b/g, 'st').replace(/\buniversity\b|\bof\b|\bthe\b/g, '').replace(/[^a-z]/g, '');

async function sdv(tag, file, season, current, columns) {
  const p = await cached(`${SDV}/${tag}/${file}`, `cfb_${file}`, season >= current ? 12 : 24 * 30);
  return p ? readParquet(p, columns) : [];
}

// ---------------------------------------------------------------- one college season
async function loadSeason(season, current) {
  const [usage, box, rec, rush, pass, roster, tierRush, tierRec] = await Promise.all([
    sdv('espn_cfb_adv_player_usage', `adv_player_usage_${season}.parquet`, season, current,
      ['pos_team_id', 'player_id', 'player_name', 'position_group', 'game_id', 'rushes', 'targets', 'receptions', 'touches', 'opportunities',
        'rush_yards', 'receiving_yards', 'touchdowns', 'explosive_plays', 'successful_plays', 'epa', 'rz_targets', 'rz_rushes', 'rz_touchdowns',
        'team_targets', 'team_touches']),
    sdv('espn_cfb_player_box', `player_box_${season}.parquet`, season, current,
      ['category', 'athlete_id', 'athlete_name', 'team_id', 'game_id', 'completions/passingAttempts', 'passingYards', 'passingTouchdowns', 'interceptions',
        'rushingAttempts', 'rushingYards', 'rushingTouchdowns', 'receptions', 'receivingYards', 'receivingTouchdowns']),
    sdv('espn_cfb_adv_receiving', `adv_receiving_${season}.parquet`, season, current, ['pos_team_id', 'receiver_player_name', 'Tar', 'Rec', 'EPA', 'SR', 'AirYds', 'YAC']),
    sdv('espn_cfb_adv_rushing', `adv_rushing_${season}.parquet`, season, current, ['pos_team_id', 'rusher_player_name', 'Car', 'EPA', 'SR']),
    sdv('espn_cfb_adv_passing', `adv_passing_${season}.parquet`, season, current, ['pos_team_id', 'passer_player_name', 'Att', 'Comp', 'xComp', 'EPA', 'SR', 'Sck', 'AirYds']),
    sdv('espn_cfb_rosters', `cfb_rosters_${season}.parquet`, season, current,
      ['athlete_id', 'full_name', 'position_abbreviation', 'experience_abbreviation', 'team_id', 'team_location', 'division', 'height', 'weight', 'date_of_birth', 'headshot_href', 'cfbd_recruit_ids']),
    sdv('espn_cfb_rushing', `cfb_rushing_${season}.parquet`, season, current, ['team_id', 'fbs_class', 'division']),
    sdv('espn_cfb_receiving', `cfb_receiving_${season}.parquet`, season, current, ['team_id', 'fbs_class', 'division']),
  ]);
  const tierByTeam = new Map();
  for (const r of [...tierRush, ...tierRec]) tierByTeam.set(String(r.team_id), r.division === 'fcs' ? 'FCS' : r.fbs_class || null);
  if (!usage.length && !box.length) return null;

  const P = new Map(); // athlete id -> accumulator
  const get = id => { let o = P.get(id); if (!o) { o = { games: new Set(), teams: {}, tgt: 0, rec: 0, reyd: 0, retd: 0, car: 0, ruyd: 0, rutd: 0, pc: 0, pa: 0, pyd: 0, ptd: 0, int: 0,
    opp: 0, exp: 0, succ: 0, epa: 0, rzt: 0, rzr: 0, rztd: 0, teamTgt: 0, teamTch: 0, tch: 0, uRushes: 0, uTargets: 0 }; P.set(id, o); } return o; };
  const T = new Map(); // team id -> season totals
  const team = id => { let t = T.get(id); if (!t) { t = { games: new Set(), passAtt: 0, recYds: 0, recTd: 0, rushAtt: 0, rushYds: 0, rushTd: 0, recRec: 0 }; T.set(id, t); } return t; };
  const nameToId = new Map(); // `${nameKey}|${teamId}` -> athlete id

  for (const r of box) {
    const id = String(r.athlete_id), tid = String(r.team_id), t = team(tid);
    t.games.add(r.game_id);
    if (!['passing', 'rushing', 'receiving'].includes(r.category)) continue;
    const o = get(id);
    o.games.add(r.game_id); o.teams[tid] = (o.teams[tid] || 0) + 1; o.name ||= r.athlete_name; (o.gt ||= {})[r.game_id] = tid;
    nameToId.set(`${nameKey(r.athlete_name)}|${tid}`, id);
    if (r.category === 'passing') {
      const [c, a] = String(r['completions/passingAttempts'] || '0/0').split('/').map(num);
      t.passAtt += a; o.pc += c; o.pa += a; o.pyd += num(r.passingYards); o.ptd += num(r.passingTouchdowns); o.int += num(r.interceptions);
    } else if (r.category === 'rushing') {
      const a = num(r.rushingAttempts), y = num(r.rushingYards);
      t.rushAtt += a; t.rushYds += y; t.rushTd += num(r.rushingTouchdowns); o.car += a; o.ruyd += y; o.rutd += num(r.rushingTouchdowns);
    } else {
      const c = num(r.receptions), y = num(r.receivingYards), td = num(r.receivingTouchdowns);
      t.recRec += c; t.recYds += y; t.recTd += td; o.rec += c; o.reyd += y; o.retd += td;
    }
  }
  for (const u of usage) {
    const id = String(u.player_id), o = get(id), tid = String(u.pos_team_id);
    o.games.add(u.game_id); o.teams[tid] = (o.teams[tid] || 0) + 1; o.name ||= u.player_name; o.group ||= u.position_group; (o.gt ||= {})[u.game_id] ||= tid;
    nameToId.set(`${nameKey(u.player_name)}|${tid}`, id);
    o.uTargets += num(u.targets); o.uRushes += num(u.rushes); o.tch += num(u.touches);
    o.opp += num(u.opportunities); o.exp += num(u.explosive_plays); o.succ += num(u.successful_plays); o.epa += num(u.epa);
    o.rzt += num(u.rz_targets); o.rzr += num(u.rz_rushes); o.rztd += num(u.rz_touchdowns);
    o.teamTgt += num(u.team_targets); o.teamTch += num(u.team_touches);
  }
  // advanced (name + team keyed)
  const adv = (rows, nameCol, fn) => {
    for (const r of rows) {
      const id = nameToId.get(`${nameKey(r[nameCol])}|${String(r.pos_team_id)}`);
      if (id) fn(get(id), r);
    }
  };
  adv(rec, 'receiver_player_name', (o, r) => {
    const n = num(r.Tar); o.aTgt = (o.aTgt || 0) + n; o.aRecEpa = (o.aRecEpa || 0) + num(r.EPA); o.aRecSr = (o.aRecSr || 0) + num(r.SR) * n;
    if (r.AirYds != null) { o.airTgt = (o.airTgt || 0) + n; o.air = (o.air || 0) + num(r.AirYds); }
    if (r.YAC != null) { o.yacRec = (o.yacRec || 0) + num(r.Rec); o.yac = (o.yac || 0) + num(r.YAC); }
  });
  adv(rush, 'rusher_player_name', (o, r) => { const n = num(r.Car); o.aCar = (o.aCar || 0) + n; o.aRushEpa = (o.aRushEpa || 0) + num(r.EPA); o.aRushSr = (o.aRushSr || 0) + num(r.SR) * n; });
  adv(pass, 'passer_player_name', (o, r) => {
    const n = num(r.Att), sk = num(r.Sck); o.aAtt = (o.aAtt || 0) + n; o.aSk = (o.aSk || 0) + sk; o.aPassEpa = (o.aPassEpa || 0) + num(r.EPA);
    o.aPassSr = (o.aPassSr || 0) + num(r.SR) * (n + sk); o.aComp = (o.aComp || 0) + num(r.Comp); o.aXComp = (o.aXComp || 0) + num(r.xComp); // xComp = expected completions (a count)
    if (r.AirYds != null) { o.pAirAtt = (o.pAirAtt || 0) + n; o.pAir = (o.pAir || 0) + num(r.AirYds); }
  });

  // ESPN's expected-completion model runs ~5 points low league-wide; center CPOE so 0 = this season's average
  let lc = 0, lx = 0, la = 0;
  for (const r of pass) { lc += num(r.Comp); lx += num(r.xComp); la += num(r.Att); }
  const leagueCpoe = la ? ((lc - lx) / la) * 100 : 0;
  // ---- play-by-play: explosive runs, stuffs, breakaway yards, line yards, explosive catches, deep targets, team dropbacks
  const pbp = await sdv('espn_cfb_pbp', `play_by_play_${season}.parquet`, season, current,
    ['game_id', 'pos_team_id', 'rush', 'pass', 'target', 'completion', 'kneel_down', 'rusher_player_id', 'receiver_player_id',
      'yds_rushed', 'yds_receiving', 'air_yards', 'line_yards', 'firstD_by_yards']);
  const drop = new Map(); // game|team -> dropbacks
  for (const r of pbp) {
    const key = `${r.game_id}|${String(r.pos_team_id)}`;
    if (r.pass) drop.set(key, (drop.get(key) || 0) + 1);
    if (r.rush && !r.kneel_down && r.rusher_player_id != null) {
      const o = get(String(r.rusher_player_id)), y = num(r.yds_rushed);
      o.pCar = (o.pCar || 0) + 1; o.pRuYd = (o.pRuYd || 0) + y;
      if (y >= 10) o.r10 = (o.r10 || 0) + 1;
      if (y >= 15) { o.r15 = (o.r15 || 0) + 1; o.y15 = (o.y15 || 0) + y; }
      if (y <= 0) o.stf = (o.stf || 0) + 1;
      if (r.line_yards != null) { o.lyN = (o.lyN || 0) + 1; o.ly = (o.ly || 0) + num(r.line_yards); }
    }
    if (r.target && r.receiver_player_id != null) {
      const o = get(String(r.receiver_player_id)), y = num(r.yds_receiving);
      o.pTgt = (o.pTgt || 0) + 1;
      if (r.completion && y >= 20) o.c20 = (o.c20 || 0) + 1;
      if (r.completion && r.firstD_by_yards) o.fd = (o.fd || 0) + 1;
      if (r.air_yards != null) { o.airN2 = (o.airN2 || 0) + 1; if (num(r.air_yards) >= 20) o.deepT = (o.deepT || 0) + 1; }
    }
  }

  const R = new Map(roster.map(r => [String(r.athlete_id), r]));
  // league context: typical number of team games so far (for prorated volume thresholds)
  const fbsTeams = new Set(roster.filter(r => r.division === 'fbs').map(r => String(r.team_id)));
  const tg = [...T.entries()].filter(([id]) => fbsTeams.has(id)).map(([, t]) => t.games.size).sort((a, b) => a - b);
  const teamGames = tg.length ? tg[Math.floor(tg.length / 2)] : 12;

  const out = new Map();
  for (const [id, o] of P) {
    const ro = R.get(id);
    let pos = posOf(ro?.position_abbreviation) || null;
    if (!SKILL.has(pos)) pos = SKILL.has(o.group) ? o.group : null;
    if (!pos) continue;
    const tid = Object.entries(o.teams).sort((a, b) => b[1] - a[1])[0]?.[0];
    const t = T.get(tid) || { passAtt: 0, recYds: 0, recTd: 0, rushAtt: 0, rushYds: 0 };
    const g = o.games.size;
    const tgt = Math.max(o.uTargets, o.aTgt || 0);
    const ysh = div(o.reyd, t.recYds), tdsh = div(o.retd, t.recTd);
    let teamDb = 0;
    for (const gm of o.games) { const tm = o.gt?.[gm]; if (tm) teamDb += drop.get(`${gm}|${tm}`) || 0; }
    const routes = teamDb * (COLLEGE_ROUTE_RATE[pos] || 0);
    const s = {
      season, cid: id, name: ro?.full_name || o.name, pos, team: ro?.team_location || null, tid, div: ro?.division || null,
      tier: tierByTeam.get(String(tid)) || (ro?.division === 'fcs' ? 'FCS' : null),
      cls: ro?.experience_abbreviation || null, ht: ro?.height ?? null, wt: ro?.weight ?? null, g,
      tgt, rec: o.rec, reyd: o.reyd, retd: o.retd, car: o.car, ruyd: o.ruyd, rutd: o.rutd, pc: o.pc, pa: o.pa, pyd: o.pyd, ptd: o.ptd, int: o.int,
      // shares
      tsh: rd(div(o.uTargets, o.teamTgt)), ysh: rd(ysh), tdsh: rd(tdsh),
      dom: rd(ysh != null ? (ysh + (tdsh ?? 0)) / 2 : null), yptpa: rd(div(o.reyd, t.passAtt), 2),
      csh: rd(div(o.car, t.rushAtt)), scsh: rd(div(o.ruyd + o.reyd, t.rushYds + t.recYds)), tch: rd(div(o.tch, o.teamTch)),
      rdom: rd(t.rushYds + t.recYds > 0 ? ((o.ruyd + o.reyd) / (t.rushYds + t.recYds) + (div(o.rutd + o.retd, (t.rushTd || 0) + t.recTd) ?? 0)) / 2 : null),
      // efficiency
      ypc: rd(div(o.ruyd, o.car), 2), ypr: rd(div(o.reyd, o.rec), 1), ypt: rd(div(o.reyd, tgt), 2), catch: rd(div(o.rec, tgt)),
      epat: rd(div(o.aRecEpa, o.aTgt), 2), rsr: rd(div(o.aRecSr, o.aTgt)), adot: rd(div(o.air, o.airTgt), 1), yacr: rd(div(o.yac, o.yacRec), 1),
      epar: rd(div(o.aRushEpa, o.aCar), 2), rusr: rd(div(o.aRushSr, o.aCar)),
      exp: rd(div(o.exp, o.opp)), sr: rd(div(o.succ, o.opp)), epao: rd(div(o.epa, o.opp), 2),
      scpg: rd(div(o.ruyd + o.reyd, g), 1),
      // QB rushing without sacks (college box scores count sacks as runs) or kneel-downs, from play-by-play
      qcar: o.pCar ?? null, qruyd: o.pCar ? o.pRuYd : null, qypc: rd(div(o.pRuYd, o.pCar), 2),
      rypg: rd(div(o.pCar ? o.pRuYd : o.ruyd, g), 1),
      ypa: rd(div(o.pyd, o.pa), 2), epap: rd(div(o.aPassEpa, (o.aAtt || 0) + (o.aSk || 0)), 2),
      cpoe: rd(o.aAtt ? ((o.aComp - o.aXComp) / o.aAtt) * 100 - leagueCpoe : null, 1), psr: rd(div(o.aPassSr, (o.aAtt || 0) + (o.aSk || 0))),
      skr: rd(div(o.aSk, (o.aAtt || 0) + (o.aSk || 0))), padot: rd(div(o.pAir, o.pAirAtt), 1),
      rzt: o.rzt, rzr: o.rzr, rztd: o.rztd,
      // play-by-play metrics
      exp10: rd(div(o.r10 || 0, o.pCar)), exp15: rd(div(o.r15 || 0, o.pCar)), stuff: rd(div(o.stf || 0, o.pCar)),
      brk: rd(o.pRuYd > 0 ? (o.y15 || 0) / o.pRuYd : null), lypc: rd(div(o.ly, o.lyN), 2),
      rec20r: rd(div(o.c20 || 0, o.pTgt)), deep: rd(div(o.deepT || 0, o.airN2)), fdt: rd(div(o.fd || 0, o.pTgt)),
      routes: routes ? Math.round(routes) : null, yprr: rd(div(o.reyd, routes), 2), tprr: rd(div(tgt, routes)),
      hs: ro?.headshot_href || null, dob: ro?.date_of_birth || null,
      recruitId: ro?.cfbd_recruit_ids ? String(ro.cfbd_recruit_ids).replace(/[^0-9,]/g, '').split(',')[0] || null : null,
    };
    out.set(id, s);
  }
  // everyone on a roster this season (incl. redshirts with no stats) — the first roster year ≈ the year out of high school
  return { players: out, teamGames, rosterIds: roster.map(r => String(r.athlete_id)) };
}

// volume needed to show up / to qualify for percentiles, per team game
const VOL = { WR: s => s.tgt, TE: s => s.tgt, RB: s => s.car + s.tgt, QB: s => s.pa };
const SHOW = { WR: 2, TE: 1.5, RB: 4, QB: 8 };
const QUAL = { WR: 3.5, TE: 2.5, RB: 7, QB: 15 };
export const COLLEGE_PCT = {
  WR: ['tsh', 'ysh', 'dom', 'yptpa', 'yprr', 'tprr', 'ypt', 'ypr', 'catch', 'epat', 'rsr', 'adot', 'yacr', 'exp', 'rec20r', 'deep', 'fdt', 'scpg', 'rztd'],
  TE: ['tsh', 'ysh', 'dom', 'yptpa', 'yprr', 'tprr', 'ypt', 'ypr', 'catch', 'epat', 'rsr', 'adot', 'yacr', 'exp', 'rec20r', 'deep', 'fdt', 'scpg', 'rztd'],
  RB: ['csh', 'scsh', 'tch', 'tsh', 'ypc', 'epar', 'rusr', 'exp', 'exp10', 'exp15', 'stuff', 'brk', 'lypc', 'epao', 'scpg', 'ypt', 'yprr', 'rztd'],
  QB: ['epap', 'cpoe', 'ypa', 'psr', 'skr', 'padot', 'rypg', 'qypc', 'epao'],
};
const LOWER = new Set(['skr', 'stuff']);

function midRankFn(values) {
  const sorted = values.filter(v => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  return v => {
    if (v == null || !sorted.length) return null;
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
    let eq = lo; while (eq < sorted.length && sorted[eq] === v) eq++;
    return ((lo + (eq - lo) / 2) / sorted.length) * 100;
  };
}

function percentilesForSeason(players, teamGames) {
  for (const pos of Object.keys(COLLEGE_PCT)) {
    const all = [...players.values()].filter(s => s.pos === pos);
    const pool = all.filter(s => VOL[pos](s) >= QUAL[pos] * teamGames && s.div === 'fbs');
    for (const s of all) { s.q = VOL[pos](s) >= QUAL[pos] * teamGames; s.pct = {}; }
    for (const m of COLLEGE_PCT[pos]) {
      const f = midRankFn(pool.map(s => s[m]));
      for (const s of all) { const p = f(s[m]); if (p != null) s.pct[m] = Math.round(LOWER.has(m) ? 100 - p : p); }
    }
  }
}

// ---------------------------------------------------------------- prospect model
const SPEED = (wt, forty) => (wt && forty ? (wt * 200) / forty ** 4 : null);
const htIn = h => { if (h == null) return null; if (typeof h === 'number') return h; const m = String(h).match(/(\d+)-(\d+)/); return m ? Number(m[1]) * 12 + Number(m[2]) : null; };
const draftCapital = pick => (pick ? Math.round(100 * Math.exp(-(pick - 1) / 45)) : null);
// production features per position: [season metric, weight]
const PROD = {
  WR: [['dom', 0.3], ['yprr', 0.2], ['tsh', 0.15], ['yptpa', 0.15], ['epat', 0.1], ['rec20r', 0.1]],
  TE: [['dom', 0.3], ['yprr', 0.2], ['tsh', 0.15], ['yptpa', 0.15], ['epat', 0.1], ['rec20r', 0.1]],
  RB: [['scsh', 0.25], ['scpg', 0.15], ['tsh', 0.15], ['exp10', 0.15], ['epar', 0.15], ['brk', 0.15]],
  QB: [['epap', 0.35], ['cpoe', 0.2], ['ypa', 0.15], ['rypg', 0.15], ['psr', 0.15]],
};
// thresholds calibrated so a similar share of day 1–2 NFL draft picks clears each (~75–90%)
const BREAKOUT = { WR: ['dom', 0.2], TE: ['dom', 0.12], RB: ['scsh', 0.2] };
// Production is discounted for weaker competition (Power 4 full credit).
export const TIER_FACTOR = { P4: 1, P5: 1, G6: 0.82, G5: 0.82, FCS: 0.6 }; // P5/G5 = pre-2024 labels
// Before the draft there's no draft capital, so a model trained on recent drafts projects it (pdc) from
// recruiting, production vs. competition, breakout, age, conference and size; real draft capital replaces it after.
const CLASS_AGE = { FR: 95, SO: 90, JR: 75, SR: 40 };
export const PROSPECT_WEIGHTS = {
  pre: { pdc: 0.45, prod: 0.3, brk: 0.1, ath: 0.1, age: 0.05 },
  preQB: { pdc: 0.5, prod: 0.3, ath: 0.1, age: 0.1 },
  drafted: { dc: 0.4, prod: 0.35, brk: 0.1, ath: 0.1, age: 0.05 },
};
// NFL rule: a player can enter the draft once three seasons have passed since his high-school class graduated.
const YEARS_OUT_OF_HS = 3;
// typical age on draft day (late April) for a player N years out of high school: ~18.05 + N
const draftAgeFromHs = (draftYear, hs) => 18.05 + (draftYear - hs);

// season production index (0–100): weighted percentile over the position's production metrics, competition-adjusted
function seasonProd(s) {
  if (!s?.q || !s.pct || !PROD[s.pos]) return null;
  let n = 0, d = 0;
  for (const [m, w] of PROD[s.pos]) { const v = s.pct[m]; if (v != null) { n += v * w; d += w; } }
  return d >= 0.4 ? (n / d) * (TIER_FACTOR[s.tier] ?? 0.85) : null;
}
const recruitScore = rc => (!rc ? 0 : rc.grade ? Math.max(0, Math.min(100, ((rc.grade - 78) / 22) * 100)) : ({ 5: 95, 4: 65, 3: 30, 2: 5 }[rc.stars] ?? 0));
export const DRAFT_FEATURES = ['best-season production', 'best-season production (squared)', 'final-season production', 'recruiting grade',
  'no recruiting profile', 'breakout', 'age on draft day', 'Power 4 school', 'FCS school', 'qualified seasons', 'height', 'weight',
  'Wikipedia attention (log of monthly page views)'];
function draftFeatures(list, info, hs, draftYear, attention = 0) {
  const last = list[list.length - 1];
  const prods = list.map(seasonProd).filter(v => v != null);
  const best = prods.length ? Math.max(...prods) : 0;
  return [
    best, (best * best) / 100, seasonProd(last) ?? 0,
    recruitScore(info?.rc), info?.rc ? 0 : 1,
    last.pos === 'QB' ? 0 : breakoutScore(info?.bk) ?? 0,
    draftAgeFromHs(draftYear, hs),
    last.tier === 'P4' || last.tier === 'P5' ? 1 : 0, last.tier === 'FCS' ? 1 : 0,
    list.filter(s => s.q).length,
    last.ht ?? NaN, last.wt ?? NaN,
    attention,
  ];
}

function bestSeason(pos, seasons) {
  const qual = seasons.filter(s => s.q);
  const pool = qual.length ? qual : seasons;
  const key = pos === 'QB' ? 'epap' : pos === 'RB' ? 'scsh' : 'dom';
  return pool.reduce((b, s) => ((s[key] ?? -1e9) > (b?.[key] ?? -1e9) ? s : b), null);
}

function breakout(pos, seasons, dob) {
  const rule = BREAKOUT[pos];
  if (!rule) return null;
  const first = [...seasons].sort((a, b) => a.season - b.season).find(s => (s[rule[0]] ?? 0) >= rule[1] && s.q);
  if (!first) return { none: true };
  const age = dob ? (new Date(`${first.season}-09-01`) - new Date(dob)) / (365.25 * 864e5) : null;
  return { season: first.season, cls: first.cls, age: rd(age, 1) };
}
const breakoutScore = b => {
  if (!b) return null;
  if (b.none) return 0;
  if (b.age != null) return b.age < 19.5 ? 100 : b.age < 20.5 ? 80 : b.age < 21.5 ? 55 : b.age < 22.5 ? 30 : 10;
  return { FR: 100, SO: 75, JR: 45, SR: 20 }[b.cls] ?? 30;
};

// ---------------------------------------------------------------- main
// privateSources: true only for the copy of the app on your own computer (never for the public website build)
export async function buildCollege({ current, nflBy, gsis2sid, out, log, privateSources = false }) {
  const seasons = [];
  for (let y = current - 7; y <= current; y++) seasons.push(y);
  const bySeason = {};
  for (const y of seasons) {
    const res = await loadSeason(y, current);
    if (!res) { log(`  college ${y}: no data`); continue; }
    percentilesForSeason(res.players, res.teamGames);
    bySeason[y] = res;
    log(`  college ${y}: ${res.players.size} skill players (team games ${res.teamGames})`);
  }
  const career = new Map();
  for (const y of Object.keys(bySeason).map(Number).sort()) for (const [cid, s] of bySeason[y].players) {
    if (!career.has(cid)) career.set(cid, []);
    career.get(cid).push(s);
  }
  // ESPN roster files carry each player's *latest* class in every season, so count back from the last season.
  const CLS = ['FR', 'SO', 'JR', 'SR'];
  for (const list of career.values()) {
    const last = list[list.length - 1];
    const n = CLASS_NUM[last.cls];
    if (!n) continue;
    for (const s of list) s.cls = CLS[Math.min(3, Math.max(0, n - 1 - (last.season - s.season)))];
  }

  // recruiting (stars / composite grade): match on name + position + recruiting class year
  const recruitsByName = new Map();
  for (let y = current - 9; y <= current; y++) {
    for (const r of await sdv('cfb_recruits', `cfb_recruits_${y}.parquet`, y, current, ['player_name', 'stars', 'grade', 'position'])) {
      const k = nameKey(r.player_name);
      if (!recruitsByName.has(k)) recruitsByName.set(k, []);
      recruitsByName.get(k).push({ stars: r.stars, grade: rd(r.grade, 1), year: y, pos: r.position });
    }
  }
  const POSMAP = { QB: ['QB', 'PRO', 'DUAL', 'ATH'], RB: ['RB', 'APB', 'ATH'], WR: ['WR', 'ATH'], TE: ['TE', 'ATH'] };
  const findRecruit = (name, pos, firstSeason) => {
    const c = (recruitsByName.get(nameKey(name)) || []).filter(r => r.year >= firstSeason - 2 && r.year <= firstSeason
      && (!r.pos || POSMAP[pos].some(x => String(r.pos).toUpperCase().includes(x))));
    return c.length === 1 ? c[0] : c.length > 1 && new Set(c.map(r => r.year)).size === 1 ? c.sort((a, b) => b.grade - a.grade)[0] : null;
  };

  // combine + draft picks (nflverse)
  const combine = (await readParquet(await nflverse('combine', 'combine.parquet', 24 * 3))).filter(r => SKILL.has(posOf(r.pos)));
  const picks = (await readParquet(await nflverse('draft_picks', 'draft_picks.parquet', 24))).filter(r => SKILL.has(posOf(r.position)));
  const combineByPfr = new Map(combine.filter(r => r.pfr_id).map(r => [r.pfr_id, r]));
  // historical combine distributions for athletic percentiles (by position)
  const ath = {};
  for (const pos of ['RB', 'WR', 'TE', 'QB']) {
    const rows = combine.filter(r => posOf(r.pos) === pos);
    ath[pos] = {
      ss: midRankFn(rows.map(r => SPEED(r.wt, r.forty))), forty: midRankFn(rows.map(r => r.forty)),
      vert: midRankFn(rows.map(r => r.vertical)), broad: midRankFn(rows.map(r => r.broad_jump)),
      cone: midRankFn(rows.map(r => r.cone)), shuttle: midRankFn(rows.map(r => r.shuttle)), ht: midRankFn(rows.map(r => htIn(r.ht))),
    };
  }
  const combineCard = (c, pos) => {
    if (!c) return null;
    const A = ath[pos], ss = SPEED(c.wt, c.forty);
    const parts = [];
    if (pos !== 'QB' && ss != null) parts.push([A.ss(ss), 2]);
    if (pos === 'QB' && c.forty) parts.push([100 - A.forty(c.forty), 1]);
    if (c.vertical) parts.push([A.vert(c.vertical), 1]);
    if (c.broad_jump) parts.push([A.broad(c.broad_jump), 1]);
    if (c.cone) parts.push([100 - A.cone(c.cone), 1]);
    if (c.shuttle) parts.push([100 - A.shuttle(c.shuttle), 1]);
    const w = parts.reduce((s, [, x]) => s + x, 0);
    return {
      ht: htIn(c.ht), wt: c.wt, forty: c.forty, vert: c.vertical, broad: c.broad_jump, cone: c.cone, shuttle: c.shuttle, bench: c.bench,
      ss: rd(ss, 1), ssPct: ss != null ? Math.round(A.ss(ss)) : null, ath: w ? Math.round(parts.reduce((s, [p, x]) => s + p * x, 0) / w) : null,
    };
  };

  // ---- career-level info for every college player
  const dobByCid = new Map();
  for (const np of nflBy.values()) if (np.espn_id && np.birth_date) dobByCid.set(String(np.espn_id), np.birth_date);
  // Pahowdy's Prospect Database (local builds only): match to NFL ids (gsis / PFR) or college players (name + school),
  // and use its birth dates where we don't have one, so ages and breakout ages are exact instead of estimated
  let pahowdy = [];
  if (privateSources) {
    try { pahowdy = await loadPahowdy(log); } catch (e) { log('  Pahowdy database unavailable:', e.message); }
    const byPfr = new Map();
    for (const np of nflBy.values()) if (np.pfr_id) byPfr.set(np.pfr_id, np);
    const byName = new Map();
    for (const [cid, list] of career) {
      const s = list[list.length - 1], k = `${nameKey(s.name)}|${s.pos}`;
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push({ cid, team: s.team });
    }
    for (const r of pahowdy) {
      const np = (r.gsis && nflBy.get(r.gsis)) || (r.pfr && byPfr.get(r.pfr)) || null;
      if (np) { r.sid = gsis2sid.get(np.gsis_id) || `g_${np.gsis_id}`; if (np.espn_id) r.cid = String(np.espn_id); }
      if (!r.cid) {
        const c = byName.get(`${nameKey(r.name)}|${r.pos}`) || [];
        const k = schoolKey(r.college);
        const m = c.length > 1 ? c.filter(x => { const t = schoolKey(x.team); return t && k && (t.includes(k) || k.includes(t)); }) : c;
        if (m.length === 1) r.cid = m[0].cid;
      }
      if (r.cid && r.dob && !dobByCid.has(r.cid)) dobByCid.set(r.cid, r.dob);
    }
    log(`  Pahowdy matches: ${pahowdy.filter(r => r.sid).length} NFL players, ${pahowdy.filter(r => r.cid).length} college players`);
  }
  // Wikipedia (Wikidata, CC0): which college players have an article (→ attention from pageviews) and their birth
  // dates. Matched on name; birth year must fit the player's first college season, and colleges break ties.
  const wikiOf = new Map();
  {
    const wiki = await wikiPlayers(log);
    const byKey = new Map();
    for (const w of wiki) {
      for (const nm of new Set([w.name, w.title.replace(/_\([^)]*\)$/, '').replace(/_/g, ' ')])) {
        const k = nameKey(nm);
        if (!byKey.has(k)) byKey.set(k, []);
        if (!byKey.get(k).includes(w)) byKey.get(k).push(w);
      }
    }
    for (const [cid, list] of career) {
      const last = list[list.length - 1];
      let c = (byKey.get(nameKey(last.name)) || []).filter(w => { const y = Number(String(w.dob).slice(0, 4)); return !w.dob || (list[0].season - y >= 16 && list[0].season - y <= 22); });
      if (c.length > 1) {
        const teams = list.map(s => schoolKey(s.team)).filter(Boolean);
        const m = c.filter(w => w.colleges.some(col => { const k = schoolKey(col); return teams.some(t => k.includes(t) || t.includes(k)); }));
        if (m.length) c = m;
      }
      if (c.length !== 1) continue;
      wikiOf.set(cid, c[0]);
      if (c[0].dob && !dobByCid.has(cid)) dobByCid.set(cid, c[0].dob);
    }
    log(`  Wikipedia articles matched: ${wikiOf.size} college players`);
  }
  const YEAR_MS = 365.25 * 864e5;
  const careerInfo = new Map();
  for (const [cid, list] of career) {
    const last = list[list.length - 1];
    const pos = last.pos;
    const rc = findRecruit(last.name, pos, list[0].season);
    const dob = dobByCid.get(cid) || null;
    let bk = null;
    const rule = BREAKOUT[pos];
    if (rule) {
      const first = list.find(x => x.q && (x[rule[0]] ?? 0) >= rule[1]);
      if (first) {
        // exact from birth date when known; otherwise ~18.4 in the fall of the recruiting class year, else from class year
        let age = null, est = false;
        if (dob) age = (new Date(`${first.season}-09-01`) - new Date(dob)) / YEAR_MS;
        else if (rc?.year) { age = 18.4 + (first.season - rc.year); est = true; }
        else if (CLASS_NUM[first.cls]) { age = 18.4 + (CLASS_NUM[first.cls] - 1); est = true; }
        bk = { season: first.season, cls: first.cls, age: rd(age, 1), est };
      } else if (list.some(x => x.q)) bk = { none: true };
    }
    const domKey = pos === 'RB' ? 'rdom' : 'dom';
    const best = pos === 'QB' ? null : Math.max(...list.filter(x => x.q).map(x => x[domKey] ?? -1), -1);
    careerInfo.set(cid, { bk, rc, best: best != null && best >= 0 ? best : null });
    // stamp the breakout onto every season from the breakout year on (for tables)
    if (bk && !bk.none) for (const x of list) if (x.season >= bk.season) { x.bkAge = bk.age; if (bk.est) x.bkEst = true; }
  }
  // breakout-age percentiles per season (younger = better), among qualified players at the position
  for (const { players } of Object.values(bySeason)) {
    for (const pos of ['WR', 'TE', 'RB']) {
      const rows = [...players.values()].filter(x => x.pos === pos && x.q && x.bkAge != null);
      const f = midRankFn(rows.map(x => x.bkAge));
      for (const x of rows) (x.pct ||= {}).bkAge = Math.round(100 - f(x.bkAge));
    }
  }

  // ---- NFL draft eligibility (three seasons out of high school). The first college roster year is the
  // high-school class for almost everyone; the recruiting class catches gap years / prep school / missions, and
  // ESPN's class year (which never runs ahead of years since high school) catches JUCO transfers.
  const firstRoster = new Map(), lastRoster = new Map();
  for (const y of Object.keys(bySeason).map(Number).sort((a, b) => a - b)) {
    for (const id of bySeason[y].rosterIds || []) { if (!firstRoster.has(id)) firstRoster.set(id, y); lastRoster.set(id, y); }
  }
  const dataStart = Math.min(...Object.keys(bySeason).map(Number));
  const eligByCid = new Map();
  for (const [cid, list] of career) {
    const first = Math.min(firstRoster.get(cid) ?? Infinity, list[0].season);
    const info = careerInfo.get(cid);
    let hs = first;
    if (info.rc?.year && info.rc.year < hs && info.rc.year >= hs - 2) hs = info.rc.year;
    const last = list[list.length - 1], n = CLASS_NUM[last.cls];
    if (n && last.season - n + 1 < hs) hs = last.season - n + 1;
    const el = { year: hs + YEARS_OUT_OF_HS, hs, ...(first <= dataStart ? { early: true } : {}) };
    eligByCid.set(cid, el);
    info.el = el;
    for (const s of list) s.elig = el.year;
  }

  // ---- projected draft capital: train on everyone who left college after the 2nd data season onward
  const draftedByCid = new Map(), draftedByName = new Map();
  for (const r of picks) {
    const np = nflBy.get(r.gsis_id);
    if (np?.espn_id && !draftedByCid.has(String(np.espn_id))) draftedByCid.set(String(np.espn_id), r);
    draftedByName.set(`${nameKey(r.pfr_player_name)}|${posOf(r.position)}|${r.season}`, r);
  }
  // pre-draft FantasyPros rookie rankings for past classes (DynastyProcess archives every ECR scrape): the target
  // for the "expert-style" model, which learns what fantasy experts value from the same college profile
  const ecrSnaps = await preDraftRookieEcr(dataStart + 2, current, log);
  // training pool: everyone who left college, draft-eligible, with a qualified season
  const leavers = [];
  for (const [cid, list] of career) {
    const last = list[list.length - 1], Y = last.season + 1, el = eligByCid.get(cid);
    if (Y < dataStart + 2 || Y > current || !list.some(s => s.q) || el.year > Y) continue;
    if ((lastRoster.get(cid) ?? last.season) > last.season) continue; // still on a roster (redshirt / injury year): hasn't left
    leavers.push({ cid, list, last, Y, el });
  }
  // Wikipedia attention: average monthly pageviews from September of the final season through January (through
  // last month for players still in school), as a percentile within the class. No article = no attention.
  // current players for the next three classes (big board + two devy boards): FBS, with real production or a 4–5★
  // recruiting profile. Articles Wikidata doesn't list are found on Wikipedia directly (name + school category).
  const poolFor = Y => [...(bySeason[current]?.players.values() || [])].filter(s => {
    const el = eligByCid.get(s.cid)?.year;
    if (el == null || (Y === current + 1 ? el > Y : el !== Y) || s.div !== 'fbs') return false;
    return s.q || bySeason[current - 1]?.players.get(s.cid)?.q || careerInfo.get(s.cid)?.rc?.stars >= 4;
  }).map(s => s.cid);
  const pools = Object.fromEntries([current + 1, current + 2, current + 3].map(Y => [Y, poolFor(Y)]));
  const missing = [...new Set(Object.values(pools).flat())].filter(cid => !wikiOf.has(cid)).map(cid => {
    const list = career.get(cid), last = list[list.length - 1];
    return { key: cid, name: last.name, pos: last.pos, teams: [...new Set(list.map(s => s.team).filter(Boolean))] };
  });
  for (const [cid, title] of await findArticles(missing, { schoolKey, log })) wikiOf.set(cid, { title, name: null, dob: null, colleges: [] });
  const hist = await historyViews(leavers.map(l => wikiOf.get(l.cid)?.title).filter(Boolean),
    { seedFile: WIKI_SEED, log, budgetMs: Number(process.env.WIKI_BUDGET_MIN || 8) * 60e3 });
  const recent = await recentViews([...new Set(Object.values(pools).flat())].map(cid => wikiOf.get(cid)?.title).filter(Boolean), log);
  const attention = new Map(); // `${cid}|${draft year}` -> log10(1 + monthly views)
  const buzzPct = new Map(); // `${cid}|${draft year}` -> percentile within the class (for display)
  const rankAttention = (cids, Y, viewsOf) => {
    // model feature: log10(1 + monthly views), which keeps how much bigger the biggest names are (a percentile caps
    // everyone famous at ~99). No article = 0. An article whose views couldn't be fetched this time gets a
    // conservative value (the lower quartile of articles in the class) rather than inflating an unknown.
    const vals = cids.map(cid => { const w = wikiOf.get(cid); return w ? viewsOf(w.title) ?? null : 0; });
    const logs = vals.map(v => (v == null ? null : Math.log10(1 + v)));
    const art = cids.map((cid, i) => (wikiOf.has(cid) ? logs[i] : null)).filter(v => v != null).sort((a, b) => a - b);
    const fallback = art.length ? art[Math.floor(art.length / 4)] : 0;
    const full = logs.map(v => v ?? fallback);
    const f = midRankFn(full);
    cids.forEach((cid, i) => { attention.set(`${cid}|${Y}`, full[i]); buzzPct.set(`${cid}|${Y}`, Math.round(f(full[i]) ?? 0)); });
  };
  for (let Y = dataStart + 2; Y <= current; Y++) rankAttention(leavers.filter(l => l.Y === Y).map(l => l.cid), Y, t => avgViews(hist[t], `${Y - 1}09`, `${Y}01`));
  for (const [Y, cids] of Object.entries(pools)) rankAttention(cids, Number(Y), t => recent[t]);
  if (process.env.WRITE_WIKI_SEED) {
    // keep only each past player's pre-draft window (Sep–Jan): small enough to commit
    const seed = {};
    for (const l of leavers) {
      const t = wikiOf.get(l.cid)?.title, m = t && hist[t];
      if (!m) continue;
      seed[t] = Object.fromEntries(Object.entries(m).filter(([k]) => k >= `${l.Y - 1}09` && k <= `${l.Y}01`));
    }
    fs.writeFileSync(WIKI_SEED, JSON.stringify(seed));
    log(`  wrote ${Object.keys(seed).length} articles to ${path.basename(WIKI_SEED)}`);
  }
  const trainRows = [], emRows = [];
  for (const { cid, list, last, Y, el } of leavers) {
    const d = draftedByCid.get(cid) || draftedByName.get(`${nameKey(last.name)}|${last.pos}|${Y}`);
    const x = draftFeatures(list, careerInfo.get(cid), el.hs, Y, attention.get(`${cid}|${Y}`) ?? 0);
    trainRows.push({ pos: last.pos, year: Y, x, y: d ? draftCapital(d.pick) : 0 });
    const snap = ecrSnaps[Y];
    if (snap) {
      const rank = snap.ranks.get(`${nameKey(last.name)}|${last.pos}`);
      // unranked = past the end of the experts' list
      emRows.push({ pos: last.pos, year: Y, x, rank: rank ?? null, y: -Math.log(rank ?? snap.n + 25) });
    }
  }
  const dm = fitDraftModel(trainRows);
  log(`  draft-capital model: ${trainRows.length} players who left college (${trainRows.filter(r => r.y > 0).length} drafted), back-test ${Object.entries(dm.test).map(([p, t]) => `${p} ρ ${t.rho}, hit ${t.hit}`).join(' · ')}`);
  const em = expertModel(emRows);
  if (em) log(`  expert-style model: ${emRows.length} players, ${emRows.filter(r => r.rank).length} ranked by FantasyPros before ${Object.keys(ecrSnaps).join('/')} drafts; back-test rank correlation ${em.test.rho}, top-24 overlap ${em.test.top24}`);
  // where the k-th QB / RB / WR / TE taken has gone in the last 8 NFL drafts. The model ranks players within a
  // position; this curve turns that rank into a pick, so each class gets a realistic number of players per position.
  const byDraft = {};
  for (const r of picks) if (r.season > current - 8 && r.season <= current) ((byDraft[r.season] ||= {})[posOf(r.position)] ||= []).push(r.pick);
  const posSlots = {};
  for (const pos of SKILL) {
    const lists = Object.values(byDraft).map(d => (d[pos] || []).sort((a, b) => a - b));
    const lens = lists.map(a => a.length).sort((a, b) => a - b);
    const K = lens[Math.floor(lens.length / 2)] || 0; // typical number drafted at the position
    posSlots[pos] = Array.from({ length: K }, (_, k) => { const v = lists.filter(a => a[k] != null).map(a => a[k]); return v.reduce((s, x) => s + x, 0) / v.length; });
  }

  // college lookup by name (+ school) for combine invitees who aren't drafted yet
  const latest = new Map();
  for (const [cid, list] of career) { const s = list[list.length - 1]; const k = nameKey(s.name); if (!latest.has(k)) latest.set(k, []); latest.get(k).push(s); }
  const findCollege = (name, school, pos) => {
    let c = latest.get(nameKey(name)) || [];
    if (c.length > 1) c = c.filter(s => s.pos === pos);
    if (c.length > 1) { const k = schoolKey(school); const m = c.filter(s => schoolKey(s.team).includes(k) || k.includes(schoolKey(s.team))); if (m.length) c = m; }
    return c.length ? c[c.length - 1].cid : null;
  };

  // ---- assemble classes
  const upcoming = current + 1;
  // online mock-draft consensus for the next class (Pro Football Network's Mock Draft Index): anyone it lists is on
  // the board, and its order is one of the board's signals
  const mocks = await mockConsensus(upcoming, log);
  const mockKey = (name, pos) => `${nameKey(name)}|${posOf(pos)}`;
  const mockBy = new Map(mocks.filter(r => SKILL.has(posOf(r.pos))).map(r => [mockKey(r.name, r.pos), r]));
  const classes = {};
  const prospects = [];
  const add = (cls, p) => { (classes[cls] ||= { status: p.status, count: 0 }).count++; prospects.push({ ...p, draftClass: cls }); };
  for (const y of [current - 3, current - 2, current - 1, current, upcoming]) {
    const drafted = picks.filter(r => r.season === y);
    if (drafted.length) {
      for (const r of drafted) {
        const np = nflBy.get(r.gsis_id);
        const cid = np?.espn_id ? String(np.espn_id) : null;
        add(y, {
          status: 'drafted', cid, sid: gsis2sid.get(r.gsis_id) || null, name: r.pfr_player_name, pos: posOf(r.position), school: r.college,
          dob: np?.birth_date || null, age: r.age ?? null, draft: { r: r.round, p: r.pick, team: r.team },
          combine: combineCard(combineByPfr.get(r.pfr_player_id), posOf(r.position)),
        });
      }
    } else if (y === upcoming) {
      const inv = combine.filter(r => r.season === y);
      if (inv.length) {
        for (const r of inv) add(y, { status: 'combine', cid: findCollege(r.player_name, r.school, posOf(r.pos)), name: r.player_name, pos: posOf(r.pos), school: r.school, combine: combineCard(r, posOf(r.pos)) });
      } else {
        // before the combine: big board = every FBS player who's draft-eligible next spring (3+ years out of
        // high school, incl. redshirt sophomores and players who already passed on a draft) with real production
        const cur = bySeason[current] || bySeason[current - 1];
        for (const s of cur ? cur.players.values() : []) {
          const prev = bySeason[current - 1]?.players.get(s.cid);
          if (!(eligByCid.get(s.cid)?.year <= y) || s.div !== 'fbs' || !(s.q || prev?.q || mockBy.has(mockKey(s.name, s.pos)))) continue;
          add(y, { status: 'watch', cid: s.cid, name: s.name, pos: s.pos, school: s.team });
        }
      }
    }
  }
  // devy boards: the two classes after that — current college players first eligible in those drafts, with real
  // production or a 4–5★ recruiting profile
  for (const y of [upcoming + 1, upcoming + 2]) {
    for (const cid of pools[y] || []) {
      const s = bySeason[current].players.get(cid);
      add(y, { status: 'devy', cid, name: s.name, pos: s.pos, school: s.team });
    }
  }

  // ---- features + Prospect Score
  for (const p of prospects) {
    const list = (p.cid && career.get(p.cid)) || [];
    p.seasons = list.map(s => s.season);
    const last = list[list.length - 1];
    p.hs = last?.hs || null;
    p.school ||= last?.team || null;
    p.cls = last?.cls || null;
    p.ht = p.combine?.ht ?? last?.ht ?? null; p.wt = p.combine?.wt ?? last?.wt ?? null;
    const info = p.cid ? careerInfo.get(p.cid) : null;
    p.recruit = info?.rc ?? (list.length ? findRecruit(p.name, p.pos, list[0].season) : null);
    const best = list.length ? bestSeason(p.pos, list) : null;
    p.best = best ? Object.fromEntries(['season', 'cls', 'team', 'tier', 'g', 'tgt', 'rec', 'reyd', 'retd', 'car', 'ruyd', 'rutd', 'pa', 'pyd', 'ptd', 'int', ...PROD[p.pos].map(x => x[0])].map(k => [k, best[k]])) : null;
    p.brk = info?.bk ?? breakout(p.pos, list, p.dob);
    if (!p.dob && p.cid && dobByCid.has(p.cid)) p.dob = dobByCid.get(p.cid); // e.g. from Pahowdy's database (local builds)
    if (p.dob) p.age = rd((new Date(`${p.draftClass}-04-25`) - new Date(p.dob)) / (365.25 * 864e5), 1);
    const el = p.cid ? eligByCid.get(p.cid) : null;
    if (el) { p.elig = el.year; p.hs = el.hs; }
    if (!p.draft && el) {
      p.yr = current - el.hs + 1; // college season number this fall (3 = third year out of high school)
      if (p.age == null) { p.age = rd(draftAgeFromHs(p.draftClass, el.hs), 1); p.ageEst = true; }
      if (list.length) {
        p.buzz = buzzPct.get(`${p.cid}|${p.draftClass}`) ?? null; // Wikipedia attention percentile in the class (display)
        const x = draftFeatures(list, info, el.hs, p.draftClass, attention.get(`${p.cid}|${p.draftClass}`) ?? 0);
        if (dm.predict[p.pos]) p.ev = Math.max(0, dm.predict[p.pos](x));
        if (em?.predict[p.pos]) p.xes = em.predict[p.pos](x);
      }
    }
  }
  // the next class: which players the online mocks list, and where
  let mockMatched = 0;
  for (const p of prospects) {
    if (p.draftClass !== upcoming || p.draft) continue;
    const r = mockBy.get(mockKey(p.name, p.pos));
    if (r) { p.mock = { rank: r.rank }; mockMatched++; }
  }
  if (mocks.length) log(`  online mock consensus: ${mockMatched} of ${mockBy.size} listed QB/RB/WR/TE matched to the ${upcoming} board`);
  // projected NFL draft slot "if he declares": the k-th best QB/RB/WR/TE by the model takes the k-th slot at the position
  // (each class separately: the 2027 board, then the 2028 and 2029 devy boards)
  // The top few at each position keep their scarcity slot; deeper players blend that slot with the pick their own
  // expected draft value implies, so there's no cliff from "QB11 = pick 207" to "QB12 = undrafted" when the model
  // still expects real draft capital (not every eligible underclassman declares, so the k-th eligible QB isn't
  // the k-th QB taken).
  const LAST_PICK = 257, UNDRAFTED = 262;
  const evPick = ev => (ev > 0 ? Math.min(UNDRAFTED, 1 - 45 * Math.log(ev / 100)) : UNDRAFTED);
  const preDraft = prospects.filter(p => !p.draft && p.ev != null);
  for (const cls of new Set(preDraft.map(p => p.draftClass))) {
    const inClass = preDraft.filter(p => p.draftClass === cls);
    for (const pos of SKILL) {
      const slots = posSlots[pos] || [];
      inClass.filter(p => p.pos === pos).sort((a, b) => b.ev - a.ev).forEach((p, k) => {
        const slot = k < slots.length ? slots[k] : UNDRAFTED;
        const w = Math.max(0, Math.min(1, (k - 2) / 8)) * 0.5; // 0 for the top 3 at the position, up to 50/50 from the 11th
        const est = Math.round(Math.exp((1 - w) * Math.log(slot) + w * Math.log(evPick(p.ev))));
        const pick = est <= LAST_PICK ? est : null;
        p.proj = { pick, round: pick ? Math.min(7, Math.ceil(pick / 32)) : null, posRank: k + 1, ev: rd(p.ev, 1) };
      });
    }
    // "Real NFL draft position": where the online mocks put him. A player they list is projected two-thirds from his
    // mock rank and one-third from the model; one they leave out of their top 40 is pushed past it (the model's
    // pick 20 becomes 50, its pick 60 becomes 70; from pick 80 on, unchanged).
    if (cls === upcoming && mocks.length) {
      const N = mocks.length;
      for (const p of inClass) {
        const model = p.proj.pick;
        const est = p.mock ? Math.round(Math.exp((2 * Math.log(p.mock.rank) + Math.log(model ?? UNDRAFTED)) / 3))
          : model != null ? Math.round(Math.max(model, N + model / 2)) : null;
        const pick = est != null && est <= LAST_PICK ? est : null;
        p.proj = { ...p.proj, pick, round: pick ? Math.min(7, Math.ceil(pick / 32)) : null, model };
      }
      for (const pos of SKILL) {
        inClass.filter(p => p.pos === pos).sort((a, b) => (a.proj.pick ?? 999) - (b.proj.pick ?? 999) || b.ev - a.ev).forEach((p, k) => { p.proj.posRank = k + 1; });
      }
    }
    inClass.sort((a, b) => (a.proj.pick ?? 999) - (b.proj.pick ?? 999) || b.ev - a.ev).forEach((p, i) => { p.proj.rank = i + 1; });
  }
  // expert-style rank: where FantasyPros experts would likely put him, by how they ranked similar past prospects (1QB)
  const withXes = prospects.filter(p => !p.draft && p.xes != null);
  for (const cls of new Set(withXes.map(p => p.draftClass))) {
    withXes.filter(p => p.draftClass === cls).sort((a, b) => b.xes - a.xes).forEach((p, i) => { p.xecr = i + 1; });
  }
  for (const p of withXes) delete p.xes;
  for (const pos of Object.keys(PROD)) {
    const group = prospects.filter(p => p.pos === pos);
    const feat = {};
    for (const [m] of PROD[pos]) feat[m] = midRankFn(group.map(p => p.best?.[m]));
    const ageRank = midRankFn(group.map(p => p.age));
    for (const p of group) {
      let num2 = 0, den = 0;
      for (const [m, w] of PROD[pos]) { const v = feat[m](p.best?.[m]); if (v != null) { num2 += v * w; den += w; } }
      const prod = den >= 0.4 ? (num2 / den) * (TIER_FACTOR[p.best?.tier] ?? 0.85) : null;
      const comps = {
        prod: prod != null ? Math.round(prod) : null,
        brk: breakoutScore(p.brk),
        ath: p.combine?.ath ?? null,
        age: p.age != null ? Math.round(100 - ageRank(p.age)) : !p.draft ? CLASS_AGE[p.cls] ?? null : null,
        rec: p.recruit?.stars ? Math.round(Math.max(0, Math.min(5, p.recruit.stars) - 2) / 3 * 100) : null,
        dc: p.draft ? draftCapital(p.draft.p) : null,
        // projected draft capital, scored like real draft capital from the projected pick (0 = projected undrafted)
        pdc: !p.draft && p.proj ? draftCapital(p.proj.pick) ?? 0 : null,
      };
      const W = p.draft ? PROSPECT_WEIGHTS.drafted : p.pos === 'QB' ? PROSPECT_WEIGHTS.preQB : PROSPECT_WEIGHTS.pre;
      let s = 0, d = 0;
      for (const [k, w] of Object.entries(W)) if (comps[k] != null) { s += comps[k] * w; d += w; }
      p.comps = comps;
      p.score = d >= 0.3 ? Math.round(s / d) : null;
    }
  }

  for (const p of prospects) delete p.ev; // kept as p.proj.ev
  await attachMarket(prospects, { current, log });

  // the pre-combine board can be long: keep the strongest 300, plus everyone the model projects to be drafted and
  // every 4–5 star recruit, so well-known names never disappear from the board
  const dropped = new Set();
  for (const [cls, c] of Object.entries(classes)) {
    if (c.status !== 'watch' && c.status !== 'devy') continue;
    const list = prospects.filter(p => p.draftClass === Number(cls)).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    for (const p of list.slice(c.status === 'watch' ? 300 : 250)) if (!(p.proj?.pick <= 128) && !(p.recruit?.stars >= 4) && !(p.xecr <= 100) && !p.mock) dropped.add(p);
  }
  for (let i = prospects.length - 1; i >= 0; i--) if (dropped.has(prospects[i])) prospects.splice(i, 1);
  for (const [cls, c] of Object.entries(classes)) if (c.status === 'watch' || c.status === 'devy') c.count = prospects.filter(p => p.draftClass === Number(cls)).length;

  // ---- write files
  const slim = s => Object.fromEntries(Object.entries(s).filter(([k, v]) => v != null && !['hs', 'dob', 'recruitId', 'tid'].includes(k)));
  // Full college careers for every skill player (every season with any offensive snap of production),
  // split into 100 small files by the last two digits of the ESPN id so a page loads only what it needs.
  const careerDir = path.join(out, 'college');
  fs.rmSync(careerDir, { recursive: true, force: true });
  fs.mkdirSync(careerDir, { recursive: true });
  const buckets = {};
  for (const [cid, list] of career) {
    const rows = list.filter(s => (s.pa || 0) + (s.car || 0) + (s.tgt || 0) + (s.rec || 0) > 0).map(slim);
    const info = careerInfo.get(cid) || {};
    if (rows.length) (buckets[cid.slice(-2).padStart(2, '0')] ||= {})[cid] = { s: rows, bk: info.bk || null, rc: info.rc || null, best: info.best ?? null, el: info.el || null };
  }
  for (const [b, obj] of Object.entries(buckets)) fs.writeFileSync(path.join(careerDir, `c_${b}.json`), JSON.stringify(obj));
  log(`  college careers: ${career.size} players in ${Object.keys(buckets).length} files`);

  const latestSeasons = Object.keys(bySeason).map(Number).sort((a, b) => b - a);
  for (const y of latestSeasons) {
    const { players, teamGames } = bySeason[y];
    const rows = [...players.values()].filter(s => VOL[s.pos](s) >= SHOW[s.pos] * teamGames).map(s => Object.fromEntries(Object.entries(s).filter(([k, v]) => v != null && !['dob', 'recruitId', 'tid'].includes(k))));
    fs.writeFileSync(path.join(out, `college_${y}.json`), JSON.stringify({ season: y, teamGames, players: rows }));
  }
  const meta = {
    current, upcoming, collegeSeasons: Object.keys(bySeason).map(Number), leaderboardSeasons: latestSeasons,
    classes: Object.fromEntries(Object.entries(classes).sort((a, b) => b[0] - a[0])), weights: PROSPECT_WEIGHTS, production: PROD, breakout: BREAKOUT,
    eligibility: { yearsOutOfHighSchool: YEARS_OUT_OF_HS },
    mockConsensus: mocks.length ? { source: 'Pro Football Network Mock Draft Index', url: MOCK_INDEX_URL(upcoming), size: mocks.length, matched: mockMatched, year: upcoming } : null,
    expertModel: em ? { ...em.test, snapshots: Object.fromEntries(Object.entries(ecrSnaps).map(([y, s]) => [y, s.date])) } : null,
    draftModel: {
      features: DRAFT_FEATURES, test: dm.test, players: trainRows.length, drafted: trainRows.filter(r => r.y > 0).length,
      slots: Object.fromEntries(Object.entries(posSlots).map(([pos, a]) => [pos, a.map(x => Math.round(x))])),
      drafts: [...new Set(trainRows.map(r => r.year))].sort((a, b) => a - b),
    },
    generated: new Date().toISOString(),
  };
  // careers live in the split college/c_XX.json files (loaded per player), which keeps this file small for phones
  fs.writeFileSync(path.join(out, 'prospects.json'), JSON.stringify({ meta, prospects }));
  // Pahowdy's database: a separate file, written only for the copy on your computer and removed in public builds
  const phFile = path.join(out, 'pahowdy.json');
  if (privateSources && pahowdy.length) {
    const players = pahowdy.filter(r => r.cid || r.sid).map(slimPahowdy);
    fs.writeFileSync(phFile, JSON.stringify({ meta: { source: 'Pahowdy’s Prospect Database', by: '@pahowdy', url: PAHOWDY.url, rows: pahowdy.length, fetched: new Date().toISOString() }, players }));
  } else fs.rmSync(phFile, { force: true });
  log(`  prospects: ${Object.entries(classes).map(([y, c]) => `${y} ${c.status} (${c.count})`).join(', ')}`);
  return meta;
}

// ---------------------------------------------------------------- expert-style projection
/**
 * Pre-draft FantasyPros rookie rankings for each past class, from DynastyProcess's archive of every ECR scrape:
 * the first snapshot from February on (after the college season) where most players have no NFL team yet.
 */
async function preDraftRookieEcr(fromYear, toYear, log) {
  const out = {};
  try {
    const f = await cached('https://github.com/dynastyprocess/data/raw/master/files/db_fpecr.parquet', 'db_fpecr.parquet', 24 * 7);
    if (!f) return out;
    const rows = await readParquet(f, ['page_type', 'scrape_date', 'player', 'pos', 'team', 'ecr']);
    const byDate = new Map();
    for (const r of rows) {
      if (r.page_type !== 'dynasty-rk') continue;
      const d = String(r.scrape_date).slice(0, 10);
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(r);
    }
    const dates = [...byDate.keys()].sort();
    for (let Y = fromYear; Y <= toYear; Y++) {
      const d = dates.find(x => x >= `${Y}-02-01` && x <= `${Y}-04-20`
        && byDate.get(x).filter(r => !r.team || r.team === 'FA').length >= byDate.get(x).length * 0.7);
      if (!d) continue;
      const list = byDate.get(d).filter(r => r.ecr != null).sort((a, b) => a.ecr - b.ecr);
      const ranks = new Map();
      list.forEach((r, i) => { const k = `${nameKey(r.player)}|${posOf(r.pos)}`; if (!ranks.has(k)) ranks.set(k, i + 1); });
      out[Y] = { date: d, n: list.length, ranks };
    }
  } catch (e) { log('  FantasyPros ranking history unavailable:', e.message); }
  return out;
}

/** Per-position ridge on −ln(pre-draft expert rank), back-tested one class at a time. */
function expertModel(rows) {
  if (rows.filter(r => r.rank).length < 100) return null;
  const fit = R => {
    const f = {};
    for (const pos of SKILL) { const P = R.filter(r => r.pos === pos); if (P.length >= 40) f[pos] = ridge(P.map(r => r.x), P.map(r => r.y), 2); }
    return f;
  };
  const predict = fit(rows);
  const years = [...new Set(rows.map(r => r.year))].sort((a, b) => a - b);
  const rho = [], top = [];
  for (const yr of years) {
    const f = fit(rows.filter(r => r.year !== yr));
    const te = rows.filter(r => r.year === yr && f[r.pos]).map(r => ({ ...r, s: f[r.pos](r.x) }));
    const ranked = te.filter(r => r.rank);
    if (ranked.length < 20) continue;
    rho.push(spearman(ranked.map(r => r.s), ranked.map(r => -r.rank)));
    const predTop = new Set([...te].sort((a, b) => b.s - a.s).slice(0, 24));
    const actualTop = ranked.filter(r => r.rank <= 24);
    top.push(actualTop.filter(r => predTop.has(r)).length / Math.max(1, actualTop.length));
  }
  const avg = a => (a.length ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 100) / 100 : null);
  return { predict, test: { rho: avg(rho), top24: avg(top), classes: years, players: rows.length, ranked: rows.filter(r => r.rank).length } };
}

// ---------------------------------------------------------------- consensus rookie rankings + ADP
async function attachMarket(prospects, { current, log }) {
  const byName = new Map();
  for (const p of prospects) {
    const k = `${nameKey(p.name)}|${p.pos}`;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(p);
  }
  const match = (name, pos) => (byName.get(`${nameKey(name)}|${posOf(pos)}`) || []).sort((a, b) => b.draftClass - a.draftClass)[0] || null;
  // FantasyPros dynasty rookie rankings (expert consensus), published weekly by DynastyProcess
  try {
    const f = await cached('https://github.com/dynastyprocess/data/raw/master/files/db_fpecr_latest.csv', 'db_fpecr_latest.csv', 24);
    const rows = readCSV(f).filter(r => r.fp_page === '/nfl/rankings/rookies.php');
    // FantasyPros ranks one class at a time; attach only to the class most of its players belong to
    const cands = rows.map(r => ({ r, list: byName.get(`${nameKey(r.player)}|${posOf(r.pos)}`) || [] }));
    const votes = {};
    for (const { list } of cands) for (const p of list) votes[p.draftClass] = (votes[p.draftClass] || 0) + 1;
    const fpClass = Number(Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0]);
    let n = 0;
    for (const { r, list } of cands) {
      const p = list.find(x => x.draftClass === fpClass);
      if (!p) continue;
      p.ecr = { rank: r.ecr, sd: r.sd, best: r.best, worst: r.worst, date: r.scrape_date };
      n++;
    }
    log(`  FantasyPros rookie rankings (${fpClass} class): ${n} of ${rows.length} matched`);
  } catch (e) { log('  FantasyPros rookie rankings unavailable:', e.message); }
  // Sleeper ADP from real drafts (rookie drafts + dynasty startups); empty until drafts happen
  try {
    const bySid = new Map(prospects.filter(p => p.sid).map(p => [String(p.sid), p]));
    let n = 0;
    for (const yr of [current, current + 1]) {
      const rows = await cachedJSON(`https://api.sleeper.com/projections/nfl/${yr}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE`, `sleeper_proj_${yr}.json`, 24);
      for (const x of Array.isArray(rows) ? rows : []) {
        const st = x.stats || {}, a = v => (v != null && v < 999 ? v : null);
        const adp = { rookie: a(st.adp_rookie), d1qb: a(st.adp_dynasty_ppr), dsf: a(st.adp_dynasty_2qb) };
        if (adp.rookie == null && adp.d1qb == null && adp.dsf == null) continue;
        // name fallback only for rookie-level players, so a veteran never lends ADP to a same-named prospect
        const rookieLike = x.player?.years_exp == null || x.player.years_exp <= 0;
        const p = bySid.get(String(x.player_id)) || (rookieLike ? match(`${x.player?.first_name} ${x.player?.last_name}`, x.player?.position) : null);
        if (!p) continue;
        p.adp = { ...(p.adp || {}), ...Object.fromEntries(Object.entries(adp).filter(([, v]) => v != null)) };
        if (!p.sid && x.player_id) p.sid = String(x.player_id);
        n++;
      }
    }
    log(`  Sleeper ADP: ${n} prospects with ADP`);
  } catch (e) { log('  Sleeper ADP unavailable:', e.message); }
}
