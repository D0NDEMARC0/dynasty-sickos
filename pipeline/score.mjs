// Position-specific "Analytics Score" (0-100): weighted percentiles of predictive usage + efficiency metrics.

const get = (s, key) => {
  if (key === 'ppg') return s.ppg?.ppr;
  if (key.startsWith('x_')) return s.ext?.[key.slice(2)];
  if (key === 'dbpg') return s.g ? s.db / s.g : null;
  return s[key];
};

// [metric, weight, direction]  direction -1 means lower is better.
export const MODEL = {
  WR: [['yprr', .22, 1], ['ppg', .22, 1], ['tprr', .14, 1], ['tsh', .12, 1], ['aysh', .08, 1], ['fdrr', .06, 1],
       ['sep', .04, 1], ['yacoe', .04, 1], ['epat', .04, 1], ['rp', .04, 1]],
  TE: [['yprr', .22, 1], ['ppg', .22, 1], ['tprr', .14, 1], ['tsh', .12, 1], ['rp', .10, 1], ['fdrr', .06, 1],
       ['epat', .06, 1], ['yacoe', .04, 1], ['sep', .04, 1]],
  RB: [['ppg', .22, 1], ['osh', .15, 1], ['hvtpg', .12, 1], ['exp10', .10, 1], ['ryoe', .10, 1], ['tsh', .08, 1],
       ['yprr', .08, 1], ['yaco', .06, 1], ['succ', .04, 1], ['epar', .05, 1]],
  QB: [['ppg', .30, 1], ['epadb', .25, 1], ['ruypg', .15, 1], ['cpoe', .10, 1], ['padot', .05, 1], ['skr', .05, -1],
       ['twp', .05, -1], ['dbpg', .05, 1]],
};

// Extra metrics shown as percentile bars on player pages (not all are in the score).
export const DISPLAY = {
  WR: ['xfp', 'fpoe', 'yprr', 'tprr', 'yprrMan', 'yprrZone', 'tprrMan', 'tprrZone', 'tsh', 'frs', 'fr1', 'aysh', 'wopr', 'adot', 'sep', 'cush', 'yacoe', 'catch', 'drop', 'contc', 'epat', 'fdrr', 'rp', 'btr', 'ppg', 'x_grade', 'x_routeGrade', 'x_winRate'],
  TE: ['xfp', 'fpoe', 'yprr', 'tprr', 'yprrMan', 'yprrZone', 'tprrMan', 'tprrZone', 'tsh', 'frs', 'fr1', 'aysh', 'wopr', 'adot', 'sep', 'yacoe', 'catch', 'drop', 'epat', 'fdrr', 'rp', 'btr', 'ppg', 'x_grade', 'x_routeGrade'],
  RB: ['xfp', 'fpoe', 'ppg', 'osh', 'csh', 'tsh', 'frs', 'hvtpg', 'exp10', 'exp15', 'ryoe', 'ryoepct', 'yaco', 'btr', 'succ', 'stuff', 'epar', 'ypc', 'yprr', 'tprr', 'x_grade', 'x_runGrade', 'x_elusive'],
  QB: ['xfp', 'fpoe', 'ppg', 'epadb', 'cpoe', 'fread', 'chkr', 'padot', 'deepr', 'skr', 'twp', 'bad', 'press', 'ratt', 'rypc', 'ruypg', 'aggr', 'x_grade', 'x_passGrade', 'x_btt'],
};
const LOWER_BETTER = new Set(['drop', 'stuff', 'skr', 'twp', 'press', 'bad']);

const volume = (pos, s) => (pos === 'QB' ? s.db : pos === 'RB' ? (s.box?.car ?? 0) + (s.box?.tgt ?? 0) : s.routes ?? 0);
const threshold = (pos, teamGames) => (pos === 'QB' ? 14 : pos === 'RB' ? 6 : 10) * teamGames;

function cdf(sorted, x) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < x) lo = m + 1; else hi = m; }
  let eq = lo; while (eq < sorted.length && sorted[eq] === x) eq++;
  return ((lo + (eq - lo) / 2) / sorted.length) * 100;
}

/** Mutates each season stat object: adds .score, .q (qualified), .pct (percentiles). */
export function scoreSeason(rows, posOf, teamGames) {
  for (const pos of Object.keys(MODEL)) {
    const all = [...rows].filter(([id]) => posOf(id) === pos);
    const T = threshold(pos, teamGames);
    const pool = all.filter(([, s]) => volume(pos, s) >= T);
    const metrics = new Set([...MODEL[pos].map(m => m[0]), ...DISPLAY[pos]]);
    const dist = {};
    for (const m of metrics) dist[m] = pool.map(([, s]) => get(s, m)).filter(v => v != null && Number.isFinite(v)).sort((a, b) => a - b);
    for (const [, s] of all) {
      const pct = {};
      for (const m of metrics) {
        const v = get(s, m);
        if (v == null || !Number.isFinite(v) || dist[m].length < 8) continue;
        const p = cdf(dist[m], v);
        pct[m] = Math.round(LOWER_BETTER.has(m) ? 100 - p : p);
      }
      let num = 0, den = 0;
      for (const [m, w] of MODEL[pos]) if (pct[m] != null) { num += pct[m] * w; den += w; }
      const raw = den >= 0.5 ? num / den : null;
      const vol = volume(pos, s);
      s.q = vol >= T;
      s.pct = pct;
      // Small samples are pulled toward a below-average prior (35): low-volume players are usually low-volume for a reason.
      s.score = raw == null ? null : Math.round(s.q ? raw : raw * (vol / T) + 35 * (1 - vol / T));
    }
  }
}

/** Blend season scores into one dynasty-facing analytics score, weighting recent + larger samples more. */
export function blendScores(seasonMap, seasonsDesc) {
  const base = [1.2, 0.6, 0.25];
  let num = 0, den = 0;
  seasonsDesc.slice(0, 3).forEach((yr, i) => {
    const s = seasonMap[yr];
    if (!s || s.score == null) return;
    const w = base[i] * Math.min(1, s.g / 17);
    num += s.score * w; den += w;
  });
  return den > 0.15 ? Math.round(num / den) : null;
}
