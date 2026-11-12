// Rookie & prospect classes: college production, breakout, combine athleticism, draft capital → Prospect Score.
import { S, rows } from '../store.js';
import { loadProspects, collegeHeadshot, stars } from '../college.js';
import { esc, fmtInt, fmt1, heat, posTag, table, sortRows } from '../ui.js';
import { mount } from './common.js';

const st = { cls: null, pos: 'ALL', q: '', sort: 'score', dir: 'desc', limit: 150 };
const STATUS = {
  watch: 'Draft-eligible watch list',
  combine: 'Combine invitees',
  drafted: 'Drafted class',
};

export async function render(root, params, query) {
  const el = mount(root);
  el.innerHTML = '<div class="empty"><span class="spinner"></span> Loading prospects…</div>';
  let data;
  try { data = await loadProspects(); } catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  rows();
  const { meta } = data;
  const classes = Object.keys(meta.classes).map(Number).sort((a, b) => b - a);
  if (query.class) st.cls = Number(query.class);
  if (!classes.includes(st.cls)) st.cls = classes[0];

  const note = cls => {
    const s = meta.classes[cls]?.status;
    if (s === 'watch') return `<b>${cls} class — before the combine.</b> These are draft-eligible juniors and seniors producing this season, ranked on college production, breakout age/class and recruiting pedigree. In early March this list switches to the official combine invitees (adding athletic testing), and after the NFL Draft in late April to the drafted class (adding draft capital). It all happens automatically with the weekly update.`;
    if (s === 'combine') return `<b>${cls} class — combine invitees.</b> Scored on college production, breakout, athletic testing, age and recruiting. Draft capital is added automatically after the NFL Draft.`;
    return `<b>${cls} draft class.</b> Scores include draft capital, the strongest single predictor of rookie success, plus college production, breakout age, athleticism and age.`;
  };

  el.innerHTML = `
    <div class="page-head"><div>
      <h1>Rookies & prospects</h1>
      <p class="sub">Prospect Score (0–100) for every skill-position prospect: college production and efficiency, how early they broke out, combine athleticism, recruiting pedigree, age and draft capital.</p>
    </div></div>
    <div class="toolbar">
      <div class="seg" data-k="cls">${classes.map(c => `<button data-v="${c}" class="${c === st.cls ? 'on' : ''}">${c}${meta.classes[c].status !== 'drafted' ? ' ★' : ''}</button>`).join('')}</div>
      <div class="seg" data-k="pos">${['ALL', 'QB', 'RB', 'WR', 'TE'].map(p => `<button data-v="${p}" class="${st.pos === p ? 'on' : ''}">${p === 'ALL' ? 'All' : p}</button>`).join('')}</div>
      <input type="search" placeholder="Search player or school" value="${esc(st.q)}" data-k="q">
    </div>
    <p class="note" data-note></p>
    <div class="tablewrap tall" data-table></div>
    <div class="more" data-more></div>`;

  const draw = () => {
    el.querySelector('[data-note]').innerHTML = note(st.cls);
    const q = st.q.trim().toLowerCase();
    let list = data.prospects.filter(p => p.draftClass === st.cls && (st.pos === 'ALL' || p.pos === st.pos)
      && (!q || p.name.toLowerCase().includes(q) || (p.school || '').toLowerCase().includes(q)));
    const drafted = meta.classes[st.cls]?.status === 'drafted';
    const market = p => (p.sid ? S.rowById.get(p.sid)?.market || null : null);
    const cell = (v, extra = '') => `<td class="n heat" style="${heat(v)}">${v ?? '—'}${extra}</td>`;
    const cols = [
      { key: 'rk', label: '#', n: true, cell: (p, i) => `<td class="rank">${i + 1}</td>` },
      { key: 'name', label: 'Player', sort: p => p.name, cell: p => `<td>${playerCell(p)}</td>` },
      { key: 'pos', label: 'Pos', sort: p => p.pos, cell: p => `<td>${posTag(p.pos)}</td>` },
      { key: 'school', label: 'School', sort: p => p.school, cell: p => `<td>${esc(p.school || '—')}</td>` },
      ...(drafted
        ? [{ key: 'draft', label: 'Draft', n: true, sort: p => p.draft?.p, cell: p => `<td class="n">${p.draft ? `${p.draft.r}.${String(p.draft.p).padStart(2, '0')} <span class="muted small">${esc(p.draft.team)}</span>` : '—'}</td>` }]
        : [{ key: 'cls', label: 'Class', sort: p => p.cls, cell: p => `<td>${esc(p.cls || '—')}</td>` }]),
      { key: 'age', label: 'Age', n: true, title: 'Age on draft day', sort: p => p.age, cell: p => `<td class="n">${p.age != null ? fmt1(p.age) : '—'}</td>` },
      { key: 'size', label: 'Ht / Wt', n: true, cell: p => `<td class="n">${p.ht ? `${Math.floor(p.ht / 12)}'${p.ht % 12}"` : '—'}${p.wt ? ` / ${p.wt}` : ''}</td>` },
      { key: 'forty', label: '40', n: true, title: '40-yard dash (combine)', sort: p => p.combine?.forty, cell: p => `<td class="n">${p.combine?.forty ?? '—'}</td>` },
      { key: 'rec', label: 'Recruit', title: 'High-school recruiting stars (247 composite grade)', sort: p => p.recruit?.grade, cell: p => `<td class="small" title="${p.recruit ? `Grade ${p.recruit.grade} (${p.recruit.year})` : ''}">${p.recruit ? stars(p.recruit.stars) : '—'}</td>` },
      { key: 'prod', label: 'Production', n: true, title: 'College production & efficiency percentile vs. prospects at the position', sort: p => p.comps?.prod, cell: p => cell(p.comps?.prod) },
      { key: 'brk', label: 'Breakout', n: true, title: 'How early they became a featured producer (by age when known, else class year)', sort: p => p.comps?.brk, cell: p => cell(p.comps?.brk, p.brk?.cls ? ` <span class="muted small">${p.brk.age ? fmt1(p.brk.age) : esc(p.brk.cls)}</span>` : '') },
      { key: 'ath', label: 'Athletic', n: true, title: 'Combine athleticism percentile (speed score, jumps, agility) vs. all combine players at the position since 2000', sort: p => p.comps?.ath, cell: p => cell(p.comps?.ath) },
      ...(drafted ? [{ key: 'dc', label: 'Draft cap', n: true, title: 'Draft capital score from pick number', sort: p => p.comps?.dc, cell: p => cell(p.comps?.dc) }] : []),
      { key: 'score', label: 'Score', n: true, title: 'Prospect Score (0–100)', sort: p => p.score, cell: p => `<td class="n heat" style="${heat(p.score)}"><b>${p.score ?? '—'}</b></td>` },
      { key: 'mkt', label: 'Dynasty value', n: true, title: 'Current dynasty market value (once in the NFL)', sort: p => market(p), cell: p => `<td class="n">${market(p) ? fmtInt(market(p)) : '<span class="muted">—</span>'}</td>` },
    ];
    list = sortRows(list, cols, st.sort, st.dir);
    el.querySelector('[data-table]').innerHTML = table({ cols, rows: list.slice(0, st.limit), sort: st.sort, dir: st.dir, cls: 'pin' });
    el.querySelector('[data-more]').innerHTML = list.length > st.limit ? `<button class="btn" data-act="more">Show more (${list.length - st.limit} left)</button>` : `<span class="muted small">${list.length} prospects · shading = percentile (blue above average, red below)</span>`;
  };
  draw();

  el.addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (th) { const k = th.dataset.sort; st.dir = st.sort === k ? (st.dir === 'asc' ? 'desc' : 'asc') : ['name', 'pos', 'school', 'cls', 'age', 'forty', 'draft'].includes(k) ? 'asc' : 'desc'; st.sort = k; draw(); return; }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'more') { st.limit += 150; draw(); return; }
    const seg = b.closest('.seg');
    if (seg?.dataset.k) {
      st[seg.dataset.k] = seg.dataset.k === 'cls' ? Number(b.dataset.v) : b.dataset.v;
      st.limit = 150;
      if (seg.dataset.k === 'cls') { st.sort = 'score'; st.dir = 'desc'; location.hash = `#/prospects?class=${st.cls}`; return; }
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      draw();
    }
  });
  el.addEventListener('input', e => { if (e.target.dataset.k === 'q') { st.q = e.target.value; st.limit = 150; draw(); } });
}

function playerCell(p) {
  const href = p.cid ? `#/college/player/${p.cid}` : p.sid ? `#/player/${p.sid}` : null;
  const src = p.sid ? `https://sleepercdn.com/content/nfl/players/thumb/${p.sid}.jpg` : p.cid ? collegeHeadshot(p.cid) : null;
  const img = src ? `<img class="hs" loading="lazy" width="30" height="30" style="width:30px;height:30px" src="${esc(src)}" alt="" onerror="this.style.visibility='hidden'">` : '<span class="hs" style="width:30px;height:30px;display:inline-block"></span>';
  const inner = `${img}<div><div class="nm">${esc(p.name)}</div><div class="meta">${posTag(p.pos)}<span>${esc(p.school || '')}</span></div></div>`;
  return href ? `<a class="pcell" href="${href}">${inner}</a>` : `<span class="pcell">${inner}</span>`;
}
