// Public attention + birth dates from Wikimedia open data.
// Wikidata (CC0) lists American football players with English Wikipedia articles (name, birth date, colleges);
// Wikimedia's pageview API gives monthly article views. Views are a measure of hype/attention, which NFL draft
// buzz and fantasy expert rankings track closely and college stats can't see.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE_DIR } from './fetch.mjs';

const UA = 'dynasty-lab-analytics/1.0 (personal fantasy football analytics)';
const DAY = 864e5;
// committed fallbacks for builds on shared servers that Wikipedia may throttle (written with WRITE_WIKI_SEED=1)
const SEED_DIR = path.dirname(fileURLToPath(import.meta.url));
const seed = name => { const f = path.join(SEED_DIR, name); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; };
export function writeSeeds() {
  const read = n => (fs.existsSync(path.join(CACHE_DIR, n)) ? JSON.parse(fs.readFileSync(path.join(CACHE_DIR, n), 'utf8')) : {});
  fs.writeFileSync(path.join(SEED_DIR, 'wiki_titles_seed.json'), JSON.stringify(Object.fromEntries(Object.entries(read('wiki_titles.json')).map(([k, v]) => [k, v.title || null]))));
  fs.writeFileSync(path.join(SEED_DIR, 'wiki_recent_seed.json'), JSON.stringify(Object.fromEntries(Object.entries(read('wiki_recent.json')).map(([k, v]) => [k, Math.round(v.v)]))));
}

/** Every American football player born 1995+ with an English Wikipedia article. Cached for a week. */
export async function wikiPlayers(log) {
  const file = path.join(CACHE_DIR, 'wikidata_football_players.json');
  const cachedRows = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []);
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 7 * DAY) return cachedRows();
  // three birth-year slices keep each query well under the endpoint's time limit; each is retried on a hiccup
  const query = (from, to) => `SELECT ?p ?pLabel ?article ?dob (GROUP_CONCAT(DISTINCT ?collegeLabel; separator="|") AS ?colleges) WHERE {
    ?p wdt:P106 wd:Q19204627; wdt:P569 ?dob .
    FILTER(?dob >= "${from}"^^xsd:dateTime && ?dob < "${to}"^^xsd:dateTime)
    ?article schema:about ?p; schema:isPartOf <https://en.wikipedia.org/> .
    OPTIONAL { ?p wdt:P69 ?college . ?college rdfs:label ?collegeLabel . FILTER(LANG(?collegeLabel) = "en") }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } GROUP BY ?p ?pLabel ?article ?dob`;
  const run = async q => {
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()).results.bindings;
      } catch (e) {
        if (attempt >= 4) throw e;
        await new Promise(res => setTimeout(res, 4000 * attempt));
      }
    }
  };
  try {
    const rows = [];
    for (const [from, to] of [['1995-01-01', '2000-01-01'], ['2000-01-01', '2003-01-01'], ['2003-01-01', '2012-01-01']]) {
      for (const b of await run(query(from, to))) {
        rows.push({
          name: b.pLabel.value, title: decodeURIComponent(b.article.value.split('/wiki/')[1]),
          dob: b.dob?.value?.slice(0, 10) || null, colleges: b.colleges?.value ? b.colleges.value.split('|') : [],
        });
      }
    }
    fs.writeFileSync(file, JSON.stringify(rows));
    log(`  Wikidata: ${rows.length} football players with Wikipedia articles`);
    return rows;
  } catch (e) {
    log('  Wikidata unavailable (using cache if any):', e.message);
    return cachedRows();
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// one Action API GET with retry on throttling; returns parsed JSON or null
async function actionApi(params) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const r = await fetch(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`, { headers: { 'User-Agent': UA } }).catch(() => null);
    if (r?.status === 429) { await sleep((Number(r.headers.get('retry-after')) || 20) * 1000 + 1000); continue; }
    if (!r?.ok) return null;
    return r.json().catch(() => null);
  }
  return null;
}

/**
 * Wikipedia articles for current college players that Wikidata doesn't list (its entries are often missing a birth
 * date or occupation). Tries "Name", "Name (American football)" and "Name (<position>)", and accepts a page only if
 * it's in a "<school> … football players" category for a school the player attended. Cached two weeks.
 * players: [{ key, name, pos, teams: [school names] }] → Map(key -> title)
 */
export async function findArticles(players, { schoolKey, log }) {
  const file = path.join(CACHE_DIR, 'wiki_titles.json');
  const cache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const seeded = seed('wiki_titles_seed.json');
  for (const [k, title] of Object.entries(seeded)) cache[k] ||= { at: Date.now() - 7 * DAY, title }; // counts as a week old
  const POSW = { QB: 'quarterback', RB: 'running back', WR: 'wide receiver', TE: 'tight end' };
  const variants = p => [...new Set([p.name, `${p.name} (American football)`, `${p.name} (${POSW[p.pos] || 'American football'})`, p.name.replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, '')])];
  const todo = players.filter(p => !cache[p.key] || Date.now() - cache[p.key].at > 14 * DAY);
  const titleInfo = new Map(); // requested title -> { title, cats }
  const all = [...new Set(todo.flatMap(variants))];
  for (let i = 0; i < all.length; i += 50) {
    const batch = all.slice(i, i + 50);
    let cont = {};
    const pages = new Map(), back = new Map();
    for (let guard = 0; guard < 20; guard++) { // categories come in pages ("continue")
      const j = await actionApi({ action: 'query', prop: 'categories', cllimit: 'max', clshow: '!hidden', redirects: '1', titles: batch.join('|'), ...cont });
      if (!j?.query) break;
      for (const n of j.query.normalized || []) back.set(n.to, n.from);
      for (const n of j.query.redirects || []) back.set(n.to, back.get(n.from) || n.from);
      for (const pg of j.query.pages || []) {
        const cur = pages.get(pg.title) || { missing: !!pg.missing, cats: [] };
        cur.cats.push(...(pg.categories || []).map(c => c.title));
        pages.set(pg.title, cur);
      }
      if (!j.continue) break;
      cont = j.continue;
      await sleep(1500);
    }
    for (const [t, v] of pages) if (!v.missing) titleInfo.set(back.get(t) || t, { title: t.replace(/ /g, '_'), cats: v.cats });
    await sleep(2500);
  }
  let found = 0;
  for (const p of todo) {
    const keys = p.teams.map(schoolKey).filter(Boolean);
    let hit = null;
    for (const v of variants(p)) {
      const info = titleInfo.get(v);
      if (!info) continue;
      const ok = info.cats.some(c => /football players/i.test(c) && keys.some(k => schoolKey(c).includes(k)));
      if (ok) { hit = info.title; break; }
    }
    cache[p.key] = { at: Date.now(), title: hit };
    if (hit) found++;
  }
  if (todo.length) fs.writeFileSync(file, JSON.stringify(cache));
  log?.(`  Wikipedia article lookup: ${todo.length ? `checked ${todo.length} players, found ${found}` : 'cached'}`);
  return new Map(players.filter(p => cache[p.key]?.title).map(p => [p.key, cache[p.key].title]));
}

/**
 * Recent attention for players still in school: average daily views over the last 60 days × 30 (a monthly
 * equivalent), from the MediaWiki API — 50 articles per request, so a whole class is a handful of calls.
 */
export async function recentViews(titles, log) {
  // cached ~6 days; a throttled or empty answer is never recorded as "no views" (it's retried next build)
  const file = path.join(CACHE_DIR, 'wiki_recent.json');
  const cache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  for (const [t, v] of Object.entries(seed('wiki_recent_seed.json'))) cache[t] ||= { at: 0, v }; // stale: refreshed if possible
  const list = [...new Set(titles)];
  const todo = list.filter(t => !cache[t] || Date.now() - cache[t].at > 6 * DAY);
  let got = 0;
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    // the API returns views for only part of the batch per call and hands back a "continue" token for the rest
    let cont = {};
    for (let guard = 0; guard < 30; guard++) {
      const j = await actionApi({ action: 'query', prop: 'pageviews', pvipdays: '60', redirects: '1', titles: batch.join('|'), ...cont });
      if (!j?.query) break;
      // map API titles (spaces, redirect targets) back to the titles we asked for
      const back = new Map();
      for (const n of j.query.normalized || []) back.set(n.to, n.from);
      for (const n of j.query.redirects || []) back.set(n.to, back.get(n.from) || n.from);
      for (const p of j.query.pages || []) {
        const key = (back.get(p.title) || p.title).replace(/ /g, '_');
        const v = Object.values(p.pageviews || {}).filter(x => x != null);
        if (v.length >= 14) { if (!cache[key] || cache[key].at < Date.now() - 6 * DAY) got++; cache[key] = { at: Date.now(), v: (v.reduce((a, b) => a + b, 0) / v.length) * 30 }; }
        else if (p.missing) { cache[key] = { at: Date.now(), v: 0 }; got++; }
      }
      if (!j.continue) break;
      cont = j.continue;
      await sleep(1000);
    }
    await sleep(2000);
  }
  if (todo.length) fs.writeFileSync(file, JSON.stringify(cache));
  const out = Object.fromEntries(list.filter(t => cache[t]).map(t => [t, cache[t].v]));
  log?.(`  Wikipedia recent pageviews: ${Object.keys(out).length} of ${list.length} articles${todo.length ? ` (refreshed ${got})` : ''}`);
  return out;
}

/**
 * Monthly views for past seasons (Wikimedia REST API, one call per article), fetched one at a time within the
 * API's anonymous rate limit and kept forever: history doesn't change. A committed seed file means the website
 * build doesn't have to re-fetch it. Returns { title: { YYYYMM: views } } for titles fetched so far.
 */
export async function historyViews(titles, { seedFile, log, budgetMs = 8 * 60e3 } = {}) {
  const file = path.join(CACHE_DIR, 'wiki_pageviews.json');
  const db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  if (seedFile && fs.existsSync(seedFile)) for (const [t, m] of Object.entries(JSON.parse(fs.readFileSync(seedFile, 'utf8')))) db[t] ||= { at: 0, m };
  const now = new Date();
  const end = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}0100`;
  const todo = [...new Set(titles)].filter(t => !db[t]);
  const t0 = Date.now();
  let ok = 0;
  for (const t of todo) {
    if (Date.now() - t0 > budgetMs) break;
    let r = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      r = await fetch(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user/${encodeURIComponent(t)}/monthly/2019010100/${end}`, { headers: { 'User-Agent': UA } }).catch(() => null);
      if (r?.status !== 429) break;
      await sleep((Number(r.headers.get('retry-after')) || 30) * 1000 + 1000);
    }
    if (r?.status === 404) db[t] = { at: Date.now(), m: {} };
    else if (r?.ok) { const j = await r.json(); db[t] = { at: Date.now(), m: Object.fromEntries((j.items || []).map(x => [x.timestamp.slice(0, 6), x.views])) }; ok++; }
    await sleep(1100);
  }
  if (todo.length) {
    fs.writeFileSync(file, JSON.stringify(db));
    const left = [...new Set(titles)].filter(x => !db[x]).length;
    log?.(`  Wikipedia pageview history: fetched ${ok} articles${left ? `, ${left} still to fetch (continues next build)` : ''}`);
  }
  return Object.fromEntries(Object.entries(db).map(([t, v]) => [t, v.m]));
}

/** Average monthly views over [from, to] (YYYYMM, inclusive). */
export function avgViews(months, from, to) {
  if (!months) return 0;
  let s = 0, n = 0;
  for (let y = Number(from.slice(0, 4)), m = Number(from.slice(4)); `${y}${String(m).padStart(2, '0')}` <= to; m === 12 ? (y++, m = 1) : m++) {
    s += months[`${y}${String(m).padStart(2, '0')}`] || 0; n++;
  }
  return n ? s / n : 0;
}
