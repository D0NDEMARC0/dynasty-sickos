// Cells and fragments shared by several views.
import { S } from '../store.js';
import { esc, headshot, injTag, posTag, heat, signed } from '../ui.js';

export const isRookie = p => p.yexp === 0 || p.rookie === S.meta.current || p.draft?.y === S.meta.current;

export function playerCell(p, { size = 30, sub } = {}) {
  const meta = sub ?? `${posTag(p.pos)}<span>${esc(p.team || 'FA')}</span>${isRookie(p) ? '<span class="tag rk" title="Rookie">R</span>' : ''}${injTag(p.inj)}`;
  return `<a class="pcell" href="#/player/${encodeURIComponent(p.id)}">${headshot(p, size)}<div><div class="nm">${esc(p.name)}</div><div class="meta">${meta}</div></div></a>`;
}

export function anCell(p) {
  if (p.an == null) return '<td class="n muted">—</td>';
  const t = p.anTrend;
  const arrow = t == null || Math.abs(t) < 8 ? '' : t > 0 ? ` <span class="up small" title="Up ${t} vs last season">↑</span>` : ` <span class="down small" title="Down ${-t} vs last season">↓</span>`;
  return `<td class="n heat" style="${heat(p.an)}">${p.an}${arrow}</td>`;
}

export function trendCell(v) {
  const t = v?.trend;
  if (t == null || t === 0) return '<td class="n muted">—</td>';
  return `<td class="n ${t > 0 ? 'up' : 'down'}" title="30-day change in FantasyCalc value">${signed(t)}</td>`;
}

export const seasonTag = yr => `’${String(yr).slice(2)}`;

export function mount(root) {
  root.innerHTML = '';
  const el = document.createElement('div');
  root.append(el);
  return el;
}
