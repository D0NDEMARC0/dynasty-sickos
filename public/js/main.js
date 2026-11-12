// App shell: router, header format controls, theme, data freshness, startup.
import { S, detectMode, loadData, loadValues, loadLeague, persist, bump } from './store.js';
import { initTips, esc } from './ui.js';
import * as rankings from './views/rankings.js';
import * as analytics from './views/analytics.js';
import * as player from './views/player.js';
import * as league from './views/league.js';
import * as about from './views/about.js';
import * as prospects from './views/prospects.js';
import * as college from './views/college.js';
import * as collegePlayer from './views/collegePlayer.js';

const app = document.getElementById('app');
const banner = document.getElementById('banner');

function parse() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  if (parts[0] === 'player' && parts[1]) return { name: 'player', view: player, params: { id: parts[1] }, query };
  if (parts[0] === 'league') return { name: 'league', view: league, params: parts[1] === 'team' ? { team: parts[2] } : {}, query };
  if (parts[0] === 'analytics') return { name: 'analytics', view: analytics, params: {}, query };
  if (parts[0] === 'prospects') return { name: 'prospects', view: prospects, params: {}, query };
  if (parts[0] === 'college' && parts[1] === 'player' && parts[2]) return { name: 'college', view: collegePlayer, params: { cid: parts[2] }, query };
  if (parts[0] === 'college') return { name: 'college', view: college, params: {}, query };
  if (parts[0] === 'about') return { name: 'about', view: about, params: {}, query };
  return { name: 'rankings', view: rankings, params: {}, query };
}

let renderSeq = 0, lastPath = null, lastWidth = innerWidth;
async function route() {
  const seq = ++renderSeq;
  const r = parse();
  const path = location.hash.split('?')[0];
  if (path !== lastPath) { window.scrollTo(0, 0); lastPath = path; }
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.route === r.name || (r.name === 'player' && a.dataset.route === 'rankings')));
  controls();
  try {
    await r.view.render(app, r.params, r.query, () => { if (seq === renderSeq) route(); });
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="empty">Something went wrong: ${esc(e.message)}</div>`;
  }
}

function controls() {
  const box = document.getElementById('controls');
  const L = S.league;
  const sc = S.settings.scoring;
  const sizes = S.mode === 'static' ? (S.site?.teams || [12]) : [8, 10, 12, 14, 16, 20, 24, 32];
  box.innerHTML = `
    ${L ? `<span class="league-pill" title="Format set by your Sleeper league"><span>League</span><b>${esc(L.info.name)}</b></span>` : ''}
    <div class="seg" data-k="qb" title="${L ? 'Set by your league' : 'QB format'}">
      <button data-v="1" class="${S.settings.qb === 1 ? 'on' : ''}" ${L ? 'disabled' : ''}>1QB</button><button data-v="2" class="${S.settings.qb === 2 ? 'on' : ''}" ${L ? 'disabled' : ''}>SF</button>
    </div>
    <select data-k="scoring" aria-label="Scoring">
      ${L ? `<option value="league" ${sc === 'league' ? 'selected' : ''}>League scoring</option>` : ''}
      <option value="ppr" ${sc === 'ppr' ? 'selected' : ''}>PPR</option><option value="half" ${sc === 'half' ? 'selected' : ''}>Half PPR</option><option value="std" ${sc === 'std' ? 'selected' : ''}>Standard</option>
    </select>
    <select data-k="teams" aria-label="League size" ${L ? 'disabled' : ''}>${sizes.map(n => `<option value="${n}" ${S.settings.teams === n ? 'selected' : ''}>${n} teams</option>`).join('')}</select>
    <button class="icon-btn" data-k="theme" title="Theme: ${S.settings.theme}" aria-label="Toggle theme">${{ auto: '◐', light: '☀', dark: '☾' }[S.settings.theme]}</button>`;
}

async function onControl(k, v) {
  if (k === 'theme') {
    S.settings.theme = { auto: 'light', light: 'dark', dark: 'auto' }[S.settings.theme];
    applyTheme(); persist(); controls(); return;
  }
  if (k === 'qb') S.settings.qb = Number(v);
  if (k === 'teams') S.settings.teams = Number(v);
  if (k === 'scoring') S.settings.scoring = v;
  persist(); bump();
  app.style.opacity = '.6';
  try { await loadValues(); } finally { app.style.opacity = ''; }
  route();
}
document.getElementById('controls').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (b.dataset.k === 'theme') return onControl('theme');
  const seg = b.closest('.seg');
  if (seg) onControl(seg.dataset.k, b.dataset.v);
});
document.getElementById('controls').addEventListener('change', e => { if (e.target.dataset.k) onControl(e.target.dataset.k, e.target.value); });

// chart points and other non-anchor links
document.addEventListener('click', e => {
  const el = e.target.closest('[data-href]');
  if (el) location.hash = el.getAttribute('data-href');
});

function applyTheme() {
  const t = S.settings.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

function showBanner(html, ms) {
  banner.innerHTML = html;
  banner.hidden = false;
  if (ms) setTimeout(() => { banner.hidden = true; }, ms);
}

// ---------- data freshness (local server mode) ----------
// The server rebuilds the data every week on its own; when a new build lands, reload it in place.
async function status() { return (await fetch('api/status', { cache: 'no-store' })).json(); }
let watching = false;
async function watchData() {
  if (S.mode !== 'server' || watching) return;
  watching = true;
  try {
    for (;;) {
      const s = await status();
      const builtAt = s.generated ? new Date(s.generated).getTime() : 0;
      const haveAt = S.meta ? new Date(S.meta.generated).getTime() : 0;
      if (s.running) {
        showBanner(`<span class="spinner"></span> Updating to the latest NFL week… the page refreshes itself when it’s done.`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      if (builtAt - haveAt > 60e3 && s.ok !== false) {
        await loadData();
        route();
        showBanner(`Updated with games through week ${S.meta.week - 1}.`, 6000);
      } else if (s.ok === false && s.reason !== 'manual') {
        showBanner('The weekly data update didn’t finish (offline?). It will retry automatically.', 8000);
      } else banner.hidden = true;
      await new Promise(r => setTimeout(r, 5 * 60e3));
    }
  } catch { /* server stopped — nothing to watch */ } finally { watching = false; }
}

async function waitForBuild() {
  app.innerHTML = '<div class="empty"><span class="spinner"></span> Building the data set for the first time (about 30–60 seconds)…<pre class="log" id="bootlog" style="text-align:left;max-width:720px;margin:16px auto"></pre></div>';
  for (;;) {
    const s = await status();
    const log = document.getElementById('bootlog');
    if (log) log.textContent = s.log;
    if (!s.running) return s.ok !== false;
    await new Promise(r => setTimeout(r, 1500));
  }
}

async function start() {
  applyTheme();
  initTips();
  await detectMode();
  try { await loadData(); }
  catch {
    if (S.mode === 'static') { app.innerHTML = '<div class="empty">The data for this site hasn’t been published yet — check back after the next update.</div>'; return; }
    if (!(await waitForBuild())) { app.innerHTML = '<div class="empty">Data build failed — check the terminal running the server.</div>'; return; }
    await loadData();
  }
  if (S.settings.scoring === 'league' && !S.leagueId) S.settings.scoring = 'ppr';
  if (S.leagueId) { try { await loadLeague(S.leagueId); } catch { S.leagueId = null; S.settings.scoring = S.settings.scoring === 'league' ? 'ppr' : S.settings.scoring; persist(); } }
  try { await loadValues(); }
  catch (e) { app.innerHTML = `<div class="empty">Couldn’t load dynasty market values (${esc(e.message)}).</div>`; return; }
  window.addEventListener('hashchange', route);
  // charts are drawn at their container's pixel width, so redraw after a real width change
  let t;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => { if (Math.abs(innerWidth - lastWidth) > 60) { lastWidth = innerWidth; route(); } }, 250);
  });
  route();
  watchData();
}
start();
