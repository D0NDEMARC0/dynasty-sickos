// Rookie & prospect classes: Prospect Score, consensus rankings, ADP, and mock drafts (generic or your league).
import { S, rows } from '../store.js';
import { loadProspects, collegeHeadshot, stars } from '../college.js';
import { consensus, genericSlots, leagueSlots, runMock } from '../mock.js';
import { esc, fmtInt, fmt1, heat, posTag, table, sortRows } from '../ui.js';
import { mount } from './common.js';

const st = { cls: null, view: 'rankings', pos: 'ALL', q: '', sort: 'mock', dir: 'asc', limit: 150, rounds: 4, mockSrc: 'league' };

export async function render(root, params, query) {
  const el = mount(root);
  el.innerHTML = '<div class="empty"><span class="spinner"></span> Loading prospects…</div>';
  let data;
  try { data = await loadProspects(); } catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  rows();
  const { meta } = data;
  const classes = Object.keys(meta.classes).map(Number).sort((a, b) => b - a);
  if (query.class) st.cls = Number(query.class);
  if (query.view) st.view = query.view === 'mock' ? 'mock' : 'rankings';
  if (!classes.includes(st.cls)) st.cls = classes[0];
  const sf = S.settings.qb === 2;
  const classList = data.prospects.filter(p => p.draftClass === st.cls);
  const history = data.prospects.filter(p => p.status === 'drafted' && p.draftClass !== st.cls);
  const { board, used } = consensus(classList, { sf, history });
  const mockRank = new Map(board.map(x => [x.p, x.rank]));

  const status = meta.classes[st.cls]?.status;
  const note = () => {
    const basis = `<b>Mock order</b> blends ${used.join(', ')}${used.length === 1 ? ' only — real ADP and expert rankings are added automatically as they’re published (FantasyPros rookie rankings usually in winter, Sleeper rookie ADP once rookie drafts start after the NFL Draft)' : ''}.`;
    if (status === 'watch') return `<b>${st.cls} class — before the combine.</b> Draft-eligible juniors and seniors producing this season. In early March the list switches to official combine invitees, and after the NFL Draft in late April to the drafted class — automatically. ${basis}`;
    if (status === 'combine') return `<b>${st.cls} class — combine invitees.</b> Draft capital is added automatically after the NFL Draft. ${basis}`;
    return `<b>${st.cls} draft class.</b> ${basis}`;
  };

  el.innerHTML = `
    <div class="page-head"><div>
      <h1>Rookies & prospects</h1>
      <p class="sub">Prospect Scores, consensus rankings, ADP and mock drafts for the incoming class and recent rookie classes.</p>
    </div></div>
    <div class="toolbar">
      <div class="seg" data-k="cls">${classes.map(c => `<button data-v="${c}" class="${c === st.cls ? 'on' : ''}">${c}${meta.classes[c].status !== 'drafted' ? ' ★' : ''}</button>`).join('')}</div>
      <div class="seg" data-k="view"><button data-v="rankings" class="${st.view === 'rankings' ? 'on' : ''}">Rankings</button><button data-v="mock" class="${st.view === 'mock' ? 'on' : ''}">Mock draft</button></div>
      ${st.view === 'rankings'
        ? `<div class="seg" data-k="pos">${['ALL', 'QB', 'RB', 'WR', 'TE'].map(p => `<button data-v="${p}" class="${st.pos === p ? 'on' : ''}">${p === 'ALL' ? 'All' : p}</button>`).join('')}</div>
           <input type="search" placeholder="Search player or school" value="${esc(st.q)}" data-k="q">`
        : `<div class="seg" data-k="rounds">${[3, 4, 5].map(r => `<button data-v="${r}" class="${st.rounds === r ? 'on' : ''}">${r} rounds</button>`).join('')}</div>
           ${S.league ? `<div class="seg" data-k="mockSrc"><button data-v="league" class="${st.mockSrc === 'league' ? 'on' : ''}">My league</button><button data-v="generic" class="${st.mockSrc === 'generic' ? 'on' : ''}">Generic ${S.settings.teams}-team</button></div>` : ''}`}
    </div>
    <p class="note">${note()}</p>
    <div data-body></div>
    <div class="more" data-more></div>`;

  const body = el.querySelector('[data-body]');
  const market = p => (p.sid ? S.rowById.get(p.sid)?.market || null : null);
  const adpOf = p => p.adp?.rookie ?? (sf ? p.adp?.dsf : p.adp?.d1qb) ?? null;

  const drawRankings = () => {
    const q = st.q.trim().toLowerCase();
    let list = classList.filter(p => (st.pos === 'ALL' || p.pos === st.pos) && (!q || p.name.toLowerCase().includes(q) || (p.school || '').toLowerCase().includes(q)));
    const drafted = status === 'drafted';
    const hasAdp = classList.some(p => adpOf(p) != null), hasEcr = classList.some(p => p.ecr);
    const cell = (v, extra = '') => `<td class="n heat" style="${heat(v)}">${v ?? '—'}${extra}</td>`;
    const cols = [
      { key: 'mock', label: 'Mock', n: true, title: 'Consensus mock-draft slot (see note above)', sort: p => mockRank.get(p), cell: p => `<td class="rank">${mockRank.get(p) ?? '—'}</td>` },
      { key: 'name', label: 'Player', sort: p => p.name, cell: p => `<td>${playerCell(p)}</td>` },
      { key: 'pos', label: 'Pos', sort: p => p.pos, cell: p => `<td>${posTag(p.pos)}</td>` },
      { key: 'school', label: 'School', sort: p => p.school, cell: p => `<td>${esc(p.school || '—')}</td>` },
      ...(drafted
        ? [{ key: 'draft', label: 'NFL draft', n: true, sort: p => p.draft?.p, cell: p => `<td class="n">${p.draft ? `${p.draft.r}.${String(p.draft.p).padStart(2, '0')} <span class="muted small">${esc(p.draft.team)}</span>` : '—'}</td>` }]
        : [{ key: 'cls', label: 'Class', sort: p => p.cls, cell: p => `<td>${esc(p.cls || '—')}</td>` }]),
      ...(hasAdp ? [{ key: 'adp', label: 'ADP', n: true, title: 'Sleeper ADP from real drafts: rookie-draft ADP when available, otherwise dynasty startup ADP for this QB format', sort: p => adpOf(p), cell: p => `<td class="n">${adpOf(p) != null ? fmt1(adpOf(p)) : '—'}${p.adp?.rookie == null && adpOf(p) != null ? ' <span class="muted small">startup</span>' : ''}</td>` }] : []),
      ...(hasEcr ? [{ key: 'ecr', label: 'Experts', n: true, title: 'FantasyPros dynasty rookie rankings (expert consensus rank)', sort: p => p.ecr?.rank, cell: p => `<td class="n" title="${p.ecr ? `Best ${p.ecr.best}, worst ${p.ecr.worst} · ${p.ecr.date}` : ''}">${p.ecr ? fmt1(p.ecr.rank) : '—'}</td>` }] : []),
      { key: 'age', label: 'Age', n: true, title: 'Age on draft day', sort: p => p.age, cell: p => `<td class="n">${p.age != null ? fmt1(p.age) : '—'}</td>` },
      { key: 'size', label: 'Ht / Wt', n: true, cell: p => `<td class="n">${p.ht ? `${Math.floor(p.ht / 12)}'${p.ht % 12}"` : '—'}${p.wt ? ` / ${p.wt}` : ''}</td>` },
      { key: 'forty', label: '40', n: true, title: '40-yard dash (combine)', sort: p => p.combine?.forty, cell: p => `<td class="n">${p.combine?.forty ?? '—'}</td>` },
      { key: 'rec', label: 'Recruit', title: 'High-school recruiting stars (247 composite grade)', sort: p => p.recruit?.grade, cell: p => `<td class="small" title="${p.recruit ? `Grade ${p.recruit.grade} (${p.recruit.year})` : ''}">${p.recruit ? stars(p.recruit.stars) : '—'}</td>` },
      { key: 'prod', label: 'Production', n: true, title: 'College production & efficiency percentile vs. prospects at the position', sort: p => p.comps?.prod, cell: p => cell(p.comps?.prod) },
      { key: 'brk', label: 'Breakout', n: true, title: 'How early they became a featured producer (by age when known, else class year)', sort: p => p.comps?.brk, cell: p => cell(p.comps?.brk, p.brk?.cls ? ` <span class="muted small">${p.brk.age ? fmt1(p.brk.age) : esc(p.brk.cls)}</span>` : '') },
      { key: 'ath', label: 'Athletic', n: true, title: 'Combine athleticism percentile vs. all combine players at the position since 2000', sort: p => p.comps?.ath, cell: p => cell(p.comps?.ath) },
      ...(drafted ? [{ key: 'dc', label: 'Draft cap', n: true, title: 'Draft capital score from pick number', sort: p => p.comps?.dc, cell: p => cell(p.comps?.dc) }] : []),
      { key: 'score', label: 'Score', n: true, title: 'Prospect Score (0–100)', sort: p => p.score, cell: p => `<td class="n heat" style="${heat(p.score)}"><b>${p.score ?? '—'}</b></td>` },
      { key: 'mkt', label: 'Dynasty value', n: true, title: 'Current dynasty market value (once in the NFL)', sort: p => market(p), cell: p => `<td class="n">${market(p) ? fmtInt(market(p)) : '<span class="muted">—</span>'}</td>` },
    ];
    list = sortRows(list, cols, st.sort, st.dir);
    body.innerHTML = `<div class="tablewrap tall">${table({ cols, rows: list.slice(0, st.limit), sort: st.sort, dir: st.dir, cls: 'pin' })}</div>`;
    el.querySelector('[data-more]').innerHTML = list.length > st.limit ? `<button class="btn" data-act="more">Show more (${list.length - st.limit} left)</button>` : `<span class="muted small">${list.length} prospects · shading = percentile (blue above average, red below)</span>`;
  };

  const drawMock = async () => {
    body.innerHTML = '<div class="empty"><span class="spinner"></span> Running mock draft…</div>';
    el.querySelector('[data-more]').innerHTML = '';
    const useLeague = S.league && st.mockSrc === 'league';
    const { slots, source } = useLeague ? await leagueSlots(st.cls, st.rounds) : genericSlots(S.settings.teams, st.rounds);
    const picks = runMock(board, slots);
    const rounds = [...new Set(picks.map(x => x.round))];
    const info = x => {
      if (!x) return '';
      const p = x.p, bits = [`consensus #${x.rank}`];
      if (p.adp?.rookie != null) bits.push(`ADP ${fmt1(p.adp.rookie)}`);
      if (p.ecr) bits.push(`experts #${fmt1(p.ecr.rank)}`);
      if (p.score != null) bits.push(`score ${p.score}`);
      return bits.join(' · ');
    };
    body.innerHTML = `
      <p class="muted small" style="margin:0 0 10px">${useLeague ? `${esc(S.league.info.name)} · ` : ''}${esc(source)} · ${sf ? 'superflex' : '1QB'} · each team takes the best available player${useLeague ? ', nudged toward its two weakest positions' : ''}.${picks.some(x => x.me) ? ' Your picks are highlighted.' : ''}</p>
      <div class="grid2">${rounds.map(r => `
        <div class="card"><h2>Round ${r}</h2><div class="lineup">${picks.filter(x => x.round === r).map(x => `
          <div class="slot mockpick${x.me ? ' mine' : ''}">
            <span class="sl">${x.round}.${String(x.pick).padStart(2, '0')}</span>
            <div>${x.x ? playerCell(x.x.p) : '<span class="muted">—</span>'}
              <div class="muted small" style="margin-top:2px">${esc(x.team)}${x.via ? ` <span class="muted">(via ${esc(x.via)})</span>` : ''} · ${info(x.x)}</div></div>
            <span></span>
          </div>`).join('')}</div></div>`).join('')}
      </div>`;
  };

  const draw = () => (st.view === 'mock' ? drawMock() : drawRankings());
  draw();

  el.addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (th) { const k = th.dataset.sort; st.dir = st.sort === k ? (st.dir === 'asc' ? 'desc' : 'asc') : ['mock', 'name', 'pos', 'school', 'cls', 'age', 'forty', 'draft', 'adp', 'ecr'].includes(k) ? 'asc' : 'desc'; st.sort = k; draw(); return; }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'more') { st.limit += 150; draw(); return; }
    const seg = b.closest('.seg');
    if (!seg?.dataset.k) return;
    const k = seg.dataset.k;
    if (k === 'cls' || k === 'view') {
      if (k === 'cls') { st.cls = Number(b.dataset.v); st.sort = 'mock'; st.dir = 'asc'; st.limit = 150; }
      else st.view = b.dataset.v;
      location.hash = `#/prospects?class=${st.cls}${st.view === 'mock' ? '&view=mock' : ''}`;
      return;
    }
    st[k] = k === 'rounds' ? Number(b.dataset.v) : b.dataset.v;
    st.limit = 150;
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    draw();
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
