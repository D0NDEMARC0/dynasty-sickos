// Pahowdy's Prospect Database: a public Google Sheet by @pahowdy with every QB/RB/WR/TE prospect since 2001
// (Sports-Reference + PFF college stats, his pre/post-draft scores, breakout ages, birth dates).
// He shares it for personal copies and it contains PFF data, so it's used ONLY in the copy of the app on your own
// computer: build.mjs --public never loads it and site.mjs never copies pahowdy.json to the website.
import fs from 'node:fs';
import { cached } from './fetch.mjs';

export const PAHOWDY = {
  sheet: '19suThny5WpYuBpv7tKrLe6_qtj_j9DQxHA8vftjkRd0',
  url: 'https://docs.google.com/spreadsheets/d/19suThny5WpYuBpv7tKrLe6_qtj_j9DQxHA8vftjkRd0/edit',
  tabs: { QB: 1246680459, RB: 1101851600, WR: 202368424, TE: 2142313753 },
};

function parseCSV(s) {
  const R = [];
  let r = [], f = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n') { r.push(f); R.push(r); r = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || r.length) { r.push(f); R.push(r); }
  return R;
}
const str = v => { const t = String(v ?? '').trim(); return !t || t === '-' || /^unk$/i.test(t) ? null : t; };
const num = v => { const t = str(v); if (t == null) return null; const n = Number(t.replace(/[%,]/g, '')); return Number.isFinite(n) ? (t.endsWith('%') ? n / 100 : n) : null; };
const rate = (n, d) => (n != null && d > 0 ? n / d : null);
const isoDate = v => { const m = String(v || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
const pctRank = values => {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  return v => { if (!Number.isFinite(v) || !s.length) return null; let lo = 0; while (lo < s.length && s[lo] < v) lo++; let eq = lo; while (eq < s.length && s[eq] === v) eq++; return Math.round(((lo + (eq - lo) / 2) / s.length) * 100); };
};

/** All four position tabs → one record per prospect (cached for a week). */
export async function loadPahowdy(log) {
  const out = [];
  for (const [pos, gid] of Object.entries(PAHOWDY.tabs)) {
    const f = await cached(`https://docs.google.com/spreadsheets/d/${PAHOWDY.sheet}/export?format=csv&gid=${gid}`, `pahowdy_${pos}.csv`, 24 * 7);
    if (!f) continue;
    const R = parseCSV(fs.readFileSync(f, 'utf8'));
    const H = (R[1] || []).map(h => h.trim()); // row 0 = column groups, row 1 = headers
    const col = (name, from = 0, to = H.length) => { for (let i = from; i < to; i++) if (H[i] === name) return i; return -1; };
    const C = {
      gsis: col('NFLfastR'), pfr: col('PFR ID'), name: col('Name'), dy: col('DY'), dr: col('DR'), dp: col('DP'), dob: col('DOB'),
      college: col('College'), conf: col('Conference'), post: col('Post Draft'), pre: col('Pre Draft'), prod: col('Production Score'),
      bk20: col('20%'), bk30: col('30%'), dom: col('AVG Dominator'), rdom: col('MAX Rushing Dominator'),
      yco: col('YCO/Att'), yrr: col('YRR'), yac: col('YACa/Rec'), tgt: col('TGT%'), ctgt: col('Contested TGT%'), slot: col('Slot Rate'), adot: col('aDot'),
      elu: col('elusive_rating'), bestPpg: col('Best PPG'),
      // career PFF passing (his "twp rate" / "btt %" columns are sums of season rates, so rates come from the counts)
      acc: col('accuracy%'), att: col('attempts PFF'), bttN: col('big time throws'), twpN: col('turnover worthy plays'), p2s: col('pressure to sack rate'),
      qadot: col('QB aDot'), qrtg: col('qb rating'),
    };
    C.bestYrr = C.bestPpg >= 0 ? col('YRR', C.bestPpg, C.bestPpg + 25) : -1; // "Best PPG Year Stats" group
    const g = (r, k) => (C[k] >= 0 ? r[C[k]] : null);
    const rows = [];
    for (const r of R.slice(2)) {
      const name = str(g(r, 'name'));
      if (!name) continue;
      const drafted = num(g(r, 'dr')) != null;
      // his scores are 0.0 placeholders for players who haven't been drafted or scored yet
      const score = k => { const v = num(g(r, k)); return v === 0 && !drafted ? null : v; };
      rows.push({
        pos, name, gsis: str(g(r, 'gsis')), pfr: str(g(r, 'pfr')), dy: num(g(r, 'dy')), dr: num(g(r, 'dr')), dp: num(g(r, 'dp')),
        dob: isoDate(g(r, 'dob')), college: str(g(r, 'college')), conf: str(g(r, 'conf')),
        pre: score('pre'), post: score('post'), prod: score('prod'),
        bk20: num(g(r, 'bk20')), bk30: num(g(r, 'bk30')), dom: num(g(r, 'dom')), rdom: num(g(r, 'rdom')),
        yrr: num(g(r, 'yrr')), bestYrr: num(g(r, 'bestYrr')), tgt: num(g(r, 'tgt')), ctgt: num(g(r, 'ctgt')), slot: num(g(r, 'slot')), adot: num(g(r, 'adot')),
        yac: num(g(r, 'yac')), yco: num(g(r, 'yco')), elu: num(g(r, 'elu')),
        acc: num(g(r, 'acc')), att: num(g(r, 'att')), btt: rate(num(g(r, 'bttN')), num(g(r, 'att'))), twp: rate(num(g(r, 'twpN')), num(g(r, 'att'))),
        p2s: num(g(r, 'p2s')), qadot: num(g(r, 'qadot')), qrtg: num(g(r, 'qrtg')),
      });
    }
    // where his scores rank among every prospect at the position in the database
    for (const k of ['pre', 'post', 'prod']) { const f2 = pctRank(rows.map(x => x[k])); for (const x of rows) x[`${k}Pct`] = f2(x[k]); }
    out.push(...rows);
  }
  log?.(`  Pahowdy's Prospect Database: ${out.length} prospects (local only)`);
  return out;
}

// fields worth showing per position (receivers who threw a pass don't need QB stats, and vice versa)
const COMMON = ['pos', 'name', 'cid', 'sid', 'dy', 'dr', 'dp', 'dob', 'college', 'conf', 'pre', 'post', 'prod', 'prePct', 'postPct', 'prodPct'];
const FIELDS = {
  WR: [...COMMON, 'bk20', 'bk30', 'dom', 'yrr', 'bestYrr', 'tgt', 'ctgt', 'slot', 'adot', 'yac'],
  TE: [...COMMON, 'bk20', 'bk30', 'dom', 'yrr', 'bestYrr', 'tgt', 'ctgt', 'slot', 'adot', 'yac'],
  RB: [...COMMON, 'bk20', 'bk30', 'dom', 'rdom', 'yco', 'elu', 'yrr', 'tgt', 'yac'],
  QB: [...COMMON, 'acc', 'att', 'btt', 'twp', 'p2s', 'qadot', 'qrtg', 'rdom'],
};
/** Compact record for the app: the position's fields, rounded, without empties. */
export const slimPahowdy = r => Object.fromEntries((FIELDS[r.pos] || COMMON)
  .filter(k => r[k] != null).map(k => [k, typeof r[k] === 'number' ? Math.round(r[k] * 1000) / 1000 : r[k]]));
