// Loaders for every remote data source. Each returns plain JS structures.
import fs from 'node:fs';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { nflverse, cached, cachedJSON, readCSV } from './fetch.mjs';

const fix = v => (typeof v === 'bigint' ? Number(v) : v);
const clean = rows => rows.map(r => { for (const k in r) r[k] = fix(r[k]); return r; });

export async function readParquet(path, columns) {
  const file = await asyncBufferFromFile(path);
  return clean(await parquetReadObjects({ file, columns, compressors }));
}

// The current season's files change weekly; older seasons are effectively frozen.
const ttl = (season, current) => (season === current ? 12 : 24 * 30);

export async function sleeperState() {
  return cachedJSON('https://api.sleeper.app/v1/state/nfl', 'sleeper_state.json', 6);
}

export async function sleeperPlayers() {
  // Sleeper asks clients to pull this at most once per day.
  const all = await cachedJSON('https://api.sleeper.app/v1/players/nfl', 'sleeper_players.json', 24);
  const out = {};
  for (const [id, p] of Object.entries(all)) {
    const pos = p.position === 'FB' ? 'RB' : p.position;
    if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
    out[id] = {
      sid: id, name: p.full_name || `${p.first_name} ${p.last_name}`, pos, team: p.team || null,
      birth: p.birth_date || null, gsis: p.gsis_id ? String(p.gsis_id).trim() : null,
      yexp: p.years_exp ?? null, inj: p.injury_status || null, status: p.status || null,
      active: !!p.active, depth: p.depth_chart_order ?? null, rank: p.search_rank ?? null,
      college: p.college || null, ht: p.height || null, wt: p.weight || null,
    };
  }
  return out;
}

export async function idMap() {
  const f = await cached('https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv', 'db_playerids.csv', 24 * 3);
  return readCSV(f).filter(r => ['QB', 'RB', 'WR', 'TE', 'FB'].includes(r.position));
}

export async function nflPlayers() {
  const p = await nflverse('players', 'players.parquet', 24 * 3);
  return readParquet(p, ['gsis_id', 'display_name', 'position', 'birth_date', 'pfr_id', 'pff_id', 'headshot', 'latest_team',
    'rookie_season', 'last_season', 'draft_year', 'draft_round', 'draft_pick', 'college_name', 'height', 'weight', 'status', 'years_of_experience']);
}

const PBP_COLS = ['game_id', 'play_id', 'season', 'week', 'season_type', 'posteam', 'play_type', 'pass_attempt', 'rush_attempt',
  'sack', 'qb_dropback', 'qb_scramble', 'qb_spike', 'qb_kneel', 'passer_player_id', 'receiver_player_id', 'rusher_player_id',
  'air_yards', 'yards_after_catch', 'receiving_yards', 'rushing_yards', 'yards_gained', 'complete_pass', 'interception',
  'touchdown', 'td_player_id', 'epa', 'qb_epa', 'success', 'first_down', 'yardline_100', 'two_point_attempt', 'cpoe'];

export async function pbp(season, current) {
  const p = await nflverse('pbp', `play_by_play_${season}.parquet`, ttl(season, current));
  if (!p) return null;
  const rows = await readParquet(p, PBP_COLS);
  return rows.filter(r => r.season_type === 'REG' && r.play_type !== 'no_play' && !r.two_point_attempt);
}

export async function participation(season, current) {
  const p = await nflverse('pbp_participation', `pbp_participation_${season}.parquet`, ttl(season, current));
  if (!p) return null;
  const rows = await readParquet(p, ['nflverse_game_id', 'play_id', 'offense_players', 'was_pressure']);
  const m = new Map();
  for (const r of rows) m.set(`${r.nflverse_game_id}|${r.play_id}`, { off: r.offense_players ? r.offense_players.split(';') : [], pressure: r.was_pressure });
  return m;
}

export async function ftn(season, current) {
  const p = await nflverse('ftn_charting', `ftn_charting_${season}.parquet`, ttl(season, current));
  if (!p) return null;
  const rows = await readParquet(p, ['nflverse_game_id', 'nflverse_play_id', 'is_play_action', 'is_screen_pass', 'is_qb_out_of_pocket',
    'is_interception_worthy', 'is_catchable_ball', 'is_contested_ball', 'is_created_reception', 'is_drop', 'is_throw_away']);
  const m = new Map();
  for (const r of rows) m.set(`${r.nflverse_game_id}|${r.nflverse_play_id}`, r);
  return m;
}

export async function snapCounts(season, current) {
  const p = await nflverse('snap_counts', `snap_counts_${season}.parquet`, ttl(season, current));
  if (!p) return null;
  const rows = await readParquet(p, ['game_id', 'game_type', 'week', 'pfr_player_id', 'position', 'team', 'offense_snaps', 'offense_pct']);
  return rows.filter(r => r.game_type === 'REG' && r.offense_snaps > 0);
}

export async function weeklyStats(season, current) {
  const p = await nflverse('stats_player', `stats_player_week_${season}.parquet`, ttl(season, current));
  if (!p) return null;
  const rows = await readParquet(p, ['player_id', 'player_display_name', 'position', 'headshot_url', 'season', 'week', 'season_type',
    'game_id', 'team', 'opponent_team', 'completions', 'attempts', 'passing_yards', 'passing_tds', 'passing_interceptions', 'sacks_suffered',
    'passing_first_downs', 'passing_2pt_conversions', 'carries', 'rushing_yards', 'rushing_tds', 'rushing_first_downs', 'rushing_2pt_conversions',
    'rushing_fumbles_lost', 'receptions', 'targets', 'receiving_yards', 'receiving_tds', 'receiving_first_downs', 'receiving_2pt_conversions',
    'receiving_fumbles_lost', 'sack_fumbles_lost', 'special_teams_tds', 'fantasy_points', 'fantasy_points_ppr']);
  return rows.filter(r => r.season_type === 'REG' && ['QB', 'RB', 'WR', 'TE', 'FB'].includes(r.position));
}

export async function ngs(kind) {
  const p = await nflverse('nextgen_stats', `ngs_${kind}.parquet`, 12);
  return (await readParquet(p)).filter(r => r.season_type === 'REG');
}

/** Pro Football Reference advanced stats (via nflverse), aggregated from weekly files → Map(pfr_id → totals). */
export async function pfrAdvanced(season, current) {
  const out = new Map();
  const get = id => { let o = out.get(id); if (!o) { o = { car: 0, ybc: 0, yaco: 0, rushBt: 0, recBt: 0, recDrop: 0, badThrows: 0, pressured: 0 }; out.set(id, o); } return o; };
  const load = async kind => {
    const p = await nflverse('pfr_advstats', `advstats_week_${kind}_${season}.parquet`, ttl(season, current));
    return p ? (await readParquet(p)).filter(r => r.game_type === 'REG') : [];
  };
  const [rush, rec, pass] = await Promise.all([load('rush'), load('rec'), load('pass')]);
  if (!rush.length && !rec.length) return null;
  for (const r of rush) {
    const o = get(r.pfr_player_id);
    o.car += r.carries ?? 0; o.ybc += r.rushing_yards_before_contact ?? 0; o.yaco += r.rushing_yards_after_contact ?? 0;
    o.rushBt += r.rushing_broken_tackles ?? 0;
  }
  for (const r of rec) { const o = get(r.pfr_player_id); o.recBt += r.receiving_broken_tackles ?? 0; o.recDrop += r.receiving_drop ?? 0; }
  for (const r of pass) { const o = get(r.pfr_player_id); o.badThrows += r.passing_bad_throws ?? 0; o.pressured += r.times_pressured ?? 0; }
  return out;
}

export async function dynastyProcessValues() {
  const f = await cached('https://github.com/dynastyprocess/data/raw/master/files/values-players.csv', 'dp_values_players.csv', 24);
  const g = await cached('https://github.com/dynastyprocess/data/raw/master/files/values-picks.csv', 'dp_values_picks.csv', 24);
  return { players: readCSV(f), picks: g ? readCSV(g) : [] };
}

export function exists(p) { return p && fs.existsSync(p); }
