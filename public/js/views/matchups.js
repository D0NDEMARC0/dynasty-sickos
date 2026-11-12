// Matchups: fantasy points allowed by each defense, run/pass funnels, coverage tendencies and offensive lines.
import { S, pprParam } from '../store.js';
import { esc, heat, table, sortRows } from '../ui.js';
import { mount } from './common.js';

const st = { view: 'def', sort: { def: 'WR', ol: 'sackRate' }, dir: { def: 'desc', ol: 'asc' } };
let cache;
const load = async () => (cache !== undefined ? cache : (cache = await fetch('data/teams.json').then(r => (r.ok ? r.json() : null)).catch(() => null)));
const POS = ['QB', 'RB', 'WR', 'TE'];
const pct1 = v => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const sgn2 = v => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`);
const ord = n => `${n}${['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th'}`;

export async function render(root, params, query) {
  const el = mount(root);
  el.innerHTML = '<div class="empty"><span class="spinner"></span> Loading matchups…</div>';
  const data = await load();
  if (!data?.teams) { el.innerHTML = '<div class="empty">Team data hasn’t been built yet — refresh the data.</div>'; return; }
  if (query.view === 'ol' || query.view === 'def') st.view = query.view;
  const ppr = pprParam();
  const fmt = ppr >= 0.75 ? 'ppr' : ppr >= 0.25 ? 'half' : 'std';
  const fmtLabel = { ppr: 'PPR', half: 'half PPR', std: 'standard' }[fmt];
  const rows = Object.entries(data.teams).map(([team, t]) => ({ team, ...t }));

  // percentile of each value among the 32 teams, oriented so blue = good for your fantasy players
  const pctFn = (get, higherIsGood) => {
    const v = rows.map(get).filter(x => x != null).sort((a, b) => a - b);
    return x => {
      if (x == null || !v.length) return null;
      const lo = v.filter(y => y < x).length, eq = v.filter(y => y === x).length;
      const p = ((lo + eq / 2) / v.length) * 100;
      return higherIsGood ? p : 100 - p;
    };
  };
  const rankFn = (get, desc) => {
    const sorted = rows.filter(r => get(r) != null).sort((a, b) => (desc ? get(b) - get(a) : get(a) - get(b)));
    const m = new Map(sorted.map((r, i) => [r.team, i + 1]));
    return r => m.get(r.team) ?? null;
  };
  const teamCell = r => `<td><b>${esc(r.team)}</b></td>`;
  const valCell = (v, p, rank, f = x => x.toFixed(1)) => `<td class="n heat" style="${heat(p)}">${v == null ? '—' : f(v)}${rank ? ` <span class="muted small">${ord(rank)}</span>` : ''}</td>`;

  const defCols = () => {
    const fpa = pos => r => r.def.fpa?.[pos]?.[fmt] ?? null;
    return [
      { key: 'team', label: 'Defense', sort: r => r.team, cell: teamCell },
      ...POS.map(pos => {
        const get = fpa(pos), p = pctFn(get, true), rk = rankFn(get, true);
        return { key: pos, label: `vs ${pos}`, n: true, title: `Fantasy points per game allowed to opposing ${pos}s (${fmtLabel}), ${data.season}. Rank 1st = gives up the most (best matchup)`, sort: get, cell: r => valCell(get(r), p(get(r)), rk(r)) };
      }),
      (() => { const get = r => r.def.passEpa, p = pctFn(get, true); return { key: 'passEpa', label: 'Pass EPA allowed', n: true, title: 'Expected points added per dropback against this defense (higher = easier to throw on)', sort: get, cell: r => valCell(get(r), p(get(r)), null, sgn2) }; })(),
      (() => { const get = r => r.def.rushEpa, p = pctFn(get, true); return { key: 'rushEpa', label: 'Rush EPA allowed', n: true, title: 'Expected points added per designed run against this defense (higher = easier to run on)', sort: get, cell: r => valCell(get(r), p(get(r)), null, sgn2) }; })(),
      { key: 'funnel', label: 'Funnel', title: 'Run funnel: much better against the pass than the run (EPA ranks 10+ apart), so opponents tend to run — good for RBs. Pass funnel: the reverse — good for passing games', sort: r => (r.def.funnel === 'run' ? 1 : r.def.funnel === 'pass' ? 2 : 3),
        cell: r => `<td>${r.def.funnel === 'run' ? '<span class="tag funnel run">Run funnel</span>' : r.def.funnel === 'pass' ? '<span class="tag funnel pass">Pass funnel</span>' : '<span class="muted">—</span>'}</td>` },
      { key: 'man', label: `Man %${data.covSeason ? ` (${data.covSeason})` : ''}`, n: true, title: `Share of dropbacks in man coverage (rest is zone), ${data.covSeason ?? '—'} season — coverage tags are published after each season`, sort: r => r.def.man, cell: r => `<td class="n">${pct1(r.def.man)}</td>` },
      { key: 'zone', label: 'Zone %', n: true, title: 'Share of dropbacks in zone coverage', sort: r => (r.def.man == null ? null : 1 - r.def.man), cell: r => `<td class="n">${r.def.man == null ? '—' : pct1(1 - r.def.man)}</td>` },
    ];
  };
  const olCols = () => {
    const col = (key, label, get, higherIsGood, f, title) => {
      const p = pctFn(get, higherIsGood), rk = rankFn(get, higherIsGood);
      return { key, label, n: true, title, sort: get, cell: r => valCell(get(r), p(get(r)), rk(r), f) };
    };
    return [
      { key: 'team', label: 'Offense', sort: r => r.team, cell: teamCell },
      col('sackRate', 'Sack %', r => r.off.sackRate, false, pct1, `Sacks per dropback, ${data.season} (lower = better protection). Rank 1st = best line`),
      col('hitRate', 'Sack + hit %', r => r.off.hitRate, false, pct1, `Dropbacks where the QB was sacked or hit, ${data.season}`),
      col('pressRate', `Pressure %${data.pressSeason ? ` (${data.pressSeason})` : ''}`, r => r.off.pressRate, false, pct1, `Share of dropbacks under pressure, ${data.pressSeason ?? '—'} season (pressure charting is published after each season)`),
      col('ybc', 'RB yds before contact', r => r.off.ybc, true, x => x.toFixed(2), `Running backs’ rushing yards before first contact per carry, ${data.season} — the cleanest run-blocking signal`),
      col('runEpa', 'Run EPA/play', r => r.off.runEpa, true, sgn2, `Expected points added per designed run, ${data.season}`),
    ];
  };

  el.innerHTML = `
    <div class="page-head"><div>
      <h1>Matchups</h1>
      <p class="sub">Which defenses give up fantasy points, which way they funnel offenses, how they cover, and how well each offensive line protects and run-blocks, built from play-by-play data.</p>
    </div></div>
    <div class="toolbar">
      <div class="seg" data-k="view"><button data-v="def" class="${st.view === 'def' ? 'on' : ''}">Defenses</button><button data-v="ol" class="${st.view === 'ol' ? 'on' : ''}">Offensive lines</button></div>
    </div>
    <p class="note" data-note></p>
    <div class="tablewrap tall" data-table></div>`;

  const draw = () => {
    const cols = st.view === 'def' ? defCols() : olCols();
    const list = sortRows(rows, cols, st.sort[st.view], st.dir[st.view]);
    const withRank = [{ key: 'rk', label: '#', n: true, cell: (r, i) => `<td class="rank">${i + 1}</td>` }, ...cols];
    el.querySelector('[data-table]').innerHTML = table({ cols: withRank, rows: list, sort: st.sort[st.view], dir: st.dir[st.view], cls: 'pin' });
    el.querySelector('[data-note]').innerHTML = st.view === 'def'
      ? `<b>${data.season} season, ${fmtLabel}.</b> Points allowed = what opposing QBs, RBs, WRs and TEs average per game against each defense. <b>Blue = friendlier matchup</b> for your players. Funnels compare how a defense ranks against the pass and the run by EPA allowed. Man/zone rates are from ${data.covSeason ?? 'the latest'} coverage tags, which nflverse publishes after each season.`
      : `<b>${data.season} season.</b> <b>Blue = better line.</b> Sack and hit rates and RB yards before contact are current; pressure rate is from ${data.pressSeason ?? 'the latest'} participation data (published after each season). Rank 1st = best.`;
  };
  draw();

  el.addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const k = th.dataset.sort, v = st.view;
      st.dir[v] = st.sort[v] === k ? (st.dir[v] === 'asc' ? 'desc' : 'asc') : k === 'team' ? 'asc' : 'desc';
      st.sort[v] = k;
      draw();
      return;
    }
    const b = e.target.closest('.seg[data-k="view"] button');
    if (b) location.hash = `#/matchups?view=${b.dataset.v}`;
  });
}
