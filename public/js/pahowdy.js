// Card for Pahowdy's Prospect Database (only in the copy of the app on your computer — personal use).
import { esc } from './ui.js';

const ord = n => `${n}${['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th'}`;
const n = (v, d = 1) => (v == null ? null : Number(v).toFixed(d));
const pc = (v, d = 1) => (v == null ? null : `${(v * 100).toFixed(d)}%`);
const score = (v, p, pos) => (v == null ? null : `<b>${n(v)}</b>${p != null ? ` <span class="muted small">${ord(p)} percentile of ${pos}s since 2001</span>` : ''}`);

export function pahowdyCard(r, meta) {
  if (!r) return '';
  const rows = [
    ['Pre-draft score', score(r.pre, r.prePct, r.pos)],
    ['Post-draft score', score(r.post, r.postPct, r.pos)],
    ['Production score', score(r.prod, r.prodPct, r.pos)],
    ['Draft', r.dr ? `${r.dy} · round ${r.dr}, pick ${r.dp}` : r.dy ? `${r.dy} class` : null],
    ['Born', r.dob ? new Date(`${r.dob}T12:00:00`).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : null],
  ];
  if (r.pos === 'QB') {
    rows.push(
      ['Accuracy (PFF)', r.acc != null ? `${n(r.acc)}%` : null],
      ['Big-time throws', pc(r.btt)],
      ['Turnover-worthy plays', pc(r.twp)],
      ['Pressure-to-sack', r.p2s != null ? `${n(r.p2s)}%` : null],
      ['aDOT', n(r.qadot)],
      ['QB rating (PFF)', n(r.qrtg)],
      ['Rushing dominator (max)', pc(r.rdom)],
    );
    if (r.att) rows.push(['PFF attempts', Math.round(r.att).toLocaleString()]);
  } else {
    rows.push(['Breakout age', r.bk20 != null || r.bk30 != null ? `${r.bk20 ?? '—'} at 20% dominator · ${r.bk30 ?? '—'} at 30%` : null]);
    rows.push(['Avg dominator', pc(r.dom)]);
    if (r.pos === 'RB') rows.push(['Rushing dominator (max)', pc(r.rdom)], ['Yards after contact / att', n(r.yco, 2)], ['Elusive rating (PFF)', n(r.elu)]);
    rows.push(
      ['College YRR (PFF)', r.yrr != null ? `${n(r.yrr, 2)} career${r.bestYrr != null ? ` · ${n(r.bestYrr, 2)} best season` : ''}` : null],
      ['Target share', pc(r.tgt)],
    );
    if (r.pos !== 'RB') rows.push(['Contested targets', pc(r.ctgt)], ['Slot rate', r.slot != null ? `${n(r.slot)}%` : null], ['aDOT', n(r.adot)]);
    rows.push(['YAC / reception', n(r.yac)]);
  }
  const body = rows.filter(([, v]) => v != null).map(([k, v]) => `<div class="slot"><span class="sl">${k}</span><span>${v}</span><span></span></div>`).join('');
  return `<div class="card"><h2>Pahowdy’s prospect database</h2>
    <div class="lineup">${body}</div>
    <p class="muted small" style="margin:8px 0 0">From <a class="link" href="${esc(meta?.url || '#')}" target="_blank" rel="noopener">Pahowdy’s Prospect Database</a> (${esc(meta?.by || '@pahowdy')}; his scores, Sports-Reference and PFF college data). Personal use: shown only in the copy of this app on your computer, never on the shared site.</p></div>`;
}
