// College player profile: career stats + advanced metrics, percentiles, combine card and Prospect Score.
import { S, rows } from '../store.js';
import { loadProspects, loadCollegeSeason, prospectByCid, CM, C_PROFILE, COUNT_STATS, fmtC, collegeHeadshot, stars } from '../college.js';
import { esc, fmtInt, fmt1, heat, table } from '../ui.js';
import { pctBars } from '../charts.js';
import { mount } from './common.js';

export async function render(root, params) {
  const el = mount(root);
  el.innerHTML = '<div class="empty"><span class="spinner"></span> Loading…</div>';
  const cid = String(params.cid);
  let data;
  try { data = await loadProspects(); } catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  rows();
  const p = prospectByCid(cid);
  let career = data.careers[cid] || [];
  if (!career.length) {
    // not a tracked prospect — use the leaderboard seasons
    for (const y of data.meta.leaderboardSeasons) {
      const s = (await loadCollegeSeason(y)).players.find(x => x.cid === cid);
      if (s) career.push(s);
    }
    career.sort((a, b) => a.season - b.season);
  }
  if (!career.length && !p) { el.innerHTML = '<div class="empty">No college data for this player. <a class="link" href="#/prospects">Back to prospects</a></div>'; return; }
  const last = career[career.length - 1] || {};
  const pos = p?.pos || last.pos;
  const name = p?.name || last.name;
  const nfl = p?.sid && S.byId.get(p.sid) ? S.byId.get(p.sid) : [...S.byId.values()].find(x => x.espn === cid);
  const row = nfl ? S.rowById.get(nfl.id) : null;
  const ht = p?.ht ?? last.ht, wt = p?.wt ?? last.wt;
  const best = career.filter(s => s.q).sort((a, b) => scoreOf(b) - scoreOf(a))[0] || last;

  el.innerHTML = `
    <p class="small" style="margin:0 0 10px"><a class="link" href="#/prospects${p ? `?class=${p.draftClass}` : ''}">← Prospects</a> · <a class="link" href="#/college?pos=${pos}">College analytics</a></p>
    <div class="card"><div class="phead">
      <img class="hs" src="${esc(nfl?.sid ? `https://sleepercdn.com/content/nfl/players/thumb/${nfl.sid}.jpg` : last.hs || collegeHeadshot(cid))}" alt="" onerror="this.style.visibility='hidden'" style="width:96px;height:96px">
      <div style="flex:1;min-width:240px">
        <h1>${esc(name)}</h1>
        <div class="chips">
          <span><span class="pos" data-pos="${pos}">${pos}</span></span>
          <span>${esc(p?.school || last.team || '')}</span>
          ${last.cls ? `<span>${esc(last.cls)} in ${last.season}</span>` : ''}
          ${ht ? `<span>${Math.floor(ht / 12)}'${ht % 12}"${wt ? `, ${wt} lb` : ''}</span>` : ''}
          ${p?.age != null ? `<span>Age ${fmt1(p.age)} on draft day</span>` : ''}
          ${p?.recruit ? `<span>${stars(p.recruit.stars)} recruit (${p.recruit.year})</span>` : ''}
          ${p?.draft ? `<span>Drafted ${p.draftClass} R${p.draft.r} #${p.draft.p} (${esc(p.draft.team)})</span>` : p ? `<span>${p.draftClass} draft class</span>` : ''}
        </div>
      </div>
      ${nfl ? `<a class="btn" href="#/player/${encodeURIComponent(nfl.id)}">NFL profile →</a>` : ''}
    </div></div>
    ${p ? prospectTiles(p, row) : ''}
    <div class="grid2">
      <div class="card"><h2>Best season vs ${pos}s · ${best.season ?? ''}</h2>${percentiles(pos, best)}</div>
      ${p?.combine ? `<div class="card"><h2>Combine</h2>${combineCard(p)}</div>` : `<div class="card"><h2>Breakout</h2>${breakoutText(p, pos)}</div>`}
    </div>
    <div class="card"><h2>College career</h2><div class="tablewrap" style="box-shadow:none">${careerTable(pos, career)}</div>
      <p class="muted small" style="margin:8px 0 0">Shading compares each season with qualified FBS ${pos}s that year. Source: ESPN college play-by-play via sportsdataverse.</p></div>`;
}

const scoreOf = s => Object.values(s.pct || {}).reduce((a, b) => a + b, 0);

function prospectTiles(p, row) {
  const t = (lbl, val, dl) => `<div class="tile"><div class="lbl">${lbl}</div><div class="val">${val ?? '—'}</div><div class="dl">${dl || ''}</div></div>`;
  const c = p.comps || {};
  return `<div class="tiles">
    ${t('Prospect score', p.score, `${p.draftClass} class · ${p.status === 'drafted' ? 'drafted' : p.status === 'combine' ? 'combine invitee' : 'watch list'}`)}
    ${t('Production', c.prod, 'percentile vs prospects at the position')}
    ${t('Breakout', c.brk, p.brk?.none ? 'never broke out' : p.brk?.season ? `${p.brk.season} as a ${p.brk.cls}${p.brk.age ? ` (age ${fmt1(p.brk.age)})` : ''}` : '—')}
    ${t('Athleticism', c.ath, p.combine ? 'combine percentile' : 'no combine data yet')}
    ${p.draft ? t('Draft capital', c.dc, `pick ${p.draft.p}`) : t('Recruiting', c.rec, p.recruit ? `${p.recruit.stars}★ · grade ${p.recruit.grade}` : 'no match')}
    ${row?.market ? t('Dynasty value', fmtInt(row.market), `market rank #${row.mktRank}`) : ''}
  </div>`;
}

function percentiles(pos, s) {
  if (!s || !s.pct) return '<p class="muted">Not enough volume for percentiles.</p>';
  const items = (C_PROFILE[pos] || []).filter(k => s[k] != null).map(k => ({ label: CM[k].label, value: fmtC(k, s[k]), pct: s.pct[k] ?? null, desc: `${CM[k].desc} · ${CM[k].src}`, pos }));
  return `<div class="pbar" style="margin-bottom:2px"><span></span><span class="muted small">0 ← percentile → 100</span><span class="v muted small">Value</span><span class="p small">Pct</span></div>${pctBars(items)}${s.q ? '' : '<p class="muted small" style="margin:8px 0 0">Below the volume needed to qualify — percentiles are indicative only.</p>'}`;
}

function combineCard(p) {
  const c = p.combine;
  const row = (k, v) => (v != null ? `<div class="slot"><span class="sl">${k}</span><span>${v}</span><span></span></div>` : '');
  return `<div class="lineup">
    ${row('40', c.forty ? `${c.forty}s` : null)}
    ${row('Speed', c.ss != null ? `${c.ss} speed score <span class="muted">(${c.ssPct}th pct)</span>` : null)}
    ${row('Vertical', c.vert ? `${c.vert}"` : null)}
    ${row('Broad', c.broad ? `${Math.floor(c.broad / 12)}'${c.broad % 12}"` : null)}
    ${row('3-cone', c.cone ? `${c.cone}s` : null)}
    ${row('Shuttle', c.shuttle ? `${c.shuttle}s` : null)}
    ${row('Bench', c.bench ? `${c.bench} reps` : null)}
    ${row('Overall', c.ath != null ? `<b>${c.ath}</b> athletic percentile vs ${p.pos}s since 2000` : null)}
  </div>`;
}

function breakoutText(p, pos) {
  if (!p) return '<p class="muted">Not in a tracked draft class.</p>';
  if (pos === 'QB') return '<p class="muted">Breakout isn’t scored for quarterbacks.</p>';
  if (p.brk?.none) return '<p>No breakout season yet (WR: 20%+ dominator, TE: 15%+, RB: 20%+ of team scrimmage yards).</p>';
  if (!p.brk) return '<p class="muted">—</p>';
  return `<p>Broke out in <b>${p.brk.season}</b> as a <b>${esc(p.brk.cls || '?')}</b>${p.brk.age ? ` at age <b>${fmt1(p.brk.age)}</b>` : ''}. Earlier breakouts are a strong signal of NFL success.</p><p class="muted small">Athletic testing appears here after the combine in early March.</p>`;
}

function careerTable(pos, career) {
  const keys = {
    WR: ['g', 'tgt', 'rec', 'reyd', 'retd', 'tsh', 'dom', 'yptpa', 'ypt', 'epat', 'exp'],
    TE: ['g', 'tgt', 'rec', 'reyd', 'retd', 'tsh', 'dom', 'yptpa', 'ypt', 'epat', 'exp'],
    RB: ['g', 'car', 'ruyd', 'rutd', 'ypc', 'rec', 'reyd', 'scsh', 'tsh', 'epar', 'exp', 'scpg'],
    QB: ['g', 'pa', 'pyd', 'ptd', 'int', 'ypa', 'epap', 'cpoe', 'psr', 'ruyd'],
  }[pos] || [];
  const cols = [
    { key: 'season', label: 'Season', cell: s => `<td>${s.season}</td>` },
    { key: 'team', label: 'School', cell: s => `<td>${esc(s.team || '—')}</td>` },
    { key: 'cls', label: 'Class', cell: s => `<td>${esc(s.cls || '—')}</td>` },
    ...keys.map(k => ({ key: k, label: CM[k].label, n: true, title: CM[k].desc, cell: s => { const p = COUNT_STATS.has(k) ? null : s.pct?.[k]; return `<td class="n${p != null ? ' heat' : ''}" style="${p != null ? heat(p) : ''}">${fmtC(k, s[k])}</td>`; } })),
  ];
  return table({ cols, rows: career });
}
