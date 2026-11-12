# Data imports (PFF and other licensed providers)

Drop CSV exports you are licensed to use into this folder (subfolders are fine), then click
**Refresh data** in the app's Methodology page (or run `npm run data`).

What happens:

- **Real route counts replace the app's estimates**, so YPRR, TPRR and route participation become exact.
- Extra columns (PFF offense/route/run/pass grades, yards after contact, elusive rating, missed tackles forced,
  breakaway %, slot rate, contested-catch rate, drop rate, big-time-throw rate, route win rate, …) appear on
  player pages and in percentile bars.

How rows are matched:

| Column in your file | Used for |
|---|---|
| `season` / `year` | the season (otherwise a 4-digit year in the file name, e.g. `receiving_summary_2026.csv`, otherwise the current season) |
| `player_id` (PFF files) | exact match on the PFF player ID, cross-checked against the name |
| `gsis_id` / `sleeper_id` | exact match |
| `player` + `position` + `team_name` | name match when no ID is present |

## PFF

1. In PFF Premium Stats, open the NFL receiving / rushing / passing summary tables for a season.
2. Use PFF's export to CSV (available to Premium Stats subscribers).
3. Save the files here, e.g. `data/imports/pff/receiving_summary_2026.csv`.

PFF's terms limit PFF data to **personal, non-commercial, non-public use**. These files and the app's output stay
on your machine; don't publish, host or share them.

## Other providers

Any CSV with a player name column plus columns such as `routes`, `yprr`, `tprr`, `separation`, `route win rate`
or grade columns works, as long as you're allowed to use the data that way. Headers are matched loosely
(e.g. `Yards Per Route Run`, `YPRR` and `yds/rr` all map to YPRR).
