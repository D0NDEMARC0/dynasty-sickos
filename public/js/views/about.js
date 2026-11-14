// Methodology, data sources, import status and data refresh.
import { S, loadData, bump } from '../store.js';
import { M } from '../metrics.js';
import { loadProspects } from '../college.js';
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
        <tr><td><a href="https://fantasycalc.com" target="_blank" rel="noopener">FantasyCalc</a></td><td>Dynasty market values from real trades in dynasty leagues, format-aware (1QB/SF, PPR, team count), and rookie pick values. <a href="https://dynastyprocess.com" target="_blank" rel="noopener">DynastyProcess</a> (FantasyPros expert rankings) only fills in players FantasyCalc doesn’t value</td></tr>
        <tr><td><a href="https://github.com/sportsdataverse/sportsdataverse-data" target="_blank" rel="noopener">sportsdataverse</a> (ESPN college data)</td><td>College play-by-play advanced stats (EPA, success rate, explosive plays, target/touch share, red-zone usage, CPOE), box scores, rosters and recruiting ratings, 2019–present</td></tr>
        <tr><td>nflverse combine & draft picks</td><td>Combine testing (40, jumps, agility, size) since 2000 and every draft pick, used for athleticism and draft capital</td></tr>
        <tr><td>Wikimedia (Wikidata + Wikipedia pageviews)</td><td>Birth dates of college players with a Wikipedia article (exact ages) and monthly page views, the “Buzz” attention signal for prospects. Public-domain data</td></tr>
        <tr><td><a href="https://github.com/ffverse/ffopportunity" target="_blank" rel="noopener">ffopportunity</a> (ffverse)</td><td>Expected fantasy points: what an average player scores with the same targets, carries and pass attempts — the basis for xFP and points over expected</td></tr>
        <tr><td>FantasyPros (via DynastyProcess) + Sleeper ADP</td><td>Dynasty rookie expert rankings; rookie-draft and startup ADP from real Sleeper drafts</td></tr>
        <tr><td><a href="https://docs.sleeper.com" target="_blank" rel="noopener">Sleeper API</a></td><td>Player directory & injuries, your league’s rosters, settings, scoring and traded picks</td></tr>
        ${S.mode === 'server' ? '<tr><td>Pahowdy’s Prospect Database (this computer only)</td><td>His pre/post-draft and production scores, breakout ages, birth dates and PFF college stats (YRR, target share, slot rate, elusive rating, QB accuracy), shown on player pages. It’s shared for personal use and includes PFF data, so it never goes on the website</td></tr>' : ''}
        ${S.mode === 'server' ? `<tr><td>Your imports</td><td>${imp.length ? imp.map(f => `${esc(f.file)} — ${f.error ? `<span class="down">${esc(f.error)}</span>` : `${esc(f.src)}, ${f.matched} matched${f.unmatched ? `, ${f.unmatched} unmatched` : ''}`}`).join('<br>') : 'None yet — see below.'}</td></tr>` : ''}
      </table>

      <h2>Where the paid sites get their numbers</h2>
      <p><b>NFL:</b> everything starts from the league’s official play-by-play and Next Gen Stats player tracking (chips in the shoulder pads), which the NFL licenses through Genius Sports. On top of that, charting companies watch every snap and log what the feed can’t: <b>PFF</b> (grades, routes, alignment), <b>Sports Info Solutions</b> (yards after contact, broken tackles, drops; it powers Pro Football Reference’s advanced stats), <b>FTN</b> (catchable and contested targets, drops, first reads, play action), and <b>SumerSports</b> (live charting sold to teams). This app uses every piece that’s openly published: the official play-by-play and weekly Next Gen Stats summaries, FTN’s charting (free since 2022), and Sports Info Solutions’ stats via Pro Football Reference, all through nflverse. From FTN it derives stats the paid sites sell: <b>first-read target share</b> and QB <b>first-read / checkdown rates</b>. Route counts, YPRR and man/zone splits are computed from the official on-field participation data.</p>
      <p><b>College prospects (2027 and later):</b> the paid route-level college stats (true routes run, YPRR, separation, drops, contested catches, missed tackles) come from PFF’s and SIS’s charting of every FBS game and aren’t published openly. Open college data stops at ESPN/NCAA play-by-play and box scores (via sportsdataverse and the College Football Data API) and 247Sports recruiting, which is what this app uses; college routes and YPRR are estimated from team dropbacks.</p>

      <h2>PFF, SumerSports and other premium charting</h2>
      <p>True route-level stats (routes run, YPRR, route grades, route win rate) come from charting companies that sell them. Their terms don’t allow automated collection: <b>PFF</b> prohibits scrapers, automated browsers and even copy-paste extraction, and limits its data to personal, non-public use; <b>SumerSports</b> prohibits any robot, spider or scraper; <b>StatRankings</b> prohibits scraping and feeding its data into any other tool (even its paid downloads are for a subscriber’s own private analysis). So this app doesn’t scrape them; where the underlying data is open (like man/zone coverage tags), it computes the stat itself.</p>
      <p>If you subscribe, you can still use your data here: export CSVs from PFF Premium Stats (receiving, rushing and passing summaries) and drop them in <code>data/imports/pff/</code>, then click <b>Refresh data</b>. Real route counts replace the estimates below, and grades, yards after contact, elusive rating, slot rate etc. show on player pages. Any other provider’s CSV export you’re licensed to use works the same way (headers like <code>routes</code>, <code>yprr</code>, <code>separation</code> are detected automatically). Imports only work in the version running on your own computer, and they’re never included in the shareable website.</p>

      <h2>Routes run & YPRR</h2>
      <p>For 2023–25, routes come from nflverse participation data: every dropback a player was on the field for, times a position route rate (WR ${rr.WR}, TE ${rr.TE}, RB ${rr.RB}) to remove pass-blocking snaps. Participation data for the current season is only published after the season, so ${m.current} routes are estimated per game as <i>snap share × team dropbacks × the player’s own pass-down skew from last season</i> (how much more often they’re on the field for passes than runs, shrunk toward the position average). Back-tested on full seasons, that estimate averages ${Object.entries(m.routeDiag || {}).map(([y, d]) => `${fmtPct(d.mape, 1)} error in ${y}`).join(' and ')}. YPRR = receiving yards ÷ routes; TPRR = targets ÷ routes.</p>
      <p><b>YPRR vs man and vs zone</b> split the same way, using the coverage tag nflverse publishes for each pass play (2023 onward). Routes against man (or zone) = on-field dropbacks where the defense played it × the route rate, and a season shows a number only with 40+ such routes. The tags come with the participation data after each season, so the current season fills in once it ends.</p>

      <h2>Expected fantasy points & matchups</h2>
      <p><b>xFP/G</b> is expected PPR fantasy points per game from the open ffopportunity model: every target is valued by its depth and field position, every carry by down, distance and field position, and every pass attempt the same way, then summed. It measures role and volume without the luck. <b>FPOE/G</b> = actual minus expected; large gaps in either direction tend to shrink the next season.</p>
      <p>The <b>Matchups</b> page is built from the same play-by-play. <b>Points allowed</b> = what opposing QBs, RBs, WRs and TEs average per game against each defense, in your scoring format. <b>Funnels</b> compare a defense’s rank in EPA allowed per dropback and per designed run: 10+ spots better against the pass makes it a <i>run funnel</i> (good for running backs), and the reverse a <i>pass funnel</i>. <b>Man/zone rates</b> and <b>pressure rates</b> come from nflverse participation data, which is published after each season, so they show the latest full season. Sack and hit rates and running backs’ yards before contact (PFR charting) are current.</p>

      <h2>Analytics Score (0–100)</h2>
      <p>For each position and season, every metric is converted to a percentile among qualified players (WR/TE ≥10 routes per team game, RB ≥6 opportunities, QB ≥14 dropbacks). The score is a weighted average of the most predictive ones. Small samples are pulled toward 35. The dynasty-facing score blends the last three seasons (weights 1.2 / 0.6 / 0.25, scaled by games played).</p>
      <table><tr><th>Pos</th><th>Weights</th></tr>
        ${Object.entries(model).map(([pos, ws]) => `<tr><td>${pos}</td><td>${ws.map(([k, w]) => `${esc(M[k]?.label || k)} ${Math.round(w * 100)}%`).join(', ')}</td></tr>`).join('')}
      </table>

      <h2>Lab value & Buy/Sell signals</h2>
      <p><b>Market value</b> = FantasyCalc’s value from real dynasty trades in your format; DynastyProcess (built from FantasyPros expert rankings) only fills players FantasyCalc doesn’t value, placed on FantasyCalc’s curve by rank. The Rankings page is ordered by market value; Lab value is the model’s own take. The market already pays for elite production, so raw scores can’t say who’s mispriced. Instead, rosterable players (market ≥ 300) with a real sample are ranked twice within their position: by <b>price</b>, and by <b>fundamentals</b> = Analytics percentile blended with age-window percentile, using the age weight that best reproduces the market’s own ordering${S.fundFit ? ` (currently ${Object.entries(S.fundFit).map(([p, f]) => `${p} ${Math.round(f.alpha * 100)}%`).join(', ')})` : ''}. First- and second-year players are re-centered on the typical young-player gap, since the market prices their projection. <b>Edge</b> = fundamentals percentile − price percentile. <b>Lab value</b> = market × e<sup>weight × edge / 30</sup> × age-tilt multiplier. Players whose Lab value is ≥10% above market are flagged <b>▲ Buy</b>; ≥10% below, <b>▼ Sell</b>. The age score is the share of a peak-level five-year window still ahead of the player, from position-specific age curves (RBs peak 23–25 and fall off fast after 27; WRs 24–27; TEs 26–29; QBs 26–33).</p>

      <h2>Rookies, prospects & college data</h2>
      <p><b>College stats</b> are built from ESPN college play-by-play the same way the NFL numbers are: EPA per play, success rate, explosive-play rate, target and touch share, red-zone usage and CPOE, plus box-score production. Key prospect metrics: <b>dominator rating</b> (average of a receiver’s share of team receiving yards and TDs), <b>YPTPA</b> (receiving yards per team pass attempt) and <b>scrimmage share</b> for running backs. College CPOE is centered on each season’s league average, because ESPN’s expected-completion model runs about 5 points low across all of college football.</p>
      <p><b>Prospect Score (0–100)</b> blends: college <b>production</b> (percentile of the best season’s key metrics vs. prospects at the position), <b>breakout</b> (first season as a featured producer: WR 20%+ dominator, TE 12%+, RB 20%+ of team scrimmage yards; scored by age), <b>athleticism</b> (combine speed score, jumps and agility vs. every combine since 2000), <b>age</b> on draft day, and <b>draft capital</b>, the single strongest predictor of rookie success. Before the draft, draft capital is <b>projected</b> by the model below; after the draft the real pick replaces it.</p>
      <table><tr><th>Stage</th><th>Weights</th></tr>
        <tr><td>Before the draft — RB, WR, TE</td><td>Projected draft capital 45%, production 30%, breakout 10%, athleticism 10% (once the combine happens), age 5%</td></tr>
        <tr><td>Before the draft — QB</td><td>Projected draft capital 50%, production 30%, athleticism 10%, age 10%</td></tr>
        <tr><td>After the draft</td><td>Draft capital 40%, production 35%, breakout 10%, athleticism 10%, age 5%</td></tr>
      </table>
      <p><b>NFL draft eligibility:</b> a player can enter the draft once three seasons have passed since his high-school class graduated. The high-school class is his first season on a college roster (redshirt years count); the recruiting class catches gap years, prep school and missions, and the class year catches junior-college transfers. Before birth dates are known (they come with the draft), age on draft day is estimated from the same high-school class and shown with a “~”.</p>
      <div data-dm><p class="muted small">Loading draft-model details…</p></div>
      <p><b>Devy boards:</b> the two classes after that get their own boards (college players first eligible for those drafts, with real production or a 4–5★ recruiting profile), built with the same models; the further out the draft, the more recruiting, early production, breakout age and Buzz drive the order. Buzz uses Wikipedia articles found through Wikidata or directly on Wikipedia (matched on name and the school’s “football players” category).</p>
      <p><b>Big board:</b> the next class’s board lists every FBS QB, RB, WR and TE who is eligible for that draft, ranked by the consensus below and grouped by rookie-draft round for your league size. Fantasy sites’ own devy boards can’t be pulled automatically: KeepTradeCut, Footballguys and Dynasty Daddy prohibit scraping, Draft Sharks and FantasyPros keep their rankings behind subscriptions or paid API keys, and Reddit blocks crawlers and requires approval for API access. Instead you can <b>paste any board or NFL mock draft you read</b> (one player per line; paste two or three mocks and the board follows their consensus) on the Big board page. It’s matched to the class by name, counts for 50% of the order, and is saved only in your browser, so nothing is copied onto this site.</p>
      <p><b>College play-by-play metrics:</b> explosive run % (runs of 10+ yards ÷ carries), 15+ run %, stuff rate, breakaway % (share of rushing yards on 15+ yard runs), line yards per carry, explosive catch % (20+ yard catches ÷ targets), deep target % and first downs per target come straight from every college play. <b>College YPRR and TPRR are estimates</b>: route charting isn’t public for college, so routes = team dropbacks in games played × a position route rate (WR 95%, TE 80%, RB 55%). That assumes a full-time role, so part-time players read low — use it alongside target share.</p>
      <p><b>Breakout age</b> is a player’s age at the start of their first season as a featured producer (WR 20%+ dominator, TE 12%+, RB 20%+ of team scrimmage yards). It’s exact when the birth date is known (drafted players); college rosters rarely list birth dates, so otherwise it’s estimated from the high-school recruiting class and shown with a “~”. <b>RB dominator</b> averages the back’s share of team scrimmage yards and scrimmage TDs. <b>QB rushing</b>: NFL numbers are official (they include scrambles and kneel-downs); college numbers exclude sacks and kneel-downs, because college box scores count sacks as runs. Player pages show every college season since 2019, including low-volume years.</p>
      <h2>Rookie ADP, consensus and mock drafts</h2>
      <p><b>ADP</b> comes from real Sleeper drafts: rookie-draft ADP once rookie drafts start (after the NFL Draft), otherwise dynasty-startup ADP for the QB format. <b>Experts</b> is the FantasyPros dynasty rookie ranking (expert consensus), published weekly via DynastyProcess; it covers one class at a time and usually switches to the next class in the winter.</p>
      <p><b>Mock drafts and the big board</b> order each class by a consensus of boards you pasted (50%), rookie ADP (40%), the expert-style projection (35%, until real expert rankings exist), dynasty market value (30%), expert rankings (25%) and the Prospect Score (15%), using whatever exists for each player and averaging their slots geometrically, so one outlier source can’t bury a player the others rank highly. The Prospect Score is position-neutral, so it’s placed on the market’s positional curve: the 2nd-best RB by score takes the slot where the 2nd RB has gone in recent rookie classes (by current dynasty value in your format, so superflex is built in). Expert rankings are 1QB, so QBs move up in superflex. Your league’s mock uses the real draft order once Sleeper sets it (until then, projected from standings, worst record first), applies traded picks, and nudges each team toward its two weakest positions.</p>
      <p><b>Strength of competition:</b> college production is discounted by level — Power 4 full credit, Group of 6 82%, FCS 60% — based on the conference of the player’s best season, so a big year against weaker defenses doesn’t outrank Power 4 production.</p>
      <p>The incoming class updates itself through the year: during the college season it’s a <b>big board</b> of every draft-eligible player with real production; in early March it becomes the official <b>combine invitees</b> with athletic testing; after the NFL Draft in late April it becomes the <b>drafted class</b> with draft capital, and the next class’s board takes its place when the following season starts.</p>

      <h2>Metric glossary</h2>
      <table><tr><th>Metric</th><th>Definition</th><th>Source</th></tr>
        ${Object.entries(M).filter(([k]) => !k.startsWith('x_')).map(([, v]) => `<tr><td>${esc(v.label)}</td><td>${esc(v.desc)}</td><td class="muted">${esc(v.src)}</td></tr>`).join('')}
      </table>
    </div>`;

  // draft-model details live with the college data
  loadProspects().then(({ meta: pm }) => {
    const dm = pm.draftModel, box = el.querySelector('[data-dm]');
    if (!box) return;
    if (!dm?.test) { box.innerHTML = ''; return; }
    const pct = v => (v == null ? '—' : `${Math.round(v * 100)}%`);
    box.innerHTML = `<p><b>Projected draft capital</b> comes from a model trained on every college QB, RB, WR and TE who left school before the ${dm.drafts[0]}–${dm.drafts[dm.drafts.length - 1]} drafts (${dm.players.toLocaleString()} players, ${dm.drafted} of them drafted). Inputs: best-season and final-season production (competition-adjusted), recruiting grade, breakout, age, Power 4 / FCS school, qualified seasons, height and weight. It ranks each class within a position, then gives the k-th QB, RB, WR or TE the pick where that many players at the position have gone over the last 8 drafts, so every class gets a realistic number at each position. It can’t see tape, injuries or scouting reports.</p>
      <table><tr><th>Pos</th><th>Back-test, one draft year held out at a time</th></tr>
        ${Object.entries(dm.test).map(([pos, t]) => `<tr><td>${pos}</td><td>${pct(t.hit)} of drafted players were in the model’s top N (N = number drafted) · rank correlation with actual draft capital ${t.rho} (${t.drafted} drafted of ${t.players})</td></tr>`).join('')}
      </table>
      ${pm.expertModel ? `<p><b>Expert-style projection.</b> Until FantasyPros ranks a class, the board uses a model of <i>how its experts ranked past classes</i>: DynastyProcess archives every FantasyPros rookie ranking, so for the ${pm.expertModel.classes[0]}–${pm.expertModel.classes[pm.expertModel.classes.length - 1]} classes the app takes the first pre-draft snapshot (early February) and learns which college profiles experts rank highly. It uses the same inputs as above plus <b>Buzz</b>: a player’s Wikipedia page views (Wikimedia’s public pageview data) as a percentile of his class. Views track the hype and draft buzz that experts follow and stats can’t see; players with no article rank low. Back-tested one class at a time, its order has a ${pm.expertModel.rho} rank correlation with the real expert rankings and catches ${pct(pm.expertModel.top24)} of the experts’ top 24. It counts for 35% of the order and steps aside for each player once FantasyPros ranks him.</p>` : ''}`;
  }).catch(() => { const b = el.querySelector('[data-dm]'); if (b) b.innerHTML = ''; });

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
