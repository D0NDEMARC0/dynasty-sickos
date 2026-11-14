// Which deploy this code belongs to. On the website every script is loaded as file.js?v=<deploy id> (stamped by
// pipeline/site.mjs), and data files are requested with the same id, so a browser can't pair one deploy's code
// with another deploy's data from its cache. On your computer there's no id: the local server never caches.
export const BUILD = new URL(import.meta.url).searchParams.get('v');
const versioned = url => (BUILD ? `${url}${url.includes('?') ? '&' : '?'}v=${BUILD}` : url);

// A tab left open across a deploy keeps running the old code. Before it loads more data, check (at most every
// 30 seconds) that data/site.json still names this deploy; if a newer one has replaced the files, reload into it
// rather than read the new files with the old code. The address keeps the current page. The page's loader just
// confirmed the deploy, so the first check waits 30 seconds. Each change of deploy reloads at most once, so a
// deploy that is only half live can't cause a reload loop.
let checked = Date.now();
export async function fetchData(url, init) {
  if (BUILD && Date.now() - checked > 30000) {
    checked = Date.now();
    try {
      const r = await fetch('data/site.json', { cache: 'no-store' });
      const v = r.ok ? (await r.json()).v : null;
      const key = `${BUILD}>${v}`;
      if (v && v !== BUILD && sessionStorage.getItem('dl.reloadFor') !== key) {
        sessionStorage.setItem('dl.reloadFor', key);
        location.reload();
        return new Promise(() => {});
      }
    } catch { /* offline or no storage: carry on with this deploy */ }
  }
  return fetch(versioned(url), init);
}
