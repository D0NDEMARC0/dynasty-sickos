// Methodology, data sources, import status and data refresh.
import { S, loadData, bump } from '../store.js';
import { M } from '../metrics.js';
import { esc, fmtPct } from '../ui.js';
import { mount } from './common.js';

export function render(root, params, query, rerender) {
  const el = mount(root);
  const m = S.meta;
  const gen = new Date(m.generated);
  const imp = m.imports || [];
  const model = m.model || {};
  const rr = m.routeRate || {};
  el.innerHTML = `
    <div class="prose">
      <h1>Methodology & data</h1>
      <p>Data built ${esc(gen.toLocaleString())} · ${m.current} season through week ${m.week - 1} · ${m.count.toLocaleString()} players · seasons ${m.seasons.join(', ')}.</p>
      ${S.mode === 'server'
        ? `<p class="small" data-sched>Updates itself every week.</p>
           <p><button class="btn primary" data-act="rebuild">Refresh data now</button> <span class="muted small" data-st></span></p>
           <pre class="log" data-log hidden></pre>`
        : '<p class="small">This site rebuilds itself every Tuesday morning with the latest week’s games, injuries and dynasty values.</p>'}

      <h2>Where the numbers come from</h2>
      <table>
        <tr><th>Source</th><th>What it provides</th></tr>
        <tr><td><a href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noopener">nflverse</a></td><td>Play-by-play (EPA, success rate, air yards, red-zone usage), player participation (who was on the field each play, 2016–2025), PFR snap counts, weekly box scores and fantasy points, rosters</td></tr>
        <tr><td>NFL Next Gen Stats (via nflverse)</td><td>Receiver separation & cushion, YAC over expected, rush yards over expected, 8+ box rate, time to LOS, QB time to throw & aggressiveness</td></tr>
        <tr><td>FTN charting (via nflverse)</td><td>Drops, catchable / contested targets, screens, play-action, interception-worthy throws</td></tr>
        <tr><td>Pro Football Reference (via nflverse)</td><td>Yards before / after contact, broken tackles, bad throws, pressures</td></tr>
        <tr><td><a href="https://fantasycalc.com" target="_blank" rel="noopener">FantasyCalc</a> + <a href="https://dynastyprocess.com" target="_blank" rel="noopener">DynastyProcess</a></td><td>Dynasty market values (real trade data + FantasyPros expert consensus), rookie pick values, format-aware (1QB/SF, PPR, team count)</td></tr>
        <tr><td><a href="https://github.com/sportsdataverse/sportsdataverse-data" target="_blank" rel="noopener">sportsdataverse</a> (ESPN college data)</td><td>College play-by-play advanced stats (EPA, success rate, explosive plays, target/touch share, red-zone usage, CPOE), box scores, rosters and recruiting ratings, 2019–present</td></tr>
        <tr><td>nflverse combine & draft picks</td><td>Combine testing (40, jumps, agility, size) since 2000 and every draft pick, used for athleticism and draft capital</td></tr>
        <tr><td><a href="https://docs.sleeper.com" target="_blank" rel="noopener">Sleeper API</a></td><td>Player directory & injuries, your league’s rosters, settings, scoring and traded picks</td></tr>
        ${S.mode === 'server' ? `<tr><td>Your imports</td><td>${imp.length ? imp.map(f => `${esc(f.file)} — ${f.error ? `<span class="down">${esc(f.error)}</span>` : `${esc(f.src)}, ${f.matched} matched${f.unmatched ? `, ${f.unmatched} unmatched` : ''}`}`).join('<br>') : 'None yet — see below.'}</td></tr>` : ''}
      </table>

      <h2>PFF, SumerSports and other premium charting</h2>
      <p>True route-level stats (routes run, YPRR, route grades, route win rate) come from charting companies that sell them. Their terms don’t allow automated collection: <b>PFF</b> prohibits scrapers, automated browsers and even copy-paste extraction, and limits its data to personal, non-public use; <b>SumerSports</b> prohibits any robot, spider or scraper. So this app doesn’t scrape them.</p>
      <p>If you subscribe, you can still use your data here: export CSVs from PFF Premium Stats (receiving, rushing and passing summaries) and drop them in <code>data/imports/pff/</code>, then click <b>Refresh data</b>. Real route counts replace the estimates below, and grades, yards after contact, elusive rating, slot rate etc. show on player pages. Any other provider’s CSV export you’re licensed to use works the same way (headers like <code>routes</code>, <code>yprr</code>, <code>separation</code> are detected automatically). Imports only work in the version running on your own computer, and they’re never included in the shareable website.</p>

      <h2>Routes run & YPRR</h2>
      <p>For 2023–25, routes come from nflverse participation data: every dropback a player was on the field for, times a position route rate (WR ${rr.WR}, TE ${rr.TE}, RB ${rr.RB}) to remove pass-blocking snaps. Participation data for the current season is only published after the season, so ${m.current} routes are estimated per game as <i>snap share × team dropbacks × the player’s own pass-down skew from last season</i> (how much more often they’re on the field for passes than runs, shrunk toward the position average). Back-tested on full seasons, that estimate averages ${Object.entries(m.routeDiag || {}).map(([y, d]) => `${fmtPct(d.mape, 1)} error in ${y}`).join(' and ')}. YPRR = receiving yards ÷ routes; TPRR = targets ÷ routes.</p>

      <h2>Analytics Score (0–100)</h2>
      <p>For each position and season, every metric is converted to a percentile among qualified players (WR/TE ≥10 routes per team game, RB ≥6 opportunities, QB ≥14 dropbacks). The score is a weighted average of the most predictive ones. Small samples are pulled toward 35. The dynasty-facing score blends the last three seasons (weights 1.2 / 0.6 / 0.25, scaled by games played).</p>
      <table><tr><th>Pos</th><th>Weights</th></tr>
        ${Object.entries(model).map(([pos, ws]) => `<tr><td>${pos}</td><td>${ws.map(([k, w]) => `${esc(M[k]?.label || k)} ${Math.round(w * 100)}%`).join(', ')}</td></tr>`).join('')}
      </table>

      <h2>Lab value & Buy/Sell signals</h2>
      <p><b>Market value</b> = 65% FantasyCalc + 35% DynastyProcess (rescaled to FantasyCalc’s range). The market already pays for elite production, so raw scores can’t say who’s mispriced. Instead, rosterable players (market ≥ 300) with a real sample are ranked twice within their position: by <b>price</b>, and by <b>fundamentals</b> = Analytics percentile blended with age-window percentile, using the age weight that best reproduces the market’s own ordering${S.fundFit ? ` (currently ${Object.entries(S.fundFit).map(([p, f]) => `${p} ${Math.round(f.alpha * 100)}%`).join(', ')})` : ''}. First- and second-year players are re-centered on the typical young-player gap, since the market prices their projection. <b>Edge</b> = fundamentals percentile − price percentile. <b>Lab value</b> = market × e<sup>weight × edge / 30</sup> × age-tilt multiplier. Players whose Lab value is ≥10% above market are flagged <b>▲ Buy</b>; ≥10% below, <b>▼ Sell</b>. The age score is the share of a peak-level five-year window still ahead of the player, from position-specific age curves (RBs peak 23–25 and fall off fast after 27; WRs 24–27; TEs 26–29; QBs 26–33).</p>

      <h2>Rookies, prospects & college data</h2>
      <p><b>College stats</b> are built from ESPN college play-by-play the same way the NFL numbers are: EPA per play, success rate, explosive-play rate, target and touch share, red-zone usage and CPOE, plus box-score production. Key prospect metrics: <b>dominator rating</b> (average of a receiver’s share of team receiving yards and TDs), <b>YPTPA</b> (receiving yards per team pass attempt) and <b>scrimmage share</b> for running backs. College CPOE is centered on each season’s league average, because ESPN’s expected-completion model runs about 5 points low across all of college football.</p>
      <p><b>Prospect Score (0–100)</b> blends: college <b>production</b> (percentile of the best season’s key metrics vs. prospects at the position), <b>breakout</b> (first season as a featured producer: WR 20%+ dominator, TE 15%+, RB 20%+ of team scrimmage yards; scored by age when the birth date is known, otherwise by class year), <b>athleticism</b> (combine speed score, jumps and agility vs. every combine since 2000), <b>age</b> on draft day, <b>recruiting</b> stars, and — once drafted — <b>draft capital</b>, the single strongest predictor of rookie success.</p>
      <table><tr><th>Stage</th><th>Weights</th></tr>
        <tr><td>Before the draft</td><td>Production 55%, breakout 15%, athleticism 15%, age 10%, recruiting 5%</td></tr>
        <tr><td>After the draft</td><td>Draft capital 40%, production 35%, breakout 10%, athleticism 10%, age 5%</td></tr>
      </table>
      <p>The incoming class updates itself through the year: during the college season it’s a <b>watch list</b> of draft-eligible juniors and seniors with real production; in early March it becomes the official <b>combine invitees</b> with athletic testing; after the NFL Draft in late April it becomes the <b>drafted class</b> with draft capital, and the next class’s watch list takes its place when the following season starts.</p>

      <h2>Metric glossary</h2>
      <table><tr><th>Metric</th><th>Definition</th><th>Source</th></tr>
        ${Object.entries(M).filter(([k]) => !k.startsWith('x_')).map(([, v]) => `<tr><td>${esc(v.label)}</td><td>${esc(v.desc)}</td><td class="muted">${esc(v.src)}</td></tr>`).join('')}
      </table>
    </div>`;

  if (S.mode === 'server') {
    fetch('api/status', { cache: 'no-store' }).then(r => r.json()).then(s => {
      const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][s.schedule?.day ?? 2];
      const next = new Date(s.nextUpdate).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const box = el.querySelector('[data-sched]');
      if (box) box.innerHTML = `<b>Automatic updates:</b> every ${day} at ${s.schedule?.hour ?? 10}:00 while the app is running, and right away on startup if a week was missed. Next update: ${esc(next)}.`;
    }).catch(() => {});
  }

  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-act="rebuild"]');
    if (!b) return;
    b.disabled = true;
    const st = el.querySelector('[data-st]'), log = el.querySelector('[data-log]');
    st.innerHTML = '<span class="spinner"></span> Rebuilding (about 30 seconds)…';
    log.hidden = false;
    await fetch('api/rebuild', { method: 'POST' });
    const poll = async () => {
      const s = await (await fetch('api/status', { cache: 'no-store' })).json();
      log.textContent = s.log;
      log.scrollTop = log.scrollHeight;
      if (s.running) return setTimeout(poll, 1500);
      if (s.ok) { await loadData(); bump(); st.textContent = 'Done — data reloaded.'; setTimeout(rerender, 600); }
      else { st.textContent = 'Rebuild failed — see log.'; b.disabled = false; }
    };
    poll();
  });
}
