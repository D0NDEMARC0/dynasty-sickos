// Advanced-stats explorer: per-position leaderboards with percentile heat and a configurable scatter plot.
import { S, rows, ppg, scoringLabel } from '../store.js';
import { M, COLUMNS, SCATTER_DEFAULT, metricValue } from '../metrics.js';
import { esc, heat, table, sortRows, tipRows, nameMatch } from '../ui.js';
import { scatter } from '../charts.js';
import { playerCell, mount } from './common.js';

const st = { pos: 'WR', season: null, q: '', qual: true, sort: 'score', dir: 'desc', limit: 100, axes: {} };

export function render(root, params, query) {
  rows();
  if (query.pos) st.pos = query.pos.toUpperCase();
  if (query.season) st.season = Number(query.season);
  const seasons = [...S.meta.seasons].reverse();
  if (!st.season || !seasons.includes(st.season)) st.season = seasons[0];
  const el = mount(root);

  el.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Advanced analytics</h1>
        <p class="sub">Usage and efficiency for every fantasy-relevant player: YPRR, targets per route, separation, YAC over expected, explosive-run rate, rush yards over expected, yards after contact and more, combined with real stats and ${esc(scoringLabel())} fantasy points.</p>
      </div>
    </div>
    <div class="toolbar">
      <div class="seg" data-k="pos">${['WR', 'RB', 'TE', 'QB'].map(p => `<button data-v="${p}" class="${st.pos === p ? 'on' : ''}">${p}</button>`).join('')}</div>
      <select data-k="season" aria-label="Season">${seasons.map(y => `<option value="${y}" ${y === st.season ? 'selected' : ''}>${y}${y === S.meta.current ? ` (thru wk ${S.meta.week - 1})` : ''}</option>`).join('')}</select>
      <input type="search" placeholder="Search player or team" value="${esc(st.q)}" data-k="q">
      <label class="chk"><input type="checkbox" data-k="qual" ${st.qual ? 'checked' : ''}> Qualified only</label>
    </div>
    <div class="card" data-chart></div>
    <div data-note></div>
    <div class="tablewrap tall" data-table style="margin-top:12px"></div>
    <div class="more" data-more></div>`;

  const pool = () => S.data.players
    .filter(p => p.pos === st.pos && p.seasons[st.season])
    .map(p => ({ p, s: p.seasons[st.season] }));

  const val = (r, k) => (k === 'ppg' ? ppg(r.p, r.s) : metricValue(r.s, k));
  const fmtv = (k, v) => (M[k]?.fmt ? M[k].fmt(v) : v ?? '—');

  const drawChart = list => {
    const keys = COLUMNS[st.pos].filter(k => k !== 'score' && list.some(r => val(r, k) != null));
    const [dx, dy] = SCATTER_DEFAULT[st.pos];
    const ax = st.axes[st.pos] || (st.axes[st.pos] = { x: dx, y: dy });
    if (!keys.includes(ax.x)) ax.x = keys[0];
    if (!keys.includes(ax.y)) ax.y = keys[1] || keys[0];
    const qual = list.filter(r => r.s.q && val(r, ax.x) != null && val(r, ax.y) != null);
    const q = st.q.trim().toLowerCase();
    const top = new Set([...qual].sort((a, b) => (b.s.score ?? 0) - (a.s.score ?? 0)).slice(0, 10).map(r => r.p.id));
    const pts = qual.map(r => ({
      id: r.p.id, x: val(r, ax.x), y: val(r, ax.y), label: r.p.name.split(' ').slice(-1)[0] === r.p.name ? r.p.name : `${r.p.name[0]}. ${r.p.name.split(' ').slice(1).join(' ')}`,
      href: `#/player/${encodeURIComponent(r.p.id)}`,
      me: q && nameMatch(r.p.name, q),
      dim: false,
      tip: tipRows(`${r.p.name} · ${r.s.team || ''}`, [[M[ax.x].label, fmtv(ax.x, val(r, ax.x))], [M[ax.y].label, fmtv(ax.y, val(r, ax.y))], ['Analytics score', r.s.score ?? '—']]),
    }));
    const opts = k => keys.map(x => `<option value="${x}" ${x === k ? 'selected' : ''}>${esc(M[x].label)}</option>`).join('');
    const box = el.querySelector('[data-chart]');
    const w = Math.max(320, box.clientWidth - 32), h = Math.round(Math.min(460, Math.max(300, w * 0.5)));
    box.innerHTML = `
      <div class="chart-head">
        <h2 style="margin:0">${esc(M[ax.y].label)} vs ${esc(M[ax.x].label)} <span class="muted small" style="font-weight:400">· ${qual.length} qualified ${st.pos}s, ${st.season}</span></h2>
        <div class="ctl">X <select data-axis="x">${opts(ax.x)}</select> Y <select data-axis="y">${opts(ax.y)}</select></div>
      </div>
      ${scatter({ pts, xLabel: M[ax.x].label, yLabel: M[ax.y].label, xFmt: v => fmtv(ax.x, v), yFmt: v => fmtv(ax.y, v), label: top, w, h })}
      <div class="muted small">Labeled: top 10 by Analytics Score${q ? ' · search matches highlighted' : ''}. Lines mark the median. Click a dot to open the player.</div>`;
  };

  const draw = () => {
    const all = pool();
    const q = st.q.trim().toLowerCase();
    let list = all.filter(r => (!st.qual || r.s.q) && (!q || nameMatch(r.p.name, q) || (r.s.team || '').toLowerCase() === q));
    drawChart(all);
    const est = S.meta.routeSource?.[st.season] === 'snap-estimate';
    const imported = all.filter(r => r.s.routesSrc).length;
    el.querySelector('[data-note]').innerHTML = est && ['WR', 'TE', 'RB'].includes(st.pos)
      ? `<p class="note"><b>${st.season} routes are estimated</b> (marked *): play-level participation data is published after the season, so routes = snap share × team dropbacks × each player’s historical pass-down skew, back-tested at ~${Math.round((S.meta.routeDiag?.[st.season - 1]?.mape ?? 0.07) * 100)}% average error. ${imported ? `${imported} players use imported route counts.` : 'Drop PFF CSV exports into <code>data/imports</code> for exact counts (see Methodology).'}</p>`
      : '';
    // imported metrics, and man/zone splits (published after each season), only show when the season has them
    const metricKeys = COLUMNS[st.pos].filter(k => !(k.startsWith('x_') || /Man$|Zone$/.test(k)) || all.some(r => metricValue(r.s, k) != null));
    const cols = [
      { key: 'rk', label: '#', n: true, cell: (r, i) => `<td class="rank">${i + 1}</td>` },
      { key: 'name', label: 'Player', sort: r => r.p.name, cell: r => `<td>${playerCell(r.p, { size: 26 })}</td>` },
      { key: 'g', label: 'G', n: true, sort: r => r.s.g, cell: r => `<td class="n">${r.s.g}</td>` },
      ...metricKeys.map(k => ({
        key: k, label: M[k].label, n: true, title: `${M[k].desc} (${M[k].src})`, sort: r => val(r, k),
        cell: r => {
          const v = val(r, k);
          const pct = k === 'score' ? r.s.score : r.s.pct?.[k];
          let extra = '';
          if (k === 'routes' && r.s.routesSrc) extra = ` <span class="tag src" title="From imported ${esc(r.s.routesSrc)} data">${esc(r.s.routesSrc)}</span>`;
          else if (['routes', 'yprr', 'tprr', 'rp'].includes(k) && r.s.routesEst) extra = '<span class="muted" title="Estimated">*</span>';
          return `<td class="n${pct != null ? ' heat' : ''}" style="${pct != null ? heat(pct) : ''}">${fmtv(k, v)}${extra}</td>`;
        },
      })),
    ];
    list = sortRows(list, cols, st.sort, st.dir);
    el.querySelector('[data-table]').innerHTML = table({ cols, rows: list.slice(0, st.limit), sort: st.sort, dir: st.dir, cls: 'pin' });
    el.querySelector('[data-more]').innerHTML = list.length > st.limit ? `<button class="btn" data-act="more">Show more (${list.length - st.limit} left)</button>` : `<span class="muted small">${list.length} players · cell shading = percentile among qualified ${st.pos}s (blue above median, red below)</span>`;
  };
  draw();

  el.addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (th) { const k = th.dataset.sort; st.dir = st.sort === k ? (st.dir === 'asc' ? 'desc' : 'asc') : k === 'name' ? 'asc' : 'desc'; st.sort = k; draw(); return; }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'more') { st.limit += 100; draw(); return; }
    const seg = b.closest('.seg');
    if (seg?.dataset.k === 'pos') {
      st.pos = b.dataset.v; st.sort = 'score'; st.dir = 'desc'; st.limit = 100;
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      draw();
    }
  });
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.k === 'season') { st.season = Number(t.value); draw(); }
    if (t.dataset.k === 'qual') { st.qual = t.checked; draw(); }
    if (t.dataset.axis) { st.axes[st.pos][t.dataset.axis] = t.value; draw(); }
  });
  el.addEventListener('input', e => { if (e.target.dataset.k === 'q') { st.q = e.target.value; st.limit = 100; draw(); } });
}
