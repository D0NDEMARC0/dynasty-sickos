// Sleeper league connection + dynasty power rankings + team detail pages.
import { S, rows, findLeagues, loadLeague, unlinkLeague } from '../store.js';
import { rankTeams, ordinal } from '../model.js';
import { scatter } from '../charts.js';
import { esc, fmtInt, fmt1, heat, minibar, table, tipRows, signalTag, posTag } from '../ui.js';
import { playerCell, anCell, mount } from './common.js';

let found = null;
const TYPE = { 0: 'Redraft', 1: 'Keeper', 2: 'Dynasty' };
const SLOT = { SUPER_FLEX: 'SF', WRRB_FLEX: 'W/R', REC_FLEX: 'W/T', WRTE_FLEX: 'W/T', FLEX: 'FLEX' };
const avatar = (id, cls = 'avatar') => (id ? `<img class="${cls}" src="https://sleepercdn.com/avatars/thumbs/${esc(id)}" alt="" onerror="this.style.visibility='hidden'">` : `<span class="${cls}"></span>`);

export async function render(root, params, query, rerender) {
  const el = mount(root);
  if (!S.league) return connect(el, rerender);
  const teams = buildTeams();
  if (params.team) return teamView(el, teams, Number(params.team));
  return leagueView(el, teams, rerender);
}

// ---------------- connect ----------------
function connect(el, rerender) {
  el.innerHTML = `
    <div class="page-head"><div>
      <h1>Connect your league</h1>
      <p class="sub">Power-rank every team in your Sleeper dynasty league: starting-lineup strength, win-now outlook, future value, draft capital and positional rooms. Read-only — it uses Sleeper’s public API, so no login is needed.</p>
    </div></div>
    <div class="card">
      <form class="toolbar" data-f="user" style="margin:0 0 8px">
        <input type="text" name="u" placeholder="Sleeper username" value="${esc(S.sleeperUser)}" autocomplete="off">
        <button class="btn primary">Find my leagues</button>
      </form>
      <form class="toolbar" data-f="id" style="margin:0">
        <input type="text" name="id" placeholder="…or paste a Sleeper league ID" autocomplete="off">
        <button class="btn">Load league</button>
        <span class="muted small" data-msg></span>
      </form>
    </div>
    <div class="league-list" data-list></div>`;
  const msg = t => { el.querySelector('[data-msg]').textContent = t; };
  const list = () => {
    if (!found) return;
    const sorted = [...found].sort((a, b) => (b.settings?.type === 2) - (a.settings?.type === 2) || String(b.season).localeCompare(String(a.season)));
    el.querySelector('[data-list]').innerHTML = sorted.length ? sorted.map(l => {
      const sf = (l.roster_positions || []).includes('SUPER_FLEX');
      return `<button class="card league-card" data-league="${esc(l.league_id)}">${avatar(l.avatar)}<div><div style="font-weight:600">${esc(l.name)}</div><div class="muted small">${esc(l.season)} · ${l.total_rosters} teams · ${TYPE[l.settings?.type] || 'League'}${sf ? ' · SF' : ''}</div></div></button>`;
    }).join('') : '<div class="muted">No leagues found for this season.</div>';
  };
  list();
  el.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    try {
      if (f.dataset.f === 'user') {
        msg('Looking up leagues…');
        found = await findLeagues(f.u.value);
        msg(`${found.length} league${found.length === 1 ? '' : 's'} found`);
        list();
      } else {
        msg('Loading league…');
        await loadLeague(f.id.value.trim());
        rerender();
      }
    } catch (err) { msg(err.message); }
  });
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-league]');
    if (!b) return;
    msg('Loading league…');
    try { await loadLeague(b.dataset.league); rerender(); } catch (err) { msg(err.message); }
  });
}

// ---------------- data ----------------
export function buildTeams() {
  const L = S.league;
  rows();
  const users = new Map(L.users.map(u => [u.user_id, u]));
  const rounds = L.info.settings?.draft_rounds || 4;
  const season = Number(L.info.season);
  const start = L.info.status === 'pre_draft' ? season : season + 1;
  const years = [start, start + 1, start + 2];
  const own = new Map();
  for (const r of L.rosters) for (const y of years) for (let rd = 1; rd <= rounds; rd++) own.set(`${y}|${rd}|${r.roster_id}`, r.roster_id);
  for (const t of L.traded) { const k = `${t.season}|${t.round}|${t.roster_id}`; if (own.has(k)) own.set(k, t.owner_id); }
  const teams = L.rosters.map(r => {
    const u = users.get(r.owner_id);
    const taxi = new Set(r.taxi || []), ir = new Set(r.reserve || []);
    const ids = [...new Set([...(r.players || []), ...taxi, ...ir])];
    const players = [];
    for (const id of ids) {
      const row = S.rowById.get(id);
      if (!row) continue;
      players.push({ id, pos: row.p.pos, lab: row.lab, proj: row.proj, age: row.p.age, inj: row.p.inj, row, taxi: taxi.has(id), ir: ir.has(id) });
    }
    const picks = [];
    for (const [k, owner] of own) if (owner === r.roster_id) { const [y, rd, orig] = k.split('|').map(Number); picks.push({ year: y, round: rd, fromRosterId: orig }); }
    picks.sort((a, b) => a.year - b.year || a.round - b.round);
    const st = r.settings || {};
    return {
      rosterId: r.roster_id, name: u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`, owner: u?.display_name || '', avatar: u?.avatar,
      players, picks, record: { w: st.wins || 0, l: st.losses || 0, t: st.ties || 0, pf: (st.fpts || 0) + (st.fpts_decimal || 0) / 100 },
      me: !!S.sleeperUserId && (r.owner_id === S.sleeperUserId || (r.co_owners || []).includes(S.sleeperUserId)),
    };
  });
  return rankTeams(teams, { slots: L.slots, picksMarket: S.values?.picks || {}, superflex: L.superflex });
}

function formatChips() {
  const L = S.league, sc = L.scoring;
  const starters = L.slots.filter(s => !['BN', 'IR', 'TAXI'].includes(s)).map(s => SLOT[s] || s).join(', ');
  return [L.superflex ? 'Superflex' : '1QB', `${sc.rec ?? 0} PPR`, sc.bonus_rec_te ? `TE premium +${sc.bonus_rec_te}` : null, `${L.rosters.length} teams`, `${TYPE[L.info.settings?.type] || 'League'}`, `Starters: ${starters}`]
    .filter(Boolean).map(esc).join(' · ');
}
const roomPct = (rank, n) => (n > 1 ? Math.round(100 - ((rank - 1) / (n - 1)) * 100) : 50);
const shortName = s => (s.length > 16 ? `${s.slice(0, 15)}…` : s);

// ---------------- league view ----------------
function leagueView(el, teams, rerender) {
  const n = teams.length;
  const maxP = Math.max(1, ...teams.map(t => t.power));
  const cols = [
    { key: 'r', label: '#', n: true, cell: t => `<td class="rank">${t.powerRank}</td>` },
    { key: 'team', label: 'Team', cell: t => `<td><a class="pcell" href="#/league/team/${t.rosterId}">${avatar(t.avatar, 'hs" style="width:28px;height:28px')}<div><div class="nm">${esc(t.name)} ${t.me ? '<span class="tag rk">You</span>' : ''}</div><div class="meta">${esc(t.owner)}</div></div></a></td>` },
    { key: 'rec', label: 'Record', n: true, cell: t => `<td class="n">${t.record.w}-${t.record.l}${t.record.t ? `-${t.record.t}` : ''} <span class="muted small">${fmtInt(t.record.pf)} PF</span></td>` },
    { key: 'arch', label: 'Profile', cell: t => `<td><span class="arch" title="${esc(t.archetype.desc)}">${esc(t.archetype.label)}</span></td>` },
    { key: 'pow', label: 'Power', n: true, title: 'Starters + depth + draft capital, indexed to the top team (100)', cell: t => `<td class="n">${minibar(t.power, maxP, Math.round((t.power / maxP) * 100))}</td>` },
    { key: 'st', label: 'Starters', n: true, title: 'Rank of best dynasty starting lineup', cell: t => `<td class="n">#${t.starterRank}</td>` },
    { key: 'now', label: 'Win-now', n: true, title: 'Projected PPG of best healthy lineup', cell: t => `<td class="n">${fmt1(t.winNow)} <span class="muted small">#${t.nowRank}</span></td>` },
    { key: 'fut', label: 'Future', n: true, title: 'Value of players three years out + draft picks', cell: t => `<td class="n">#${t.futureRank}</td>` },
    { key: 'pk', label: 'Picks', n: true, title: 'Draft capital (next 3 drafts)', cell: t => `<td class="n">${fmtInt(t.pickValue)} <span class="muted small">#${t.pickRank}</span></td>` },
    { key: 'age', label: 'Age', n: true, title: 'Value-weighted average age', cell: t => `<td class="n">${fmt1(t.avgAge)}</td>` },
    ...['QB', 'RB', 'WR', 'TE'].map(pos => ({ key: pos, label: pos, title: `${pos} room rank (1 = best)`, cell: t => `<td class="roomcell heat" style="${heat(roomPct(t.roomRank[pos], n))}">${t.roomRank[pos]}</td>` })),
  ];
  const pts = teams.map(t => ({
    id: t.rosterId, x: t.winNow, y: t.future / 1000, label: shortName(t.name), me: t.me, href: `#/league/team/${t.rosterId}`,
    tip: tipRows(t.name, [['Power rank', `#${t.powerRank}`], ['Win-now (proj PPG)', fmt1(t.winNow)], ['Future value', fmtInt(t.future)], ['Draft capital', fmtInt(t.pickValue)], ['Profile', t.archetype.label]]),
  }));
  el.innerHTML = `
    <div class="page-head">
      <div style="display:flex;gap:12px;align-items:center">${avatar(S.league.info.avatar)}<div><h1>${esc(S.league.info.name)}</h1><p class="sub small">${formatChips()}</p></div></div>
      <div style="display:flex;gap:8px"><button class="btn" data-act="refresh">Refresh rosters</button><button class="btn" data-act="switch">Switch league</button></div>
    </div>
    <div class="card"><h2>Dynasty power rankings</h2><div class="tablewrap" style="box-shadow:none">${table({ cols, rows: teams, rowClass: t => (t.me ? 'me' : '') })}</div>
      <p class="muted small" style="margin:8px 0 0">Click a team for lineups, roster values, picks and trade targets. Position columns show each room’s rank; shading runs blue (strong) to red (weak).</p></div>
    <div class="grid2" style="margin-top:16px">
      <div class="card"><h2>Contend or rebuild?</h2>
        <div data-quad></div>
        <div class="muted small">Lines mark the league median.${teams.some(t => t.me) ? ' Your team is the larger orange dot.' : ''}</div>
      </div>
      <div class="card prose"><h2>How teams are ranked</h2>
        <p><b>Power</b> = best dynasty starting lineup (Lab value) + 60% of bench depth (each bench spot counts 15% less than the one above) + 80% of draft-pick value.</p>
        <p><b>Win-now</b> = projected points per game of the best healthy lineup, using this season’s production blended with last season’s (${esc(S.league.scoring.rec ?? 0)} PPR league scoring).</p>
        <p><b>Future</b> = each player’s value × projected productivity three years from now (age curve), plus draft picks.</p>
        <p><b>Picks</b>: next year’s picks are priced Early/Mid/Late from the original owner’s win-now rank; later years use average round values from FantasyCalc.</p>
        <p class="muted small">Rosters come live from Sleeper. Player values follow the model settings on the Rankings page.</p>
      </div>
    </div>`;
  const quad = el.querySelector('[data-quad]');
  const w = Math.max(300, quad.clientWidth);
  quad.innerHTML = scatter({ pts, xLabel: 'Win-now: projected lineup PPG', yLabel: 'Future value (thousands)', xFmt: v => v.toFixed(0), yFmt: v => `${v.toFixed(0)}K`, label: new Set(teams.map(t => t.rosterId)), quad: [['Rebuilding', 'Dynasty'], ['Teardown', 'Win-now']], w, h: Math.round(Math.max(300, w * 0.72)) });
  el.addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'switch') { unlinkLeague(); rerender(); }
    if (b.dataset.act === 'refresh') { b.disabled = true; try { await loadLeague(S.leagueId); } finally { rerender(); } }
  });
}

// ---------------- team view ----------------
function teamView(el, teams, rid) {
  const t = teams.find(x => x.rosterId === rid);
  if (!t) { el.innerHTML = '<div class="empty">Team not found. <a class="link" href="#/league">Back to league</a></div>'; return; }
  const n = teams.length;
  const ownerOf = new Map();
  for (const x of teams) for (const p of x.players) ownerOf.set(p.id, x);
  const lineup = (lu, valFn, unit) => `<div class="lineup">${lu.map(({ slot, player }) => `<div class="slot"><span class="sl">${esc(SLOT[slot] || slot)}</span>${player ? playerCell(player.row.p, { size: 24 }) : '<span class="muted">Empty</span>'}<span class="num">${player ? `${valFn(player)}${unit}` : ''}</span></div>`).join('')}</div>`;
  const leagueAvg = pos => teams.reduce((s, x) => s + x.rooms[pos], 0) / n;
  const rooms = ['QB', 'RB', 'WR', 'TE'].map(pos => ({ pos, v: t.rooms[pos], rank: t.roomRank[pos], avg: leagueAvg(pos), max: Math.max(...teams.map(x => x.rooms[pos])) }));
  const weakest = [...rooms].sort((a, b) => b.rank - a.rank).slice(0, 2).map(r => r.pos);
  const roster = [...t.players].sort((a, b) => b.lab - a.lab);
  const maxLab = Math.max(1, ...roster.map(p => p.lab));
  const rosterCols = [
    { key: 'p', label: 'Player', cell: p => `<td>${playerCell(p.row.p, { size: 26 })}</td>` },
    { key: 'pr', label: 'Pos rk', cell: p => `<td>${posTag(p.pos)} <span class="small">${p.row.posRank ?? '—'}</span></td>` },
    { key: 'age', label: 'Age', n: true, cell: p => `<td class="n">${fmt1(p.age)}</td>` },
    { key: 'lab', label: 'Lab value', n: true, cell: p => `<td class="n">${minibar(p.lab, maxLab, fmtInt(p.lab))}</td>` },
    { key: 'mk', label: 'Market', n: true, cell: p => `<td class="n">${fmtInt(p.row.market)}</td>` },
    { key: 'sig', label: 'Model vs market', cell: p => `<td>${signalTag(p.row.signal, p.row.mult)}</td>` },
    { key: 'an', label: 'Analytics', n: true, cell: p => anCell(p.row.p) },
    { key: 'ppg', label: 'PPG', n: true, cell: p => `<td class="n">${fmt1(p.row.ppg)}</td>` },
    { key: 'proj', label: 'Proj', n: true, title: 'Rest-of-season PPG projection', cell: p => `<td class="n">${fmt1(p.proj)}</td>` },
    { key: 'st', label: 'Slot', cell: p => `<td class="muted small">${p.taxi ? 'Taxi' : p.ir ? 'IR' : ''}</td>` },
  ];
  const sells = roster.filter(p => p.row.signal === 'sell').sort((a, b) => b.row.market - a.row.market).slice(0, 6);
  const buys = S.data.players
    .map(p => S.rowById.get(p.id))
    .filter(r => r && r.signal === 'buy' && weakest.includes(r.p.pos) && ownerOf.get(r.p.id) && ownerOf.get(r.p.id) !== t)
    .sort((a, b) => b.lab - a.lab).slice(0, 8);
  const teamName = id => esc(teams.find(x => x.rosterId === id)?.name || `Team ${id}`);

  el.innerHTML = `
    <p class="small" style="margin:0 0 10px"><a class="link" href="#/league">← ${esc(S.league.info.name)}</a></p>
    <div class="page-head">
      <div style="display:flex;gap:12px;align-items:center">${avatar(t.avatar)}<div><h1>${esc(t.name)} ${t.me ? '<span class="tag rk">You</span>' : ''}</h1>
        <p class="sub small">${esc(t.owner)} · ${t.record.w}-${t.record.l}${t.record.t ? `-${t.record.t}` : ''} · ${fmtInt(t.record.pf)} PF · <span class="arch" title="${esc(t.archetype.desc)}">${esc(t.archetype.label)}</span></p></div></div>
    </div>
    <div class="tiles">
      <div class="tile"><div class="lbl">Power rank</div><div class="val">#${t.powerRank}<span class="muted small"> of ${n}</span></div><div class="dl">Starters #${t.starterRank}</div></div>
      <div class="tile"><div class="lbl">Win-now</div><div class="val">#${t.nowRank}</div><div class="dl">${fmt1(t.winNow)} projected PPG</div></div>
      <div class="tile"><div class="lbl">Future</div><div class="val">#${t.futureRank}</div><div class="dl">${fmtInt(t.future)} value</div></div>
      <div class="tile"><div class="lbl">Draft capital</div><div class="val">#${t.pickRank}</div><div class="dl">${fmtInt(t.pickValue)} · ${t.picks.length} picks</div></div>
      <div class="tile"><div class="lbl">Avg age</div><div class="val">${fmt1(t.avgAge)}</div><div class="dl">Value-weighted</div></div>
    </div>
    <div class="grid2">
      <div class="card"><h2>Best dynasty lineup</h2>${lineup(t.lineupDyn, p => fmtInt(p.lab), '')}</div>
      <div class="card"><h2>Best lineup now</h2>${lineup(t.lineupNow, p => fmt1(p.proj), ' ppg')}<p class="muted small" style="margin:8px 0 0">Excludes players on IR/PUP/suspension.</p></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Positional rooms</h2>
      <table class="data"><thead><tr><th>Room</th><th class="n">Value</th><th class="n">League avg</th><th class="n">Rank</th><th style="width:40%"></th></tr></thead><tbody>
      ${rooms.map(r => `<tr><td>${posTag(r.pos)}</td><td class="n">${fmtInt(r.v)}</td><td class="n">${fmtInt(r.avg)}</td><td class="n heat" style="${heat(roomPct(r.rank, n))}">#${r.rank}</td><td><div class="minibar" style="justify-content:flex-start"><span class="track" style="width:100%"><span class="fill" style="display:block;width:${Math.round((r.v / (r.max || 1)) * 100)}%"></span></span></div></td></tr>`).join('')}
      </tbody></table></div>
    <div class="grid2" style="margin-top:16px">
      <div class="card"><h2>Sell-high candidates</h2>${sells.length ? `<div class="lineup">${sells.map(p => `<div class="slot"><span class="sl">${p.pos}</span>${playerCell(p.row.p, { size: 24 })}<span class="num">${signalTag(p.row.signal, p.row.mult)}</span></div>`).join('')}</div>` : '<p class="muted">No players the model rates well below market.</p>'}
        <p class="muted small" style="margin:8px 0 0">Your players the model values ≥10% below their market price.</p></div>
      <div class="card"><h2>Buy-low targets · ${weakest.join(' & ')}</h2>${buys.length ? `<div class="lineup">${buys.map(r => `<div class="slot"><span class="sl">${r.p.pos}</span>${playerCell(r.p, { size: 24, sub: `${posTag(r.p.pos)}<span>${esc(r.p.team || 'FA')}</span><span>on ${esc(ownerOf.get(r.p.id).name)}</span>` })}<span class="num">${signalTag(r.signal, r.mult)}</span></div>`).join('')}</div>` : '<p class="muted">No undervalued players at your weakest positions on other rosters.</p>'}
        <p class="muted small" style="margin:8px 0 0">Players on other rosters at your two weakest rooms that the model values ≥10% above market.</p></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Draft picks</h2>
      <div class="picks">${t.picks.map(pk => `<span class="pick"><b>${pk.year} ${ordinal(pk.round)}</b>${pk.fromRosterId !== t.rosterId ? ` <span class="muted">via ${teamName(pk.fromRosterId)}</span>` : ''} · ${fmtInt(pk.value)}</span>`).join('') || '<span class="muted">No picks in the next three drafts.</span>'}</div>
    </div>
    <div class="card"><h2>Roster</h2><div class="tablewrap" style="box-shadow:none">${table({ cols: rosterCols, rows: roster })}</div></div>`;
}
