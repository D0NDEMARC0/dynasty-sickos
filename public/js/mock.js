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
 * Consensus order for a class. Each available signal becomes a slot within the class, then they're blended:
 * real rookie-draft ADP 40%, dynasty market value 30%, expert rankings 25%, Prospect Score 15%
 * (re-normalized to whatever exists for each player). The Prospect Score is position-neutral, so it's mapped
 * onto the market's positional curve: the 2nd-best RB by score takes the slot where 2nd RBs usually go.
 */
export function consensus(list, { sf, history = [] }) {
  const rankBy = (get, asc) => {
    const have = list.filter(p => get(p) != null).sort((a, b) => (asc ? get(a) - get(b) : get(b) - get(a)));
    return new Map(have.map((p, i) => [p, i + 1]));
  };
  const curves = positionalCurves(history);
  const overall = rankBy(p => p.score ?? null, false); // position-neutral quality
  const scoreSlot = new Map(), byPos = {};
  for (const p of list) if (p.score != null) (byPos[p.pos] ||= []).push(p);
  for (const [pos, arr] of Object.entries(byPos)) {
    arr.sort((a, b) => b.score - a.score);
    const c = curves[pos] || [];
    arr.forEach((p, i) => {
      if (!c.length) { scoreSlot.set(p, overall.get(p)); return; }
      const curve = i < c.length ? c[i] : c[c.length - 1] + (i - c.length + 1) * 4;
      // half "where this position-rank usually goes", half overall quality — so a weak RB1 doesn't jump the class
      scoreSlot.set(p, 0.5 * curve + 0.5 * overall.get(p));
    });
  }
  const signals = [
    { label: 'rookie ADP', w: 0.4, m: rankBy(p => p.adp?.rookie ?? null, true) },
    { label: 'market value', w: 0.3, m: rankBy(market, false) },
    // FantasyPros rookie rankings are 1QB; move QBs up in superflex
    { label: 'expert rankings', w: 0.25, m: rankBy(p => p.ecr?.rank ?? null, true), adj: p => (sf && p.pos === 'QB' ? 0.7 : 1) },
    { label: Object.keys(curves).length ? 'Prospect Score (on the market’s positional curve)' : 'Prospect Score', w: 0.15, m: scoreSlot },
  ];
  const out = [];
  for (const p of list) {
    let num = 0, den = 0;
    for (const s of signals) { const r = s.m.get(p); if (r != null) { num += r * (s.adj ? s.adj(p) : 1) * s.w; den += s.w; } }
    if (!den) continue;
    out.push({ p, slot: num / den });
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
