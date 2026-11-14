// College football metric dictionary + data loaders for the Prospects and College pages.
import { fetchData } from './version.js';
const pct = v => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const d1 = v => (v == null ? '—' : v.toFixed(1));
const d2 = v => (v == null ? '—' : v.toFixed(2));
const sgn = f => v => (v == null ? '—' : (v > 0 ? '+' : '') + f(v));
const int = v => (v == null ? '—' : Math.round(v).toLocaleString());
const SRC = 'ESPN college data via sportsdataverse';

export const CM = {
  g: { label: 'G', fmt: int, desc: 'Games played' },
  elig: { label: 'Draft elig.', fmt: v => (v == null ? '—' : String(v)), desc: 'First NFL draft the player can enter: three years after his high-school class (from his first college roster year, cross-checked with his recruiting class and class year)' },
  tgt: { label: 'Tgt', fmt: int, desc: 'Targets' },
  rec: { label: 'Rec', fmt: int, desc: 'Receptions' },
  reyd: { label: 'Rec yds', fmt: int, desc: 'Receiving yards' },
  retd: { label: 'Rec TD', fmt: int, desc: 'Receiving touchdowns' },
  car: { label: 'Car', fmt: int, desc: 'Carries' },
  ruyd: { label: 'Rush yds', fmt: int, desc: 'Rushing yards' },
  rutd: { label: 'Rush TD', fmt: int, desc: 'Rushing touchdowns' },
  pa: { label: 'Att', fmt: int, desc: 'Pass attempts' },
  pyd: { label: 'Pass yds', fmt: int, desc: 'Passing yards' },
  ptd: { label: 'Pass TD', fmt: int, desc: 'Passing touchdowns' },
  int: { label: 'INT', fmt: int, desc: 'Interceptions' },
  tsh: { label: 'Tgt share', fmt: pct, desc: 'Share of team targets in games played' },
  ysh: { label: 'Yds share', fmt: pct, desc: 'Share of team receiving yards' },
  tdsh: { label: 'TD share', fmt: pct, desc: 'Share of team receiving touchdowns' },
  dom: { label: 'Dominator', fmt: pct, desc: 'Dominator rating: average of share of team receiving yards and receiving TDs' },
  rdom: { label: 'Dominator', fmt: pct, desc: 'RB dominator rating: average of share of team scrimmage yards and scrimmage TDs' },
  bkAge: { label: 'Breakout age', fmt: d1, desc: 'Age at the start of the first season as a featured producer (WR 20%+ dominator, TE 12%+, RB 20%+ of team scrimmage yards). Exact when the birth date is known; ~ = estimated from high-school recruiting class (or class year). Lower is better' },
  yptpa: { label: 'YPTPA', fmt: d2, desc: 'Receiving yards per team pass attempt — production adjusted for offense volume' },
  csh: { label: 'Carry share', fmt: pct, desc: 'Share of team rush attempts' },
  scsh: { label: 'Scrim share', fmt: pct, desc: 'Share of team scrimmage yards (rushing + receiving)' },
  tch: { label: 'Touch share', fmt: pct, desc: 'Share of team touches in games played' },
  ypc: { label: 'YPC', fmt: d2, desc: 'Yards per carry' },
  ypr: { label: 'Yds/rec', fmt: d1, desc: 'Yards per reception' },
  ypt: { label: 'Yds/tgt', fmt: d2, desc: 'Yards per target' },
  catch: { label: 'Catch %', fmt: pct, desc: 'Receptions ÷ targets' },
  epat: { label: 'EPA/tgt', fmt: sgn(d2), desc: 'Expected points added per target' },
  rsr: { label: 'Rec success', fmt: pct, desc: 'Share of targets with positive EPA' },
  adot: { label: 'aDOT', fmt: d1, desc: 'Average depth of target (where charted)' },
  yacr: { label: 'YAC/rec', fmt: d1, desc: 'Yards after catch per reception (where charted)' },
  epar: { label: 'EPA/rush', fmt: sgn(d2), desc: 'Expected points added per carry' },
  rusr: { label: 'Rush success', fmt: pct, desc: 'Share of carries with positive EPA' },
  exp: { label: 'Explosive %', fmt: pct, desc: 'Explosive plays per opportunity (carries + targets)' },
  sr: { label: 'Success %', fmt: pct, desc: 'Successful plays per opportunity' },
  epao: { label: 'EPA/opp', fmt: sgn(d2), desc: 'Expected points added per opportunity' },
  scpg: { label: 'Scrim yds/G', fmt: d1, desc: 'Rushing + receiving yards per game' },
  rypg: { label: 'Rush yds/G', fmt: d1, desc: 'Rushing yards per game' },
  ypa: { label: 'Y/A', fmt: d2, desc: 'Passing yards per attempt' },
  epap: { label: 'EPA/play', fmt: sgn(d2), desc: 'Expected points added per dropback' },
  cpoe: { label: 'CPOE', fmt: sgn(d1), desc: 'Completion % over expected' },
  psr: { label: 'Success %', fmt: pct, desc: 'Share of dropbacks with positive EPA' },
  skr: { label: 'Sack %', fmt: pct, desc: 'Sacks ÷ dropbacks (lower is better)' },
  padot: { label: 'aDOT', fmt: d1, desc: 'Average depth of target on attempts (where charted)' },
  exp10: { label: 'Explosive run %', fmt: pct, desc: 'Runs of 10+ yards ÷ carries (from play-by-play)' },
  exp15: { label: '15+ run %', fmt: pct, desc: 'Runs of 15+ yards ÷ carries' },
  stuff: { label: 'Stuff %', fmt: pct, desc: 'Runs stopped at or behind the line ÷ carries (lower is better)' },
  brk: { label: 'Breakaway %', fmt: pct, desc: 'Share of rushing yards gained on 15+ yard runs' },
  lypc: { label: 'Line yds/car', fmt: d2, desc: 'Line yards per carry — yards credited near the line of scrimmage (ESPN formula)' },
  rec20r: { label: 'Explosive catch %', fmt: pct, desc: 'Catches of 20+ yards ÷ targets' },
  deep: { label: 'Deep tgt %', fmt: pct, desc: 'Targets 20+ air yards downfield ÷ charted targets (air yards are charted on ~40% of college passes)' },
  fdt: { label: '1D/tgt', fmt: pct, desc: 'First downs per target' },
  routes: { label: 'Routes (est.)', fmt: int, desc: 'Estimated routes: team dropbacks in games played × position route rate (WR 95%, TE 80%, RB 55%) — college route charting isn’t public' },
  yprr: { label: 'YPRR (est.)', fmt: d2, desc: 'Receiving yards per estimated route run. College route data isn’t public, so routes are estimated from team dropbacks in games played; it assumes a full-time role, so part-time players read low' },
  tprr: { label: 'TPRR (est.)', fmt: pct, desc: 'Targets per estimated route run' },
  rzt: { label: 'RZ tgt', fmt: int, desc: 'Red-zone targets' },
  rzr: { label: 'RZ car', fmt: int, desc: 'Red-zone carries' },
  rztd: { label: 'RZ TD', fmt: int, desc: 'Red-zone touchdowns' },
  qcar: { label: 'Rush att', fmt: int, desc: 'Rushing attempts, excluding sacks and kneel-downs (college box scores count sacks as runs)' },
  qruyd: { label: 'Rush yds', fmt: int, desc: 'Rushing yards, excluding sacks and kneel-downs' },
  qypc: { label: 'Rush YPC', fmt: d2, desc: 'Yards per rush, excluding sacks and kneel-downs' },
};
for (const m of Object.values(CM)) m.src = SRC;

export const C_COLUMNS = {
  WR: ['elig', 'g', 'tgt', 'rec', 'reyd', 'retd', 'tsh', 'dom', 'bkAge', 'yprr', 'tprr', 'yptpa', 'ypt', 'catch', 'epat', 'rsr', 'rec20r', 'deep', 'adot', 'yacr', 'fdt', 'rztd'],
  TE: ['elig', 'g', 'tgt', 'rec', 'reyd', 'retd', 'tsh', 'dom', 'bkAge', 'yprr', 'tprr', 'yptpa', 'ypt', 'catch', 'epat', 'rsr', 'rec20r', 'deep', 'adot', 'yacr', 'fdt', 'rztd'],
  RB: ['elig', 'g', 'car', 'ruyd', 'rutd', 'ypc', 'exp10', 'exp15', 'stuff', 'brk', 'lypc', 'epar', 'rusr', 'csh', 'scsh', 'rdom', 'bkAge', 'tsh', 'rec', 'reyd', 'yprr', 'scpg', 'rztd'],
  QB: ['elig', 'g', 'pa', 'pyd', 'ptd', 'int', 'ypa', 'epap', 'cpoe', 'psr', 'skr', 'padot', 'qcar', 'qruyd', 'qypc', 'rutd', 'rypg'],
};
// not stats: never offered as chart axes
export const C_NONSTAT = new Set(['g', 'elig']);
export const C_SCATTER = { WR: ['tprr', 'yprr'], TE: ['tprr', 'yprr'], RB: ['stuff', 'exp10'], QB: ['cpoe', 'epap'] };
export const C_PROFILE = {
  WR: ['tsh', 'dom', 'yprr', 'tprr', 'yptpa', 'ypt', 'catch', 'epat', 'rsr', 'rec20r', 'deep', 'adot', 'yacr', 'fdt'],
  TE: ['tsh', 'dom', 'yprr', 'tprr', 'yptpa', 'ypt', 'catch', 'epat', 'rsr', 'rec20r', 'deep', 'adot', 'yacr', 'fdt'],
  RB: ['csh', 'scsh', 'rdom', 'tch', 'tsh', 'ypc', 'exp10', 'exp15', 'stuff', 'brk', 'lypc', 'epar', 'rusr', 'scpg', 'yprr'],
  QB: ['epap', 'cpoe', 'ypa', 'psr', 'skr', 'padot', 'qypc', 'rypg'],
};
export const COUNT_STATS = new Set(['g', 'tgt', 'rec', 'reyd', 'retd', 'car', 'ruyd', 'rutd', 'pa', 'pyd', 'ptd', 'int', 'rzt', 'rzr', 'rztd', 'qcar', 'qruyd']);

const cache = { prospects: null, seasons: {} };
export async function loadProspects() {
  if (!cache.prospects) {
    const r = await fetchData('data/prospects.json');
    if (!r.ok) throw new Error('College data hasn’t been built yet — refresh the data.');
    cache.prospects = await r.json();
    cache.byCid = new Map(cache.prospects.prospects.filter(p => p.cid).map(p => [p.cid, p]));
  }
  return cache.prospects;
}
export const prospectByCid = cid => cache.byCid?.get(String(cid)) || null;
export async function loadCollegeSeason(season) {
  if (!cache.seasons[season]) {
    const r = await fetchData(`data/college_${season}.json`);
    cache.seasons[season] = r.ok ? await r.json() : { season, players: [] };
  }
  return cache.seasons[season];
}
/** Full college career (every season since 2019) for any player, from the split career files. */
export async function loadCareer(cid) {
  cid = String(cid);
  const b = cid.slice(-2).padStart(2, '0');
  if (!cache.careers?.[b]) {
    (cache.careers ||= {})[b] = await fetchData(`data/college/c_${b}.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
  }
  const c = cache.careers[b][cid];
  return c ? { s: [...c.s].sort((x, y) => x.season - y.season), bk: c.bk, rc: c.rc, best: c.best, el: c.el || null } : { s: [], bk: null, rc: null, best: null, el: null };
}
/**
 * Pahowdy's Prospect Database (personal use). It only exists in the copy of the app running on your computer;
 * the public website never has the file, so callers check S.mode === 'server' before asking for it.
 */
export async function loadPahowdy() {
  if (cache.pahowdy === undefined) {
    const d = await fetchData('data/pahowdy.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (d) {
      d.byCid = new Map(); d.bySid = new Map();
      for (const r of d.players) { if (r.cid) d.byCid.set(String(r.cid), r); if (r.sid) d.bySid.set(String(r.sid), r); }
    }
    cache.pahowdy = d;
  }
  return cache.pahowdy;
}
/** Format a stat from a season row; estimated breakout ages get a ~ prefix. */
export const fmtRow = (k, row) => (k === 'bkAge' && row?.bkEst && row.bkAge != null ? `~${CM.bkAge.fmt(row.bkAge)}` : fmtC(k, row?.[k]));
export const collegeHeadshot = cid => `https://a.espncdn.com/i/headshots/college-football/players/full/${cid}.png`;
export const stars = n => (n ? '★'.repeat(n) : '');
export const fmtC = (k, v) => (CM[k] ? CM[k].fmt(v) : v ?? '—');
