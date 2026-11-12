// College football metric dictionary + data loaders for the Prospects and College pages.
const pct = v => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const d1 = v => (v == null ? '—' : v.toFixed(1));
const d2 = v => (v == null ? '—' : v.toFixed(2));
const sgn = f => v => (v == null ? '—' : (v > 0 ? '+' : '') + f(v));
const int = v => (v == null ? '—' : Math.round(v).toLocaleString());
const SRC = 'ESPN college data via sportsdataverse';

export const CM = {
  g: { label: 'G', fmt: int, desc: 'Games played' },
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
  rzt: { label: 'RZ tgt', fmt: int, desc: 'Red-zone targets' },
  rzr: { label: 'RZ car', fmt: int, desc: 'Red-zone carries' },
  rztd: { label: 'RZ TD', fmt: int, desc: 'Red-zone touchdowns' },
};
for (const m of Object.values(CM)) m.src = SRC;

export const C_COLUMNS = {
  WR: ['g', 'tgt', 'rec', 'reyd', 'retd', 'tsh', 'dom', 'yptpa', 'ypt', 'catch', 'epat', 'rsr', 'adot', 'yacr', 'exp', 'rztd'],
  TE: ['g', 'tgt', 'rec', 'reyd', 'retd', 'tsh', 'dom', 'yptpa', 'ypt', 'catch', 'epat', 'rsr', 'adot', 'yacr', 'exp', 'rztd'],
  RB: ['g', 'car', 'ruyd', 'rutd', 'ypc', 'rec', 'reyd', 'csh', 'scsh', 'tsh', 'epar', 'rusr', 'exp', 'scpg', 'rztd'],
  QB: ['g', 'pa', 'pyd', 'ptd', 'int', 'ypa', 'epap', 'cpoe', 'psr', 'skr', 'padot', 'ruyd', 'rypg'],
};
export const C_SCATTER = { WR: ['tsh', 'yptpa'], TE: ['dom', 'yptpa'], RB: ['scsh', 'epar'], QB: ['cpoe', 'epap'] };
export const C_PROFILE = {
  WR: ['tsh', 'dom', 'yptpa', 'ypt', 'catch', 'epat', 'rsr', 'adot', 'yacr', 'exp', 'scpg'],
  TE: ['tsh', 'dom', 'yptpa', 'ypt', 'catch', 'epat', 'rsr', 'adot', 'yacr', 'exp', 'scpg'],
  RB: ['csh', 'scsh', 'tch', 'tsh', 'ypc', 'epar', 'rusr', 'exp', 'epao', 'scpg'],
  QB: ['epap', 'cpoe', 'ypa', 'psr', 'skr', 'padot', 'rypg'],
};
export const COUNT_STATS = new Set(['g', 'tgt', 'rec', 'reyd', 'retd', 'car', 'ruyd', 'rutd', 'pa', 'pyd', 'ptd', 'int', 'rzt', 'rzr', 'rztd']);

const cache = { prospects: null, seasons: {} };
export async function loadProspects() {
  if (!cache.prospects) {
    const r = await fetch('data/prospects.json');
    if (!r.ok) throw new Error('College data hasn’t been built yet — refresh the data.');
    cache.prospects = await r.json();
    cache.byCid = new Map(cache.prospects.prospects.filter(p => p.cid).map(p => [p.cid, p]));
  }
  return cache.prospects;
}
export const prospectByCid = cid => cache.byCid?.get(String(cid)) || null;
export async function loadCollegeSeason(season) {
  if (!cache.seasons[season]) {
    const r = await fetch(`data/college_${season}.json`);
    cache.seasons[season] = r.ok ? await r.json() : { season, players: [] };
  }
  return cache.seasons[season];
}
export const collegeHeadshot = cid => `https://a.espncdn.com/i/headshots/college-football/players/full/${cid}.png`;
export const stars = n => (n ? '★'.repeat(n) : '');
export const fmtC = (k, v) => (CM[k] ? CM[k].fmt(v) : v ?? '—');
