// Your own boards: paste a ranking from any site you read (Footballguys, Draft Sharks, KeepTradeCut, a r/DynastyFF
// post…). It's matched to the class by name and saved only in this browser — nothing is uploaded or published.
const KEY = 'dl.boards.v1';
const mem = {}; // fallback when the browser blocks storage (private mode): lasts until the page is closed

export const pkey = p => p.cid || `${p.name}|${p.pos}`;

// "C.J. Smith-Jones Jr." -> " cj smith jones " (padded so substring checks only hit whole words)
const norm = s => ` ${String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/['’`.]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ').replace(/\s+/g, ' ').trim()} `;

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
function write(all) {
  try { localStorage.setItem(KEY, JSON.stringify(all)); return true; } catch { return false; }
}

/**
 * Match a pasted ranking to a class. Each line that contains a prospect's name counts once, in order; a leading
 * "1." / "#1" / "1)" sets the rank when most lines have one (so players missing from this app don't shift the rest).
 */
export function parseBoard(text, list) {
  const idx = list.map(p => {
    const full = norm(p.name), t = full.trim().split(' ');
    return { p, full, alias: t.length > 2 ? ` ${t[0]} ${t[t.length - 1]} ` : null, rev: t.length >= 2 ? ` ${t[t.length - 1]} ${t[0]} ` : null };
  }).sort((a, b) => b.full.length - a.full.length);
  const aliasCount = new Map();
  for (const x of idx) if (x.alias) aliasCount.set(x.alias, (aliasCount.get(x.alias) || 0) + 1);
  const seen = new Set(), rows = [], unmatched = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const l = norm(line);
    let hit = idx.find(x => !seen.has(x.p) && l.includes(x.full));
    // "Ryan Williams" for "Ryan Coleman-Williams", or "Smith, Jeremiah"
    hit ||= idx.find(x => !seen.has(x.p) && ((x.alias && aliasCount.get(x.alias) === 1 && l.includes(x.alias)) || (x.rev && l.includes(x.rev))));
    const num = line.match(/^#?(\d{1,3})(?:[.)\]:\-\s]|$)/);
    if (hit) { seen.add(hit.p); rows.push({ p: hit.p, n: num ? Number(num[1]) : null }); }
    else if (/[a-z]{2,}\s+[a-z'’.-]{2,}/i.test(line) && (num || /\b(QB|RB|WR|TE)\d*\b/.test(line))) unmatched.push(line.slice(0, 70));
  }
  const explicit = rows.length && rows.filter(r => r.n != null).length >= rows.length * 0.6;
  const ranks = {};
  rows.forEach((r, i) => { ranks[pkey(r.p)] = explicit && r.n != null ? r.n : i + 1; });
  return { ranks, matched: rows.length, unmatched };
}

/** Saved boards for a class, re-matched against the current list (so new players are picked up after updates). */
export function userBoards(cls, list) {
  const saved = [...(read()[cls] || []), ...(mem[cls] || [])];
  return saved.map(b => {
    const r = parseBoard(b.text, list);
    const max = Math.max(0, ...Object.values(r.ranks));
    // a full board that leaves a player off ranks him behind everyone it did list
    return { ...b, ...r, rank: p => r.ranks[pkey(p)] ?? null, blendRank: p => r.ranks[pkey(p)] ?? (r.matched >= 20 ? max + 10 : null) };
  });
}

export function addBoard(cls, name, text, list) {
  const res = parseBoard(text, list);
  if (!res.matched) return { error: `No ${cls} prospects found in that text. Paste one player per line, e.g. “1. Jeremiah Smith WR Ohio State”.` };
  const all = read();
  const count = (all[cls]?.length || 0) + (mem[cls]?.length || 0);
  const b = { id: Date.now().toString(36), name: String(name || '').trim().slice(0, 32) || `Board ${count + 1}`, date: new Date().toISOString().slice(0, 10), text: String(text).slice(0, 60000) };
  (all[cls] ||= []).push(b);
  if (write(all)) return { board: b, res };
  (mem[cls] ||= []).push(b);
  return { board: b, res, warning: 'This browser blocks saving, so the board lasts only until you close the page.' };
}

export function removeBoard(cls, id) {
  const all = read();
  all[cls] = (all[cls] || []).filter(b => b.id !== id);
  write(all);
  if (mem[cls]) mem[cls] = mem[cls].filter(b => b.id !== id);
}
