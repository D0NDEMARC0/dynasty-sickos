// Online NFL mock-draft consensus: Pro Football Network's free Mock Draft Index aggregates analysts' public mock
// drafts (ESPN, CBS, PFF, The Athletic, The Sporting News, SI…). We read two things from the page, once every few
// days, and credit/link the source wherever it's shown:
// - season: its consensus top 40 by average draft position across every mock of the cycle (the ranked list the
//   page publishes as schema.org data for search engines). Slow to move.
// - recent: its "consensus by pick" table for the latest mocks: the most-mocked player at each first-round pick
//   and in how many of those mocks. This is where risers (and fallers) show up first.
import fs from 'node:fs';
import { cached } from './fetch.mjs';

export const MOCK_INDEX_URL = year => `https://www.profootballnetwork.com/nfl-draft-hq/mock-draft-index?year=${year}`;

const text = s => s.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

function seasonList(html) {
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let o;
    try { o = JSON.parse(m[1]); } catch { continue; }
    const list = (o['@graph'] || [o]).find(x => x['@type'] === 'ItemList' && /mock draft consensus/i.test(x.name || ''));
    if (list) return (list.itemListElement || []).map(e => ({ rank: e.position, name: e.item?.name, pos: e.item?.jobTitle, school: e.item?.affiliation?.name })).filter(x => x.name && x.rank);
  }
  return [];
}

// rows like: 3 | Drew Mestemaker | QB | Oklahoma State | Miami Dolphins MIA | 7 / 11 | 64%
function recentTable(html) {
  const start = html.indexOf('Freq.');
  if (start < 0) return { mocks: 0, rows: [] };
  const end = html.indexOf('</table>', start);
  const rows = [];
  for (const [tr] of html.slice(start, end < 0 ? undefined : end).matchAll(/<tr[\s\S]*?<\/tr>/g)) {
    const name = text((tr.match(/<a[^>]*href="\/nfl-draft-hq\/prospects\/[^"]+"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '');
    const t = text(tr);
    const pick = Number((t.match(/^(\d+)\s/) || [])[1]);
    const f = t.match(/(\d+)\s*\/\s*(\d+)\s+\d+\s*%\s*$/);
    if (!name || !pick || !f) continue;
    const pos = (t.slice(t.indexOf(name) + name.length).trim().split(' ')[0] || '').toUpperCase();
    rows.push({ pick, name, pos, n: Number(f[1]), m: Number(f[2]) });
  }
  return { mocks: Math.max(0, ...rows.map(r => r.m)), rows };
}

/** { season: [{ rank, name, pos, school }], recent: { mocks, rows: [{ pick, name, pos, n, m }] } }, empty if unavailable. */
export async function mockConsensus(year, log) {
  const none = { season: [], recent: { mocks: 0, rows: [] } };
  try {
    const f = await cached(MOCK_INDEX_URL(year), `pfn_mock_index_${year}.html`, 72);
    if (!f) return none;
    const html = fs.readFileSync(f, 'utf8');
    const out = { season: seasonList(html), recent: recentTable(html) };
    log?.(`  online mock consensus (${year}): season-long top ${out.season.length} + first round of the latest ${out.recent.mocks} mocks, from Pro Football Network's Mock Draft Index`);
    return out;
  } catch (e) { log?.('  online mock consensus unavailable:', e.message); }
  return none;
}

/**
 * One projected NFL pick per player from both views, weighted 3:1 toward the latest mocks. A player missing from
 * a view is placed just past its end: past the first round for the latest mocks (keeping the season order among
 * those players), past the top 40 for the season-long list.
 */
export function mockEstimate({ season, recent }) {
  const out = new Map(); // key -> { rank, recent, recentN, recentM, est }
  const key = (name, pos) => `${name}|${pos}`;
  for (const r of season) out.set(key(r.name, r.pos), { name: r.name, pos: r.pos, rank: r.rank });
  const acc = new Map();
  for (const r of recent.rows) {
    const k = key(r.name, r.pos);
    const a = acc.get(k) || { name: r.name, pos: r.pos, s: 0, n: 0, picks: [] };
    a.s += r.pick * r.n; a.n += r.n; a.picks.push(`#${r.pick} in ${r.n}`);
    acc.set(k, a);
  }
  for (const [k, a] of acc) out.set(k, { ...(out.get(k) || { name: a.name, pos: a.pos }), recent: a.s / a.n, recentN: a.n, recentM: recent.mocks, picks: a.picks });
  const seasonEnd = Math.max(40, season.length);
  for (const v of out.values()) {
    const r = v.recent ?? (recent.mocks ? 32 + (v.rank ?? seasonEnd) / 2 : null);
    const s = v.rank ?? seasonEnd + 1;
    v.est = r == null ? s : Math.exp(0.75 * Math.log(r) + 0.25 * Math.log(s));
  }
  return out;
}
