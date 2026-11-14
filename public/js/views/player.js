// Player profile: dynasty value, analytics percentiles, weekly fantasy points, season history and game log.
import { S, rows, ppg, finish, loadLogs, loadSplits, weekPoints, scoringLabel } from '../store.js';
import { M, PROFILE, metricValue } from '../metrics.js';
import { esc, fmtInt, fmt1, fmtPct, headshot, injTag, signalTag, tipRows, table, heat } from '../ui.js';
import { columns, pctBars } from '../charts.js';
import { mount, isRookie } from './common.js';
import { loadProspects, loadCareer, prospectByCid, loadPahowdy, CM, fmtRow } from '../college.js';
import { pahowdyCard } from '../pahowdy.js';

export async function render(root, params, query) {
  rows();
  const p = S.byId.get(decodeURIComponent(params.id));
  const el = mount(root);
  if (!p) { el.innerHTML = '<div class="empty">Player not found. <a class="link" href="#/rankings">Back to rankings</a></div>'; return; }
  const r = S.rowById.get(p.id);
  const years = Object.keys(p.seasons).map(Number).sort((a, b) => b - a);
  const season = query.season && p.seasons[query.season] ? Number(query.season) : years[0];
  const s = season ? p.seasons[season] : null;
  const ht = p.ht ? `${Math.floor(p.ht / 12)}'${p.ht % 12}"` : null;
  const draft = p.draft ? `${p.draft.y} R${p.draft.r} #${p.draft.p}` : p.rookie ? `Undrafted (${p.rookie})` : null;
  const v = r?.v;

  el.innerHTML = `
    <div class="card">
      <div class="phead">
        ${headshot(p, 96)}
        <div style="flex:1;min-width:240px">
          <h1>${esc(p.name)} ${injTag(p.inj)} ${isRookie(p) ? '<span class="tag rk">Rookie</span>' : ''}</h1>
          <div class="chips">
            <span><span class="pos" data-pos="${p.pos}">${p.pos}</span>${r?.posRank ? ` ${r.posRank}` : ''}</span>
            <span>${esc(p.team || 'Free agent')}</span>
            ${p.age ? `<span>Age ${p.age.toFixed(1)}</span>` : ''}
            ${ht ? `<span>${ht}${p.wt ? `, ${p.wt} lb` : ''}</span>` : ''}
            ${draft ? `<span>Drafted ${esc(draft)}</span>` : ''}
            ${p.college ? `<span>${esc(p.college)}</span>` : ''}
            ${p.yexp != null ? `<span>${p.yexp === 0 ? 'Rookie season' : `${p.yexp} yr exp`}</span>` : ''}
          </div>
        </div>
        <div>${signalTag(r?.signal, r?.mult)}</div>
      </div>
    </div>
    <div class="tiles">
      <div class="tile"><div class="lbl">Lab value</div><div class="val">${fmtInt(r?.lab)}</div><div class="dl">${r?.labRank ? `#${r.labRank} overall · ${p.pos}${r.posRank}` : 'Not ranked'}</div></div>
      <div class="tile"><div class="lbl">Market value</div><div class="val">${fmtInt(r?.market)}</div><div class="dl">${v?.fc ? `FantasyCalc ${fmtInt(v.fc)}` : ''}${v?.dp ? ` · DP ${fmtInt(v.dp)}` : ''}${v?.trend ? ` · 30d ${v.trend > 0 ? '+' : ''}${fmtInt(v.trend)}` : ''}</div></div>
      <div class="tile"><div class="lbl">Analytics score</div><div class="val">${p.an ?? '—'}</div><div class="dl">${p.anTrend != null ? `${p.anTrend >= 0 ? '+' : ''}${p.anTrend} vs last season` : '3-season blend'}</div></div>
      <div class="tile"><div class="lbl">Age score</div><div class="val">${r?.ageS ?? '—'}</div><div class="dl">Peak window remaining</div></div>
      <div class="tile"><div class="lbl">${esc(scoringLabel())} PPG · ${season ?? '—'}</div><div class="val">${fmt1(s ? ppg(p, s) : null)}</div><div class="dl">${s ? `${p.pos}${finish(p, season) ?? '—'} finish · ${s.g} games` : 'No games yet'}</div></div>
    </div>
    ${years.length ? `
    <div class="toolbar"><span class="muted small">Season</span><div class="seg" data-k="season">${years.map(y => `<button data-v="${y}" class="${y === season ? 'on' : ''}">${y}</button>`).join('')}</div></div>
    <div class="grid2">
      <div class="card"><h2>Percentiles vs ${p.pos}s · ${season}</h2>${percentiles(p, s)}
        ${s?.routesEst ? '<p class="muted small" style="margin:10px 0 0">Routes-based stats are estimated for this season (see Methodology).</p>' : ''}
        ${s?.ext ? `<p class="muted small" style="margin:10px 0 0">Includes imported ${esc(s.ext.src)} data.</p>` : ''}
      </div>
      <div class="card"><h2>Weekly fantasy points · ${season}</h2><div data-weekly><span class="spinner"></span></div></div>
    </div>
    <div data-splits></div>
    <div class="card"><h2>Season history</h2><div class="tablewrap" style="box-shadow:none">${history(p, years)}</div></div>
    <div class="card"><h2>Game log · ${season}</h2><div class="tablewrap" style="box-shadow:none" data-log><span class="spinner"></span></div></div>`
    : '<div class="card empty">No NFL stats yet — value is driven by market price and age.</div>'}
    <div data-college></div>
    <div data-pahowdy></div>`;

  el.addEventListener('click', e => {
    const b = e.target.closest('.seg[data-k="season"] button');
    if (b) location.hash = `#/player/${encodeURIComponent(p.id)}?season=${b.dataset.v}`;
  });

  collegeCard(el.querySelector('[data-college]'), p);
  pahowdyBox(el.querySelector('[data-pahowdy]'), p);
  if (!season) return;
  if (s && S.meta.splitSeasons?.includes(season)) {
    loadSplits(season).then(all => {
      const x = all[p.id], box = el.querySelector('[data-splits]');
      if (x && box) box.innerHTML = splitsCard(p, { ...s, season, split: x.sp, rtree: x.rt, qsplit: x.qs, splitEst: x.est });
    });
  }
  const logs = await loadLogs(season);
  const games = logs[p.id] || [];
  const avg = s && s.g ? ppg(p, s) : null;
  const data = games.map(g => {
    const pts = weekPoints(p, g);
    return {
      label: String(g[0]), v: pts,
      tip: tipRows(`Week ${g[0]} vs ${g[1]}`, [['Points', pts.toFixed(1)], ['Pos rank', g[17] ? `${p.pos}${g[17]}` : '—'], ['Snap share', g[16] != null ? fmtPct(g[16]) : '—'], ...lineFor(p.pos, g)]),
    };
  });
  const wk = el.querySelector('[data-weekly]');
  if (wk) wk.innerHTML = columns({ data, avg, avgLabel: 'Avg', w: Math.max(300, wk.clientWidth), h: 250, yFmt: x => x.toFixed(x % 1 && Math.abs(x) < 10 ? 1 : 0) })
    + `<div class="muted small">${scoringLabel()}${S.settings.scoring === 'league' ? ' (weekly bars exclude fumbles, 2-pt and first-down bonuses)' : ''} · line = season average · hover a week for details</div>`;
  const lg = el.querySelector('[data-log]');
  if (lg) lg.innerHTML = gameLog(p, games);
}

/** Pahowdy's Prospect Database card — only in the copy of the app on your computer (personal-use data). */
async function pahowdyBox(box, p) {
  if (!box || S.mode !== 'server') return;
  const ph = await loadPahowdy();
  const rec = ph?.bySid.get(String(p.id)) || (p.espn ? ph?.byCid.get(String(p.espn)) : null);
  if (rec) box.innerHTML = pahowdyCard(rec, ph.meta);
}

/** College career summary for players we have college data for (recent draft classes). */
async function collegeCard(box, p) {
  if (!box || !p.espn) return;
  let data, info;
  try { [data, info] = await Promise.all([loadProspects(), loadCareer(p.espn)]); } catch { return; }
  const career = info.s.length ? info.s : [...(data.careers?.[p.espn] || [])].sort((a, b) => a.season - b.season);
  const pr = prospectByCid(p.espn);
  if (!career.length && !pr) return;
  const keys = { WR: ['rec', 'reyd', 'retd', 'tsh', 'dom', 'yprr', 'epat'], TE: ['rec', 'reyd', 'retd', 'tsh', 'dom', 'yprr', 'epat'],
    RB: ['car', 'ruyd', 'rutd', 'ypc', 'exp10', 'reyd', 'rdom'], QB: ['pa', 'pyd', 'ptd', 'int', 'ypa', 'epap', 'qcar', 'qypc'] }[p.pos] || [];
  const cols = [
    { key: 's', label: 'Season', cell: x => `<td>${x.season}</td>` },
    { key: 't', label: 'School', cell: x => `<td>${esc(x.team || '—')}</td>` },
    { key: 'c', label: 'Class', cell: x => `<td>${esc(x.cls || '—')}</td>` },
    ...keys.map(k => ({ key: k, label: CM[k].label, n: true, title: CM[k].desc, cell: x => `<td class="n">${fmtRow(k, x)}</td>` })),
  ];
  const bk = pr?.brk ?? info.bk, rc = pr?.recruit ?? info.rc;
  const facts = [
    pr ? `Prospect score <b>${pr.score ?? '—'}</b> (${pr.draftClass} class)` : null,
    p.pos !== 'QB' && bk?.age != null ? `breakout age <b>${bk.est ? '~' : ''}${bk.age.toFixed(1)}</b> (${bk.season})` : p.pos !== 'QB' && bk?.none ? 'no college breakout season' : null,
    p.pos !== 'QB' && info.best != null ? `best dominator <b>${(info.best * 100).toFixed(1)}%</b>` : null,
    rc ? `${'★'.repeat(rc.stars || 0)} recruit` : null,
    pr?.combine?.forty ? `${pr.combine.forty}s 40` : null,
  ].filter(Boolean).join(' · ');
  box.innerHTML = `<div class="card"><div class="chart-head"><h2 style="margin:0">College career</h2><a class="btn" href="#/college/player/${p.espn}">Full college profile →</a></div>
    ${facts ? `<p class="small" style="margin:0 0 10px">${facts}</p>` : ''}
    ${career.length ? `<div class="tablewrap" style="box-shadow:none">${table({ cols, rows: career })}</div>` : ''}</div>`;
}

function percentiles(p, s) {
  if (!s) return '';
  const items = (PROFILE[p.pos] || []).filter(k => metricValue(s, k) != null && (s.pct?.[k] != null || !k.startsWith('x_')))
    .map(k => ({ label: M[k].label, value: M[k].fmt(metricValue(s, k)), pct: s.pct?.[k] ?? null, desc: `${M[k].desc} · ${M[k].src}`, pos: p.pos }));
  const head = `<div class="pbar" style="margin-bottom:2px"><span></span><span class="muted small">0 ← percentile → 100</span><span class="v muted small">Value</span><span class="p small">Pct</span></div>`;
  const score = s.score != null ? `<p class="small" style="margin:0 0 10px">Season Analytics Score <b>${s.score}</b>${s.q ? '' : ' <span class="muted">(small sample, shrunk toward 35)</span>'}</p>` : '';
  return score + head + pctBars(items);
}

// Coverage, blitz and motion splits (receivers: routes, targets, yards; QBs: EPA per dropback), plus the route tree.
const SPLIT_ROWS = [
  ['M', 'vs man coverage'], ['Z', 'vs zone coverage'],
  ['C0', 'Cover 0', 'man, no deep safety'], ['C1', 'Cover 1', 'man, one deep safety'], ['C2M', 'Cover 2 man', 'man under two deep safeties'],
  ['C2', 'Cover 2', 'zone, two deep'], ['C3', 'Cover 3', 'zone, three deep'], ['C4', 'Cover 4', 'quarters: four deep'], ['C6', 'Cover 6', 'quarter-quarter-half'], ['C9', 'Cover 9'],
  ['BL', 'vs blitz', '5+ pass rushers'], ['NB', 'no blitz', '4 or fewer rushers'], ['MO', 'with pre-snap motion'], ['NM', 'no motion'],
];
const QB_ROWS = [['M', 'vs man coverage'], ['Z', 'vs zone coverage'], ['BL', 'vs blitz', '5+ pass rushers'], ['NB', 'no blitz', '4 or fewer rushers'], ['CL', 'clean pocket'], ['PR', 'pressured']];
const routeName = r => r.toLowerCase().replace(/(^|[\s/])\w/g, c => c.toUpperCase()).replace('/', ' / ');
// shade a split by how it compares to his own overall rate: blue above, red below (±50% = full color)
const vsOwn = (v, base) => (v == null || !base ? '' : heat(Math.max(0, Math.min(100, 50 + 100 * (v / base - 1)))));
const label = ([, name, hint]) => `${esc(name)}${hint ? ` <span class="muted small">${esc(hint)}</span>` : ''}`;

function splitsCard(p, s) {
  if (!s) return '';
  if (p.pos === 'QB') {
    const q = s.qsplit;
    if (!q) return '';
    const rowsQ = QB_ROWS.filter(([k]) => q[k]);
    return `<div class="card"><h2>Splits · ${esc(String(s.season ?? ''))}</h2>
      <div class="tablewrap" style="box-shadow:none"><table class="data"><thead><tr><th>Split</th><th class="n">Dropbacks</th><th class="n" title="Expected points added per dropback">EPA/DB</th></tr></thead><tbody>
      ${rowsQ.map(row => { const [n, e] = q[row[0]]; return `<tr><td>${label(row)}</td><td class="n">${fmtInt(n)}</td><td class="n heat" style="${n >= 40 ? vsOwn(e - (s.epadb ?? 0) + 1, 1) : ''}">${n >= 40 ? `${e > 0 ? '+' : ''}${e.toFixed(2)}` : '<span class="muted">—</span>'}</td></tr>`; }).join('')}
      </tbody></table></div>
      <p class="muted small" style="margin:8px 0 0">Shading compares each split with his overall EPA per dropback (${s.epadb != null ? `${s.epadb > 0 ? '+' : ''}${s.epadb.toFixed(2)}` : '—'}). Needs 40+ dropbacks. Coverage and pressure tags are published after each season; the blitz split is charted within two days of each game. Data: FTN Data via nflverse.</p></div>`;
  }
  const sp = s.split, rt = s.rtree;
  if (!sp && !rt) return '';
  const total = s.routes || 0;
  const splitTable = !sp ? '' : `
    <h3 style="margin:0 0 6px">Coverage, blitz and motion</h3>
    <div class="tablewrap" style="box-shadow:none"><table class="data"><thead><tr><th>Split</th><th class="n">Routes</th><th class="n" title="Share of his routes">% routes</th><th class="n">Tgt</th><th class="n">Yds</th><th class="n" title="Yards per route run">YPRR</th><th class="n" title="Targets per route run">TPRR</th></tr></thead><tbody>
    ${SPLIT_ROWS.filter(([k]) => sp[k]).map(row => {
      const [rts, tgt, yds] = sp[row[0]];
      const ok = rts >= 40, yprr = ok ? yds / rts : null, tprr = ok ? tgt / rts : null;
      return `<tr${row[0] === 'C0' || row[0] === 'BL' || row[0] === 'MO' ? ' class="sep-top"' : ''}><td>${label(row)}</td><td class="n">${fmtInt(rts)}${s.splitEst && ['BL', 'NB', 'MO', 'NM'].includes(row[0]) ? '<span class="muted">*</span>' : ''}</td><td class="n">${total ? fmtPct(rts / total) : '—'}</td><td class="n">${tgt}</td><td class="n">${fmtInt(yds)}</td>
        <td class="n heat" style="${vsOwn(yprr, s.yprr)}">${yprr != null ? yprr.toFixed(2) : '<span class="muted">—</span>'}</td><td class="n heat" style="${vsOwn(tprr, s.tprr)}">${tprr != null ? fmtPct(tprr) : '<span class="muted">—</span>'}</td></tr>`;
    }).join('')}
    </tbody></table></div>
    <p class="muted small" style="margin:8px 0 14px">Shading compares each split with his own overall YPRR (${s.yprr != null ? s.yprr.toFixed(2) : '—'}) and TPRR (${s.tprr != null ? fmtPct(s.tprr) : '—'}). Rates need 40+ routes. ${s.splitEst ? '* Routes estimated from his team’s blitz and motion rates: coverage tags and play-level participation for this season are published after it ends.' : 'Routes vs a split = his on-field dropbacks with that tag × his position’s route rate.'}</p>`;
  const rtTotal = rt ? Object.values(rt).reduce((n, a) => n + a[0], 0) : 0;
  const routeTable = !rt ? '' : `
    <h3 style="margin:0 0 6px">Targets by route</h3>
    <div class="tablewrap" style="box-shadow:none"><table class="data"><thead><tr><th>Route</th><th class="n">Tgt</th><th class="n" title="Share of his route-tagged targets">% tgt</th><th class="n">Catch %</th><th class="n" title="Yards per target">Yds/tgt</th></tr></thead><tbody>
    ${Object.entries(rt).sort((a, b) => b[1][0] - a[1][0]).map(([name, [t, c, y]]) => `<tr><td>${esc(routeName(name))}</td><td class="n">${t}</td><td class="n">${fmtPct(t / rtTotal)}</td><td class="n">${fmtPct(c / t)}</td><td class="n">${(y / t).toFixed(1)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted small" style="margin:8px 0 0">The route he ran on each target (charting only tags the targeted receiver’s route, so untargeted routes aren’t counted). Data: FTN Data via nflverse.</p>`;
  return `<div class="card"><h2>Splits · ${esc(String(s.season ?? ''))}</h2>${splitTable}${routeTable}</div>`;
}

function lineFor(pos, g) {
  const [, , , , rec, tgt, reyd, retd, car, ruyd, rutd, cmp, att, pyd, ptd, int] = g;
  if (pos === 'QB') return [['Passing', `${cmp}/${att}, ${pyd} yds, ${ptd} TD, ${int} INT`], ['Rushing', `${car}-${ruyd}-${rutd}`]];
  if (pos === 'RB') return [['Rushing', `${car} car, ${ruyd} yds, ${rutd} TD`], ['Receiving', `${rec}/${tgt}, ${reyd} yds, ${retd} TD`]];
  return [['Receiving', `${rec}/${tgt}, ${reyd} yds, ${retd} TD`], ...(car ? [['Rushing', `${car}-${ruyd}-${rutd}`]] : [])];
}

function history(p, years) {
  const pos = p.pos, n = v => `<td class="n">${v ?? '—'}</td>`;
  const f = (k, s) => n(M[k].fmt(metricValue(s, k)));
  const base = [
    { key: 'yr', label: 'Season', cell: y => `<td><a class="link" href="#/player/${encodeURIComponent(p.id)}?season=${y}">${y}</a></td>` },
    { key: 'tm', label: 'Team', cell: y => `<td>${esc(p.seasons[y].team || '—')}</td>` },
    { key: 'g', label: 'G', n: true, cell: y => n(p.seasons[y].g) },
    { key: 'ppg', label: 'PPG', n: true, cell: y => n(fmt1(ppg(p, p.seasons[y]))) },
    { key: 'fin', label: 'Finish', n: true, cell: y => n(finish(p, y) ? `${pos}${finish(p, y)}` : '—') },
  ];
  const b = y => p.seasons[y].box;
  const extra = {
    QB: [['Cmp/Att', y => `${b(y).cmp}/${b(y).att}`], ['Pass yds', y => fmtInt(b(y).pyd)], ['TD', y => b(y).ptd], ['INT', y => b(y).int],
      ['Rush att', y => b(y).car], ['Rush yds', y => fmtInt(b(y).ruyd)], ['YPC', y => (b(y).car ? (b(y).ruyd / b(y).car).toFixed(2) : '—')], ['Rush TD', y => b(y).rutd]],
    RB: [['Car', y => b(y).car], ['Rush yds', y => fmtInt(b(y).ruyd)], ['TD', y => b(y).rutd], ['Rec', y => b(y).rec], ['Rec yds', y => fmtInt(b(y).reyd)], ['Rec TD', y => b(y).retd]],
    WR: [['Tgt', y => b(y).tgt], ['Rec', y => b(y).rec], ['Yds', y => fmtInt(b(y).reyd)], ['TD', y => b(y).retd]],
    TE: [['Tgt', y => b(y).tgt], ['Rec', y => b(y).rec], ['Yds', y => fmtInt(b(y).reyd)], ['TD', y => b(y).retd]],
  }[pos] || [];
  const adv = { QB: ['epadb', 'cpoe', 'padot', 'skr', 'twp'], RB: ['ypc', 'exp10', 'ryoe', 'yaco', 'osh', 'tsh', 'yprr'], WR: ['routes', 'yprr', 'tprr', 'tsh', 'aysh', 'adot', 'sep', 'yacoe'], TE: ['routes', 'yprr', 'tprr', 'tsh', 'rp', 'adot', 'sep'] }[pos] || [];
  const cols = [
    ...base,
    ...extra.map(([label, fn], i) => ({ key: `e${i}`, label, n: true, cell: y => n(fn(y)) })),
    ...adv.map(k => ({ key: k, label: M[k].label, n: true, title: M[k].desc, cell: y => f(k, p.seasons[y]) })),
    { key: 'sc', label: 'Score', n: true, cell: y => n(p.seasons[y].score) },
  ];
  return table({ cols, rows: years });
}

function gameLog(p, games) {
  if (!games.length) return '<div class="empty">No games.</div>';
  const n = v => `<td class="n">${v ?? '—'}</td>`;
  const cols = [
    { key: 'w', label: 'Wk', cell: g => `<td>${g[0]}</td>` },
    { key: 'o', label: 'Opp', cell: g => `<td>${esc(g[1])}</td>` },
    { key: 'pts', label: 'Pts', n: true, cell: g => n(weekPoints(p, g).toFixed(1)) },
    { key: 'rk', label: 'Pos rk', n: true, cell: g => n(g[17] ? `${p.pos}${g[17]}` : '—') },
    { key: 'sn', label: 'Snap %', n: true, cell: g => n(g[16] != null ? fmtPct(g[16]) : '—') },
  ];
  const stat = (label, i) => ({ key: label, label, n: true, cell: g => n(g[i]) });
  if (p.pos === 'QB') cols.push({ key: 'ca', label: 'Cmp/Att', n: true, cell: g => n(`${g[11]}/${g[12]}`) }, stat('Pass yds', 13), stat('TD', 14), stat('INT', 15), stat('Car', 8), stat('Rush yds', 9), stat('Rush TD', 10));
  else if (p.pos === 'RB') cols.push(stat('Car', 8), stat('Rush yds', 9), stat('Rush TD', 10), stat('Tgt', 5), stat('Rec', 4), stat('Rec yds', 6), stat('Rec TD', 7));
  else cols.push(stat('Tgt', 5), stat('Rec', 4), stat('Yds', 6), stat('TD', 7), stat('Car', 8), stat('Rush yds', 9));
  return table({ cols, rows: games });
}
