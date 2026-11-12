// Per-season aggregation: real stats, fantasy points, usage, and advanced efficiency metrics.

// Share of a player's on-field dropbacks where they actually run a route (pass-pro snaps excluded).
// Applied to on-field dropback counts from participation data (or the snap-based estimate).
// Calibrated so fantasy-relevant players land near publicly reported route totals.
export const ROUTE_RATE = { WR: 0.96, TE: 0.90, RB: 0.80, QB: 0 };

const div = (a, b) => (b > 0 ? a / b : null);
const r = (x, d = 3) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

function blank() {
  return {
    games: new Set(), teams: {}, gt: {},
    // receiving
    tgt: 0, rec: 0, recYds: 0, recTd: 0, ay: 0, yac: 0, recFd: 0, recEpa: 0, recSucc: 0, rec20: 0, deepTgt: 0, rzTgt: 0, ezTgt: 0,
    catchable: 0, contested: 0, contestedRec: 0, drops: 0, screens: 0, created: 0, ftnTgt: 0,
    // rushing
    car: 0, rushYds: 0, rushTd: 0, rushFd: 0, rushEpa: 0, rushSucc: 0, run10: 0, run15: 0, run20: 0, stuff: 0, rzCar: 0, i10Car: 0, i5Car: 0,
    designed: 0, scrambles: 0,
    // passing
    db: 0, att: 0, cmp: 0, passYds: 0, passTd: 0, int: 0, sacks: 0, qbEpa: 0, cpoeSum: 0, cpoeN: 0, passAy: 0, deepAtt: 0,
    pressured: 0, pressN: 0, intWorthy: 0, pa: 0, oop: 0, ftnDb: 0,
    // usage
    passSnaps: 0, passSnapsEst: false, snapPctSum: 0, snapGames: 0, offSnaps: 0,
    teamDb: 0, teamTgt: 0, teamAy: 0, teamCar: 0, teamDbSnapW: 0,
  };
}

/**
 * @returns {{ players: Map<string, object>, skew: Map<string, number>, posSkew: object, diag: object }}
 */
export function buildSeason({ season, plays, part, ftn, snaps, weekly, pfr2gsis, posOf, priorSkew, priorPosSkew, ngsRec, ngsRush, ngsPass }) {
  const P = new Map();
  const get = id => { let o = P.get(id); if (!o) { o = blank(); P.set(id, o); } return o; };

  // ---------- team-game totals ----------
  const TG = new Map(); // `${game}|${team}` -> totals
  const tg = (g, t) => { const k = `${g}|${t}`; let o = TG.get(k); if (!o) { o = { db: 0, tgt: 0, ay: 0, car: 0, plays: 0 }; TG.set(k, o); } return o; };

  for (const p of plays) {
    if (!p.posteam) continue;
    const T = tg(p.game_id, p.posteam);
    const key = `${p.game_id}|${p.play_id}`;
    const isDb = p.qb_dropback === 1 && !p.qb_spike;
    const isTarget = p.pass_attempt === 1 && !p.sack && p.receiver_player_id;
    const isRush = p.rush_attempt === 1 && !p.qb_kneel && p.rusher_player_id;
    if (isDb || isRush) T.plays++;
    const ch = ftn ? ftn.get(key) : null;
    const pr = part ? part.get(key) : null;

    if (isDb) {
      T.db++;
      if (pr) for (const id of pr.off) { const o = get(id); o.passSnaps++; o.games.add(p.game_id); o.gt[p.game_id] = p.posteam; }
      if (p.passer_player_id) {
        const q = get(p.passer_player_id);
        q.db++; q.games.add(p.game_id); q.gt[p.game_id] = p.posteam;
        q.qbEpa += p.qb_epa ?? 0;
        if (p.sack) q.sacks++;
        if (pr && pr.pressure != null) { q.pressN++; if (pr.pressure) q.pressured++; }
        if (ch) { q.ftnDb++; if (ch.is_interception_worthy) q.intWorthy++; if (ch.is_play_action) q.pa++; if (ch.is_qb_out_of_pocket) q.oop++; }
        if (p.pass_attempt === 1 && !p.sack) {
          q.att++;
          if (p.complete_pass) q.cmp++;
          if (p.interception) q.int++;
          if (p.air_yards != null) { q.passAy += p.air_yards; if (p.air_yards >= 20) q.deepAtt++; }
          if (p.cpoe != null) { q.cpoeSum += p.cpoe; q.cpoeN++; }
        }
      }
    }

    if (isTarget) {
      T.tgt++; T.ay += p.air_yards ?? 0;
      const o = get(p.receiver_player_id);
      o.games.add(p.game_id); o.gt[p.game_id] = p.posteam;
      o.tgt++;
      o.ay += p.air_yards ?? 0;
      o.recEpa += p.epa ?? 0;
      if (p.success) o.recSucc++;
      if ((p.air_yards ?? 0) >= 20) o.deepTgt++;
      if (p.yardline_100 != null && p.yardline_100 <= 20) o.rzTgt++;
      if (p.air_yards != null && p.yardline_100 != null && p.air_yards >= p.yardline_100) o.ezTgt++;
      if (p.complete_pass) {
        o.rec++;
        o.recYds += p.receiving_yards ?? 0;
        o.yac += p.yards_after_catch ?? 0;
        if (p.first_down) o.recFd++;
        if ((p.receiving_yards ?? 0) >= 20) o.rec20++;
      }
      if (p.touchdown && p.td_player_id === p.receiver_player_id) o.recTd++;
      if (ch) {
        o.ftnTgt++;
        if (ch.is_catchable_ball) o.catchable++;
        if (ch.is_contested_ball) { o.contested++; if (p.complete_pass) o.contestedRec++; }
        if (ch.is_drop) o.drops++;
        if (ch.is_screen_pass) o.screens++;
        if (ch.is_created_reception) o.created++;
      }
    }

    if (isRush) {
      T.car++;
      const o = get(p.rusher_player_id);
      o.games.add(p.game_id); o.gt[p.game_id] = p.posteam;
      o.car++;
      const y = p.rushing_yards ?? p.yards_gained ?? 0;
      o.rushYds += y;
      o.rushEpa += p.epa ?? 0;
      if (p.success) o.rushSucc++;
      if (p.first_down) o.rushFd++;
      if (p.touchdown && p.td_player_id === p.rusher_player_id) o.rushTd++;
      if (p.qb_scramble) o.scrambles++;
      else {
        o.designed++;
        if (y >= 10) o.run10++;
        if (y >= 15) o.run15++;
        if (y >= 20) o.run20++;
        if (y <= 0) o.stuff++;
      }
      if (p.yardline_100 != null) {
        if (p.yardline_100 <= 20) o.rzCar++;
        if (p.yardline_100 <= 10) o.i10Car++;
        if (p.yardline_100 <= 5) o.i5Car++;
      }
    }
  }

  // ---------- snap counts (PFR) ----------
  const snapByPG = new Map(); // `${gsis}|${game}` -> {pct, snaps, team}
  if (snaps) {
    for (const s of snaps) {
      const id = pfr2gsis.get(s.pfr_player_id);
      if (!id) continue;
      snapByPG.set(`${id}|${s.game_id}`, { pct: s.offense_pct, snaps: s.offense_snaps, team: s.team });
      const o = get(id);
      o.games.add(s.game_id); o.gt[s.game_id] ||= s.team;
      o.teams[s.team] = (o.teams[s.team] || 0) + 1;
      o.snapPctSum += s.offense_pct; o.snapGames++; o.offSnaps += s.offense_snaps;
    }
  }

  // ---------- weekly box scores & fantasy ----------
  const W = new Map(); // gsis -> array of week rows
  for (const w of weekly) {
    const o = get(w.player_id);
    o.games.add(w.game_id); o.gt[w.game_id] ||= w.team;
    o.teams[w.team] = (o.teams[w.team] || 0) + 1;
    if (!W.has(w.player_id)) W.set(w.player_id, []);
    W.get(w.player_id).push(w);
  }
  // weekly positional ranks per format
  const byWeekPos = new Map();
  for (const w of weekly) {
    const pos = posOf(w.player_id) || (w.position === 'FB' ? 'RB' : w.position);
    const k = `${w.week}|${pos}`;
    if (!byWeekPos.has(k)) byWeekPos.set(k, []);
    w._half = (w.fantasy_points ?? 0) + 0.5 * (w.receptions ?? 0);
    byWeekPos.get(k).push(w);
  }
  for (const list of byWeekPos.values()) {
    for (const [fmt, f] of [['ppr', w => w.fantasy_points_ppr ?? 0], ['half', w => w._half], ['std', w => w.fantasy_points ?? 0]]) {
      list.sort((a, b) => f(b) - f(a)).forEach((w, i) => { w[`_rk_${fmt}`] = i + 1; });
    }
  }

  // ---------- per-player team totals in the games they played ----------
  const teamOfGame = (id, game) => P.get(id)?.gt[game] ?? null;

  const posSkewAcc = {};
  const skew = new Map();
  let diagN = 0, diagAbs = 0, diagActual = 0;

  for (const [id, o] of P) {
    const pos = posOf(id);
    if (!pos) continue;
    let estPassSnaps = 0, dbSnapW = 0;
    for (const g of o.games) {
      const team = teamOfGame(id, g);
      if (!team) continue;
      const T = TG.get(`${g}|${team}`);
      if (!T) continue;
      o.teamDb += T.db; o.teamTgt += T.tgt; o.teamAy += T.ay; o.teamCar += T.car;
      const sn = snapByPG.get(`${id}|${g}`);
      if (sn) { dbSnapW += sn.pct * T.db; }
    }
    o.teamDbSnapW = dbSnapW;
    // Pass-snap skew: how much more (or less) a player is on the field for dropbacks than for all plays.
    if (part && dbSnapW > 30 && o.passSnaps > 0) {
      const s = o.passSnaps / dbSnapW;
      skew.set(id, { s, n: o.passSnaps });
      (posSkewAcc[pos] ||= { a: 0, b: 0 }); posSkewAcc[pos].a += o.passSnaps; posSkewAcc[pos].b += dbSnapW;
    }
    // Snap-based estimate (used when participation data isn't published yet).
    const prior = priorSkew?.get(id);
    const posMean = priorPosSkew?.[pos] ?? 1;
    const k = 150;
    const sk = prior ? (prior.n * prior.s + k * posMean) / (prior.n + k) : posMean;
    estPassSnaps = Math.min(dbSnapW * sk, o.teamDb);
    if (!part) { o.passSnaps = estPassSnaps; o.passSnapsEst = true; }
    else if (priorSkew && dbSnapW > 100 && ['WR', 'TE', 'RB'].includes(pos)) {
      diagN++; diagAbs += Math.abs(estPassSnaps - o.passSnaps); diagActual += o.passSnaps;
    }
  }
  const posSkew = {};
  for (const [pos, v] of Object.entries(posSkewAcc)) posSkew[pos] = v.b > 0 ? v.a / v.b : 1;

  // ---------- assemble outputs ----------
  const out = new Map();
  const logs = new Map();
  for (const [id, o] of P) {
    const pos = posOf(id);
    if (!pos) continue;
    const wk = (W.get(id) || []).sort((a, b) => a.week - b.week);
    const g = Math.max(wk.length, o.snapGames, 0);
    if (g === 0 && o.tgt + o.car + o.db === 0) continue;
    const sum = f => wk.reduce((s, w) => s + (f(w) ?? 0), 0);
    const std = sum(w => w.fantasy_points), ppr = sum(w => w.fantasy_points_ppr), recs = sum(w => w.receptions);
    const half = std + 0.5 * recs;
    const gp = Math.max(wk.length, o.snapGames, 1);
    const pprWeeks = wk.map(w => w.fantasy_points_ppr ?? 0);
    const mean = pprWeeks.reduce((a, b) => a + b, 0) / gp;
    const sd = Math.sqrt(pprWeeks.reduce((a, b) => a + (b - mean) ** 2, 0) / gp);
    const boomT = pos === 'QB' ? 24 : 20, bustT = pos === 'QB' ? 12 : pos === 'TE' ? 5 : 7;
    const rate = (fmt, n) => (wk.length ? wk.filter(w => w[`_rk_${fmt}`] <= n).length / gp : null);
    const team = Object.entries(o.teams).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const routes = o.passSnaps * (ROUTE_RATE[pos] ?? 0);
    const tsh = div(o.tgt, o.teamTgt), aysh = div(o.ay, o.teamAy);

    const s = {
      team, g: gp,
      // ---- fantasy ----
      fp: { std: r(std, 1), half: r(half, 1), ppr: r(ppr, 1) },
      ppg: { std: r(std / gp, 2), half: r(half / gp, 2), ppr: r(ppr / gp, 2) },
      top12: { std: r(rate('std', 12)), half: r(rate('half', 12)), ppr: r(rate('ppr', 12)) },
      top24: { std: r(rate('std', 24)), half: r(rate('half', 24)), ppr: r(rate('ppr', 24)) },
      boom: r(wk.length ? pprWeeks.filter(x => x >= boomT).length / gp : null),
      bust: r(wk.length ? (pprWeeks.filter(x => x < bustT).length + gp - wk.length) / gp : null),
      sd: r(sd, 2),
      // ---- box score (for custom league scoring) ----
      box: {
        cmp: sum(w => w.completions), att: sum(w => w.attempts), pyd: sum(w => w.passing_yards), ptd: sum(w => w.passing_tds),
        int: sum(w => w.passing_interceptions), sk: sum(w => w.sacks_suffered), pfd: sum(w => w.passing_first_downs),
        car: sum(w => w.carries), ruyd: sum(w => w.rushing_yards), rutd: sum(w => w.rushing_tds), rufd: sum(w => w.rushing_first_downs),
        rec: recs, tgt: sum(w => w.targets), reyd: sum(w => w.receiving_yards), retd: sum(w => w.receiving_tds), refd: sum(w => w.receiving_first_downs),
        fl: sum(w => (w.rushing_fumbles_lost ?? 0) + (w.receiving_fumbles_lost ?? 0) + (w.sack_fumbles_lost ?? 0)),
        tp: sum(w => (w.rushing_2pt_conversions ?? 0) + (w.receiving_2pt_conversions ?? 0)),
        ptp: sum(w => w.passing_2pt_conversions), sttd: sum(w => w.special_teams_tds),
      },
      // ---- usage ----
      snap: r(div(o.snapPctSum, o.snapGames)),
      routes: Math.round(routes), routesEst: o.passSnapsEst,
      rp: r(div(routes, o.teamDb)),
      tsh: r(tsh), aysh: r(aysh), wopr: r(tsh != null && aysh != null ? 1.5 * tsh + 0.7 * aysh : null),
      csh: r(div(o.car, o.teamCar)),
      osh: r(div(o.car + o.tgt, o.teamCar + o.teamTgt)),
      hvt: o.tgt + o.i10Car, hvtpg: r(div(o.tgt + o.i10Car, gp), 2),
      rzTgt: o.rzTgt, ezTgt: o.ezTgt, rzCar: o.rzCar, i10: o.i10Car, i5: o.i5Car,
      // ---- receiving efficiency ----
      yprr: r(div(o.recYds, routes), 2), tprr: r(div(o.tgt, routes)), fdrr: r(div(o.recFd, routes)),
      adot: r(div(o.ay, o.tgt), 1), ay: Math.round(o.ay), yacr: r(div(o.yac, o.rec), 1),
      catch: r(div(o.rec, o.tgt)), epat: r(div(o.recEpa, o.tgt)), rsucc: r(div(o.recSucc, o.tgt)),
      rec20: o.rec20, deep: r(div(o.deepTgt, o.tgt)), racr: r(div(o.recYds, o.ay), 2),
      drop: r(div(o.drops, o.catchable)), cont: r(div(o.contested, o.ftnTgt)), contc: r(div(o.contestedRec, o.contested)),
      catchable: r(div(o.catchable, o.ftnTgt)), screen: r(div(o.screens, o.ftnTgt)),
      // ---- rushing efficiency ----
      ypc: r(div(o.rushYds, o.car), 2), exp10: r(div(o.run10, o.designed)), exp15: r(div(o.run15, o.designed)),
      run20: o.run20, stuff: r(div(o.stuff, o.designed)), succ: r(div(o.rushSucc, o.car)), epar: r(div(o.rushEpa, o.car)),
      // ---- passing ----
      db: o.db, epadb: r(div(o.qbEpa, o.db)), cpoe: r(div(o.cpoeSum, o.cpoeN), 2), padot: r(div(o.passAy, o.att), 1),
      skr: r(div(o.sacks, o.db)), deepr: r(div(o.deepAtt, o.att)), press: o.pressN >= 20 ? r(div(o.pressured, o.pressN)) : null,
      twp: r(div(o.intWorthy, o.ftnDb)), par: r(div(o.pa, o.ftnDb)), oop: r(div(o.oop, o.ftnDb)),
      scr: o.scrambles, ruypg: r(div(sum(w => w.rushing_yards), gp), 1),
      // official rushing (box score): attempts include scrambles and kneel-downs
      ratt: sum(w => w.carries), rypc: r(div(sum(w => w.rushing_yards), sum(w => w.carries)), 2),
    };
    out.set(id, s);
    logs.set(id, wk.map(w => {
      const sn = snapByPG.get(`${id}|${w.game_id}`);
      return [w.week, w.opponent_team, r(w.fantasy_points ?? 0, 1), r(w.fantasy_points_ppr ?? 0, 1), w.receptions ?? 0, w.targets ?? 0,
        w.receiving_yards ?? 0, w.receiving_tds ?? 0, w.carries ?? 0, w.rushing_yards ?? 0, w.rushing_tds ?? 0,
        w.completions ?? 0, w.attempts ?? 0, w.passing_yards ?? 0, w.passing_tds ?? 0, w.passing_interceptions ?? 0,
        sn ? r(sn.pct, 2) : null, w._rk_ppr ?? null];
    }));
  }

  // ---------- Next Gen Stats ----------
  const ngsSeason = (rows, map) => {
    const bySeason = rows.filter(x => x.season === season);
    const full = new Map(bySeason.filter(x => x.week === 0).map(x => [x.player_gsis_id, x]));
    const weeksBy = new Map();
    for (const x of bySeason) if (x.week > 0) { if (!weeksBy.has(x.player_gsis_id)) weeksBy.set(x.player_gsis_id, []); weeksBy.get(x.player_gsis_id).push(x); }
    for (const [id, s] of out) {
      const f = full.get(id);
      if (f) { map(s, f, false); continue; }
      const ws = weeksBy.get(id);
      if (ws && ws.length >= 2) map(s, avgRows(ws), true);
    }
  };
  ngsSeason(ngsRec, (s, x, partial) => {
    s.sep = r(x.avg_separation, 2); s.cush = r(x.avg_cushion, 2); s.yacoe = r(x.avg_yac_above_expectation, 2);
    s.iaysh = r(x.percent_share_of_intended_air_yards != null ? x.percent_share_of_intended_air_yards / 100 : null);
    if (partial) s.ngsPartial = true;
  });
  ngsSeason(ngsRush, (s, x) => {
    s.ryoe = r(x.rush_yards_over_expected_per_att, 2);
    s.ryoepct = r(x.rush_pct_over_expected);
    s.box8 = r(x.percent_attempts_gte_eight_defenders != null ? x.percent_attempts_gte_eight_defenders / 100 : null);
    s.ttlos = r(x.avg_time_to_los, 2); s.eff = r(x.efficiency, 2);
  });
  ngsSeason(ngsPass, (s, x) => {
    s.ttt = r(x.avg_time_to_throw, 2); s.aggr = r(x.aggressiveness != null ? x.aggressiveness / 100 : null);
    s.ngscpoe = r(x.completion_percentage_above_expectation, 2); s.cay = r(x.avg_completed_air_yards, 1);
  });

  const diag = diagN ? { players: diagN, mape: r(diagAbs / diagActual, 3) } : null;
  return { players: out, logs, skew, posSkew, diag, teamGames: maxTeamGames(TG) };
}

function avgRows(rows) {
  // target/attempt-weighted average of weekly NGS rows
  const wkey = rows[0].targets != null ? 'targets' : rows[0].rush_attempts != null ? 'rush_attempts' : 'attempts';
  const out = {};
  const tot = rows.reduce((s, x) => s + (x[wkey] || 0), 0) || rows.length;
  for (const k of Object.keys(rows[0])) {
    if (typeof rows[0][k] !== 'number') continue;
    out[k] = rows.reduce((s, x) => s + (x[k] ?? 0) * ((x[wkey] || 0) || 1), 0) / tot;
  }
  return out;
}

function maxTeamGames(TG) {
  const c = {};
  for (const k of TG.keys()) { const t = k.split('|')[1]; c[t] = (c[t] || 0) + 1; }
  return Math.max(0, ...Object.values(c));
}
