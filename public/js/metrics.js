// Metric dictionary: labels, formatting, descriptions and data source for every stat shown in the app.
const pct = v => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const d1 = v => (v == null ? '—' : v.toFixed(1));
const d2 = v => (v == null ? '—' : v.toFixed(2));
const sgn = (f) => v => (v == null ? '—' : (v > 0 ? '+' : '') + f(v));
const int = v => (v == null ? '—' : Math.round(v).toLocaleString());

export const M = {
  // fantasy
  ppg: { label: 'PPG', fmt: d1, desc: 'Fantasy points per game in the selected scoring format', src: 'nflverse' },
  xfp: { label: 'xFP/G', fmt: d1, desc: 'Expected PPR fantasy points per game: what an average player would score with the same opportunities (targets by depth and location, carries by field position, pass attempts). Volume and role, minus luck', src: 'ffopportunity (ffverse)' },
  fpoe: { label: 'FPOE/G', fmt: sgn(d1), desc: 'PPR fantasy points over expected per game (actual − expected). Positive = scored more than the opportunities usually produce; big gaps in either direction tend to shrink', src: 'ffopportunity (ffverse)' },
  // usage
  routes: { label: 'Routes', fmt: int, desc: 'Routes run. 2023–25: on-field dropbacks from participation data × position route rate. Current season: estimated from snap share × team dropbacks (see Methodology).', src: 'nflverse' },
  rp: { label: 'Route %', fmt: pct, desc: 'Route participation: routes ÷ team dropbacks in games played', src: 'nflverse' },
  snap: { label: 'Snap %', fmt: pct, desc: 'Average offensive snap share', src: 'PFR' },
  tsh: { label: 'Tgt share', fmt: pct, desc: 'Share of team targets in games played', src: 'nflverse' },
  aysh: { label: 'AY share', fmt: pct, desc: 'Share of team air yards in games played', src: 'nflverse' },
  wopr: { label: 'WOPR', fmt: d2, desc: 'Weighted opportunity rating: 1.5 × target share + 0.7 × air-yard share', src: 'nflverse' },
  osh: { label: 'Opp share', fmt: pct, desc: 'Opportunity share: (carries + targets) ÷ team (carries + targets)', src: 'nflverse' },
  csh: { label: 'Carry share', fmt: pct, desc: 'Share of team rush attempts (excl. kneels)', src: 'nflverse' },
  hvtpg: { label: 'HVT/G', fmt: d1, desc: 'High-value touches per game: targets + carries inside the 10', src: 'nflverse' },
  rzTgt: { label: 'RZ tgt', fmt: int, desc: 'Red-zone targets (inside the 20)', src: 'nflverse' },
  ezTgt: { label: 'EZ tgt', fmt: int, desc: 'End-zone targets (air yards ≥ distance to goal)', src: 'nflverse' },
  rzCar: { label: 'RZ car', fmt: int, desc: 'Red-zone carries (inside the 20)', src: 'nflverse' },
  i5: { label: 'GL car', fmt: int, desc: 'Goal-line carries (inside the 5)', src: 'nflverse' },
  // receiving efficiency
  yprr: { label: 'YPRR', fmt: d2, desc: 'Receiving yards per route run — the most predictive single receiving efficiency stat', src: 'nflverse' },
  tprr: { label: 'TPRR', fmt: pct, desc: 'Targets per route run — how often a player earns the ball when running a route', src: 'nflverse' },
  yprrMan: { label: 'YPRR vs man', fmt: d2, desc: 'Receiving yards per route run against man coverage. Routes vs that coverage = on-field dropbacks where the defense played it (coverage tags in nflverse participation data) × position route rate; needs 40+ such routes. Participation data is published after each season, so the in-progress season fills in once it ends', src: 'nflverse' },
  yprrZone: { label: 'YPRR vs zone', fmt: d2, desc: 'Receiving yards per route run against zone coverage. Routes vs that coverage = on-field dropbacks where the defense played it (coverage tags in nflverse participation data) × position route rate; needs 40+ such routes. Participation data is published after each season, so the in-progress season fills in once it ends', src: 'nflverse' },
  tprrMan: { label: 'TPRR vs man', fmt: pct, desc: 'Targets per route run against man coverage. Routes vs that coverage = on-field dropbacks where the defense played it (coverage tags in nflverse participation data) × position route rate; needs 40+ such routes. Participation data is published after each season, so the in-progress season fills in once it ends', src: 'nflverse' },
  tprrZone: { label: 'TPRR vs zone', fmt: pct, desc: 'Targets per route run against zone coverage. Routes vs that coverage = on-field dropbacks where the defense played it (coverage tags in nflverse participation data) × position route rate; needs 40+ such routes. Participation data is published after each season, so the in-progress season fills in once it ends', src: 'nflverse' },
  fdrr: { label: '1D/RR', fmt: v => (v == null ? '—' : v.toFixed(3)), desc: 'First downs per route run', src: 'nflverse' },
  adot: { label: 'aDOT', fmt: d1, desc: 'Average depth of target (air yards per target)', src: 'nflverse' },
  sep: { label: 'Separation', fmt: d2, desc: 'Avg. yards between receiver and nearest defender when the pass arrives', src: 'NFL Next Gen Stats' },
  cush: { label: 'Cushion', fmt: d1, desc: 'Avg. yards of cushion from the nearest defender at the snap', src: 'NFL Next Gen Stats' },
  yacoe: { label: 'YAC+', fmt: sgn(d2), desc: 'Yards after catch above expectation, per reception', src: 'NFL Next Gen Stats' },
  catch: { label: 'Catch %', fmt: pct, desc: 'Receptions ÷ targets', src: 'nflverse' },
  drop: { label: 'Drop %', fmt: pct, desc: 'Drops ÷ catchable targets (lower is better)', src: 'FTN charting' },
  cont: { label: 'Contested %', fmt: pct, desc: 'Share of targets that were contested', src: 'FTN charting' },
  contc: { label: 'Cont. catch %', fmt: pct, desc: 'Catch rate on contested targets', src: 'FTN charting' },
  catchable: { label: 'Catchable %', fmt: pct, desc: 'Share of targets charted as catchable', src: 'FTN charting' },
  screen: { label: 'Screen %', fmt: pct, desc: 'Share of targets on screen passes', src: 'FTN charting' },
  epat: { label: 'EPA/tgt', fmt: sgn(d2), desc: 'Expected points added per target', src: 'nflverse' },
  yacr: { label: 'YAC/rec', fmt: d1, desc: 'Yards after catch per reception', src: 'nflverse' },
  racr: { label: 'RACR', fmt: d2, desc: 'Receiver air conversion ratio: receiving yards ÷ air yards', src: 'nflverse' },
  rec20: { label: '20+ rec', fmt: int, desc: 'Receptions of 20+ yards', src: 'nflverse' },
  deep: { label: 'Deep tgt %', fmt: pct, desc: 'Share of targets 20+ air yards downfield', src: 'nflverse' },
  // rushing
  ypc: { label: 'YPC', fmt: d2, desc: 'Yards per carry', src: 'nflverse' },
  exp10: { label: 'Explosive %', fmt: pct, desc: 'Explosive run rate: designed runs gaining 10+ yards', src: 'nflverse' },
  exp15: { label: '15+ run %', fmt: pct, desc: 'Designed runs gaining 15+ yards', src: 'nflverse' },
  run20: { label: '20+ runs', fmt: int, desc: 'Runs of 20+ yards', src: 'nflverse' },
  stuff: { label: 'Stuff %', fmt: pct, desc: 'Designed runs stopped at or behind the line (lower is better)', src: 'nflverse' },
  succ: { label: 'Success %', fmt: pct, desc: 'Share of carries with positive EPA', src: 'nflverse' },
  epar: { label: 'EPA/rush', fmt: sgn(d2), desc: 'Expected points added per carry', src: 'nflverse' },
  ryoe: { label: 'RYOE/att', fmt: sgn(d2), desc: 'Rush yards over expected per attempt (tracking-data expected yards)', src: 'NFL Next Gen Stats' },
  ryoepct: { label: 'Beat exp. %', fmt: pct, desc: 'Share of runs that gained more than expected', src: 'NFL Next Gen Stats' },
  box8: { label: '8+ box %', fmt: pct, desc: 'Share of carries facing 8+ defenders in the box', src: 'NFL Next Gen Stats' },
  ttlos: { label: 'Time to LOS', fmt: d2, desc: 'Avg. seconds from handoff to crossing the line of scrimmage', src: 'NFL Next Gen Stats' },
  // passing
  db: { label: 'Dropbacks', fmt: int, desc: 'Pass attempts + sacks + scrambles', src: 'nflverse' },
  epadb: { label: 'EPA/db', fmt: sgn(d2), desc: 'Expected points added per dropback', src: 'nflverse' },
  cpoe: { label: 'CPOE', fmt: sgn(d1), desc: 'Completion % over expected', src: 'nflverse' },
  padot: { label: 'aDOT', fmt: d1, desc: 'Average depth of target on attempts', src: 'nflverse' },
  deepr: { label: 'Deep %', fmt: pct, desc: 'Share of attempts 20+ air yards', src: 'nflverse' },
  skr: { label: 'Sack %', fmt: pct, desc: 'Sacks ÷ dropbacks (lower is better)', src: 'nflverse' },
  twp: { label: 'INT-worthy %', fmt: pct, desc: 'Interception-worthy throws ÷ dropbacks (lower is better)', src: 'FTN charting' },
  press: { label: 'Pressure %', fmt: pct, desc: 'Dropbacks under pressure (participation data, 2023–25)', src: 'nflverse' },
  ttt: { label: 'Time to throw', fmt: d2, desc: 'Avg. seconds from snap to throw', src: 'NFL Next Gen Stats' },
  aggr: { label: 'Tight window %', fmt: pct, desc: 'Aggressiveness: throws into tight windows (<1 yd separation)', src: 'NFL Next Gen Stats' },
  par: { label: 'Play-action %', fmt: pct, desc: 'Share of dropbacks using play-action', src: 'FTN charting' },
  bad: { label: 'Bad throw %', fmt: pct, desc: 'Bad throws ÷ attempts (lower is better)', src: 'Pro Football Reference' },
  yaco: { label: 'YCO/att', fmt: d2, desc: 'Yards after contact per carry', src: 'Pro Football Reference' },
  ybco: { label: 'YBC/att', fmt: d2, desc: 'Yards before contact per carry (blocking + vision)', src: 'Pro Football Reference' },
  bt: { label: 'Broken tkl', fmt: int, desc: 'Broken tackles (rushing + receiving)', src: 'Pro Football Reference' },
  btr: { label: 'Broken tkl %', fmt: pct, desc: 'Broken tackles per touch', src: 'Pro Football Reference' },
  // imported (PFF or other licensed exports placed in data/imports)
  x_grade: { label: 'Off. grade', fmt: d1, desc: 'Overall offensive grade from your imported data (e.g. PFF)', src: 'Import' },
  x_routeGrade: { label: 'Route grade', fmt: d1, desc: 'Receiving / pass-route grade from your imported data', src: 'Import' },
  x_runGrade: { label: 'Run grade', fmt: d1, desc: 'Rushing grade from your imported data', src: 'Import' },
  x_passGrade: { label: 'Pass grade', fmt: d1, desc: 'Passing grade from your imported data', src: 'Import' },
  x_elusive: { label: 'Elusive rtg', fmt: d1, desc: 'Elusive rating from your imported data', src: 'Import' },
  x_mtf: { label: 'MTF', fmt: int, desc: 'Missed tackles forced, from your imported data', src: 'Import' },
  x_yco: { label: 'YCO/att (imp.)', fmt: d2, desc: 'Yards after contact per attempt, from your imported data', src: 'Import' },
  x_breakaway: { label: 'Breakaway %', fmt: pct, desc: 'Share of rushing yards on 15+ yard runs, from your imported data', src: 'Import' },
  x_slot: { label: 'Slot %', fmt: pct, desc: 'Slot alignment rate, from your imported data', src: 'Import' },
  x_contested: { label: 'Cont. catch % (imp.)', fmt: pct, desc: 'Contested catch rate, from your imported data', src: 'Import' },
  x_btt: { label: 'BTT %', fmt: pct, desc: 'Big-time throw rate, from your imported data', src: 'Import' },
  x_winRate: { label: 'Route win %', fmt: pct, desc: 'Route win rate, from your imported data', src: 'Import' },
  ruypg: { label: 'Rush Y/G', fmt: d1, desc: 'Rushing yards per game', src: 'nflverse' },
  ratt: { label: 'Rush att', fmt: int, desc: 'Rushing attempts (official: includes scrambles and kneel-downs)', src: 'nflverse' },
  rypc: { label: 'Rush YPC', fmt: d2, desc: 'Rushing yards per attempt (official, includes scrambles and kneel-downs)', src: 'nflverse' },
  scr: { label: 'Scrambles', fmt: int, desc: 'QB scrambles', src: 'nflverse' },
  dbpg: { label: 'DB/G', fmt: d1, desc: 'Dropbacks per game', src: 'nflverse' },
  score: { label: 'Score', fmt: v => (v == null ? '—' : String(v)), desc: 'Analytics Score (0–100): weighted percentile blend of the position’s most predictive metrics', src: 'Dynasty Lab' },
};

export const LOWER_BETTER = new Set(['drop', 'stuff', 'skr', 'twp', 'press', 'bad']);

// Column sets for the analytics explorer, per position. Imported columns appear only when data exists.
export const COLUMNS = {
  WR: ['ppg', 'xfp', 'fpoe', 'routes', 'rp', 'tsh', 'aysh', 'wopr', 'tprr', 'yprr', 'yprrMan', 'yprrZone', 'adot', 'sep', 'cush', 'yacoe', 'catch', 'drop', 'contc', 'epat', 'fdrr', 'btr', 'rzTgt', 'x_grade', 'x_routeGrade', 'x_winRate', 'score'],
  TE: ['ppg', 'xfp', 'fpoe', 'routes', 'rp', 'tsh', 'aysh', 'tprr', 'yprr', 'yprrMan', 'yprrZone', 'adot', 'sep', 'yacoe', 'catch', 'drop', 'epat', 'fdrr', 'rzTgt', 'ezTgt', 'x_grade', 'x_routeGrade', 'score'],
  RB: ['ppg', 'xfp', 'fpoe', 'csh', 'osh', 'tsh', 'hvtpg', 'ypc', 'exp10', 'exp15', 'stuff', 'succ', 'ryoe', 'ryoepct', 'yaco', 'ybco', 'btr', 'box8', 'epar', 'routes', 'yprr', 'rzCar', 'i5', 'x_grade', 'x_runGrade', 'x_elusive', 'score'],
  QB: ['ppg', 'xfp', 'fpoe', 'db', 'epadb', 'cpoe', 'padot', 'deepr', 'skr', 'twp', 'bad', 'press', 'ttt', 'aggr', 'par', 'ratt', 'rypc', 'ruypg', 'scr', 'x_grade', 'x_passGrade', 'x_btt', 'score'],
};

// Percentile bars on the player page.
export const PROFILE = {
  WR: ['xfp', 'fpoe', 'yprr', 'tprr', 'yprrMan', 'yprrZone', 'tprrMan', 'tprrZone', 'tsh', 'aysh', 'wopr', 'adot', 'sep', 'cush', 'yacoe', 'catch', 'drop', 'contc', 'epat', 'fdrr', 'rp', 'btr', 'x_grade', 'x_routeGrade', 'x_winRate'],
  TE: ['xfp', 'fpoe', 'yprr', 'tprr', 'yprrMan', 'yprrZone', 'tprrMan', 'tprrZone', 'tsh', 'aysh', 'wopr', 'adot', 'sep', 'yacoe', 'catch', 'drop', 'epat', 'fdrr', 'rp', 'btr', 'x_grade', 'x_routeGrade'],
  RB: ['xfp', 'fpoe', 'osh', 'csh', 'tsh', 'hvtpg', 'exp10', 'exp15', 'ryoe', 'ryoepct', 'yaco', 'btr', 'succ', 'stuff', 'epar', 'ypc', 'yprr', 'tprr', 'x_grade', 'x_runGrade', 'x_elusive'],
  QB: ['xfp', 'fpoe', 'epadb', 'cpoe', 'padot', 'deepr', 'skr', 'twp', 'bad', 'press', 'ratt', 'rypc', 'ruypg', 'aggr', 'x_grade', 'x_passGrade', 'x_btt'],
};

export const SCATTER_DEFAULT = { WR: ['tprr', 'yprr'], TE: ['tprr', 'yprr'], RB: ['osh', 'exp10'], QB: ['cpoe', 'epadb'] };

export function metricValue(s, key, ppgFn) {
  if (!s) return null;
  if (key === 'ppg') return ppgFn ? ppgFn(s) : s.ppg?.ppr;
  if (key === 'dbpg') return s.g ? s.db / s.g : null;
  const v = key.startsWith('x_') ? s.ext?.[key.slice(2)] : s[key];
  return v == null || !Number.isFinite(v) ? null : v;
}
