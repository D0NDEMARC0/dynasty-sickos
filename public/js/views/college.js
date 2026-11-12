// College football advanced-stats explorer (EPA, success rate, target/dominator shares, YPTPA, explosive rate…).
import { loadProspects, loadCollegeSeason, CM, C_COLUMNS, C_SCATTER, fmtC, fmtRow, collegeHeadshot } from '../college.js';
import { esc, heat, table, sortRows, tipRows, posTag } from '../ui.js';
import { scatter } from '../charts.js';
import { mount } from './common.js';

const st = { pos: 'WR', season: null, q: '', qual: true, fbs: true, sort: null, dir: 'desc', limit: 100, axes: {} };
const DEFAULT_SORT = { WR: 'reyd', TE: 'reyd', RB: 'ruyd', QB: 'epap' };

export async function render(root, params, query) {
  const el = mount(root);
  el.innerHTML = '<div class="empty"><span class="spinner"></span> Loading college data…</div>';
  let meta;
  try { meta = (await loadProspects()).meta; } catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const seasons = [...meta.leaderboardSeasons].sort((a, b) => b - a);
  if (query.pos && query.pos.toUpperCase() !== st.pos) { st.pos = query.pos.toUpperCase(); st.sort = null; st.dir = 'desc'; }
  if (query.season) st.season = Number(query.season);
  if (!seasons.includes(st.season)) st.season = seasons[0];
  const data = await loadCollegeSeason(st.season);
  if (!st.sort) st.sort = DEFAULT_SORT[st.pos];

  el.innerHTML = `
    <div class="page-head"><div>
      <h1>College football analytics</h1>
      <p class="sub">Every FBS and FCS skill player: EPA per play, success rate, explosive-play rate, target share, dominator rating, yards per team pass attempt, CPOE and more — built from college play-by-play the same way the NFL numbers are.</p>
    </div></div>
    <div class="toolbar">
      <div class="seg" data-k="pos">${['WR', 'RB', 'TE', 'QB'].map(p => `<button data-v="${p}" class="${st.pos === p ? 'on' : ''}">${p}</button>`).join('')}</div>
      <select data-k="season" aria-label="Season">${seasons.map(y => `<option value="${y}" ${y === st.season ? 'selected' : ''}>${y}${y === meta.current ? ' (in progress)' : ''}</option>`).join('')}</select>
      <input type="search" placeholder="Search player or school" value="${esc(st.q)}" data-k="q">
      <label class="chk"><input type="checkbox" data-k="qual" ${st.qual ? 'checked' : ''}> Qualified only</label>
      <label class="chk"><input type="checkbox" data-k="fbs" ${st.fbs ? 'checked' : ''}> FBS only</label>
    </div>
    <div class="card" data-chart></div>
    <div class="tablewrap tall" data-table style="margin-top:12px"></div>
    <div class="more" data-more></div>`;

  const pool = () => data.players.filter(s => s.pos === st.pos && (!st.fbs || s.div === 'fbs'));

  const drawChart = list => {
    const keys = C_COLUMNS[st.pos].filter(k => !['g'].includes(k) && list.some(s => s[k] != null));
    const [dx, dy] = C_SCATTER[st.pos];
    const ax = st.axes[st.pos] || (st.axes[st.pos] = { x: dx, y: dy });
    if (!keys.includes(ax.x)) ax.x = keys[0];
    if (!keys.includes(ax.y)) ax.y = keys[1] || keys[0];
    const qual = list.filter(s => s.q && s[ax.x] != null && s[ax.y] != null);
    const q = st.q.trim().toLowerCase();
    const scoreOf = s => (s.pct?.[ax.x] ?? 0) + (s.pct?.[ax.y] ?? 0);
    const top = new Set([...qual].sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, 10).map(s => s.cid));
    const pts = qual.map(s => ({
      id: s.cid, x: s[ax.x], y: s[ax.y], label: `${s.name.split(' ')[0][0]}. ${s.name.split(' ').slice(1).join(' ')}`,
      href: `#/college/player/${s.cid}`, me: q && s.name.toLowerCase().includes(q),
      tip: tipRows(`${s.name} · ${s.team || ''}`, [[CM[ax.x].label, fmtC(ax.x, s[ax.x])], [CM[ax.y].label, fmtC(ax.y, s[ax.y])], ['Class', s.cls || '—']]),
    }));
    const box = el.querySelector('[data-chart]');
    const w = Math.max(320, box.clientWidth - 32), h = Math.round(Math.min(460, Math.max(300, w * 0.5)));
    const opts = k => keys.map(x => `<option value="${x}" ${x === k ? 'selected' : ''}>${esc(CM[x].label)}</option>`).join('');
    box.innerHTML = `
      <div class="chart-head">
        <h2 style="margin:0">${esc(CM[ax.y].label)} vs ${esc(CM[ax.x].label)} <span class="muted small" style="font-weight:400">· ${qual.length} qualified ${st.pos}s, ${st.season}</span></h2>
        <div class="ctl">X <select data-axis="x">${opts(ax.x)}</select> Y <select data-axis="y">${opts(ax.y)}</select></div>
      </div>
      ${scatter({ pts, xLabel: CM[ax.x].label, yLabel: CM[ax.y].label, xFmt: v => fmtC(ax.x, v), yFmt: v => fmtC(ax.y, v), label: top, w, h })}
      <div class="muted small">Labeled: the 10 best combined on these two stats${q ? ' · search matches highlighted' : ''}. Lines mark the median. Click a dot to open the player.</div>`;
  };

  const draw = () => {
    const all = pool();
    const q = st.q.trim().toLowerCase();
    let list = all.filter(s => (!st.qual || s.q) && (!q || s.name.toLowerCase().includes(q) || (s.team || '').toLowerCase().includes(q)));
    drawChart(all);
    const keys = C_COLUMNS[st.pos].filter(k => all.some(s => s[k] != null));
    const cols = [
      { key: 'rk', label: '#', n: true, cell: (s, i) => `<td class="rank">${i + 1}</td>` },
      { key: 'name', label: 'Player', sort: s => s.name, cell: s => `<td><a class="pcell" href="#/college/player/${s.cid}"><img class="hs" loading="lazy" width="26" height="26" style="width:26px;height:26px" src="${esc(s.hs || collegeHeadshot(s.cid))}" alt="" onerror="this.style.visibility='hidden'"><div><div class="nm">${esc(s.name)}</div><div class="meta">${posTag(s.pos)}<span>${esc(s.team || '')}</span><span>${esc(s.cls || '')}</span></div></div></a></td>` },
      ...keys.map(k => ({
        key: k, label: CM[k].label, n: true, title: CM[k].desc, sort: s => s[k],
        cell: s => { const p = s.pct?.[k]; return `<td class="n${p != null ? ' heat' : ''}" style="${p != null ? heat(p) : ''}">${fmtRow(k, s)}</td>`; },
      })),
    ];
    list = sortRows(list, cols, st.sort, st.dir);
    el.querySelector('[data-table]').innerHTML = table({ cols, rows: list.slice(0, st.limit), sort: st.sort, dir: st.dir, cls: 'pin' });
    el.querySelector('[data-more]').innerHTML = list.length > st.limit ? `<button class="btn" data-act="more">Show more (${list.length - st.limit} left)</button>` : `<span class="muted small">${list.length} players · shading = percentile among qualified FBS ${st.pos}s (blue above median, red below)</span>`;
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
      st.pos = b.dataset.v; st.sort = DEFAULT_SORT[st.pos]; st.dir = 'desc'; st.limit = 100;
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      draw();
    }
  });
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.k === 'season') { location.hash = `#/college?season=${t.value}&pos=${st.pos}`; return; }
    if (t.dataset.k === 'qual') { st.qual = t.checked; draw(); }
    if (t.dataset.k === 'fbs') { st.fbs = t.checked; draw(); }
    if (t.dataset.axis) { st.axes[st.pos][t.dataset.axis] = t.value; draw(); }
  });
  el.addEventListener('input', e => { if (e.target.dataset.k === 'q') { st.q = e.target.value; st.limit = 100; draw(); } });
}
