// Hand-rolled SVG charts: scatter (with optional quadrants), weekly columns, percentile bars.
import { esc, heatSolid } from './ui.js';

function niceStep(range, count) {
  const raw = range / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
export function niceTicks(lo, hi, count = 5) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (lo === hi) { lo -= 1; hi += 1; }
  const st = niceStep(hi - lo, count);
  const a = Math.floor(lo / st) * st, b = Math.ceil(hi / st) * st;
  const ticks = [];
  for (let v = a; v <= b + st / 2; v += st) ticks.push(Number(v.toFixed(10)));
  return { lo: a, hi: b, ticks };
}
const median = arr => { const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * pts: [{ id, x, y, label, tip, href, me, dim }]
 * label: Set of ids to direct-label. quad: [[topLeft, topRight], [bottomLeft, bottomRight]] corner captions.
 */
export function scatter({ pts, xLabel, yLabel, xFmt = v => v, yFmt = v => v, w = 780, h = 420, label = new Set(), quad = null, refs = 'median' }) {
  if (!pts.length) return '<div class="empty">Not enough data for this chart.</div>';
  const m = { l: 62, r: 20, t: 16, b: 46 };
  const X = niceTicks(Math.min(...pts.map(p => p.x)), Math.max(...pts.map(p => p.x)), 6);
  const Y = niceTicks(Math.min(...pts.map(p => p.y)), Math.max(...pts.map(p => p.y)), 5);
  const sx = v => m.l + ((v - X.lo) / (X.hi - X.lo)) * (w - m.l - m.r);
  const sy = v => h - m.b - ((v - Y.lo) / (Y.hi - Y.lo)) * (h - m.t - m.b);
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(`${yLabel} vs ${xLabel}`)}">`;
  for (const t of Y.ticks) s += `<line class="grid" x1="${m.l}" x2="${w - m.r}" y1="${sy(t)}" y2="${sy(t)}"/><text x="${m.l - 8}" y="${sy(t) + 4}" text-anchor="end">${esc(yFmt(t))}</text>`;
  for (const t of X.ticks) s += `<line class="grid" y1="${m.t}" y2="${h - m.b}" x1="${sx(t)}" x2="${sx(t)}"/><text x="${sx(t)}" y="${h - m.b + 16}" text-anchor="middle">${esc(xFmt(t))}</text>`;
  s += `<line class="axis" x1="${m.l}" x2="${w - m.r}" y1="${h - m.b}" y2="${h - m.b}"/>`;
  if (refs === 'median' || refs === 'mean') {
    const f = refs === 'median' ? median : a => a.reduce((x, y) => x + y, 0) / a.length;
    const mx = f(pts.map(p => p.x)), my = f(pts.map(p => p.y));
    s += `<line class="ref" x1="${sx(mx)}" x2="${sx(mx)}" y1="${m.t}" y2="${h - m.b}"/><line class="ref" x1="${m.l}" x2="${w - m.r}" y1="${sy(my)}" y2="${sy(my)}"/>`;
    s += `<text x="${sx(mx) + 4}" y="${m.t + 10}">${refs}</text><text x="${w - m.r - 4}" y="${sy(my) - 5}" text-anchor="end">${refs}</text>`;
  }
  if (quad) {
    s += `<text class="qlabel" x="${m.l + 8}" y="${m.t + 14}">${esc(quad[0][0])}</text><text class="qlabel" x="${w - m.r - 8}" y="${m.t + 14}" text-anchor="end">${esc(quad[0][1])}</text>`;
    s += `<text class="qlabel" x="${m.l + 8}" y="${h - m.b - 8}">${esc(quad[1][0])}</text><text class="qlabel" x="${w - m.r - 8}" y="${h - m.b - 8}" text-anchor="end">${esc(quad[1][1])}</text>`;
  }
  s += `<text class="axis-title" x="${(m.l + w - m.r) / 2}" y="${h - 8}" text-anchor="middle">${esc(xLabel)}</text>`;
  s += `<text class="axis-title" transform="translate(12 ${(m.t + h - m.b) / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`;
  // dim points first so highlighted ones draw on top
  const ordered = [...pts].sort((a, b) => (a.me ? 1 : 0) - (b.me ? 1 : 0) || (a.dim ? -1 : 0) - (b.dim ? -1 : 0));
  for (const p of ordered) {
    const cx = sx(p.x), cy = sy(p.y);
    s += `<g${p.tip ? ` data-tip="${p.tip}"` : ''}${p.href ? ` data-href="${esc(p.href)}"` : ''}><circle class="hit" cx="${cx}" cy="${cy}" r="11"/><circle class="dot${p.me ? ' me' : p.dim ? ' dim' : ''}" cx="${cx}" cy="${cy}" r="${p.me ? 7 : 5}"/></g>`;
  }
  // direct labels with greedy collision avoidance
  const boxes = [];
  const hit = b => boxes.some(o => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
  for (const p of pts.filter(q => label.has(q.id) || q.me)) {
    const cx = sx(p.x), cy = sy(p.y), tw = p.label.length * 6.2 + 4;
    for (const [dx, anchor] of [[9, 'start'], [-9, 'end']]) {
      const b = { x: anchor === 'start' ? cx + dx : cx + dx - tw, y: cy - 9, w: tw, h: 13 };
      if (b.x < m.l || b.x + b.w > w - m.r || hit(b)) continue;
      boxes.push(b);
      s += `<text class="lbl${p.me ? ' strong' : ''}" x="${cx + dx}" y="${cy + 4}" text-anchor="${anchor}">${esc(p.label)}</text>`;
      break;
    }
  }
  return s + '</svg>';
}

function barPath(x, y0, y1, w, r) {
  const up = y1 < y0, h = Math.abs(y1 - y0);
  r = Math.min(r, w / 2, h);
  if (h < 0.5) return '';
  if (up) return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

/** Weekly columns. data: [{ label, v, tip, dim }] */
export function columns({ data, w = 780, h = 230, yFmt = v => v.toFixed(0), avg = null, avgLabel = 'Avg' }) {
  if (!data.length) return '<div class="empty">No games this season.</div>';
  const m = { l: 40, r: 64, t: 18, b: 28 };
  const vals = data.map(d => d.v);
  const Y = niceTicks(Math.min(0, ...vals), Math.max(1, ...vals, avg ?? 0), 4);
  const sy = v => h - m.b - ((v - Y.lo) / (Y.hi - Y.lo)) * (h - m.t - m.b);
  const band = (w - m.l - m.r) / data.length, bw = Math.min(24, band * 0.66);
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Fantasy points by week">`;
  for (const t of Y.ticks) s += `<line class="grid" x1="${m.l}" x2="${w - m.r}" y1="${sy(t)}" y2="${sy(t)}"/><text x="${m.l - 8}" y="${sy(t) + 4}" text-anchor="end">${esc(yFmt(t))}</text>`;
  const maxI = vals.indexOf(Math.max(...vals));
  data.forEach((d, i) => {
    const x = m.l + i * band + (band - bw) / 2;
    s += `<path class="bar${d.dim ? ' dim' : ''}" d="${barPath(x, sy(0), sy(d.v), bw, 4)}"/>`;
    s += `<text x="${x + bw / 2}" y="${h - m.b + 16}" text-anchor="middle">${esc(d.label)}</text>`;
    if (i === maxI) s += `<text class="lbl" x="${x + bw / 2}" y="${sy(d.v) - 5}" text-anchor="middle">${esc(yFmt(d.v))}</text>`;
    s += `<rect class="hit" x="${m.l + i * band}" y="${m.t}" width="${band}" height="${h - m.t - m.b}"${d.tip ? ` data-tip="${d.tip}"` : ''}/>`;
  });
  s += `<line class="axis" x1="${m.l}" x2="${w - m.r}" y1="${sy(0)}" y2="${sy(0)}"/>`;
  if (avg != null) s += `<line class="ref" x1="${m.l}" x2="${w - m.r}" y1="${sy(avg)}" y2="${sy(avg)}"/><text class="lbl" x="${w - m.r + 6}" y="${sy(avg) + 4}">${esc(avgLabel)} ${esc(yFmt(avg))}</text>`;
  return s + '</svg>';
}

/** items: [{ label, value, pct, desc }] → HTML percentile bars (diverging color around the median). */
export function pctBars(items) {
  if (!items.length) return '<div class="muted small">No qualifying sample for percentiles.</div>';
  return `<div class="pbars">${items.map(it => `<div class="pbar" data-tip="${esc(`<b>${esc(it.label)}</b><div>${esc(it.desc || '')}</div>${it.pct != null ? `<div class="muted" style="margin-top:4px">${it.pct}th percentile among qualified ${esc(it.pos || '')}s</div>` : ''}`)}">
      <span class="l">${esc(it.label)}</span>
      <span class="t"><span class="f" style="display:block;width:${it.pct ?? 0}%;${heatSolid(it.pct)}"></span></span>
      <span class="v">${it.value}</span><span class="p">${it.pct ?? '—'}</span></div>`).join('')}</div>`;
}
