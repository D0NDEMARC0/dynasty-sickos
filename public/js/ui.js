// Small DOM / formatting helpers shared by all views.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtInt = v => (v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString());
export const fmt1 = v => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(1));
export const fmtPct = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`);
export const signed = (v, d = 0, suffix = '') => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}${suffix}`);

// Name search that forgives a letter: "jaden baugh" finds Jadan Baugh, "mestamaker" finds Mestemaker. Each word you
// type has to start a word of the name; words of 4+ letters may have one wrong, missing or extra letter.
// Accents are dropped; apostrophes either vanish or split the word (Ja'Marr = jamarr or ja marr); other punctuation
// splits words.
const normName = (s, apos = '') => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, apos).replace(/[^a-z0-9]+/g, ' ').trim();
const oneOff = (a, b) => {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++d > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return d + (a.length - i) + (b.length - j) <= 1;
};
export function nameMatch(name, q) {
  const n = normName(name), n2 = normName(name, ' '), qq = normName(q);
  if (!qq || n.includes(qq) || n2.includes(qq)) return true;
  const words = [...new Set([...n.split(' '), ...n2.split(' ')])];
  return qq.split(' ').every(t => words.some(w => w.startsWith(t) || (t.length >= 4 && (oneOff(t, w.slice(0, t.length)) || oneOff(t, w)))));
}

export const posTag = pos => (pos ? `<span class="pos" data-pos="${esc(pos)}">${esc(pos)}</span>` : '');

export function injTag(inj) {
  if (!inj) return '';
  const out = /^(Out|IR|PUP|Sus|NFI|Doubtful)$/i.test(inj);
  const short = { Questionable: 'Q', Doubtful: 'D', Out: 'OUT', Sus: 'SUS' }[inj] || inj.toUpperCase();
  return `<span class="tag inj${out ? ' out' : ''}" title="${esc(inj)}">${esc(short)}</span>`;
}

export function headshot(p, size = 32) {
  const src = p?.sid ? `https://sleepercdn.com/content/nfl/players/thumb/${p.sid}.jpg` : p?.hs;
  if (!src) return `<span class="hs" style="width:${size}px;height:${size}px;display:inline-block"></span>`;
  return `<img class="hs" loading="lazy" width="${size}" height="${size}" style="width:${size}px;height:${size}px" src="${esc(src)}" alt="" onerror="this.style.visibility='hidden'">`;
}

/** Diverging tint for a 0–100 percentile: blue above the median, red below, neutral at 50. */
export function heat(pct) {
  if (pct == null) return '';
  const d = (pct - 50) / 50;
  const a = Math.round(Math.min(1, Math.abs(d)) ** 0.9 * 42);
  return `background: color-mix(in oklab, ${d >= 0 ? 'var(--div-pos)' : 'var(--div-neg)'} ${a}%, transparent)`;
}
export function heatSolid(pct) {
  if (pct == null) return 'background: var(--axis)';
  const d = (pct - 50) / 50;
  const a = 30 + Math.round(Math.min(1, Math.abs(d)) * 70);
  return `background: color-mix(in oklab, ${d >= 0 ? 'var(--div-pos)' : 'var(--div-neg)'} ${a}%, var(--div-mid))`;
}

export function signalTag(sig, mult) {
  if (!sig) return '<span class="muted">—</span>';
  const pct = signed((mult - 1) * 100, 0, '%');
  if (sig === 'buy') return `<span class="sig buy" title="Model values this player above market"><span class="ar">▲</span>Buy <span class="muted">${pct}</span></span>`;
  if (sig === 'sell') return `<span class="sig sell" title="Model values this player below market"><span class="ar">▼</span>Sell <span class="muted">${pct}</span></span>`;
  return `<span class="sig hold">${pct}</span>`;
}

export function minibar(value, max, label) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return `<div class="minibar"><span>${label}</span><span class="track"><span class="fill" style="width:${w}%;display:block"></span></span></div>`;
}

/** Sortable table. cols: [{key,label,title,n(bool),cell(row),sort(row)}] */
export function table({ cols, rows, sort, dir, rowClass, cls = '' }) {
  const head = cols.map(c => {
    const cls = [c.n ? 'n' : '', c.key === sort ? `sorted ${dir === 'asc' ? 'asc' : ''}` : ''].join(' ').trim();
    return `<th${cls ? ` class="${cls}"` : ''}${c.sort ? ` data-sort="${c.key}"` : ''}${c.title ? ` title="${esc(c.title)}"` : ''}>${c.label}</th>`;
  }).join('');
  const body = rows.map((r, i) => `<tr${rowClass ? ` class="${rowClass(r) || ''}"` : ''}>${cols.map(c => c.cell(r, i)).join('')}</tr>`).join('');
  return `<table class="data ${cls}"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}" class="empty">No players match.</td></tr>`}</tbody></table>`;
}

export function sortRows(rows, cols, key, dir) {
  const c = cols.find(x => x.key === key);
  if (!c?.sort) return rows;
  const m = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = c.sort(a), vb = c.sort(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return typeof va === 'string' ? m * va.localeCompare(vb) : m * (va - vb);
  });
}

// ---------- tooltip ----------
const tip = () => document.getElementById('tip');
export function initTips() {
  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-tip]');
    if (!el) { tip().classList.remove('on'); return; }
    tip().innerHTML = el.getAttribute('data-tip');
    tip().classList.add('on');
    place(e);
  });
  document.addEventListener('mousemove', e => { if (tip().classList.contains('on')) place(e); });
  document.addEventListener('scroll', () => tip().classList.remove('on'), true);
}
function place(e) {
  const t = tip(), pad = 14;
  const w = t.offsetWidth, h = t.offsetHeight;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > innerWidth - 8) x = e.clientX - w - pad;
  if (y + h > innerHeight - 8) y = e.clientY - h - pad;
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${Math.max(8, y)}px`;
}
/** Tooltip HTML, already escaped for use inside a data-tip="" attribute. */
export const tipRows = (title, pairs, note) => esc(`<b>${esc(title)}</b>${pairs.map(([k, v]) => `<div class="r"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}${note ? `<div class="muted" style="margin-top:4px">${esc(note)}</div>` : ''}`);
