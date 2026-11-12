// Dynasty market values: FantasyCalc (live trade data, format-aware) blended with DynastyProcess (FantasyPros ECR).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedJSON } from './fetch.mjs';
import { dynastyProcessValues } from './load.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'out');

// League sizes pre-built for the static website (other sizes snap to the nearest one).
export const STATIC_TEAMS = [8, 10, 12, 14, 16];
export const STATIC_PPR = [0, 0.5, 1];
export const STATIC_QB = [1, 2];

export async function marketValues({ qb, ppr, teams }) {
  const fc = await cachedJSON(
    `https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=${qb}&numTeams=${teams}&ppr=${ppr}`,
    `fc_${qb}qb_${teams}_${ppr}.json`, 6);
  const players = {}, picks = {};
  for (const r of fc || []) {
    if (r.player.position === 'PICK') { picks[r.player.name] = r.value; continue; }
    if (!r.player.sleeperId) continue;
    players[r.player.sleeperId] = { fc: r.value, trend: r.trend30Day };
  }
  try {
    const { fp2sid } = JSON.parse(fs.readFileSync(path.join(OUT, 'idmap.json'), 'utf8'));
    const dp = (await dynastyProcessValues()).players;
    const key = qb === 2 ? 'value_2qb' : 'value_1qb';
    const top = arr => arr.sort((a, b) => b - a).slice(0, 24).reduce((a, b) => a + b, 0) / 24;
    const fcTop = top(Object.values(players).map(p => p.fc));
    const dpTop = top(dp.map(r => r[key] || 0));
    const scale = dpTop ? fcTop / dpTop : 1;
    for (const r of dp) {
      const sid = fp2sid[r.fp_id];
      if (!sid || !r[key]) continue;
      (players[sid] ||= {}).dp = Math.round(r[key] * scale);
    }
  } catch (e) { console.warn('DynastyProcess values unavailable:', e.message); }
  for (const p of Object.values(players)) {
    p.market = p.fc != null && p.dp != null ? Math.round(0.65 * p.fc + 0.35 * p.dp) : p.fc ?? Math.round((p.dp ?? 0) * 0.85);
  }
  return { players, picks, format: { qb, ppr, teams }, fetched: new Date().toISOString() };
}
