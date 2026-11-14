// Rookie consensus board + mock draft engine (generic league or your Sleeper league).
import { S, sleeper } from './store.js';
import { buildTeams } from './views/league.js';

const market = p => (p.sid ? S.rowById.get(p.sid)?.market || null : null);

/**
 * How the market drafts each position: the average overall slot of the k-th QB/RB/WR/TE in recent rookie
 * classes, ordered by current dynasty value in this format (so superflex QB value is built in).
 */
function positionalCurves(history) {
  const classes = {};
  for (const p of history) if (market(p)) (classes[p.draftClass] ||= []).push(p);
  const acc = {};
  for (const cls of Object.values(classes)) {
    const k = {};
    cls.sort((a, b) => market(b) - market(a)).forEach((p, i) => {
      const j = (k[p.pos] = (k[p.pos] || 0) + 1) - 1;
      const a = ((acc[p.pos] ||= [])[j] ||= [0, 0]);
      a[0] += i + 1; a[1]++;
    });
  }
  const curves = {};
  for (const [pos, arr] of Object.entries(acc)) {
    let prev = 0;
    curves[pos] = arr.filter(Boolean).map(([s, n]) => (prev = Math.max(prev, s / n)));
  }
  return curves;
}

/**
 * Consensus order for a class, led by what people outside this app say: online NFL mock drafts and boards you pasted
 * (weight 1.6 each), real rookie-draft ADP (0.4), dynasty market value (0.3) and expert rankings (0.25). Our own models
 * fill in behind them: the expert-style projection (0.35), the projected NFL draft position (0.3) and the Prospect
 * Score (0.15). Each signal becomes a slot within the class; the slots are blended by a weighted geometric mean,
 * re-normalized to whatever exists for each player. For a player the community has ranked, the models can move him
 * at most 3× either way from that ranking. Position-neutral signals are mapped onto the market's positional curve:
 * the 2nd-best RB by score takes about the slot where 2nd RBs usually go in this format.
 */
export function consensus(list, { sf, history = [], boards = [] }) {
  const rankBy = (get, asc) => {
    const have = list.filter(p => get(p) != null).sort((a, b) => (asc ? get(a) - get(b) : get(b) - get(a)));
    return new Map(have.map((p, i) => [p, i + 1]));
  };
  const curves = positionalCurves(history);
  const qbAdj = p => (sf && p.pos === 'QB' ? 0.5 : 1); // 1QB-based ranks: QBs move up in superflex
  // Half "where the i-th QB/RB/WR/TE of a class usually goes in this format", half the overall rank, so a weak RB1
  // doesn't jump the class.
  const curveSlot = (pos, i, overall) => {
    const c = curves[pos] || [];
    if (!c.length) return overall;
    return 0.5 * (i < c.length ? c[i] : c[c.length - 1] + (i - c.length + 1) * 4) + 0.5 * overall;
  };
  // a signal's order within each position, placed on the market's positional curve
  const onCurve = (get, adj) => {
    const overall = rankBy(get, true);
    const slot = new Map(), byPos = {};
    for (const p of list) if (get(p) != null) (byPos[p.pos] ||= []).push(p);
    for (const [pos, arr] of Object.entries(byPos)) {
      arr.sort((a, b) => get(a) - get(b));
      arr.forEach((p, i) => slot.set(p, curveSlot(pos, i, overall.get(p) * (adj ? adj(p) : 1))));
    }
    return slot;
  };
  const scoreSlot = onCurve(p => (p.score == null ? null : -p.score));
  // Online NFL mock-draft consensus (Pro Football Network's Mock Draft Index: the latest mocks' first round, weighted
  // 3:1 over the season-long top 40; p.mock.est is the NFL pick that implies). Its order among QB/RB/WR/TE goes on the
  // positional curve, so in 1QB the 9th QB it lists isn't a top-10 rookie pick. Players it doesn't list come after
  // everyone it does.
  const mocked = list.filter(p => p.mock && !p.draft).sort((a, b) => (a.mock.est ?? a.mock.rank) - (b.mock.est ?? b.mock.rank));
  const mockSlots = new Map();
  if (mocked.length) {
    const k = {};
    mocked.forEach((p, i) => mockSlots.set(p, curveSlot(p.pos, (k[p.pos] = (k[p.pos] || 0) + 1) - 1, i + 1)));
    for (const p of list) if (!p.draft && !p.mock) mockSlots.set(p, curveSlot(p.pos, k[p.pos] || 0, mocked.length + 30));
  }
  // boards you pasted (Footballguys, Draft Sharks, Reddit…): average of their ranks for the player
  const yours = p => {
    const r = boards.map(b => (b.blendRank || b.rank)(p)).filter(v => v != null);
    return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
  };
  // community: what people outside this app say (for the mocks, only the players they actually list)
  const all = () => true;
  const signals = [
    { label: `your pasted board${boards.length === 1 ? '' : 's'} (${boards.map(b => b.name).join(', ')})`, w: 1.6, m: rankBy(yours, true), community: all },
    { label: 'online NFL mock-draft consensus (Pro Football Network)', w: 1.6, m: mockSlots, community: p => !!p.mock },
    { label: 'rookie ADP', w: 0.4, m: rankBy(p => p.adp?.rookie ?? null, true), community: all },
    { label: 'market value', w: 0.3, m: rankBy(market, false), community: all },
    // FantasyPros rookie rankings are 1QB; move QBs up in superflex
    { label: 'expert rankings', w: 0.25, m: rankBy(p => p.ecr?.rank ?? null, true), adj: qbAdj, community: all },
    // before FantasyPros ranks a class: a model of how its experts ranked past classes from the same profile
    // (pedigree, production, age, school, size, Wikipedia attention), placed on the market's positional curve
    { label: 'expert-style projection (on the market’s positional curve)', w: 0.35, m: onCurve(p => (p.ecr ? null : p.xecr ?? null), qbAdj) },
    // before the NFL Draft: where the draft-capital model projects him in the real draft (players it projects as
    // undrafted come after everyone it projects to be picked)
    { label: 'projected NFL draft position', w: 0.3, m: rankBy(p => (p.draft || !p.proj ? null : p.proj.pick ?? 300 + p.proj.rank), true) },
    { label: Object.keys(curves).length ? 'Prospect Score (on the market’s positional curve)' : 'Prospect Score', w: 0.15, m: scoreSlot },
  ];
  const slotOf = (s, p) => { const r = s.m.get(p); return r == null ? null : Math.max(1, r * (s.adj ? s.adj(p) : 1)); };
  // weighted geometric mean of the slots: one source ranking a player 250th can't bury a #2 from the others
  const out = [];
  for (const p of list) {
    let cn = 0, cd = 0;
    for (const s of signals) { const r = s.community?.(p) ? slotOf(s, p) : null; if (r != null) { cn += Math.log(r) * s.w; cd += s.w; } }
    const anchor = cd ? Math.exp(cn / cd) : null;
    let num = 0, den = 0;
    for (const s of signals) {
      let r = slotOf(s, p);
      if (r == null) continue;
      if (!s.community && anchor) r = Math.min(anchor * 3, Math.max(anchor / 3, r));
      num += Math.log(r) * s.w; den += s.w;
    }
    if (!den) continue;
    out.push({ p, slot: Math.exp(num / den) });
  }
  out.sort((a, b) => a.slot - b.slot);
  out.forEach((x, i) => { x.rank = i + 1; });
  return { board: out, used: signals.filter(s => s.m.size).map(s => s.label) };
}

/** Generic league: linear rookie draft, team 1 picks first each round. */
export function genericSlots(teams, rounds) {
  const slots = [];
  for (let r = 1; r <= rounds; r++) for (let i = 1; i <= teams; i++) slots.push({ round: r, pick: i, team: `Team ${i}` });
  return { slots, source: `${teams}-team linear draft` };
}

/** Your Sleeper league: real draft order when set, otherwise projected from standings; traded picks applied. */
export async function leagueSlots(cls, roundsOverride) {
  const L = S.league;
  const teams = buildTeams();
  const byRid = new Map(teams.map(t => [t.rosterId, t]));
  let drafts = [];
  try { drafts = await sleeper(`/league/${L.info.league_id}/drafts`); } catch { /* offline: project */ }
  const d = (drafts || []).find(x => String(x.season) === String(cls) && x.status !== 'complete');
  let order = null, source;
  if (d?.slot_to_roster_id && Object.keys(d.slot_to_roster_id).length) {
    order = Object.entries(d.slot_to_roster_id).sort((a, b) => a[0] - b[0]).map(([, rid]) => Number(rid));
    source = 'your league’s draft order';
  } else if (d?.draft_order && Object.keys(d.draft_order).length) {
    const byUser = new Map(L.rosters.map(r => [r.owner_id, r.roster_id]));
    order = Object.entries(d.draft_order).sort((a, b) => a[1] - b[1]).map(([uid]) => byUser.get(uid)).filter(Boolean);
    source = 'your league’s draft order';
  }
  if (!order || order.length !== L.rosters.length) {
    order = [...L.rosters].sort((a, b) => ((a.settings?.wins || 0) - (b.settings?.wins || 0))
      || ((a.settings?.fpts || 0) + (a.settings?.fpts_decimal || 0) / 100) - ((b.settings?.fpts || 0) + (b.settings?.fpts_decimal || 0) / 100)).map(r => r.roster_id);
    source = 'order projected from current standings (worst record picks first)';
  }
  const rounds = roundsOverride || d?.settings?.rounds || L.info.settings?.draft_rounds || 4;
  const owner = new Map();
  for (const t of L.traded) if (String(t.season) === String(cls)) owner.set(`${t.round}|${t.roster_id}`, t.owner_id);
  const needs = rid => {
    const t = byRid.get(rid);
    if (!t?.roomRank) return {};
    const worst = Object.entries(t.roomRank).sort((a, b) => b[1] - a[1]).map(([pos]) => pos);
    return { [worst[0]]: 2, [worst[1]]: 1 };
  };
  const slots = [];
  for (let r = 1; r <= rounds; r++) order.forEach((orig, i) => {
    const own = owner.get(`${r}|${orig}`) ?? orig;
    slots.push({ round: r, pick: i + 1, team: byRid.get(own)?.name || `Team ${own}`, via: own !== orig ? byRid.get(orig)?.name || `Team ${orig}` : null,
      me: !!byRid.get(own)?.me, needs: needs(own) });
  });
  return { slots, source };
}

/** Each pick takes the best available, nudged toward a team's weakest positions (league mocks only). */
export function runMock(board, slots) {
  const avail = [...board];
  return slots.map(slot => {
    let best = 0, bestCost = Infinity;
    for (let i = 0; i < Math.min(5, avail.length); i++) {
      const cost = i - (slot.needs?.[avail[i].p.pos] || 0);
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    const [pickd] = avail.splice(best, 1);
    return { ...slot, x: pickd || null };
  });
}
