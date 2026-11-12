// Player profile: dynasty value, analytics percentiles, weekly fantasy points, season history and game log.
import { S, rows, ppg, finish, loadLogs, weekPoints, scoringLabel } from '../store.js';
import { M, PROFILE, metricValue } from '../metrics.js';
import { esc, fmtInt, fmt1, fmtPct, headshot, injTag, signalTag, tipRows, table } from '../ui.js';
import { columns, pctBars } from '../charts.js';
import { mount, isRookie } from './common.js';

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
    <div class="card"><h2>Season history</h2><div class="tablewrap" style="box-shadow:none">${history(p, years)}</div></div>
    <div class="card"><h2>Game log · ${season}</h2><div class="tablewrap" style="box-shadow:none" data-log><span class="spinner"></span></div></div>`
    : '<div class="card empty">No NFL stats yet — value is driven by market price and age.</div>'}`;

  el.addEventListener('click', e => {
    const b = e.target.closest('.seg[data-k="season"] button');
    if (b) location.hash = `#/player/${encodeURIComponent(p.id)}?season=${b.dataset.v}`;
  });

  if (!season) return;
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

function percentiles(p, s) {
  if (!s) return '';
  const items = (PROFILE[p.pos] || []).filter(k => metricValue(s, k) != null && (s.pct?.[k] != null || !k.startsWith('x_')))
    .map(k => ({ label: M[k].label, value: M[k].fmt(metricValue(s, k)), pct: s.pct?.[k] ?? null, desc: `${M[k].desc} · ${M[k].src}`, pos: p.pos }));
  const head = `<div class="pbar" style="margin-bottom:2px"><span></span><span class="muted small">0 ← percentile → 100</span><span class="v muted small">Value</span><span class="p small">Pct</span></div>`;
  const score = s.score != null ? `<p class="small" style="margin:0 0 10px">Season Analytics Score <b>${s.score}</b>${s.q ? '' : ' <span class="muted">(small sample, shrunk toward 35)</span>'}</p>` : '';
  return score + head + pctBars(items);
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
    QB: [['Cmp/Att', y => `${b(y).cmp}/${b(y).att}`], ['Pass yds', y => fmtInt(b(y).pyd)], ['TD', y => b(y).ptd], ['INT', y => b(y).int], ['Rush yds', y => fmtInt(b(y).ruyd)], ['Rush TD', y => b(y).rutd]],
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
