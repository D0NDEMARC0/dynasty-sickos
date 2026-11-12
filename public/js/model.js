// Dynasty model: age curves, Lab Value, league scoring, lineup optimization and team power rankings.

// Relative productivity by age (1.0 = peak), per position.
const CURVE = {
  QB: [[21, .74], [22, .8], [23, .85], [24, .9], [25, .95], [26, 1], [33, 1], [34, .92], [35, .84], [36, .74], [37, .62], [38, .5], [39, .38], [41, .2]],
  RB: [[20, .85], [21, .92], [22, .97], [23, 1], [25, 1], [26, .95], [27, .86], [28, .74], [29, .6], [30, .46], [31, .34], [32, .24], [34, .1]],
  WR: [[20, .8], [21, .85], [22, .9], [23, .96], [24, 1], [27, 1], [28, .97], [29, .92], [30, .85], [31, .76], [32, .65], [33, .52], [34, .4], [36, .2]],
  TE: [[21, .6], [22, .68], [23, .78], [24, .88], [25, .95], [26, 1], [29, 1], [30, .94], [31, .86], [32, .76], [33, .64], [34, .5], [36, .25]],
};

export function curve(pos, age) {
  const c = CURVE[pos];
  if (!c || age == null) return 0.9;
  if (age <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    const [a1, v1] = c[i], [a0, v0] = c[i - 1];
    if (age <= a1) return v0 + ((age - a0) / (a1 - a0)) * (v1 - v0);
  }
  return c[c.length - 1][1];
}

/** 0–100: share of a full peak-level 5-year window still ahead of the player. */
export function ageScore(pos, age) {
  if (age == null) return null;
  let num = 0, den = 0;
  for (let t = 0; t < 5; t++) { const w = 0.8 ** t; num += curve(pos, age + t) * w; den += w; }
  return Math.round((num / den) * 100);
}

export function ageOf(birth, now = new Date()) {
  if (!birth) return null;
  const b = new Date(birth);
  return (now - b) / (365.25 * 864e5);
}

// Players below this market value are waiver-level; their signals would be noise.
export const RELEVANT_VALUE = 300;

const midRank = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return v => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
    let eq = lo; while (eq < sorted.length && sorted[eq] === v) eq++;
    return ((lo + (eq - lo) / 2) / sorted.length) * 100;
  };
};
const pearson = (a, b) => {
  const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
};

/** True when the Analytics Score rests on a real sample (a qualified season, or 8+ games) in the last two years. */
export function reliable(p, current) {
  if (p.an == null) return false;
  const recent = [p.seasons[current], p.seasons[current - 1]].filter(Boolean);
  return recent.some(s => s.q) || recent.reduce((g, s) => g + (s.g || 0), 0) >= 8;
}
const isYoung = (p, current) => (p.yexp != null ? p.yexp <= 1 : (p.rookie ?? 0) >= current - 1);

/**
 * Fundamentals vs. price, per position — a symmetric rank comparison (no regression-to-the-mean bias).
 * Relevant players are ranked twice: by market value, and by fundamentals = Analytics percentile blended
 * with age-window percentile, using the age weight (alpha) that best reproduces the market's own ordering.
 * First- and second-year players are re-centered on the typical young-player gap, because the market
 * prices their projection, not just their production so far.
 * edge = fundamentals percentile − market percentile (−100…100 points).
 */
export function fundamentals(rows, current) {
  const out = new Map();
  out.alpha = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const pool = rows.filter(r => r.p.pos === pos && r.market >= RELEVANT_VALUE && r.ageS != null && reliable(r.p, current));
    if (pool.length < 12) continue;
    const anP = midRank(pool.map(r => r.p.an)), ageP = midRank(pool.map(r => r.ageS)), mkP = midRank(pool.map(r => r.market));
    const a = pool.map(r => anP(r.p.an)), g = pool.map(r => ageP(r.ageS)), m = pool.map(r => mkP(r.market));
    let alpha = 0, best = -2;
    for (let al = 0; al <= 0.8001; al += 0.05) {
      const rho = pearson(a.map((x, i) => (1 - al) * x + al * g[i]), m);
      if (rho > best) { best = rho; alpha = Math.round(al * 100) / 100; }
    }
    const F = pool.map((r, i) => (1 - alpha) * a[i] + alpha * g[i]);
    const fP = midRank(F);
    const fp = F.map(x => fP(x));
    const young = pool.map((r, i) => (isYoung(r.p, current) ? i : -1)).filter(i => i >= 0);
    const youngGap = young.length >= 5 ? young.reduce((s, i) => s + (m[i] - fp[i]), 0) / young.length : 0;
    for (const i of young) fp[i] = Math.max(0, Math.min(100, fp[i] + youngGap));
    out.alpha[pos] = { alpha, rho: Math.round(best * 100) / 100, n: pool.length, youngGap: Math.round(youngGap) };
    pool.forEach((r, i) => out.set(r, { edge: Math.round(fp[i] - m[i]), fundPct: Math.round(fp[i]), mktPct: Math.round(m[i]) }));
  }
  return out;
}

/**
 * Lab Value = market × analytics-edge multiplier × the user's age tilt.
 *  - Edge multiplier = exp(weight × edge / 30): at the default 30% weight, +10 points ≈ +10%, +30 points ≈ +35%.
 *  - Age tilt: -1 (win-now) … +1 (youth). 0 trusts the market's own age pricing.
 */
export function labValue(market, edge, age, pos, { anWeight = 0.3, ageTilt = 0 } = {}) {
  if (!market) return { value: 0, mult: 1 };
  const mA = edge == null ? 1 : Math.exp(anWeight * Math.max(-50, Math.min(50, edge)) / 30);
  const as = ageScore(pos, age);
  const mY = as == null ? 1 : 1 + ageTilt * 0.3 * ((as - 70) / 30);
  const mult = Math.max(0.3, mA * mY);
  return { value: Math.round(market * mult), mult };
}

// ---------------- league scoring ----------------
export const PRESETS = {
  ppr: { pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2, rush_yd: 0.1, rush_td: 6, rush_2pt: 2, rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2 },
  half: { pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2, rush_yd: 0.1, rush_td: 6, rush_2pt: 2, rec: 0.5, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2 },
  std: { pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2, rush_yd: 0.1, rush_td: 6, rush_2pt: 2, rec: 0, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2 },
};

/** Season fantasy points from box-score totals under any Sleeper scoring_settings. */
export function pointsFromBox(b, sc, pos) {
  if (!b) return 0;
  const k = key => sc[key] || 0;
  let pts = b.pyd * k('pass_yd') + b.ptd * k('pass_td') + b.int * k('pass_int') + b.ptp * k('pass_2pt')
    + b.pfd * k('pass_fd') + b.cmp * k('pass_cmp') + (b.att - b.cmp) * k('pass_inc') + b.att * k('pass_att') + b.sk * k('pass_sack')
    + b.ruyd * k('rush_yd') + b.rutd * k('rush_td') + b.rufd * k('rush_fd') + b.car * k('rush_att')
    + b.rec * k('rec') + b.reyd * k('rec_yd') + b.retd * k('rec_td') + b.refd * k('rec_fd')
    + b.tp * ((k('rush_2pt') + k('rec_2pt')) / 2) + b.fl * k('fum_lost') + (b.sttd || 0) * (sc.st_td ?? 6);
  if (pos === 'TE') pts += b.rec * k('bonus_rec_te');
  if (pos === 'RB') pts += b.rec * k('bonus_rec_rb');
  if (pos === 'WR') pts += b.rec * k('bonus_rec_wr');
  return pts;
}

// ---------------- lineups ----------------
const ELIGIBLE = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'],
  FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'], WRTE_FLEX: ['WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
};
const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'WRRB_FLEX', 'REC_FLEX', 'WRTE_FLEX', 'FLEX', 'SUPER_FLEX'];

/** Greedy optimal lineup: fills the most restrictive slots first with the highest-valued eligible player. */
export function bestLineup(players, slots, valueOf) {
  const pool = [...players].filter(p => valueOf(p) > 0).sort((a, b) => valueOf(b) - valueOf(a));
  const used = new Set();
  const lineup = [];
  const sorted = slots.filter(s => ELIGIBLE[s]).sort((a, b) => SLOT_ORDER.indexOf(a) - SLOT_ORDER.indexOf(b));
  for (const slot of sorted) {
    const pick = pool.find(p => !used.has(p.id) && ELIGIBLE[slot].includes(p.pos));
    if (pick) { used.add(pick.id); lineup.push({ slot, player: pick }); }
    else lineup.push({ slot, player: null });
  }
  return { lineup, used };
}

const ORD = { 1: '1st', 2: '2nd', 3: '3rd' };
export const ordinal = n => ORD[n] || `${n}th`;

/** Market value of a rookie pick. tier = 'Early' | 'Mid' | 'Late' when the slot can be projected. */
export function pickValue(picks, year, round, tier) {
  const base = `${year} ${ordinal(round)}`;
  if (tier && picks[`${base} (${tier})`] != null) return picks[`${base} (${tier})`];
  if (picks[base] != null) return picks[base];
  const years = [...new Set(Object.keys(picks).map(k => parseInt(k, 10)).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!years.length) return 0;
  const lastYear = years[years.length - 1];
  // a year further out than the market lists: discount the furthest listed year
  if (year > lastYear) return Math.round(pickValue(picks, lastYear, round) * 0.92 ** (year - lastYear));
  // a round deeper than the market lists: halve per extra round
  const rounds = Object.keys(picks).filter(k => k.startsWith(`${year} `) && !k.includes('(')).map(k => parseInt(k.slice(5), 10));
  if (!rounds.length) return 0;
  const maxR = Math.max(...rounds);
  return round > maxR ? Math.round(pickValue(picks, year, maxR) * 0.5 ** (round - maxR)) : 0;
}

const BENCH_W = 0.6, BENCH_DECAY = 0.85, PICK_W = 0.8;
const ROOM = { QB: [1, 0.25], RB: [1, 1, 0.5, 0.25], WR: [1, 1, 1, 0.5, 0.25], TE: [1, 0.25] };

/**
 * Power-rank every roster in a league.
 * @param teams [{ rosterId, name, owner, players: [playerView], picks: [{year, round, fromRosterId}] }]
 * playerView: { id, pos, lab, proj, age, inj }
 */
export function rankTeams(teams, { slots, picksMarket, superflex }) {
  const room = { ...ROOM, QB: superflex ? [1, 1, 0.25] : ROOM.QB };
  for (const t of teams) {
    const dyn = bestLineup(t.players, slots, p => p.lab);
    t.starterValue = dyn.lineup.reduce((s, x) => s + (x.player?.lab || 0), 0);
    const bench = t.players.filter(p => !dyn.used.has(p.id)).sort((a, b) => b.lab - a.lab);
    t.depthValue = bench.reduce((s, p, i) => s + p.lab * BENCH_DECAY ** i, 0);
    const healthy = t.players.filter(p => !['IR', 'PUP', 'Sus', 'NFI'].includes(p.inj));
    const now = bestLineup(healthy, slots, p => p.proj);
    t.lineupNow = now.lineup;
    t.lineupDyn = dyn.lineup;
    t.winNow = now.lineup.reduce((s, x) => s + (x.player?.proj || 0), 0);
    t.youth = t.players.reduce((s, p) => s + p.lab * curve(p.pos, (p.age ?? 25) + 3), 0);
    const val = t.players.reduce((s, p) => s + p.lab, 0);
    t.avgAge = val ? t.players.reduce((s, p) => s + p.lab * (p.age ?? 25), 0) / val : null;
    t.rooms = {};
    for (const [pos, w] of Object.entries(room)) {
      const list = t.players.filter(p => p.pos === pos).sort((a, b) => b.lab - a.lab);
      t.rooms[pos] = w.reduce((s, wt, i) => s + (list[i]?.lab || 0) * wt, 0);
    }
  }
  // 1st-round tiers for next year's picks come from the original owner's win-now strength.
  const byNow = [...teams].sort((a, b) => b.winNow - a.winNow);
  const n = teams.length;
  byNow.forEach((t, i) => { t.nowRank = i + 1; t.pickTier = i < n / 3 ? 'Late' : i < (2 * n) / 3 ? 'Mid' : 'Early'; });
  const tierOf = Object.fromEntries(teams.map(t => [t.rosterId, t.pickTier]));
  const nextYear = Math.min(...teams.flatMap(t => t.picks.map(p => p.year)), Infinity);
  for (const t of teams) {
    for (const p of t.picks) p.value = pickValue(picksMarket, p.year, p.round, p.year === nextYear ? tierOf[p.fromRosterId] : null);
    t.pickValue = t.picks.reduce((s, p) => s + p.value, 0);
    t.power = t.starterValue + BENCH_W * t.depthValue + PICK_W * t.pickValue;
    t.future = t.youth + t.pickValue;
  }
  const rankBy = (key, field) => [...teams].sort((a, b) => b[key] - a[key]).forEach((t, i) => { t[field] = i + 1; });
  rankBy('power', 'powerRank'); rankBy('future', 'futureRank'); rankBy('starterValue', 'starterRank'); rankBy('pickValue', 'pickRank');
  for (const pos of Object.keys(room)) [...teams].sort((a, b) => b.rooms[pos] - a.rooms[pos]).forEach((t, i) => { (t.roomRank ||= {})[pos] = i + 1; });
  for (const t of teams) t.archetype = archetype(t.nowRank, t.futureRank, n);
  return teams.sort((a, b) => a.powerRank - b.powerRank);
}

function archetype(now, fut, n) {
  const top = now <= n / 3, bottom = now > (2 * n) / 3, young = fut <= n / 2;
  if (top && young) return { key: 'dynasty', label: 'Dynasty', desc: 'Strong now and built to last' };
  if (top) return { key: 'contender', label: 'All-in contender', desc: 'Strong now, aging or thin future' };
  if (bottom && young) return { key: 'rebuild', label: 'Rebuild on track', desc: 'Weak now, strong young core / picks' };
  if (bottom) return { key: 'teardown', label: 'Needs a teardown', desc: 'Weak now and weak future' };
  return young ? { key: 'rising', label: 'Rising', desc: 'Middle of the pack with upside' } : { key: 'middle', label: 'Stuck in the middle', desc: 'Middle of the pack, aging core' };
}
