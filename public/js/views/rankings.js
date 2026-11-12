// Dynasty player rankings: market value adjusted by the analytics + age model, with Buy/Sell signals.
import { S, rows, persist, bump, scoringLabel } from '../store.js';
import { esc, fmtInt, fmt1, posTag, signalTag, minibar, table, sortRows, signed } from '../ui.js';
import { playerCell, anCell, trendCell, isRookie, seasonTag, mount } from './common.js';

const st = { pos: 'ALL', q: '', rookies: false, signal: 'all', sort: 'rank', dir: 'asc', limit: 150, model: false };

export function render(root, params, query) {
  if (query.pos) st.pos = query.pos.toUpperCase();
  const el = mount(root);
  const fmt = `${S.settings.qb === 2 ? 'Superflex' : '1QB'} · ${scoringLabel()} · ${S.settings.teams} teams`;
  el.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Dynasty rankings</h1>
        <p class="sub">Market value (FantasyCalc trade data blended with DynastyProcess consensus), adjusted by each player’s Analytics Score and age window. <span class="muted">${esc(fmt)}</span></p>
      </div>
      <button class="btn" data-act="model">${st.model ? 'Hide' : 'Tune'} model</button>
    </div>
    <div class="card" data-panel ${st.model ? '' : 'hidden'}>
      <div class="panel">
        <div class="slider">
          <label for="anw">Analytics weight <span id="anwv">${Math.round(S.settings.anWeight * 100)}%</span></label>
          <input id="anw" type="range" min="0" max="0.5" step="0.05" value="${S.settings.anWeight}">
          <div class="ends"><span>Pure market</span><span>Heavy analytics</span></div>
          <p>How far a player’s edge (fundamentals rank minus price rank at the player’s position) can move value. At 30%, a +10 edge ≈ +10% and +30 ≈ +35%.</p>
        </div>
        <div class="slider">
          <label for="tilt">Age tilt <span id="tiltv">${tiltLabel(S.settings.ageTilt)}</span></label>
          <input id="tilt" type="range" min="-1" max="1" step="0.25" value="${S.settings.ageTilt}">
          <div class="ends"><span>Win now</span><span>Youth</span></div>
          <p>Neutral trusts the market’s own age pricing. Slide right if you’re rebuilding, left if you’re contending.</p>
        </div>
      </div>
    </div>
    <div class="toolbar">
      <div class="seg" data-k="pos">${['ALL', 'QB', 'RB', 'WR', 'TE'].map(p => `<button data-v="${p}" class="${st.pos === p ? 'on' : ''}">${p === 'ALL' ? 'All' : p}</button>`).join('')}</div>
      <div class="seg" data-k="signal">${[['all', 'All'], ['buy', '▲ Buy'], ['sell', '▼ Sell']].map(([v, l]) => `<button data-v="${v}" class="${st.signal === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input type="search" placeholder="Search player or team" value="${esc(st.q)}" data-k="q">
      <label class="chk"><input type="checkbox" data-k="rookies" ${st.rookies ? 'checked' : ''}> Rookies only</label>
    </div>
    <div class="tablewrap tall" data-table></div>
    <div class="more" data-more></div>
    <p class="note"><b>Analytics</b> is a 0–100 positional percentile blend of the most predictive usage and efficiency stats (see Methodology), across the last three seasons. <b>Edge</b> compares where a player ranks within the position on fundamentals (analytics + age, weighted the way the market weighs age) with where they rank on price, in percentile points; rookies and second-year players are compared against the typical young-player gap. <b>Lab value</b> = market value adjusted by edge and your age tilt. <b>▲ Buy</b> / <b>▼ Sell</b> flag players valued at least 10% above / below market. Edges only appear for rosterable players with a real sample.</p>`;

  const draw = () => {
    const all = rows().filter(r => r.market > 0);
    const maxLab = Math.max(1, ...all.map(r => r.lab));
    const q = st.q.trim().toLowerCase();
    let list = all.filter(r => (st.pos === 'ALL' || r.p.pos === st.pos)
      && (!st.rookies || isRookie(r.p))
      && (st.signal === 'all' || r.signal === st.signal)
      && (!q || r.p.name.toLowerCase().includes(q) || (r.p.team || '').toLowerCase() === q));
    const cols = [
      { key: 'rank', label: '#', n: true, sort: r => r.labRank, cell: r => `<td class="rank">${r.labRank}</td>` },
      { key: 'name', label: 'Player', sort: r => r.p.name, cell: r => `<td>${playerCell(r.p)}</td>` },
      { key: 'pos', label: 'Pos rk', sort: r => r.posRank, cell: r => `<td>${posTag(r.p.pos)} <span class="small">${r.posRank}</span></td>` },
      { key: 'age', label: 'Age', n: true, sort: r => r.p.age, cell: r => `<td class="n">${fmt1(r.p.age)}</td>` },
      { key: 'lab', label: 'Lab value', n: true, title: 'Model-adjusted dynasty value', sort: r => r.lab, cell: r => `<td class="n">${minibar(r.lab, maxLab, fmtInt(r.lab))}</td>` },
      { key: 'market', label: 'Market', n: true, title: 'Blended market value (rank in parentheses)', sort: r => r.market, cell: r => `<td class="n">${fmtInt(r.market)} <span class="muted small">#${r.mktRank}</span></td>` },
      { key: 'signal', label: 'Model vs market', sort: r => r.mult, cell: r => `<td>${signalTag(r.signal, r.mult)}</td>` },
      { key: 'an', label: 'Analytics', n: true, title: 'Analytics Score (0–100, positional percentile blend)', sort: r => r.p.an, cell: r => anCell(r.p) },
      { key: 'edge', label: 'Edge', n: true, title: 'Fundamentals rank minus price rank within the position (percentile points)', sort: r => r.edge, cell: r => `<td class="n ${r.edge > 0 ? 'up' : r.edge < 0 ? 'down' : 'muted'}">${r.edge == null ? '—' : signed(r.edge)}</td>` },
      { key: 'ageS', label: 'Age score', n: true, title: 'Share of a peak 5-year window still ahead (0–100)', sort: r => r.ageS, cell: r => `<td class="n">${r.ageS ?? '—'}</td>` },
      { key: 'ppg', label: 'PPG', n: true, title: `${scoringLabel()} points per game (this season, else last season)`, sort: r => r.ppg, cell: r => `<td class="n">${fmt1(r.ppg)}${r.ppgSeason && r.ppgSeason !== S.meta.current ? ` <span class="muted small">${seasonTag(r.ppgSeason)}</span>` : ''}</td>` },
      { key: 'trend', label: '30d', n: true, title: '30-day change in FantasyCalc value', sort: r => r.v?.trend, cell: r => trendCell(r.v) },
    ];
    list = sortRows(list, cols, st.sort, st.dir);
    el.querySelector('[data-table]').innerHTML = table({ cols, rows: list.slice(0, st.limit), sort: st.sort, dir: st.dir, cls: 'pin' });
    el.querySelector('[data-more]').innerHTML = list.length > st.limit ? `<button class="btn" data-act="more">Show more (${list.length - st.limit} left)</button>` : `<span class="muted small">${list.length} players</span>`;
  };
  draw();

  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const k = th.dataset.sort;
      st.dir = st.sort === k ? (st.dir === 'asc' ? 'desc' : 'asc') : ['rank', 'name', 'pos', 'age'].includes(k) ? 'asc' : 'desc';
      st.sort = k; draw(); return;
    }
    if (!b) return;
    if (b.dataset.act === 'more') { st.limit += 150; draw(); return; }
    if (b.dataset.act === 'model') { st.model = !st.model; el.querySelector('[data-panel]').hidden = !st.model; b.textContent = st.model ? 'Hide model' : 'Tune model'; return; }
    const seg = b.closest('.seg');
    if (seg?.dataset.k) {
      st[seg.dataset.k] = b.dataset.v; st.limit = 150;
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      draw();
    }
  });
  el.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.k === 'q') { st.q = t.value; st.limit = 150; draw(); }
    if (t.dataset.k === 'rookies') { st.rookies = t.checked; draw(); }
    if (t.id === 'anw' || t.id === 'tilt') {
      if (t.id === 'anw') { S.settings.anWeight = Number(t.value); el.querySelector('#anwv').textContent = `${Math.round(t.value * 100)}%`; }
      else { S.settings.ageTilt = Number(t.value); el.querySelector('#tiltv').textContent = tiltLabel(Number(t.value)); }
      persist(); bump(); draw();
    }
  });
}

function tiltLabel(v) {
  if (v === 0) return 'Neutral';
  return `${v < 0 ? 'Win now' : 'Youth'} ${Math.abs(v * 100)}%`;
}
