// Which version of the app this tab is running, so it never shows old code with new data.
// - On the website every script is loaded as file.js?v=<deploy id> (stamped by pipeline/site.mjs) and data files
//   are requested with the same id; data/site.json (never cached) names the current deploy.
// - On your computer the local server fingerprints its code and data files (api/version).
// A tab left open while the app was updated reloads into the new version the next time it changes page or loads
// more data. The address keeps the current page. Each change reloads at most once, so a half-finished update can't
// cause a reload loop.
export const BUILD = new URL(import.meta.url).searchParams.get('v');
const versioned = url => (BUILD ? `${url}${url.includes('?') ? '&' : '?'}v=${BUILD}` : url);

const latest = async () => {
  try {
    const r = await fetch(BUILD ? 'data/site.json' : 'api/version', { cache: 'no-store' });
    return r.ok ? (await r.json()).v || null : null;
  } catch { return null; } // offline: carry on with this version
};
let mine = BUILD;
const ready = BUILD ? Promise.resolve() : latest().then(v => { mine = v; });
// the website's page loader just confirmed the deploy; local checks are cheap
const EVERY = BUILD ? 30000 : 3000;
let checked = Date.now();

async function outdated() {
  if (Date.now() - checked < EVERY) return false;
  checked = Date.now();
  await ready;
  const v = await latest();
  if (!v || !mine || v === mine) return false;
  const key = `${mine}>${v}`;
  try {
    if (sessionStorage.getItem('dl.reloadFor') === key) return false;
    sessionStorage.setItem('dl.reloadFor', key);
  } catch { return false; } // no storage: never risk a reload loop
  return true;
}

export async function fetchData(url, init) {
  if (await outdated()) { location.reload(); return new Promise(() => {}); }
  return fetch(versioned(url), init);
}

addEventListener('hashchange', async () => { if (await outdated()) location.reload(); });
