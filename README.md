# Dynasty Lab

A local dynasty fantasy football app that combines advanced analytics (YPRR, targets per route, separation,
YAC over expected, explosive-run rate, rush yards over expected, yards after contact, EPA, CPOE…) with real stats,
fantasy points and live dynasty market values. It ranks players and power-ranks every team in your Sleeper league.

## Run it

Requires Node 18+.

```bash
npm install
npm start
```

Open http://localhost:5178. The first start builds the data set (about 30 seconds).

### Automatic weekly updates

- **On your computer:** the server rebuilds the data every **Tuesday at 10:00** (after Monday Night Football). If the
  computer was off or the app was closed, it catches up as soon as you start it, and any open page reloads itself
  with a short "Updated" banner. You can still force a refresh from the Methodology page (or `npm run data`).
  Change the schedule with the `UPDATE_DAY` (0 = Sunday … 6 = Saturday) and `UPDATE_HOUR` environment variables.
- **On the website:** a GitHub Actions job rebuilds and republishes the site every Tuesday (see below). Your
  computer doesn't need to be on.

## Use it on your phone and share it (free website)

The repository includes everything needed to publish the app as a free GitHub Pages website that updates itself
weekly — open the link on any phone, tap **Share → Add to Home Screen** for an app icon, and send the link to friends
(each person connects their own Sleeper league).

1. Push this folder to a GitHub repository (public repositories get Pages for free).
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Open the **Actions** tab and run **Weekly data update** (or push any commit). In a few minutes the site is live at
   `https://<your-username>.github.io/<repository-name>/`.

The website is built with `--public`, so files in `data/imports/` (e.g. PFF exports) and Pahowdy's Prospect Database
are never included. GitHub
pauses scheduled jobs in repositories with no activity for 60 days; the job records a small commit each week to
prevent that. If it ever pauses, re-enable it from the Actions tab.

To preview the website build locally: `node pipeline/build.mjs --public && node pipeline/site.mjs && node pipeline/preview-site.mjs`.

## Pages

- **Rankings** – dynasty value per player: market value (FantasyCalc + DynastyProcess), Analytics Score, age window,
  and ▲ Buy / ▼ Sell signals where fundamentals and price disagree. Tune the analytics weight and an age tilt.
- **Analytics** – per-position leaderboards (WR, RB, TE, QB) with percentile shading and an X/Y scatter of any two metrics,
  including YPRR and TPRR vs man and vs zone coverage (2023 onward, from nflverse coverage tags).
- **Player pages** – percentile bars, weekly fantasy points, season history, game log, and college career.
- **Prospects** – a **big board** for the next draft class (every FBS QB/RB/WR/TE who's draft-eligible, tiered by
  rookie-draft round, with a projected NFL pick from a draft-capital model trained on recent drafts), plus the
  Prospect Score for the last four rookie classes: college production, breakout age, combine athleticism, recruiting,
  age and draft capital — with Sleeper ADP, FantasyPros rookie rankings and a consensus **mock draft** (generic, or
  your Sleeper league with its real pick order, traded picks and team needs). **Paste any board you read**
  (Footballguys, Draft Sharks, KeepTradeCut, a r/DynastyFF post…) and it's blended in; pasted boards stay in your
  browser. The incoming class goes from the big board (fall) to combine invitees (March) to the drafted class
  (late April) automatically.
- **College** – college football advanced stats explorer (EPA, success rate, explosive run %, stuff rate,
  breakaway %, target share, dominator, YPRR/TPRR (est.), explosive catch %, CPOE…) with scatter plots, NFL draft
  eligibility (three years out of high school), plus a profile page for every college player.
- **League** – enter your Sleeper username: power rankings, contend/rebuild quadrant, positional rooms, draft capital,
  best lineups, sell-high candidates and buy-low targets. Format and scoring come from the league automatically.
- **Methodology** – every data source, metric definition and model weight.

## Data

| Source | Used for |
|---|---|
| nflverse (play-by-play, participation, snap counts, box scores) | usage, efficiency, routes, fantasy points |
| NFL Next Gen Stats (via nflverse) | separation, cushion, YAC over expected, RYOE, time to throw |
| FTN charting (via nflverse) | drops, contested/catchable targets, screens, play-action |
| Pro Football Reference (via nflverse) | yards before/after contact, broken tackles, bad throws, pressures |
| sportsdataverse (ESPN college data) | college play-by-play + advanced stats (EPA, success rate, explosive runs, shares, CPOE), rosters, recruiting |
| FantasyPros via DynastyProcess, Sleeper | dynasty rookie expert rankings; rookie and startup ADP from real drafts |
| nflverse combine & draft picks | athletic testing and draft capital for the Prospect Score |
| FantasyCalc, DynastyProcess | dynasty market values and rookie pick values |
| Sleeper API | player directory, injuries, your league |

**Routes / YPRR:** 2023–25 use on-field participation data. The current season's participation data is published
after the season, so current-season routes are estimated from snap share × team dropbacks × each player's pass-down
skew (back-tested at ~7% average error) and marked with `*`.

**PFF, SumerSports and other paid charting:** their terms prohibit scraping, so the app doesn't scrape them. If you
have a subscription, export CSVs and drop them in `data/imports/` (see `data/imports/README.md`); real route counts
then replace the estimates and grades appear on player pages. PFF limits its data to personal, non-public use — keep
those files and this app private. StatRankings' terms also forbid scraping or feeding its data into other tools, so
it isn't used; man/zone splits are computed here from open nflverse data instead.

**Pahowdy's Prospect Database** (a public Google Sheet by @pahowdy, shared for personal use) is pulled automatically
when you run the app on your own computer: his pre/post-draft scores, breakout ages, birth dates (exact prospect ages)
and PFF college stats appear on player pages. It includes PFF data, so the `--public` website build skips it.

## Layout

```
server.mjs            local web server + /api/values (market values) + weekly auto-update
pipeline/             data pipeline (download, aggregate, score) → data/out/*.json
pipeline/site.mjs     builds the static website into site/
.github/workflows/    weekly GitHub Pages build
public/               the web app (no build step)
data/cache/           downloaded raw files (safe to delete)
data/imports/         your licensed CSV exports (optional)
```
