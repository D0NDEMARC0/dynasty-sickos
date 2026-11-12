// Team matchup data from open nflverse data: fantasy points allowed by position, run/pass funnel defenses,
// man/zone coverage rates, and offensive-line pass protection and run blocking.
const r = (x, d = 3) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const div = (a, b) => (b > 0 ? a / b : null);
const POS = ['QB', 'RB', 'WR', 'TE'];

/** One season of team stats. part = participation map (pressure + coverage tags; only published after a season). */
export function teamSeason({ plays, weekly, part, players, adv, pfr2gsis, posOf }) {
  const T = {};
  const t = k => (T[k] ||= {
    off: { db: 0, sacks: 0, hits: 0, pressN: 0, pressured: 0, runs: 0, runEpa: 0, rbCar: 0, rbYbc: 0 },
    def: { db: 0, passEpa: 0, runs: 0, rushEpa: 0, cov: 0, man: 0, games: new Set(), fp: {} },
  });
  for (const p of plays) {
    if (!p.posteam || !p.defteam) continue;
    const O = t(p.posteam).off, D = t(p.defteam).def;
    const isDb = p.qb_dropback === 1 && !p.qb_spike;
    const isRun = p.rush_attempt === 1 && !p.qb_kneel && !p.qb_scramble;
    if (isDb) {
      O.db++; D.db++; D.passEpa += p.epa ?? 0;
      if (p.sack) O.sacks++;
      if (p.sack || p.qb_hit) O.hits++;
      const pr = part?.get(`${p.game_id}|${p.play_id}`);
      if (pr) {
        if (pr.pressure != null) { O.pressN++; if (pr.pressure) O.pressured++; }
        if (pr.cov) { D.cov++; if (pr.cov === 'M') D.man++; }
      }
    } else if (isRun) {
      O.runs++; O.runEpa += p.epa ?? 0; D.runs++; D.rushEpa += p.epa ?? 0;
    }
  }
  // fantasy points allowed: every opposing QB/RB/WR/TE box score, by position
  for (const w of weekly) {
    const pos = w.position === 'FB' ? 'RB' : w.position;
    if (!POS.includes(pos) || !w.opponent_team) continue;
    const D = t(w.opponent_team).def;
    D.games.add(w.game_id);
    const f = (D.fp[pos] ||= { ppr: 0, std: 0 });
    f.ppr += w.fantasy_points_ppr ?? 0; f.std += w.fantasy_points ?? 0;
  }
  // run blocking: the team's running backs' yards before contact per carry (PFR charting)
  if (adv) {
    for (const [pfr, a] of adv) {
      const g = pfr2gsis.get(pfr), s = g && players.get(g);
      if (!s?.team || !a.car || posOf(g) !== 'RB') continue;
      const O = t(s.team).off;
      O.rbCar += a.car; O.rbYbc += a.ybc;
    }
  }
  const out = {};
  for (const [team, { off: O, def: D }] of Object.entries(T)) {
    const g = D.games.size;
    out[team] = {
      def: {
        g,
        fpa: Object.fromEntries(POS.map(pos => {
          const f = D.fp[pos];
          return [pos, f && g ? { ppr: r(f.ppr / g, 1), half: r((f.ppr + f.std) / 2 / g, 1), std: r(f.std / g, 1) } : null];
        })),
        passEpa: r(div(D.passEpa, D.db)), rushEpa: r(div(D.rushEpa, D.runs)),
        man: D.cov >= 100 ? r(D.man / D.cov) : null, covN: D.cov,
      },
      off: {
        sackRate: r(div(O.sacks, O.db)), hitRate: r(div(O.hits, O.db)),
        pressRate: O.pressN >= 100 ? r(O.pressured / O.pressN) : null, pressN: O.pressN,
        ybc: O.rbCar >= 50 ? r(O.rbYbc / O.rbCar, 2) : null, runEpa: r(div(O.runEpa, O.runs)),
      },
    };
  }
  return out;
}

/**
 * Current-season matchups, with coverage and pressure from the latest season that has participation data
 * (it's published after each season). Adds league ranks and a run/pass funnel tag.
 */
export function assembleTeams(bySeason, current) {
  const seasons = Object.keys(bySeason).map(Number).sort((a, b) => b - a);
  const season = bySeason[current] ? current : seasons[0];
  const cur = bySeason[season] || {};
  const covSeason = seasons.find(y => Object.values(bySeason[y]).some(t => t.def.covN >= 100)) ?? null;
  const pressSeason = seasons.find(y => Object.values(bySeason[y]).some(t => t.off.pressN >= 100)) ?? null;
  const teams = {};
  for (const [team, t] of Object.entries(cur)) {
    if (!t.def.g) continue;
    const cov = covSeason != null ? bySeason[covSeason][team] : null;
    const prs = pressSeason != null ? bySeason[pressSeason][team] : null;
    teams[team] = {
      def: { ...t.def, man: t.def.man ?? cov?.def.man ?? null },
      off: { ...t.off, pressRate: t.off.pressRate ?? prs?.off.pressRate ?? null },
    };
    delete teams[team].def.covN; delete teams[team].off.pressN;
  }
  // ranks (1 = best defense / best line) and funnels: a defense much better against the pass than the run
  // "funnels" opponents to the run (good for RBs), and vice versa
  const rankBy = (get, asc) => {
    const list = Object.entries(teams).filter(([, t]) => get(t) != null).sort((a, b) => (asc ? get(a[1]) - get(b[1]) : get(b[1]) - get(a[1])));
    return Object.fromEntries(list.map(([k], i) => [k, i + 1]));
  };
  const passRk = rankBy(t => t.def.passEpa, true), rushRk = rankBy(t => t.def.rushEpa, true);
  for (const [team, t] of Object.entries(teams)) {
    t.def.passRank = passRk[team] ?? null; t.def.rushRank = rushRk[team] ?? null;
    const gap = (t.def.rushRank ?? 0) - (t.def.passRank ?? 0);
    t.def.funnel = t.def.passRank == null || t.def.rushRank == null ? null : gap >= 10 ? 'run' : gap <= -10 ? 'pass' : null;
  }
  return { season, covSeason, pressSeason, teams };
}
