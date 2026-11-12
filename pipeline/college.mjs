// College football: per-player college seasons (box score + advanced/EPA), combine athleticism, draft capital,
// and a Prospect Score for the incoming class and recent rookie classes.
// Free, keyless sources: sportsdataverse (ESPN college data incl. EPA) + nflverse (combine, draft picks, players).
import fs from 'node:fs';
import path from 'node:path';
import { cached, cachedJSON, nflverse, readCSV } from './fetch.mjs';
import { readParquet } from './load.mjs';
import { nameKey } from './imports.mjs';

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
  return { players: out, teamGames };
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
// Before the draft there's no draft capital, so lean on what predicts it: production vs. competition, pedigree, age.
const CLASS_AGE = { FR: 95, SO: 90, JR: 75, SR: 40 };
export const PROSPECT_WEIGHTS = {
  pre: { prod: 0.4, rec: 0.25, brk: 0.15, ath: 0.1, age: 0.1 },
  preQB: { prod: 0.35, rec: 0.35, ath: 0.15, age: 0.15 },
  drafted: { dc: 0.4, prod: 0.35, brk: 0.1, ath: 0.1, age: 0.05 },
};

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
export async function buildCollege({ current, nflBy, gsis2sid, out, log }) {
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
        // before the combine: draft-eligible watch list = juniors/seniors with real production this season
        const cur = bySeason[current] || bySeason[current - 1];
        for (const s of cur ? cur.players.values() : []) {
          const prev = bySeason[current - 1]?.players.get(s.cid);
          if (!['JR', 'SR'].includes(s.cls) || s.div !== 'fbs' || !(s.q || prev?.q)) continue;
          add(y, { status: 'watch', cid: s.cid, name: s.name, pos: s.pos, school: s.team });
        }
      }
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
    if (p.dob) p.age = rd((new Date(`${p.draftClass}-04-25`) - new Date(p.dob)) / (365.25 * 864e5), 1);
  }
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
      };
      const W = p.draft ? PROSPECT_WEIGHTS.drafted : p.pos === 'QB' ? PROSPECT_WEIGHTS.preQB : PROSPECT_WEIGHTS.pre;
      let s = 0, d = 0;
      for (const [k, w] of Object.entries(W)) if (comps[k] != null) { s += comps[k] * w; d += w; }
      p.comps = comps;
      p.score = d >= 0.3 ? Math.round(s / d) : null;
    }
  }

  await attachMarket(prospects, { current, log });

  // the pre-combine watch list can be long; keep the strongest 300
  const watch = prospects.filter(p => p.status === 'watch').sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const dropped = new Set(watch.slice(300));
  for (let i = prospects.length - 1; i >= 0; i--) if (dropped.has(prospects[i])) prospects.splice(i, 1);
  if (classes[upcoming]?.status === 'watch') classes[upcoming].count = Math.min(classes[upcoming].count, 300);

  // ---- write files
  const keep = new Set(prospects.map(p => p.cid).filter(Boolean));
  const careers = {};
  const slim = s => Object.fromEntries(Object.entries(s).filter(([k, v]) => v != null && !['hs', 'dob', 'recruitId', 'tid'].includes(k)));
  for (const cid of keep) careers[cid] = (career.get(cid) || []).map(slim);
  // Full college careers for every skill player (every season with any offensive snap of production),
  // split into 100 small files by the last two digits of the ESPN id so a page loads only what it needs.
  const careerDir = path.join(out, 'college');
  fs.rmSync(careerDir, { recursive: true, force: true });
  fs.mkdirSync(careerDir, { recursive: true });
  const buckets = {};
  for (const [cid, list] of career) {
    const rows = list.filter(s => (s.pa || 0) + (s.car || 0) + (s.tgt || 0) + (s.rec || 0) > 0).map(slim);
    const info = careerInfo.get(cid) || {};
    if (rows.length) (buckets[cid.slice(-2).padStart(2, '0')] ||= {})[cid] = { s: rows, bk: info.bk || null, rc: info.rc || null, best: info.best ?? null };
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
    generated: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(out, 'prospects.json'), JSON.stringify({ meta, prospects, careers }));
  log(`  prospects: ${Object.entries(classes).map(([y, c]) => `${y} ${c.status} (${c.count})`).join(', ')}`);
  return meta;
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
