// Online NFL mock-draft consensus: Pro Football Network's free Mock Draft Index aggregates dozens of public mock
// drafts (ESPN, CBS, PFF, The Athletic, Bleacher Report, SI…). Its page publishes the consensus order as schema.org
// structured data (the machine-readable list it provides for search engines); we read only that list, once a week,
// and credit/link the source wherever it's shown.
import fs from 'node:fs';
import { cached } from './fetch.mjs';

export const MOCK_INDEX_URL = year => `https://www.profootballnetwork.com/nfl-draft-hq/mock-draft-index?year=${year}`;

/** [{ rank, name, pos, school }] for that draft year, or [] if unavailable. */
export async function mockConsensus(year, log) {
  try {
    const f = await cached(MOCK_INDEX_URL(year), `pfn_mock_index_${year}.html`, 72);
    if (!f) return [];
    const html = fs.readFileSync(f, 'utf8');
    for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
      let o;
      try { o = JSON.parse(m[1]); } catch { continue; }
      const list = (o['@graph'] || [o]).find(x => x['@type'] === 'ItemList' && /mock draft consensus/i.test(x.name || ''));
      if (!list) continue;
      const out = (list.itemListElement || []).map(e => ({ rank: e.position, name: e.item?.name, pos: e.item?.jobTitle, school: e.item?.affiliation?.name })).filter(x => x.name && x.rank);
      log?.(`  online mock consensus (${year}): ${out.length} prospects from Pro Football Network's Mock Draft Index`);
      return out;
    }
  } catch (e) { log?.('  online mock consensus unavailable:', e.message); }
  return [];
}
