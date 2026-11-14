// College player profile: full career stats + advanced metrics, breakout age, dominator, combine and Prospect Score.
import { S, rows } from '../store.js';
import { loadProspects, loadCareer, prospectByCid, loadPahowdy, CM, C_PROFILE, COUNT_STATS, fmtC, fmtRow, collegeHeadshot, stars, mockText } from '../college.js';
import { pahowdyCard } from '../pahowdy.js';
import { esc, fmtInt, fmt1, fmtPct, heat, table } from '../ui.js';
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
  // full career (every season since 2019, including low-volume years) for anyone, prospect or not
  const info = await loadCareer(cid);
  const career = info.s.length ? info.s : [...(data.careers?.[cid] || [])].sort((a, b) => a.season - b.season);
  if (!career.length && !p) { el.innerHTML = '<div class="empty">No college data for this player. <a class="link" href="#/college">Back to college analytics</a></div>'; return; }
  const last = career[career.length - 1] || {};
  const pos = p?.pos || last.pos;
  const name = p?.name || last.name;
  const nfl = p?.sid && S.byId.get(p.sid) ? S.byId.get(p.sid) : [...S.byId.values()].find(x => x.espn === cid);
  const row = nfl ? S.rowById.get(nfl.id) : null;
  const ht = p?.ht ?? last.ht, wt = p?.wt ?? last.wt;
  const best = career.filter(s => s.q).sort((a, b) => scoreOf(b) - scoreOf(a))[0] || last;
  const bk = p?.brk ?? info.bk, rc = p?.recruit ?? info.rc;
  const schools = [...new Set(career.map(s => s.team).filter(Boolean))];
  // NFL draft eligibility: three years out of high school
  const eli = info.el || (p?.elig ? { year: p.elig, hs: p.hs } : null);
  const { current, upcoming } = data.meta;
  const elig = !eli ? null : nfl ? { chip: null, dl: 'now in the NFL' }
    : eli.year > upcoming ? { chip: `Draft-eligible in ${eli.year}`, dl: `can’t enter the ${upcoming} draft` }
      : eli.year === upcoming ? { chip: `Draft-eligible in ${eli.year} (first year)`, dl: last.season === current ? 'can declare after this season' : '' }
        : { chip: `Draft-eligible since ${eli.early ? '≤' : ''}${eli.year}${last.season === current ? ' · returned to school' : ''}`, dl: last.season === current ? 'already eligible; went back to school' : '' };

  el.innerHTML = `
    <p class="small" style="margin:0 0 10px"><a class="link" href="#/college?pos=${pos}">← College analytics</a>${p ? ` · <a class="link" href="#/prospects?class=${p.draftClass}">${p.draftClass} prospects</a>` : ''}</p>
    <div class="card"><div class="phead">
      <img class="hs" src="${esc(nfl?.sid ? `https://sleepercdn.com/content/nfl/players/thumb/${nfl.sid}.jpg` : last.hs || collegeHeadshot(cid))}" alt="" onerror="this.style.visibility='hidden'" style="width:96px;height:96px">
      <div style="flex:1;min-width:240px">
        <h1>${esc(name)}</h1>
        <div class="chips">
          <span><span class="pos" data-pos="${pos}">${pos}</span></span>
          <span>${esc(schools.join(' → ') || p?.school || '')}</span>
          ${last.cls ? `<span>${esc(last.cls)} in ${last.season}</span>` : ''}
          ${ht ? `<span>${Math.floor(ht / 12)}'${ht % 12}"${wt ? `, ${wt} lb` : ''}</span>` : ''}
          ${elig?.chip ? `<span>${elig.chip}</span>` : ''}
          ${p?.age != null ? `<span>Age ${p.ageEst ? '~' : ''}${fmt1(p.age)} on draft day</span>` : ''}
          ${rc ? `<span>${stars(rc.stars)} recruit (${rc.year})</span>` : ''}
          ${p?.draft ? `<span>Drafted ${p.draftClass} R${p.draft.r} #${p.draft.p} (${esc(p.draft.team)})</span>` : p ? `<span>${p.draftClass} draft class</span>` : ''}
        </div>
      </div>
      ${nfl ? `<a class="btn" href="#/player/${encodeURIComponent(nfl.id)}">NFL profile →</a>` : ''}
    </div></div>
    ${profileTiles(pos, bk, rc, info.best, career, eli, elig)}
    ${p ? prospectTiles(p, row) : ''}
    <div class="grid2">
      <div class="card"><h2>Best season vs ${pos}s · ${best.season ?? ''}</h2>${percentiles(pos, best)}</div>
      ${p?.combine ? `<div class="card"><h2>Combine</h2>${combineCard(p)}</div>` : `<div class="card"><h2>Breakout</h2>${breakoutText(bk, pos)}</div>`}
    </div>
    <div class="card"><h2>College career</h2><div class="tablewrap" style="box-shadow:none">${careerTable(pos, career)}</div>
      <p class="muted small" style="margin:8px 0 0">Every season since 2019, including low-volume years. Shading compares each season with qualified FBS ${pos}s that year (shown once a season has enough volume). Source: ESPN college play-by-play via sportsdataverse.</p></div>`;
  // Pahowdy's Prospect Database: only in the copy of the app on your computer (personal-use data)
  if (S.mode === 'server') {
    const ph = await loadPahowdy();
    const rec = ph?.byCid.get(cid) || (nfl ? ph?.bySid.get(String(nfl.id)) : null);
    if (rec) el.insertAdjacentHTML('beforeend', pahowdyCard(rec, ph.meta));
  }
}

const scoreOf = s => Object.values(s.pct || {}).reduce((a, b) => a + b, 0);
const tile = (lbl, val, dl) => `<div class="tile"><div class="lbl">${lbl}</div><div class="val">${val ?? '—'}</div><div class="dl">${dl || ''}</div></div>`;

function profileTiles(pos, bk, rc, bestDom, career, el, elig) {
  const sum = k => career.reduce((s, x) => s + (x[k] || 0), 0);
  const totals = pos === 'QB' ? `${fmtInt(sum('pyd'))} pass yds · ${sum('ptd')} TD · ${fmtInt(sum('qruyd'))} rush yds`
    : pos === 'RB' ? `${fmtInt(sum('ruyd'))} rush yds · ${fmtInt(sum('reyd'))} rec yds · ${sum('rutd') + sum('retd')} TD`
      : `${sum('rec')} rec · ${fmtInt(sum('reyd'))} yds · ${sum('retd')} TD`;
  return `<div class="tiles">
    ${pos !== 'QB' ? tile('Breakout age', bk?.none ? 'None' : bk?.age != null ? `${bk.est ? '~' : ''}${fmt1(bk.age)}` : '—', bk?.none ? 'no featured season yet' : bk?.season ? `${bk.season} as a ${esc(bk.cls || '?')}${bk.est ? ' · estimated age' : ''}` : '') : ''}
    ${pos !== 'QB' ? tile('Best dominator', bestDom != null ? fmtPct(bestDom, 1) : '—', pos === 'RB' ? 'share of team scrimmage yds + TDs' : 'share of team receiving yds + TDs') : ''}
    ${tile('Recruiting', rc ? stars(rc.stars) : '—', rc ? `${rc.year} class · grade ${rc.grade}` : 'no match found')}
    ${tile('College career', `${career.length} season${career.length === 1 ? '' : 's'}`, totals)}
    ${el ? tile('First NFL draft', `${el.early ? '≤' : ''}${el.year}`, [`high-school class of ${el.early ? '≤' : ''}${el.hs} + 3 years`, elig?.dl].filter(Boolean).join(' · ')) : ''}
  </div>`;
}

// where the projected pick comes from: the online mocks when they list him, otherwise the draft model
function projNote(p) {
  const pr = p.proj, model = pr.model === undefined ? pr.pick : pr.model;
  const m = model ? `model #${model}` : 'model: undrafted';
  if (p.mock) return `online mocks, ${mockText(p.mock)} (our ${m}), if he declares`;
  if (pr.model !== undefined) return `not in the online mocks · ${m}, placed after their top 40, if he declares`;
  return pr.pick ? `${p.pos}${pr.posRank} of the class by the draft model, if he declares`
    : `${p.pos}${pr.posRank} of the class by the draft model: past the number of ${p.pos}s usually drafted (stats only; it can’t see tape)`;
}

function prospectTiles(p, row) {
  const c = p.comps || {};
  return `<div class="tiles">
    ${tile('Prospect score', p.score, `${p.draftClass} class · ${p.status === 'drafted' ? 'drafted' : p.status === 'combine' ? 'combine invitee' : p.status === 'devy' ? 'devy board' : 'big board'}`)}
    ${tile('Production', c.prod, 'percentile vs prospects at the position')}
    ${p.pos !== 'QB' ? tile('Breakout score', c.brk, 'earlier breakout = higher') : ''}
    ${tile('Athleticism', c.ath, p.combine ? 'combine percentile' : 'no combine data yet')}
    ${p.draft ? tile('Draft capital', c.dc, `pick ${p.draft.p}`)
      : p.proj ? tile('Projected NFL pick', p.proj.pick ? `R${p.proj.round} · #${p.proj.pick}` : 'UDFA', projNote(p))
        : tile('Recruiting score', c.rec, '')}
    ${row?.market ? tile('Dynasty value', fmtInt(row.market), `market rank #${row.mktRank}`) : ''}
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

function breakoutText(bk, pos) {
  if (pos === 'QB') return '<p class="muted">Breakout isn’t measured for quarterbacks.</p>';
  if (bk?.none) return '<p>No breakout season yet (WR: 20%+ dominator, TE: 12%+, RB: 20%+ of team scrimmage yards).</p>';
  if (!bk) return '<p class="muted">Not enough qualified seasons yet.</p>';
  return `<p>Broke out in <b>${bk.season}</b> as a <b>${esc(bk.cls || '?')}</b>${bk.age != null ? ` at age <b>${bk.est ? '~' : ''}${fmt1(bk.age)}</b>` : ''}. Earlier breakouts are a strong signal of NFL success.</p>
    ${bk.est ? '<p class="muted small">Age is estimated from the high-school recruiting class (college rosters rarely list birth dates); it becomes exact once the player is drafted.</p>' : ''}`;
}

function careerTable(pos, career) {
  const keys = {
    WR: ['g', 'tgt', 'rec', 'reyd', 'retd', 'tsh', 'dom', 'yprr', 'yptpa', 'epat', 'rec20r'],
    TE: ['g', 'tgt', 'rec', 'reyd', 'retd', 'tsh', 'dom', 'yprr', 'yptpa', 'epat', 'rec20r'],
    RB: ['g', 'car', 'ruyd', 'rutd', 'ypc', 'exp10', 'stuff', 'brk', 'rec', 'reyd', 'scsh', 'rdom', 'epar'],
    QB: ['g', 'pa', 'pyd', 'ptd', 'int', 'ypa', 'epap', 'cpoe', 'qcar', 'qruyd', 'qypc', 'rutd'],
  }[pos] || [];
  const cols = [
    { key: 'season', label: 'Season', cell: s => `<td>${s.season}</td>` },
    { key: 'team', label: 'School', cell: s => `<td>${esc(s.team || '—')}</td>` },
    { key: 'cls', label: 'Class', cell: s => `<td>${esc(s.cls || '—')}</td>` },
    ...keys.map(k => ({ key: k, label: CM[k].label, n: true, title: CM[k].desc, cell: s => { const p = COUNT_STATS.has(k) || !s.q ? null : s.pct?.[k]; return `<td class="n${p != null ? ' heat' : ''}" style="${p != null ? heat(p) : ''}">${fmtRow(k, s)}</td>`; } })),
  ];
  return table({ cols, rows: career });
}
