(() => {
  'use strict';

  /* =====================================================================
     Sports Management
     - Students sign up as Captain or Player.
     - The admin logs in from the "Admin login" tab. From "Manage sports"
       the admin adds any sport, sets the squad size, the scorecard type and
       a scoring system:
         1. Winner / Loser   (winner 2, loser 0)
         2. Placement        (points for 1st to 16th place, optional points per elimination)
         3. Custom           (your own results, e.g. Win 3, Draw 1, Loss 0)
     - Winner / Loser and Custom sports get scorecards and upcoming matches.
     - The admin can run a live score (cricket runs/wickets, kabaddi points) or a live
       standings board (BGMI / Free Fire) with an Undo button for mistakes.
     - Data is saved in this browser only (localStorage). To share data between
       many phones/computers you need a server + database.
     ===================================================================== */

  const DATA_KEY = 'sports-management-v2';
  const SESSION_KEY = 'sports-management-session-v2';

  // Admin account (created automatically). Change these before real use.
  const ADMIN = { username: 'admin', password: 'admin123', name: 'Admin' };

  // Winner / Loser scoring
  const WIN_POINTS = 2;
  const LOSS_POINTS = 0;

  // Placement scoring always has rows for 1st to 16th place
  const PLACES = 16;
  const DEFAULT_PLACEMENT = [10, 6, 5, 4, 3, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0];

  // Colours given to new sports
  const COLORS = ['#b45ce0', '#14b8a6', '#e0a020', '#f0436a', '#4f86f7', '#84cc16'];

  // Old dark colours (from earlier versions) -> brighter ones for the black theme
  const COLOR_UPGRADE = {
    '#1f5c3f': '#22a559', '#2b3f8c': '#3b6fe0', '#4d5a36': '#8a9a4b',
    '#7a3e8e': '#b45ce0', '#0f766e': '#14b8a6', '#a16207': '#e0a020',
    '#be123c': '#f0436a', '#1d4ed8': '#4f86f7', '#4d7c0f': '#84cc16'
  };

  const ROLE_LABEL = { admin: 'Admin', captain: 'Captain', player: 'Player' };
  const SCORING_LABEL = { winloss: 'Winner / Loser', placement: 'Placement', custom: 'Custom' };
  const SCORE_LABEL = { simple: 'Points scored (like 14 - 17)', cricket: 'Runs / wickets (like 106/5)', none: 'No score' };

  // Sports that are added the first time the app opens. The admin can edit or delete them.
  function defaultSports() {
    return [
      { id: 'cricket', name: 'Cricket', main: 11, extra: 2, maxTeams: null, color: '#22a559', scoreType: 'cricket', autoFixtures: true, scoring: { type: 'winloss' } },
      { id: 'kabaddi', name: 'Kabaddi', main: 7, extra: 2, maxTeams: null, color: '#3b6fe0', scoreType: 'simple', autoFixtures: true, scoring: { type: 'winloss' } },
      {
        id: 'bgmi', name: 'BGMI', main: 4, extra: 1, maxTeams: 16, color: '#8a9a4b', scoreType: 'none', autoFixtures: false,
        scoring: { type: 'placement', placement: DEFAULT_PLACEMENT.slice(), killPoints: 1 }
      }
    ];
  }

  const AVATAR_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>';
  const CHEVRON_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  /* ---------- State ---------- */
  let db = { users: [], teams: [], points: [], sports: null, fixtures: [], live: [] };   // sports is filled in load()
  let sessionUserId = null;
  let view = 'home';                 // 'home' | 'points' | 'manage' | a sport id
  let pointsSportId = null;          // sport chosen on the Points table page
  let authMode = 'login';            // 'login' | 'signup' | 'admin'
  let authError = '';
  let authDraft = { name: '', username: '' };
  let sportDraft = null;             // the "Add / Edit sport" form while it is open
  let editingFixtureId = null;       // upcoming match being edited by the admin
  let prefill = null;                // teams to pre-select in the result form
  const expandedTeams = new Set();   // teams whose players are open in the list
  const historyLimits = {};          // how many recent matches are shown per sport

  /* ---------- Helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

  const isInt = (value, min, max) => /^\d+$/.test(String(value).trim()) && +value >= min && +value <= max;
  const plural = (n, one, many) => (n === 1 ? one : many);
  const displayName = (user) => (user.role === 'admin' ? 'Admin' : user.name);

  // Simple hash so passwords are not stored as plain text.
  // This is NOT real security - a real app must hash passwords on a server.
  function hashPassword(username, password) {
    const s = username + ':' + password;
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function ordinal(n) {
    const suffix = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (suffix[(v - 20) % 10] || suffix[v] || suffix[0]);
  }

  function todayISO() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function formatDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  let toastTimer;
  function toast(message, isError = false) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }
  const fail = (message) => toast(message, true);

  // In-page dialog: the browser's built-in confirm box is blocked in some previews
  function ask(message) {
    return new Promise((resolve) => {
      const modal = $('#confirm-modal');
      const yes = $('#confirm-yes');
      const no = $('#confirm-no');
      $('#confirm-text').textContent = message;
      modal.hidden = false;
      const done = (result) => {
        modal.hidden = true;
        yes.onclick = null;
        no.onclick = null;
        resolve(result);
      };
      yes.onclick = () => done(true);
      no.onclick = () => done(false);
      no.focus();
    });
  }

  /* ---------- Storage ---------- */
  function save() {
    try { localStorage.setItem(DATA_KEY, JSON.stringify(db)); } catch (err) { console.warn('Could not save:', err); }
  }

  function saveSession() {
    try {
      if (sessionUserId) localStorage.setItem(SESSION_KEY, sessionUserId);
      else localStorage.removeItem(SESSION_KEY);
    } catch (err) { /* ignore */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(DATA_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.teams) && Array.isArray(parsed.points)) {
          db = {
            users: parsed.users, teams: parsed.teams, points: parsed.points,
            sports: parsed.sports, fixtures: Array.isArray(parsed.fixtures) ? parsed.fixtures : [],
            live: Array.isArray(parsed.live) ? parsed.live : []
          };
        }
      }
      sessionUserId = localStorage.getItem(SESSION_KEY);
    } catch (err) {
      console.warn('Could not read saved data:', err);
    }

    // First run (or data from an older version): add the starting sports
    if (!Array.isArray(db.sports)) db.sports = defaultSports();

    // Older sports did not store the scorecard type or automatic matches
    db.sports.forEach((s) => {
      if (!s.scoreType) s.scoreType = s.id === 'cricket' ? 'cricket' : (s.scoring.type === 'placement' ? 'none' : 'simple');
      if (typeof s.autoFixtures !== 'boolean') s.autoFixtures = s.scoring.type !== 'placement';
    });

    // Older sports used darker colours that are hard to see on the black theme
    db.sports.forEach((s) => { if (COLOR_UPGRADE[s.color]) s.color = COLOR_UPGRADE[s.color]; });

    // Older teams did not store who is an extra player
    db.teams.forEach((t) => {
      if (!Array.isArray(t.extras)) {
        const sport = db.sports.find((s) => s.id === t.game);
        t.extras = sport ? t.members.slice(sport.main) : [];
      }
      t.extras = t.extras.filter((id) => t.members.includes(id));
    });

    if (!db.users.some((u) => u.role === 'admin')) {
      db.users.push({
        id: uid(), name: ADMIN.name, username: ADMIN.username,
        pass: hashPassword(ADMIN.username, ADMIN.password), role: 'admin'
      });
    }
    db.users.forEach((u) => { if (u.role === 'admin') u.name = 'Admin'; });

    // Drop live matches whose sport or teams no longer exist
    db.live = db.live.filter((l) => {
      if (!sportById(l.game) || !l.state || !Array.isArray(l.history)) return false;
      if (l.kind === 'two') return !!teamById(l.a) && !!teamById(l.b);
      if (l.kind === 'battle') return Array.isArray(l.teams) && l.teams.length >= 2 && l.teams.every((id) => teamById(id) && l.state.t[id]);
      return false;
    });
    db.live.forEach(normalizeLiveItem);
    save();
  }

  /* ---------- Data lookups ---------- */
  const userById = (id) => db.users.find((u) => u.id === id);
  const teamById = (id) => db.teams.find((t) => t.id === id);
  const sportById = (id) => db.sports.find((s) => s.id === id);
  const teamsOf = (sportId) => db.teams.filter((t) => t.game === sportId);
  const currentUser = () => db.users.find((u) => u.id === sessionUserId) || null;
  const teamOfUser = (userId, sportId) => teamsOf(sportId).find((t) => t.members.includes(userId));
  const teamName = (id) => (teamById(id) ? teamById(id).name : 'Removed team');
  const squadSize = (g) => g.main + g.extra;
  const hasResults = (sportId) => db.points.some((p) => p.game === sportId);
  const isTwoTeam = (g) => g.scoring.type !== 'placement';   // head-to-head sports

  // How many playing / extra players a team has right now
  function counts(t) {
    const extra = t.members.filter((id) => t.extras.includes(id)).length;
    return { playing: t.members.length - extra, extra };
  }
  const isTeamFull = (t, g) => {
    const c = counts(t);
    return c.playing >= g.main && c.extra >= g.extra;
  };

  function placementPoints(g, rank) {
    return Number(g.scoring.placement[rank - 1]) || 0;
  }

  function placementSummary(list) {
    const pts = Array.from({ length: PLACES }, (_, i) => Number(list[i]) || 0);
    let last = -1;
    pts.forEach((p, i) => { if (p > 0) last = i; });
    if (last < 0) return 'no points for any place';
    const parts = pts.slice(0, last + 1).map((p, i) => `${ordinal(i + 1)} ${p}`);
    if (last + 1 < PLACES) {
      parts.push(last + 2 === PLACES ? `${ordinal(PLACES)} 0` : `${ordinal(last + 2)} to ${ordinal(PLACES)} 0`);
    }
    return parts.join(', ');
  }

  function ruleText(g) {
    const sc = g.scoring;
    if (sc.type === 'winloss') return `Winning team gets ${WIN_POINTS} points. Losing team gets ${LOSS_POINTS}.`;
    if (sc.type === 'custom') return 'Points per result: ' + sc.outcomes.map((o) => `${o.label} ${o.points}`).join(', ') + '.';
    const kp = Number(sc.killPoints) || 0;
    return `Placement points: ${placementSummary(sc.placement)}.` +
      (kp > 0 ? ` Plus ${kp} ${plural(kp, 'point', 'points')} for every elimination.` : '');
  }

  // Points table: built automatically from the results the admin has entered
  function standings(g) {
    const sc = g.scoring;
    let topIndex = 0;
    if (sc.type === 'custom') sc.outcomes.forEach((o, i) => { if (o.points > sc.outcomes[topIndex].points) topIndex = i; });

    return teamsOf(g.id)
      .map((t) => {
        const entries = db.points.filter((p) => p.teamId === t.id);
        return {
          id: t.id,
          name: t.name,
          matches: entries.length,
          won: entries.filter((p) => p.result === 'win').length,
          lost: entries.filter((p) => p.result === 'loss').length,
          kills: entries.reduce((sum, p) => sum + (p.kills || 0), 0),
          counts: sc.type === 'custom' ? sc.outcomes.map((o) => entries.filter((p) => p.outcome === o.id).length) : [],
          points: entries.reduce((sum, p) => sum + p.points, 0)
        };
      })
      .sort((a, b) => {
        let tie = 0;
        if (sc.type === 'placement') tie = b.kills - a.kills;
        else if (sc.type === 'winloss') tie = b.won - a.won;
        else tie = (b.counts[topIndex] || 0) - (a.counts[topIndex] || 0);
        return b.points - a.points || tie || a.name.localeCompare(b.name);
      });
  }

  function matchGroups(sportId) {
    const groups = new Map();
    db.points.filter((p) => p.game === sportId).forEach((p) => {
      if (!groups.has(p.matchId)) groups.set(p.matchId, { id: p.matchId, name: p.matchName, date: p.date, entries: [] });
      groups.get(p.matchId).entries.push(p);
    });
    return Array.from(groups.values()).reverse(); // newest first
  }

  /* ---------- Live matches ---------- */
  const liveOf = (sportId) => db.live.filter((l) => l.game === sportId);
  const liveById = (id) => db.live.find((l) => l.id === id);
  const canGoLive = (g) => (isTwoTeam(g) ? g.scoreType !== 'none' : true);
  const MAX_UNDO = 200;

  // Cricket: balls = legal balls only (wides and no balls are extras and do not count),
  // ov = the deliveries of the current over, ovDone = the over just finished.
  const newTwoState = (g) => {
    const blank = () => (g.scoreType === 'cricket' ? { runs: 0, wickets: 0, balls: 0, ov: [], ovDone: false } : { score: 0 });
    return { a: blank(), b: blank() };
  };
  const liveScoreText = (g, s) => (g.scoreType === 'cricket' ? `${s.runs}/${s.wickets}` : String(s.score));

  const DEFAULT_OVERS = 20;
  const oversText = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;
  const maxBalls = (l) => (l.overs || DEFAULT_OVERS) * 6;
  // An innings is closed when the team is all out or all its overs are bowled
  const closedReason = (l, s) => (s.wickets >= 10 ? 'All out' : (s.balls >= maxBalls(l) ? 'Overs complete' : ''));

  function applyDelivery(s, token, runs, legal, wicket) {
    if (s.ovDone) { s.ov = []; s.ovDone = false; }   // a new over starts
    s.ov.push(token);
    s.runs += runs;
    if (wicket) s.wickets += 1;
    if (legal) {
      s.balls += 1;
      if (s.balls % 6 === 0) s.ovDone = true;
    }
  }

  // Older live matches (before overs and status undo existed) get the new fields
  function normalizeLiveItem(l) {
    if (l.kind === 'two') {
      const g = db.sports.find((s) => s.id === l.game);
      if (g && g.scoreType === 'cricket') {
        if (!Number.isInteger(l.overs) || l.overs < 1) l.overs = DEFAULT_OVERS;
        ['a', 'b'].forEach((k) => {
          const s = l.state[k];
          if (typeof s.balls !== 'number') s.balls = 0;
          if (!Array.isArray(s.ov)) s.ov = [];
          s.ovDone = !!s.ovDone;
        });
      }
    } else if (l.kind === 'battle' && l.state && l.state.t) {
      Object.keys(l.state.t).forEach((id) => { if (!Array.isArray(l.state.t[id].hist)) l.state.t[id].hist = []; });
    }
  }

  function newBattleState(g, teamIds) {
    const t = {};
    teamIds.forEach((id) => { t[id] = { p: Array(g.main).fill('a'), kills: 0, out: null, hist: [] }; });
    return { seq: 0, t };
  }

  // Live board rows for a placement sport. The first team out gets the last place.
  function battleRows(g, live) {
    const n = live.teams.length;
    const kp = Number(g.scoring.killPoints) || 0;
    const recorded = new Map(standings(g).map((r) => [r.id, r.points]));
    const eliminated = live.teams
      .filter((id) => live.state.t[id].out !== null)
      .sort((x, y) => live.state.t[x].out - live.state.t[y].out);
    const rankOf = new Map(eliminated.map((id, i) => [id, n - i]));

    return live.teams
      .map((id) => {
        const s = live.state.t[id];
        const alive = s.p.filter((x) => x === 'a').length;
        const knock = s.p.filter((x) => x === 'k').length;
        const out = s.out !== null;
        const rank = rankOf.get(id) || null;
        const livePoints = s.kills * kp + (out ? placementPoints(g, rank) : 0);
        return {
          id, name: teamName(id), pips: s.p, kills: s.kills, alive, knock,
          canUndo: Array.isArray(s.hist) && s.hist.length > 0,
          eliminated: out, rank, total: (recorded.get(id) || 0) + livePoints
        };
      })
      .sort((a, b) => b.total - a.total || b.kills - a.kills || b.alive - a.alive || a.name.localeCompare(b.name));
  }

  // Final ranks when the admin ends a placement match: teams still alive take the top places
  function battleFinalRanks(live) {
    const n = live.teams.length;
    const t = live.state.t;
    const out = live.teams.filter((id) => t[id].out !== null).sort((x, y) => t[x].out - t[y].out);
    const alive = live.teams
      .filter((id) => t[id].out === null)
      .sort((x, y) => t[y].kills - t[x].kills || teamName(x).localeCompare(teamName(y)));
    const ranks = {};
    alive.forEach((id, i) => { ranks[id] = i + 1; });
    out.forEach((id, i) => { ranks[id] = n - i; });
    return { ranks, aliveCount: alive.length };
  }

  function pushHistory(live, label) {
    live.history.push({ label, prev: JSON.stringify(live.state) });
    if (live.history.length > MAX_UNDO) live.history.shift();
  }

  function consumeLive(gameId, aId, bId) {
    db.live = db.live.filter((l) => !(l.game === gameId && l.kind === 'two' && pairKey(l.a, l.b) === pairKey(aId, bId)));
  }

  function removeTeamFromLive(teamId) {
    db.live = db.live.filter((l) => !(l.kind === 'two' && (l.a === teamId || l.b === teamId)));
    db.live.forEach((l) => {
      if (l.kind !== 'battle' || !l.teams.includes(teamId)) return;
      l.teams = l.teams.filter((id) => id !== teamId);
      delete l.state.t[teamId];
      l.history = [];   // old snapshots still contain the removed team
    });
    db.live = db.live.filter((l) => l.kind !== 'battle' || l.teams.length >= 2);
  }

  /* ---------- Upcoming matches ---------- */
  const pairKey = (a, b) => [a, b].sort().join('|');

  function fixturesOf(g) {
    return db.fixtures
      .filter((f) => f.game === g.id && teamById(f.a) && teamById(f.b))
      .sort((x, y) => (x.date || '9999-99-99').localeCompare(y.date || '9999-99-99'));
  }

  // Pairs of teams that already played each other
  function playedPairs(g) {
    const byMatch = new Map();
    db.points.filter((p) => p.game === g.id).forEach((p) => {
      if (!byMatch.has(p.matchId)) byMatch.set(p.matchId, []);
      byMatch.get(p.matchId).push(p.teamId);
    });
    const set = new Set();
    byMatch.forEach((ids) => { if (ids.length === 2) set.add(pairKey(ids[0], ids[1])); });
    return set;
  }

  // A new team plays every team that is already registered
  function addFixturesForNewTeam(g, team) {
    if (!isTwoTeam(g) || !g.autoFixtures) return 0;
    let added = 0;
    teamsOf(g.id).forEach((other) => {
      if (other.id === team.id) return;
      db.fixtures.push({ id: uid(), game: g.id, a: other.id, b: team.id, date: '' });
      added++;
    });
    return added;
  }

  // Add every missing pair that has not played yet and is not already scheduled
  function addMissingFixtures(g) {
    if (!isTwoTeam(g)) return 0;
    const teams = teamsOf(g.id);
    const have = new Set(db.fixtures.filter((f) => f.game === g.id).map((f) => pairKey(f.a, f.b)));
    const played = playedPairs(g);
    let added = 0;
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const key = pairKey(teams[i].id, teams[j].id);
        if (have.has(key) || played.has(key)) continue;
        db.fixtures.push({ id: uid(), game: g.id, a: teams[i].id, b: teams[j].id, date: '' });
        added++;
      }
    }
    return added;
  }

  // When a result is saved, the matching upcoming match is removed
  function consumeFixture(gameId, aId, bId) {
    const i = db.fixtures.findIndex((f) => f.game === gameId && pairKey(f.a, f.b) === pairKey(aId, bId));
    if (i >= 0) db.fixtures.splice(i, 1);
  }

  /* =====================================================================
     Rendering
     ===================================================================== */
  function render() {
    const user = currentUser();
    if (!user && sessionUserId) { sessionUserId = null; saveSession(); }
    $('#auth').hidden = !!user;
    $('#app').hidden = !user;
    if (!user) { renderAuth(); return; }

    // Make sure the page being shown still exists and is allowed
    if (view !== 'home' && view !== 'points' && view !== 'manage' && !sportById(view)) view = 'home';
    if (view === 'manage' && user.role !== 'admin') view = 'home';
    if (pointsSportId && !sportById(pointsSportId)) pointsSportId = null;
    renderApp(user);
  }

  /* ---------- Login / sign up ---------- */
  function renderAuth() {
    let fields;

    if (authMode === 'signup') {
      fields = `
        <label>Full name
          <input id="f-name" maxlength="40" autocomplete="name" value="${esc(authDraft.name)}">
        </label>
        <label>Username
          <input id="f-username" maxlength="20" autocomplete="username" autocapitalize="none" placeholder="Letters, numbers, . _ -" value="${esc(authDraft.username)}">
        </label>
        <label>Password
          <input id="f-password" type="password" autocomplete="new-password" placeholder="At least 4 characters">
        </label>
        <label>I am a
          <select id="f-role">
            <option value="player">Player (join a team)</option>
            <option value="captain">Captain (create and manage a team)</option>
          </select>
        </label>
        <button type="button" class="btn primary block" data-action="signup">Create account</button>`;
    } else {
      const isAdmin = authMode === 'admin';
      fields = `
        ${isAdmin ? '<p class="muted">Only the admin can add sports, enter results and manage matches.</p>' : ''}
        <label>Username
          <input id="f-username" autocomplete="username" autocapitalize="none" value="${esc(authDraft.username)}">
        </label>
        <label>Password
          <input id="f-password" type="password" autocomplete="current-password">
        </label>
        <button type="button" class="btn primary block" data-action="login">${isAdmin ? 'Log in as admin' : 'Log in'}</button>`;
    }

    const tab = (mode, label) =>
      `<button type="button" class="tab ${authMode === mode ? 'is-active' : ''}" data-action="auth-tab" data-mode="${mode}">${label}</button>`;

    $('#auth').innerHTML = `
      <div class="auth-card">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true"></span>
          <span class="brand-name">Sports<br>Management</span>
        </div>
        <div class="tabs">
          ${tab('login', 'Student login')}
          ${tab('signup', 'Sign up')}
          ${tab('admin', 'Admin login')}
        </div>
        ${authError ? `<p class="form-error" role="alert">${esc(authError)}</p>` : ''}
        ${fields}
      </div>`;
  }

  /* ---------- App shell ---------- */
  function renderApp(user) {
    const item = (key, label, color) =>
      `<button type="button" class="nav-btn ${view === key ? 'is-active' : ''}" data-nav="${key}"${color ? ` style="--accent:${color}"` : ''}>
        ${color ? '<span class="dot"></span>' : ''}${esc(label)}${color && liveOf(key).length ? '<span class="live-dot" title="Live now"></span>' : ''}
      </button>`;

    const nav = [
      item('home', 'Home'),
      item('points', 'Points table'),
      ...db.sports.map((s) => item(s.id, s.name, s.color)),
      user.role === 'admin' ? item('manage', 'Manage sports') : ''
    ].join('');

    let content;
    if (view === 'home') content = homeHTML(user);
    else if (view === 'points') content = pointsHTML(user);
    else if (view === 'manage') content = manageHTML();
    else content = gameHTML(sportById(view), user);

    $('#app').innerHTML = `
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true"></span>
          <span class="brand-name">Sports<br>Management</span>
        </div>
        <div class="profile">
          <button type="button" class="profile-btn" data-action="toggle-profile" aria-haspopup="menu" aria-expanded="false" aria-controls="profile-menu">
            <span class="avatar">${AVATAR_SVG}</span>
            <span class="profile-name">${esc(displayName(user))}</span>
            <span class="badge ${user.role}">${ROLE_LABEL[user.role]}</span>
            <span class="chevron">${CHEVRON_SVG}</span>
          </button>
          <div class="profile-menu" id="profile-menu" role="menu" hidden>
            <button type="button" class="menu-item" role="menuitem" data-action="logout">↪ Log out</button>
          </div>
        </div>
      </header>
      <aside class="sidebar">
        <nav class="nav" aria-label="Main">${nav}</nav>
      </aside>
      <main class="main">${content}</main>`;

    syncMatchLabels();
  }

  function setProfileMenu(open) {
    const btn = $('.profile-btn');
    const menu = $('#profile-menu');
    if (!btn || !menu) return;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }

  /* ---------- Home ---------- */
  function homeHTML(user) {
    const isAdmin = user.role === 'admin';
    const intro = {
      captain: 'Create a team in each sport you captain, then choose who plays and who is an extra.',
      player: 'Join a team in each sport you play. You can leave a team whenever you need to.',
      admin: 'Add sports, enter match results and manage squads and upcoming matches. The points tables update by themselves.'
    }[user.role];

    const greeting = isAdmin ? 'Admin' : user.name.split(' ')[0];

    // Sports where you are registered come first, the rest go to the bottom
    const rows = db.sports
      .map((g) => ({ g, team: teamOfUser(user.id, g.id) }))
      .sort((a, b) => (b.team ? 1 : 0) - (a.team ? 1 : 0));

    const yourTeams = isAdmin || !rows.length ? '' : `
      <section class="panel">
        <h2>Your teams</h2>
        <ul class="plain-list">
          ${rows.map(({ g, team }) => `
            <li>
              <span><strong>${esc(g.name)}</strong>: ${team
                ? `${esc(team.name)} <span class="muted">(${team.members.length}/${squadSize(g)} players)</span>`
                : '<span class="muted">Not registered</span>'}</span>
              <button type="button" class="btn small" data-nav="${g.id}"${team ? ' data-focus="team"' : ''}>${team ? 'Open' : (user.role === 'captain' ? 'Create team' : 'Find a team')}</button>
            </li>`).join('')}
        </ul>
      </section>`;

    const adminPanel = isAdmin ? `
      <section class="panel note">
        <strong>Sports setup.</strong> Add a new sport, set how many players play and choose how points are given.
        <div class="panel-actions" style="margin-top:0.75rem"><button type="button" class="btn primary small" data-nav="manage">Manage sports</button></div>
      </section>` : '';

    const pointsLink = `
      <section class="panel points-link">
        <div>
          <h2>Points table</h2>
          <p class="muted">See the points table of any sport.</p>
        </div>
        <button type="button" class="btn primary" data-nav="points">Open points table</button>
      </section>`;

    const cards = db.sports.map((g) => {
      const teams = teamsOf(g.id);
      const lead = standings(g)[0];
      const registered = g.maxTeams
        ? `${teams.length} of ${g.maxTeams} teams registered`
        : `${teams.length} ${plural(teams.length, 'team', 'teams')} registered`;
      return `
        <article class="game-card" style="--accent:${g.color}">
          <h2>${esc(g.name)}</h2>
          <p class="muted">${g.main} playing${g.extra ? ` + ${g.extra} extra` : ''} per team</p>
          <p>${registered}</p>
          <p>${lead && lead.points > 0 ? `Leading: <strong>${esc(lead.name)}</strong> (${lead.points} pts)` : 'No points awarded yet'}</p>
          <button type="button" class="btn small primary" data-nav="${g.id}">Open ${esc(g.name)} dashboard</button>
        </article>`;
    }).join('');

    return `
      <div class="hero">
        <h1>Welcome, ${esc(greeting)}</h1>
        <p>${intro}</p>
      </div>
      ${liveHomeHTML()}
      ${adminPanel}
      ${pointsLink}
      ${yourTeams}
      <h2>Sports</h2>
      ${db.sports.length
        ? `<div class="game-cards">${cards}</div>`
        : `<div class="panel empty">No sports yet. ${isAdmin ? 'Add one from Manage sports.' : 'The admin will add sports soon.'}</div>`}`;
  }

  /* ---------- Points table page: choose a sport, then see its table ---------- */
  function pointsHTML(user) {
    const g = pointsSportId ? sportById(pointsSportId) : null;

    if (g) {
      const teams = teamsOf(g.id).length;
      return `
        <div style="--accent:${g.color}">
          <div class="page-head"><button type="button" class="btn small" data-action="points-back">← All sports</button></div>
          <div class="hero">
            <h1>${esc(g.name)}</h1>
            <p>Points table. ${teams} ${plural(teams, 'team', 'teams')} registered.</p>
          </div>
          ${standingsHTML(g, user)}
        </div>`;
    }

    const n = db.sports.length;
    const cards = db.sports.map((s) => {
      const teams = teamsOf(s.id);
      const lead = standings(s)[0];
      return `
        <article class="game-card" style="--accent:${s.color}">
          <h2>${esc(s.name)}</h2>
          <p class="muted">${teams.length} ${plural(teams.length, 'team', 'teams')} registered</p>
          <p>${lead && lead.points > 0 ? `Leading: <strong>${esc(lead.name)}</strong> (${lead.points} pts)` : 'No points awarded yet'}</p>
          <button type="button" class="btn small primary" data-action="open-points" data-sport="${s.id}">View points table</button>
        </article>`;
    }).join('');

    return `
      <div class="hero">
        <h1>Points table</h1>
        <p>${n} ${plural(n, 'sport is', 'sports are')} available. Choose a sport to see its points table.</p>
      </div>
      ${n ? `<div class="game-cards">${cards}</div>` : '<div class="panel empty">No sports yet.</div>'}`;
  }

  /* ---------- Sport dashboard ---------- */
  function gameHTML(g, user) {
    const teams = teamsOf(g.id);
    const total = squadSize(g);
    const isAdmin = user.role === 'admin';
    const isFullLeague = !!g.maxTeams && teams.length >= g.maxTeams;
    const percent = g.maxTeams ? Math.min(100, Math.round((teams.length / g.maxTeams) * 100)) : 0;
    const extraText = g.extra > 0 ? ` and ${g.extra} extra ${plural(g.extra, 'player', 'players')} for emergencies` : '';
    const myTeam = isAdmin ? null : teamOfUser(user.id, g.id);

    const hero = `
      <div class="hero">
        <h1>${esc(g.name)}</h1>
        <p>Every team has ${g.main} playing ${plural(g.main, 'player', 'players')}${extraText}.${g.maxTeams ? ` Up to ${g.maxTeams} teams can register.` : ''}</p>
        <div class="hero-stats">
          <div><b>${teams.length}${g.maxTeams ? ` / ${g.maxTeams}` : ''}</b><span>Teams registered</span></div>
          <div><b>${g.main} + ${g.extra}</b><span>Playing + extra</span></div>
          <div><b>${total}</b><span>Players per team</span></div>
        </div>
        ${g.maxTeams ? `<div class="meter" aria-hidden="true"><span style="width:${percent}%"></span></div>` : ''}
      </div>`;

    // Members see their own team right below the header
    const yourTeam = myTeam ? `
      <section id="my-team" class="my-team">
        <div class="section-head"><h2>Your team</h2></div>
        ${teamCardHTML(myTeam, g, user)}
      </section>` : '';

    return `<div style="--accent:${g.color}">
      ${hero}
      ${liveSectionHTML(g, user)}
      ${yourTeam}
      ${standingsHTML(g, user)}
      ${isAdmin ? adminPanelHTML(g, teams) : registerPanelHTML(g, user, teams, isFullLeague)}
      ${isTwoTeam(g) ? upcomingHTML(g, user, teams) : ''}
      ${recentHTML(g, user)}
      ${teamsSectionHTML(g, user, teams, isFullLeague)}
    </div>`;
  }

  function standingsHTML(g, user) {
    const rows = standings(g);
    const mine = teamOfUser(user.id, g.id);
    const sc = g.scoring;
    const showKills = sc.type === 'placement' && (Number(sc.killPoints) || 0) > 0;

    let head;
    if (sc.type === 'winloss') {
      head = '<th class="num">Played</th><th class="num">Won</th><th class="num">Lost</th>';
    } else if (sc.type === 'custom') {
      head = '<th class="num">Played</th>' + sc.outcomes.map((o) => `<th class="num">${esc(o.label)}</th>`).join('');
    } else {
      head = '<th class="num">Matches</th>' + (showKills ? '<th class="num">Eliminations</th>' : '');
    }
    const cols = 3 + (head.match(/<th/g) || []).length;

    const cells = (r) => {
      if (sc.type === 'winloss') return `<td class="num">${r.matches}</td><td class="num">${r.won}</td><td class="num">${r.lost}</td>`;
      if (sc.type === 'custom') return `<td class="num">${r.matches}</td>` + r.counts.map((n) => `<td class="num">${n}</td>`).join('');
      return `<td class="num">${r.matches}</td>` + (showKills ? `<td class="num">${r.kills}</td>` : '');
    };

    const body = rows.length
      ? rows.map((r, i) => `
          <tr class="${mine && mine.id === r.id ? 'mine' : ''}">
            <td class="num">${i + 1}</td>
            <td>${esc(r.name)}</td>
            ${cells(r)}
            <td class="num pts">${r.points}</td>
          </tr>`).join('')
      : `<tr><td colspan="${cols}" class="empty">No teams yet, so there is no table.</td></tr>`;

    return `
      <section>
        <div class="section-head"><h2>Points table</h2></div>
        <div class="panel table-wrap">
          <table>
            <thead><tr><th class="num">#</th><th>Team</th>${head}<th class="num">Points</th></tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
        <p class="hint">${esc(ruleText(g))} Teams are ranked by points.</p>
      </section>`;
  }

  /* Score boxes for the result form (depends on the sport's scorecard type) */
  function scoreFieldsHTML(g, pre = {}) {
    if (g.scoreType === 'cricket') {
      return `
        <div class="form-row" style="margin-bottom:1rem">
          <label class="narrow"><span data-lbl="a" data-suffix="runs">Team 1 runs</span>
            <input id="r-a" type="number" min="0" max="999" inputmode="numeric" value="${pre.ra ?? ''}"></label>
          <label class="narrow"><span data-lbl="a" data-suffix="wickets">Team 1 wickets</span>
            <input id="w-a" type="number" min="0" max="10" inputmode="numeric" value="${pre.wa ?? ''}"></label>
          <label class="narrow"><span data-lbl="b" data-suffix="runs">Team 2 runs</span>
            <input id="r-b" type="number" min="0" max="999" inputmode="numeric" value="${pre.rb ?? ''}"></label>
          <label class="narrow"><span data-lbl="b" data-suffix="wickets">Team 2 wickets</span>
            <input id="w-b" type="number" min="0" max="10" inputmode="numeric" value="${pre.wb ?? ''}"></label>
        </div>`;
    }
    if (g.scoreType === 'simple') {
      return `
        <div class="form-row" style="margin-bottom:1rem">
          <label class="narrow"><span data-lbl="a" data-suffix="score">Team 1 score</span>
            <input id="s-a" type="number" min="0" max="9999" inputmode="numeric" value="${pre.sa ?? ''}"></label>
          <label class="narrow"><span data-lbl="b" data-suffix="score">Team 2 score</span>
            <input id="s-b" type="number" min="0" max="9999" inputmode="numeric" value="${pre.sb ?? ''}"></label>
        </div>`;
    }
    return '';
  }

  /* Admin: enter results (form depends on the scoring system) */
  function adminPanelHTML(g, teams) {
    const type = g.scoring.type;
    const pf = prefill || {};            // values filled in when the admin ends a live match
    const pre = pf.scores || {};

    if (type === 'placement') {
      if (!teams.length) return `<section class="panel note">Teams must register before you can enter a ${esc(g.name)} match.</section>`;
      const showKills = (Number(g.scoring.killPoints) || 0) > 0;
      return `
        <section class="panel" id="placement-form">
          <h2>Enter ${esc(g.name)} match result</h2>
          <p class="muted">Enter each team's final rank${showKills ? ' and total eliminations' : ''}. Points are worked out automatically. Leave a team blank if it did not play.</p>
          <div class="form-row" style="margin-bottom:1rem">
            <label>Match name <input id="award-name" maxlength="40" placeholder="Match 1" value="${esc(pf.name || '')}"></label>
          </div>
          <div class="table-wrap" style="margin-bottom:0.75rem">
            <table>
              <thead><tr><th>Team</th><th class="num">Rank</th>${showKills ? '<th class="num">Eliminations</th>' : ''}</tr></thead>
              <tbody>
                ${teams.map((t) => `
                  <tr>
                    <td>${esc(t.name)}</td>
                    <td class="num"><input class="pt-input rank-input" type="number" min="1" max="${teams.length}" inputmode="numeric" data-team="${t.id}" value="${esc(pf.ranks && pf.ranks[t.id] !== undefined ? pf.ranks[t.id] : '')}" aria-label="Rank of ${esc(t.name)}"></td>
                    ${showKills ? `<td class="num"><input class="pt-input kill-input" type="number" min="0" max="99" inputmode="numeric" data-team="${t.id}" value="${esc(pf.kills && pf.kills[t.id] !== undefined ? pf.kills[t.id] : '')}" aria-label="Eliminations of ${esc(t.name)}"></td>` : ''}
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <p class="hint">${esc(ruleText(g))}</p>
          <div class="panel-actions"><button type="button" class="btn primary" data-action="save-placement" data-live="${esc(pf.liveId || '')}">Save match</button></div>
        </section>`;
    }

    if (teams.length < 2) {
      return '<section class="panel note">At least two teams must register before you can record a match.</section>';
    }
    const pickA = prefill ? prefill.a : null;
    const pickB = prefill ? prefill.b : null;
    const teamOptions = (selectedId, fallbackIndex) => teams
      .map((t, i) => `<option value="${t.id}" ${(selectedId ? t.id === selectedId : i === fallbackIndex) ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
    const scoreHint = g.scoreType === 'cricket' ? ' Enter runs and wickets for each team.' : (g.scoreType === 'simple' ? ' Enter the score of each team.' : '');

    if (type === 'winloss') {
      return `
        <section class="panel" id="record-form">
          <h2>Record match result</h2>
          <p class="muted">Pick the two teams${g.scoreType === 'none' ? ' and the winner' : ', the scores and the winner'}. The winner gets ${WIN_POINTS} points, the other team gets ${LOSS_POINTS}, and the points table updates automatically.${scoreHint}</p>
          <div class="form-row" style="margin-bottom:1rem">
            <label>Team 1 <select id="m-a">${teamOptions(pickA, 0)}</select></label>
            <label>Team 2 <select id="m-b">${teamOptions(pickB, 1)}</select></label>
          </div>
          ${scoreFieldsHTML(g, pre)}
          <div class="form-row">
            <label>Winner
              <select id="m-win">
                <option value="">Choose winner</option>
                <option value="a">Team 1</option>
                <option value="b">Team 2</option>
              </select>
            </label>
          </div>
          <div class="panel-actions"><button type="button" class="btn primary" data-action="record-result">Save result</button></div>
        </section>`;
    }

    // Custom results (for example Win 3, Draw 1, Loss 0)
    const outcomeOptions = '<option value="">Choose result</option>' + g.scoring.outcomes
      .map((o) => `<option value="${o.id}">${esc(o.label)} (${o.points} ${plural(o.points, 'point', 'points')})</option>`).join('');
    return `
      <section class="panel" id="record-form">
        <h2>Record match result</h2>
        <p class="muted">Pick the two teams${g.scoreType === 'none' ? '' : ', the scores'} and the result for each team. Points come from the scoring you set up for ${esc(g.name)}.${scoreHint}</p>
        <div class="form-row" style="margin-bottom:1rem">
          <label>Team 1 <select id="m-a">${teamOptions(pickA, 0)}</select></label>
          <label>Team 2 <select id="m-b">${teamOptions(pickB, 1)}</select></label>
        </div>
        ${scoreFieldsHTML(g, pre)}
        <div class="form-row">
          <label><span data-lbl="a" data-suffix="result">Team 1 result</span> <select id="c-a">${outcomeOptions}</select></label>
          <label><span data-lbl="b" data-suffix="result">Team 2 result</span> <select id="c-b">${outcomeOptions}</select></label>
        </div>
        <div class="panel-actions"><button type="button" class="btn primary" data-action="record-custom">Save result</button></div>
      </section>`;
  }

  /* ---------- Live scores ---------- */
  const liveBadge = () => '<span class="live-badge">Live</span>';

  function livePanelActionsHTML(l) {
    const last = l.history[l.history.length - 1];
    return `
      <div class="live-actions">
        <button type="button" class="btn small" data-action="live-undo" data-live="${l.id}" ${last ? '' : 'disabled'}>↶ Undo${last ? ` (${esc(last.label)})` : ''}</button>
        <button type="button" class="btn small primary" data-action="live-finish" data-live="${l.id}">End match</button>
        <button type="button" class="btn small danger" data-action="live-cancel" data-live="${l.id}">Cancel live</button>
      </div>`;
  }

  // One delivery shown as a small chip: dot, runs, W, Wd, Nb
  function ballChip(tok) {
    const cls = tok === 'W' ? 'wk' : (tok.startsWith('Wd') || tok.startsWith('Nb') ? 'ex' : (tok === '4' || tok === '6' ? 'bd' : 'rn'));
    return `<i class="ball ${cls}">${tok === '0' ? '•' : esc(tok)}</i>`;
  }

  // Two-team live score (cricket runs/wickets/overs, kabaddi points)
  function liveCardHTML(g, l, admin) {
    const cricket = g.scoreType === 'cricket';

    const side = (key) => {
      const s = l.state[key];
      let extra = '';
      if (cricket) {
        const closed = closedReason(l, s);
        extra = `
          <span class="sc-overs">${oversText(s.balls)} / ${l.overs} ov</span>
          ${closed ? `<span class="badge full">${closed}</span>` : ''}
          ${s.ov.length ? `<span class="over-line"><span class="muted">${s.ovDone ? 'Last over' : 'This over'}</span><span class="over-balls">${s.ov.map(ballChip).join('')}</span></span>` : ''}`;
      }
      return `
        <div class="sc-team">
          <span class="sc-name">${esc(teamName(l[key]))}</span>
          <span class="sc-score">${esc(liveScoreText(g, s))}</span>
          ${extra}
        </div>`;
    };

    const btn = (action, side, attrs, label, cls = '', disabled = false, aria = '') =>
      `<button type="button" class="btn small ${cls}" data-action="${action}" data-live="${l.id}" data-side="${side}" ${attrs}${aria ? ` aria-label="${aria}"` : ''} ${disabled ? 'disabled' : ''}>${label}</button>`;

    const pad = (key) => {
      const name = esc(teamName(l[key]));
      if (cricket) {
        const s = l.state[key];
        const closed = closedReason(l, s);
        const off = !!closed;
        const balls = [[0, 'Dot', 'Dot ball'], [1, '+1', '1 run'], [2, '+2', '2 runs'], [3, '+3', '3 runs'], [4, '+4', 'Four'], [6, '+6', 'Six']]
          .map(([r, label, aria]) => btn('live-ball', key, `data-r="${r}"`, label, '', off, `${name}: ${aria}`)).join('');
        const wicket = btn('live-wicket', key, '', 'Wicket', 'danger', off);
        const extras = [['wd', 1, 'Wide', 'Wide, 1 run'], ['nb', 1, 'No ball', 'No ball, 1 run'], ['nb', 5, 'NB +4', 'No ball and 4 runs off the bat'], ['nb', 7, 'NB +6', 'No ball and 6 runs off the bat']]
          .map(([kind, r, label, aria]) => btn('live-extra', key, `data-kind="${kind}" data-r="${r}"`, label, '', off, `${name}: ${aria}`)).join('');
        return `
          <div class="live-side">
            <strong>${name}</strong>
            ${closed ? `<p class="hint" style="margin:0 0 0.4rem">${closed}: no more runs can be added for this team.</p>` : ''}
            <p class="pad-label">Ball (counts in the over)</p>
            <div class="pad">${balls}${wicket}</div>
            <p class="pad-label">Extras (ball does not count)</p>
            <div class="pad">${extras}</div>
          </div>`;
      }
      const buttons = [1, 2, 3, 4, 5].map((n) => btn('live-add', key, `data-n="${n}"`, `+${n}`)).join('');
      return `<div class="live-side"><strong>${name}</strong><div class="pad">${buttons}</div></div>`;
    };

    return `
      <article class="panel live-card">
        <div class="live-head">${liveBadge()}<span class="muted">${esc(g.name)}${cricket ? `, ${l.overs} overs a side` : ''}</span></div>
        <div class="scorecard">
          ${side('a')}
          <span class="sc-vs">v/s</span>
          ${side('b')}
        </div>
        ${admin ? `<div class="live-controls">${pad('a')}${pad('b')}</div>${livePanelActionsHTML(l)}` : ''}
      </article>`;
  }

  function pipsHTML(l, r, admin) {
    const word = { a: 'alive', k: 'knocked', d: 'eliminated' };
    if (!admin) {
      const dead = r.pips.length - r.alive - r.knock;
      return `<span class="pips" role="img" aria-label="${r.alive} alive, ${r.knock} knocked, ${dead} eliminated">${r.pips.map((p) => `<i class="pip ${p}"></i>`).join('')}</span>`;
    }
    const undo = `<button type="button" class="pip-undo" data-action="live-pip-undo" data-live="${l.id}" data-team="${r.id}" aria-label="Undo the last status change of ${esc(r.name)}" title="Undo status" ${r.canUndo ? '' : 'disabled'}>↶</button>`;
    return `<span class="pips edit">${r.pips.map((p, i) =>
      `<button type="button" class="pip ${p}" data-action="live-pip" data-live="${l.id}" data-team="${r.id}" data-idx="${i}" aria-label="${esc(r.name)} player ${i + 1} is ${word[p]}. Tap to change."></button>`).join('')}${undo}</span>`;
  }

  // Live standings for placement sports (BGMI, Free Fire)
  function liveBoardHTML(g, l, admin) {
    const rows = battleRows(g, l);
    const aliveTeams = rows.filter((r) => !r.eliminated).length;

    const killCell = (r) => admin
      ? `<span class="kill-ctl">
           <button type="button" class="btn small" data-action="live-kill" data-live="${l.id}" data-team="${r.id}" data-d="-1" aria-label="Remove an elimination from ${esc(r.name)}" ${r.kills <= 0 ? 'disabled' : ''}>−</button>
           <b>${r.kills}</b>
           <button type="button" class="btn small" data-action="live-kill" data-live="${l.id}" data-team="${r.id}" data-d="1" aria-label="Add an elimination to ${esc(r.name)}">+</button>
         </span>`
      : String(r.kills);

    const body = rows.map((r, i) => `
      <tr class="${r.eliminated ? 'out' : ''}">
        <td class="rank">${i + 1}</td>
        <td class="team-cell">${esc(r.name)}</td>
        <td class="num">${killCell(r)}</td>
        <td class="num pts">${r.total}</td>
        <td class="status">${pipsHTML(l, r, admin)}</td>
      </tr>`).join('');

    return `
      <article class="panel live-card">
        <div class="live-head">${liveBadge()}<strong>${esc(l.name)}</strong><span class="muted">${aliveTeams} of ${rows.length} teams alive</span></div>
        <div class="board-wrap">
          <table class="board">
            <thead><tr><th>#</th><th>Team</th><th>Elims</th><th>Total pts</th><th>Status</th></tr></thead>
            <tbody>${body}</tbody>
          </table>
          <div class="board-legend">
            <span><i class="pip a"></i>Alive</span><span><i class="pip k"></i>Knock</span><span><i class="pip d"></i>Elim.</span>
          </div>
        </div>
        ${admin ? `<p class="hint">Tap a player bar to change it: alive, knocked, eliminated. If you tap by mistake, press ↶ next to the bars to put that team back as it was. Use + and − for eliminations. A team is out when all its players are eliminated, and gets its placement points automatically.</p>${livePanelActionsHTML(l)}` : ''}
      </article>`;
  }

  function liveStartHTML(g, teams) {
    if (!isTwoTeam(g)) {
      if (teams.length < 2) return '<div class="panel note">At least two teams must register before you can start a live match.</div>';
      return `
        <div class="panel">
          <h3>Start a live match</h3>
          <div class="form-row" style="margin:0.75rem 0">
            <label>Match name <input id="lv-name" maxlength="40" placeholder="Match 1"></label>
          </div>
          <p class="muted" style="margin-bottom:0.5rem">Teams playing in this match</p>
          <div class="team-checks">
            ${teams.map((t) => `<label class="check"><input type="checkbox" class="lv-team" value="${t.id}" checked> ${esc(t.name)}</label>`).join('')}
          </div>
          <div class="panel-actions" style="margin-top:1rem"><button type="button" class="btn primary" data-action="live-start-battle">Start live match</button></div>
        </div>`;
    }
    if (teams.length < 2) return '<div class="panel note">At least two teams must register before you can start a live match.</div>';
    const options = (sel) => teams.map((t, i) => `<option value="${t.id}" ${i === sel ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
    return `
      <div class="panel">
        <h3>Start a live match</h3>
        <div class="form-row" style="margin-top:0.75rem">
          <label>Team 1 <select id="lv-a">${options(0)}</select></label>
          <label>Team 2 <select id="lv-b">${options(1)}</select></label>
          ${g.scoreType === 'cricket' ? `<label class="narrow">Overs per team <input id="lv-overs" type="number" min="1" max="100" value="${DEFAULT_OVERS}" inputmode="numeric"></label>` : ''}
          <button type="button" class="btn primary" data-action="live-start-two">Start live</button>
        </div>
      </div>`;
  }

  // Live matches at the top of a sport page. Admin also gets the "Start" box.
  function liveSectionHTML(g, user) {
    if (!canGoLive(g)) return '';
    const admin = user.role === 'admin';
    const lives = liveOf(g.id);
    const cards = lives.map((l) => (l.kind === 'battle' ? liveBoardHTML(g, l, admin) : liveCardHTML(g, l, admin))).join('');
    if (!cards && !admin) return '';

    return `
      <section id="live-section">
        <div class="section-head"><h2>${lives.length ? `${liveBadge()} Live now` : 'Live score'}</h2></div>
        ${cards}
        ${admin ? liveStartHTML(g, teamsOf(g.id)) : ''}
      </section>`;
  }

  // Live matches listed on the Home page
  function liveHomeHTML() {
    const lives = db.live.filter((l) => sportById(l.game));
    if (!lives.length) return '';
    const rows = lives.map((l) => {
      const g = sportById(l.game);
      let text;
      if (l.kind === 'battle') {
        const lead = battleRows(g, l)[0];
        text = `${esc(l.name)}. Leading: ${esc(lead.name)} (${lead.total} pts)`;
      } else {
        const ov = (s) => (g.scoreType === 'cricket' ? ` (${oversText(s.balls)} ov)` : '');
        text = `${esc(teamName(l.a))} ${esc(liveScoreText(g, l.state.a))}${ov(l.state.a)} v/s ${esc(teamName(l.b))} ${esc(liveScoreText(g, l.state.b))}${ov(l.state.b)}`;
      }
      return `<li><span><strong>${esc(g.name)}</strong>: ${text}</span><button type="button" class="btn small primary" data-nav="${g.id}">Watch</button></li>`;
    }).join('');
    return `<section class="panel"><h2>${liveBadge()} Live now</h2><ul class="plain-list">${rows}</ul></section>`;
  }

  /* Captain: create team. Player: hint */
  function registerPanelHTML(g, user, teams, isFullLeague) {
    // Your own team is shown at the top of the page
    if (teamOfUser(user.id, g.id)) return '';

    if (user.role === 'captain') {
      if (isFullLeague) {
        return `<section class="panel warn"><strong>Registration is full.</strong> All ${g.maxTeams} team places are taken.</section>`;
      }
      return `
        <section class="panel">
          <h2>Create your ${esc(g.name)} team</h2>
          <div class="form-row">
            <label>Team name
              <input id="new-team-name" maxlength="30" placeholder="Enter a team name">
            </label>
            <button type="button" class="btn primary" data-action="create-team">Create team</button>
          </div>
          <p class="hint">You join as the first playing member. Other students join your team, and you decide who plays and who is an extra.</p>
        </section>`;
    }
    return '<section class="panel note">Pick a team below and press Join team. Only captains can create teams.</section>';
  }

  /* ---------- Upcoming matches (Winner / Loser and Custom sports) ---------- */
  function upcomingHTML(g, user, teams) {
    const admin = user.role === 'admin';
    const myTeam = admin ? null : teamOfUser(user.id, g.id);
    const list = fixturesOf(g);
    const options = (selectedId, fallbackIndex) => teams
      .map((t, i) => `<option value="${t.id}" ${(selectedId ? t.id === selectedId : i === fallbackIndex) ? 'selected' : ''}>${esc(t.name)}</option>`).join('');

    const adminTools = admin && teams.length >= 2 ? `
      <div class="panel">
        <h3>Add an upcoming match</h3>
        <div class="form-row" style="margin-top:0.75rem">
          <label>Team 1 <select id="nf-a">${options(null, 0)}</select></label>
          <label>Team 2 <select id="nf-b">${options(null, 1)}</select></label>
          <label>Date (optional) <input type="date" id="nf-date"></label>
          <button type="button" class="btn primary" data-action="add-fixture">Add match</button>
        </div>
        <div class="panel-actions" style="margin-top:0.75rem">
          <button type="button" class="btn small" data-action="auto-fixtures">Add all missing matches</button>
        </div>
        <p class="hint">${g.autoFixtures
          ? 'Matches are added automatically when a team registers: the new team plays every other team.'
          : 'Automatic matches are off for this sport. You can turn them on from Manage sports.'}
          "Add all missing matches" makes every team play every other team once.</p>
      </div>` : '';

    const rows = list.map((f) => {
      const a = teamById(f.a);
      const b = teamById(f.b);

      if (admin && editingFixtureId === f.id) {
        return `
          <li class="fixture editing">
            <div class="form-row">
              <label>Team 1 <select id="fx-a">${options(f.a, 0)}</select></label>
              <label>Team 2 <select id="fx-b">${options(f.b, 1)}</select></label>
              <label>Date <input type="date" id="fx-date" value="${esc(f.date)}"></label>
            </div>
            <div class="fixture-actions">
              <button type="button" class="btn small primary" data-action="save-fixture" data-fixture="${f.id}">Save</button>
              <button type="button" class="btn small" data-action="cancel-fixture">Cancel</button>
            </div>
          </li>`;
      }

      const mine = myTeam && (f.a === myTeam.id || f.b === myTeam.id);
      const liveNow = liveOf(g.id).some((l) => l.kind === 'two' && pairKey(l.a, l.b) === pairKey(f.a, f.b));
      return `
        <li class="fixture ${mine ? 'mine' : ''}">
          <div class="fixture-main">
            <span class="fixture-date">${f.date ? esc(formatDate(f.date)) : 'Date to be announced'}</span>
            <span class="fixture-teams"><strong>${esc(a.name)}</strong> <span class="muted">v/s</span> <strong>${esc(b.name)}</strong></span>
            ${mine ? '<span class="badge yours">Your match</span>' : ''}
            ${liveNow ? '<span class="live-badge">Live</span>' : ''}
          </div>
          ${admin ? `
            <div class="fixture-actions">
              ${canGoLive(g) && !liveNow ? `<button type="button" class="btn small" data-action="live-from-fixture" data-fixture="${f.id}">Go live</button>` : ''}
              <button type="button" class="btn small primary" data-action="fixture-result" data-fixture="${f.id}">Enter result</button>
              <button type="button" class="btn small" data-action="edit-fixture" data-fixture="${f.id}">Edit</button>
              <button type="button" class="btn small danger" data-action="delete-fixture" data-fixture="${f.id}">Delete</button>
            </div>` : ''}
        </li>`;
    }).join('');

    const empty = g.autoFixtures
      ? 'No upcoming matches yet. They are added automatically as teams register.'
      : 'No upcoming matches yet. The admin will add them.';

    return `
      <section>
        <div class="section-head"><h2>Upcoming matches</h2></div>
        ${adminTools}
        <div class="panel">
          ${list.length ? `<ul class="fixture-list">${rows}</ul>` : `<p class="muted">${empty}</p>`}
        </div>
      </section>`;
  }

  /* ---------- Recent matches: scorecards, or a points table for placement sports ---------- */
  function scoreText(e) {
    if (e.runs !== undefined) return `${e.runs}/${e.wickets}`;
    if (e.score !== undefined) return String(e.score);
    return '';
  }

  function scorecardHTML(m) {
    const [a, b] = m.entries;
    const sa = scoreText(a);
    const sb = scoreText(b);

    let result;
    if (a.points !== b.points) {
      result = `${esc(teamName((a.points > b.points ? a : b).teamId))} won`;
    } else if (a.label && a.label === b.label) {
      result = a.label.toLowerCase() === 'draw' ? 'Match drawn' : `Result: ${esc(a.label)}`;
    } else {
      result = 'Match tied';
    }

    const side = (e, score) => `
      <div class="sc-team ${e.points > (e === a ? b : a).points ? 'win' : ''}">
        <span class="sc-name">${esc(teamName(e.teamId))}</span>
        ${score ? `<span class="sc-score">${esc(score)}</span>` : ''}
      </div>`;

    return `
      <div class="scorecard">
        ${side(a, sa)}
        <span class="sc-vs">v/s</span>
        ${side(b, sb)}
        <p class="sc-result">${result}</p>
      </div>`;
  }

  function placementTableHTML(m, g) {
    const showKills = (Number(g.scoring.killPoints) || 0) > 0 || m.entries.some((e) => e.kills);
    const rows = m.entries.slice().sort((x, y) => (x.rank && y.rank) ? x.rank - y.rank : y.points - x.points);
    return `
      <div class="mini-table">
        <table>
          <thead><tr><th class="num">Rank</th><th>Team</th>${showKills ? '<th class="num">Eliminations</th>' : ''}<th class="num">Points</th></tr></thead>
          <tbody>
            ${rows.map((e) => `
              <tr>
                <td class="num">${e.rank || '-'}</td>
                <td>${esc(teamName(e.teamId))}</td>
                ${showKills ? `<td class="num">${e.kills || 0}</td>` : ''}
                <td class="num pts">${e.points}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function matchBlockHTML(m, g, user) {
    const del = user.role === 'admin'
      ? `<button type="button" class="btn small danger" data-action="delete-match" data-match="${m.id}">Delete</button>` : '';

    if (g.scoring.type === 'placement') {
      return `
        <div class="history-item">
          <div class="history-head"><strong>${esc(m.name)}</strong><span class="muted">${esc(formatDate(m.date))}</span>${del}</div>
          ${placementTableHTML(m, g)}
        </div>`;
    }

    if (m.entries.length === 2) {
      return `
        <div class="history-item">
          <div class="history-head"><span class="muted">${esc(formatDate(m.date))}</span>${del}</div>
          ${scorecardHTML(m)}
        </div>`;
    }

    return `
      <div class="history-item">
        <div class="history-head"><strong>${esc(m.name)}</strong><span class="muted">${esc(formatDate(m.date))}</span>${del}</div>
        <ul class="chips">${m.entries.map((e) => `<li>${esc(teamName(e.teamId))}<b>${e.points}</b></li>`).join('')}</ul>
      </div>`;
  }

  function recentHTML(g, user) {
    const groups = matchGroups(g.id);
    const limit = historyLimits[g.id] || 5;
    const shown = groups.slice(0, limit);

    return `
      <section>
        <div class="section-head"><h2>Recent matches</h2></div>
        <div class="panel">
          ${shown.length
            ? shown.map((m) => matchBlockHTML(m, g, user)).join('')
            : '<p class="muted">No matches played yet. Results appear here after the admin enters them.</p>'}
          ${groups.length > limit ? `<div class="panel-actions" style="margin-top:1rem"><button type="button" class="btn small" data-action="more-matches" data-sport="${g.id}">Show more matches</button></div>` : ''}
        </div>
      </section>`;
  }

  /* ---------- Teams: your own team is shown at the top, other teams as a short list ---------- */
  function teamsSectionHTML(g, user, teams, isFullLeague) {
    const myTeam = teamOfUser(user.id, g.id);
    const others = teams.filter((t) => !myTeam || t.id !== myTeam.id);

    let body;
    if (others.length) {
      body = `<h3 class="sub-head">${myTeam ? 'Other teams' : 'All teams'}</h3>
        <div class="team-list">${others.map((t) => teamRowHTML(t, g, user, myTeam)).join('')}</div>`;
    } else {
      body = `<div class="panel empty">${teams.length ? 'No other teams have registered yet.' : 'No teams have registered yet.'}</div>`;
    }

    const status = g.maxTeams
      ? (isFullLeague ? 'Registration full' : `${g.maxTeams - teams.length} team places left`)
      : `${teams.length} ${plural(teams.length, 'team', 'teams')}`;

    return `
      <section>
        <div class="section-head">
          <h2>Teams and registration</h2>
          <span class="muted">${status}</span>
        </div>
        ${body}
      </section>`;
  }

  // Who may change a player between Playing and Extra, or remove a player
  const isAdminUser = (user) => user.role === 'admin';
  const isOwnerOf = (user, t) => user.role === 'captain' && t.captainId === user.id;

  function squadHTML(t, g, user) {
    const canManage = isAdminUser(user) || isOwnerOf(user, t);
    const owner = isOwnerOf(user, t);
    const c = counts(t);
    const playing = t.members.filter((id) => !t.extras.includes(id));
    const extras = t.members.filter((id) => t.extras.includes(id));

    const row = (memberId, label, isExtra) => {
      const member = userById(memberId);
      const memberName = member ? member.name : 'Unknown player';
      const isCaptain = memberId === t.captainId;

      let buttons = '';
      if (canManage) {
        if (isExtra) {
          buttons += `<button type="button" class="btn small" data-action="set-status" data-to="playing" data-team="${t.id}" data-user="${memberId}" aria-label="Make ${esc(memberName)} a playing player" ${c.playing >= g.main ? 'disabled' : ''}>Make playing</button>`;
        } else if (g.extra > 0 && !(owner && isCaptain)) {
          buttons += `<button type="button" class="btn small" data-action="set-status" data-to="extra" data-team="${t.id}" data-user="${memberId}" aria-label="Make ${esc(memberName)} an extra player" ${c.extra >= g.extra ? 'disabled' : ''}>Make extra</button>`;
        }
        // Captain and admin can remove a player (the captain stays, remove the whole team instead)
        if (!isCaptain) {
          buttons += `<button type="button" class="btn small danger" data-action="kick" data-team="${t.id}" data-user="${memberId}" aria-label="Remove ${esc(memberName)}">Remove</button>`;
        }
      }

      return `
        <li class="slot filled ${isExtra ? 'is-extra' : ''}">
          <span class="slot-no">${label}</span>
          <span class="slot-name">${esc(memberName)}</span>
          ${isCaptain ? '<span class="badge captain">Captain</span>' : ''}
          ${isExtra ? '<span class="badge extra">Extra</span>' : ''}
          ${buttons ? `<span class="slot-actions">${buttons}</span>` : ''}
        </li>`;
    };
    const empty = (label) => `<li class="slot empty"><span class="slot-no">${label}</span><span class="slot-name">Open slot</span></li>`;

    let html = '';
    for (let i = 0; i < g.main; i++) html += playing[i] ? row(playing[i], String(i + 1), false) : empty(String(i + 1));
    if (g.extra > 0) {
      html += '<li class="squad-divider">Extra players (for emergencies)</li>';
      for (let i = 0; i < g.extra; i++) html += extras[i] ? row(extras[i], 'E' + (i + 1), true) : empty('E' + (i + 1));
    }
    return html;
  }

  function squadHintHTML(t, g, user) {
    if (!(isAdminUser(user) || isOwnerOf(user, t))) return '';
    const c = counts(t);
    const limit = g.extra > 0 && c.extra >= g.extra ? ' Extra limit reached.' : '';
    const own = isOwnerOf(user, t) ? ' You cannot make yourself an extra player.' : '';
    return `<p class="hint">Playing ${c.playing} of ${g.main}. Extra ${c.extra} of ${g.extra}.${limit}${own}</p>`;
  }

  const teamBadge = (t, g) => {
    const open = squadSize(g) - t.members.length;
    return open <= 0 ? '<span class="badge full">Full</span>' : `<span class="badge open">${open} open</span>`;
  };

  // Full card: used for the team you belong to
  function teamCardHTML(t, g, user) {
    const captain = userById(t.captainId);
    const isOwner = isOwnerOf(user, t);
    const isMember = t.members.includes(user.id);

    let actions = '';
    if (user.role === 'player' && isMember) {
      actions = `<button type="button" class="btn danger" data-action="exit-team" data-team="${t.id}">Exit team</button>`;
    } else if (isOwner) {
      actions = `<button type="button" class="btn danger" data-action="remove-team" data-team="${t.id}">Remove team</button>`;
    }

    return `
      <article class="team-card mine">
        <div class="team-head">
          <h3>${esc(t.name)}</h3>
          <span class="team-badges">
            <span class="badge yours">Your team</span>
            ${teamBadge(t, g)}
          </span>
        </div>
        <p class="team-meta">Captain: ${esc(captain ? captain.name : 'Unknown')} &middot; ${t.members.length} of ${squadSize(g)} players</p>
        <ol class="squad">${squadHTML(t, g, user)}</ol>
        ${squadHintHTML(t, g, user)}
        ${actions ? `<div class="team-actions">${actions}</div>` : ''}
      </article>`;
  }

  // Short row: team name + View button. Players show when View is pressed.
  function teamRowHTML(t, g, user, myTeam) {
    const captain = userById(t.captainId);
    const expanded = expandedTeams.has(t.id);

    let join = '';
    if (user.role === 'player' && !myTeam) {
      join = isTeamFull(t, g)
        ? '<button type="button" class="btn small" disabled>Full</button>'
        : `<button type="button" class="btn small primary" data-action="join-team" data-team="${t.id}">Join team</button>`;
    }

    return `
      <article class="team-row">
        <div class="team-row-main">
          <div class="team-row-info">
            <h3>${esc(t.name)}</h3>
            <p class="team-meta">Captain: ${esc(captain ? captain.name : 'Unknown')} &middot; ${t.members.length} of ${squadSize(g)} players</p>
          </div>
          <div class="team-row-actions">
            ${teamBadge(t, g)}
            <button type="button" class="btn small" data-action="toggle-team" data-team="${t.id}" aria-expanded="${expanded}">${expanded ? 'Hide' : 'View'}</button>
            ${join}
          </div>
        </div>
        ${expanded ? `<ol class="squad">${squadHTML(t, g, user)}</ol>${squadHintHTML(t, g, user)}` : ''}
      </article>`;
  }

  // Show the team names in the "Winner", "result" and score labels
  function syncMatchLabels() {
    const a = $('#m-a');
    const b = $('#m-b');
    if (!a || !b) return;
    const nameOf = (sel) => (sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '');

    const w = $('#m-win');
    if (w) {
      w.options[1].text = nameOf(a) || 'Team 1';
      w.options[2].text = nameOf(b) || 'Team 2';
    }
    $$('[data-lbl]').forEach((el) => {
      const sel = el.dataset.lbl === 'a' ? a : b;
      el.textContent = `${nameOf(sel) || (el.dataset.lbl === 'a' ? 'Team 1' : 'Team 2')} ${el.dataset.suffix}`;
    });
  }

  // When scores are typed, pick the team with the higher score as the winner
  function suggestWinner() {
    const w = $('#m-win');
    const A = $('#r-a') || $('#s-a');
    const B = $('#r-b') || $('#s-b');
    if (!w || !A || !B || A.value === '' || B.value === '') return;
    const x = +A.value;
    const y = +B.value;
    w.value = x > y ? 'a' : (y > x ? 'b' : '');
  }

  /* ---------- Manage sports (admin) ---------- */
  function manageHTML() {
    const list = db.sports.map((s) => {
      const teams = teamsOf(s.id).length;
      const matches = new Set(db.points.filter((p) => p.game === s.id).map((p) => p.matchId)).size;
      const twoTeam = isTwoTeam(s);
      return `
        <article class="sport-card" style="--accent:${s.color}">
          <div class="sport-card-head">
            <h3>${esc(s.name)}</h3>
            <span class="badge">${SCORING_LABEL[s.scoring.type]}</span>
          </div>
          <p>${s.main} playing${s.extra ? ` + ${s.extra} extra` : ''} per team &middot; ${s.maxTeams ? `up to ${s.maxTeams} teams` : 'no team limit'}</p>
          <p class="muted">${esc(ruleText(s))}</p>
          ${twoTeam ? `<p class="muted">Scorecard: ${SCORE_LABEL[s.scoreType]}. Upcoming matches: ${s.autoFixtures ? 'automatic' : 'added by you'}.</p>` : ''}
          <p class="muted">${teams} ${plural(teams, 'team', 'teams')}, ${matches} ${plural(matches, 'match', 'matches')} played</p>
          <div class="team-actions">
            <button type="button" class="btn small primary" data-nav="${s.id}">Open dashboard</button>
            <button type="button" class="btn small" data-action="edit-sport" data-sport="${s.id}">Edit</button>
            <button type="button" class="btn small danger" data-action="delete-sport" data-sport="${s.id}">Delete</button>
          </div>
        </article>`;
    }).join('');

    return `
      <div class="hero">
        <h1>Manage sports</h1>
        <p>Add any sport, say how many players play, and choose how points are given. You do not need to change any code.</p>
      </div>
      ${sportDraft
        ? sportFormHTML()
        : '<div class="panel-actions" style="margin-bottom:1.5rem"><button type="button" class="btn primary" data-action="new-sport">Add a sport</button></div>'}
      <h2>Your sports</h2>
      ${db.sports.length ? `<div class="sport-list">${list}</div>` : '<div class="panel empty">No sports yet. Add your first sport above.</div>'}`;
  }

  function sportFormHTML() {
    const d = sportDraft;
    const editing = !!d.id;
    const choice = (value, title, text) => `
      <label class="choice ${d.type === value ? 'is-selected' : ''}">
        <input type="radio" name="scoring-type" value="${value}" data-draft="type" ${d.type === value ? 'checked' : ''} ${d.lockScoring ? 'disabled' : ''}>
        <span><strong>${title}</strong><small>${text}</small></span>
      </label>`;

    let details = '';
    if (d.lockScoring) {
      details = '<p class="hint">Results are already recorded for this sport, so the scoring system is locked. Delete its match results first if you need to change it.</p>';
    } else if (d.type === 'placement') {
      details = `
        <div class="scoring-details">
          <p class="muted">Points for each finishing place. Leave a box empty for 0.</p>
          <div class="place-grid">
            ${Array.from({ length: PLACES }, (_, i) => `
              <label class="place">${ordinal(i + 1)}
                <input type="number" min="0" max="999" inputmode="numeric" data-place="${i}" value="${esc(d.placement[i])}">
              </label>`).join('')}
          </div>
          <div class="form-row" style="margin-top:1rem">
            <label>Points for every elimination (optional)
              <input type="number" min="0" max="99" inputmode="numeric" data-draft="killPoints" value="${esc(d.killPoints)}" placeholder="0">
            </label>
          </div>
        </div>`;
    } else if (d.type === 'custom') {
      details = `
        <div class="scoring-details">
          <p class="muted">Add the possible results and their points, for example Win 3, Draw 1, Loss 0.</p>
          ${d.outcomes.map((o, i) => `
            <div class="outcome-row">
              <label>Result name
                <input maxlength="20" data-o-label="${i}" value="${esc(o.label)}" placeholder="Win">
              </label>
              <label class="narrow">Points
                <input type="number" min="0" max="99" inputmode="numeric" data-o-points="${i}" value="${esc(o.points)}">
              </label>
              <button type="button" class="btn small danger" data-action="remove-outcome" data-index="${i}" ${d.outcomes.length <= 2 ? 'disabled' : ''}>Remove</button>
            </div>`).join('')}
          <button type="button" class="btn small" data-action="add-outcome" ${d.outcomes.length >= 6 ? 'disabled' : ''}>Add a result</button>
        </div>`;
    } else {
      details = `<p class="hint">Winner gets ${WIN_POINTS} points and loser gets ${LOSS_POINTS}.</p>`;
    }

    const matchSettings = d.type === 'placement' ? '' : `
        <div class="form-row" style="margin-top:1.25rem">
          <label>Scorecard
            <select data-draft="scoreType">
              <option value="simple" ${d.scoreType === 'simple' ? 'selected' : ''}>${SCORE_LABEL.simple}</option>
              <option value="cricket" ${d.scoreType === 'cricket' ? 'selected' : ''}>${SCORE_LABEL.cricket}</option>
              <option value="none" ${d.scoreType === 'none' ? 'selected' : ''}>${SCORE_LABEL.none}</option>
            </select>
          </label>
          <label>Upcoming matches
            <select data-draft="autoFixtures">
              <option value="yes" ${d.autoFixtures === 'yes' ? 'selected' : ''}>Add automatically when teams register</option>
              <option value="no" ${d.autoFixtures === 'no' ? 'selected' : ''}>I will add them myself</option>
            </select>
          </label>
        </div>`;

    return `
      <section class="panel sport-form">
        <h2>${editing ? 'Edit sport' : 'Add a sport'}</h2>
        <div class="form-row">
          <label>Sport name
            <input maxlength="30" data-draft="name" value="${esc(d.name)}" placeholder="Football">
          </label>
          <label class="narrow">Playing players
            <input type="number" min="1" max="50" inputmode="numeric" data-draft="main" value="${esc(d.main)}" placeholder="11">
          </label>
          <label class="narrow">Extra players
            <input type="number" min="0" max="20" inputmode="numeric" data-draft="extra" value="${esc(d.extra)}" placeholder="0">
          </label>
          <label class="narrow">Max teams
            <input type="number" min="1" max="500" inputmode="numeric" data-draft="maxTeams" value="${esc(d.maxTeams)}" placeholder="No limit">
          </label>
        </div>

        <fieldset class="scoring">
          <legend>Scoring system</legend>
          <div class="choices">
            ${choice('winloss', 'Winner / Loser', `Winner gets ${WIN_POINTS} points, loser gets ${LOSS_POINTS}.`)}
            ${choice('placement', 'Placement', 'Points for 1st to 16th place. Good for BGMI and Free Fire.')}
            ${choice('custom', 'Custom', 'You set the results, for example Win 3, Draw 1, Loss 0.')}
          </div>
          ${details}
          ${matchSettings}
        </fieldset>

        <div class="panel-actions form-buttons">
          <button type="button" class="btn primary" data-action="save-sport">${editing ? 'Save changes' : 'Add sport'}</button>
          <button type="button" class="btn" data-action="cancel-sport">Cancel</button>
        </div>
      </section>`;
  }

  const defaultOutcomes = () => [
    { id: uid(), label: 'Win', points: '3' },
    { id: uid(), label: 'Draw', points: '1' },
    { id: uid(), label: 'Loss', points: '0' }
  ];

  function newDraft() {
    return {
      id: null, lockScoring: false,
      name: '', main: '', extra: '0', maxTeams: '',
      type: 'winloss', scoreType: 'simple', autoFixtures: 'yes',
      placement: DEFAULT_PLACEMENT.map(String), killPoints: '0',
      outcomes: defaultOutcomes()
    };
  }

  function draftFromSport(s) {
    const sc = s.scoring;
    return {
      id: s.id, lockScoring: hasResults(s.id),
      name: s.name, main: String(s.main), extra: String(s.extra), maxTeams: s.maxTeams ? String(s.maxTeams) : '',
      type: sc.type,
      scoreType: s.scoreType === 'none' && sc.type === 'placement' ? 'simple' : s.scoreType,
      autoFixtures: s.autoFixtures ? 'yes' : 'no',
      placement: sc.type === 'placement' ? Array.from({ length: PLACES }, (_, i) => String(sc.placement[i] || 0)) : DEFAULT_PLACEMENT.map(String),
      killPoints: sc.type === 'placement' ? String(sc.killPoints || 0) : '0',
      outcomes: sc.type === 'custom' ? sc.outcomes.map((o) => ({ id: o.id, label: o.label, points: String(o.points) })) : defaultOutcomes()
    };
  }

  // Check the scoring part of the form. Returns { scoring } or { error }.
  function buildScoring(d) {
    if (d.type === 'winloss') return { scoring: { type: 'winloss' } };

    if (d.type === 'placement') {
      const placement = [];
      for (let i = 0; i < PLACES; i++) {
        const raw = String(d.placement[i] ?? '').trim();
        if (raw === '') { placement.push(0); continue; }
        if (!isInt(raw, 0, 999)) return { error: `Points for ${ordinal(i + 1)} place must be a whole number from 0 to 999.` };
        placement.push(+raw);
      }
      const kraw = String(d.killPoints ?? '').trim();
      if (kraw !== '' && !isInt(kraw, 0, 99)) return { error: 'Points per elimination must be a whole number from 0 to 99.' };
      return { scoring: { type: 'placement', placement, killPoints: kraw === '' ? 0 : +kraw } };
    }

    if (d.type === 'custom') {
      if (d.outcomes.length < 2) return { error: 'Add at least two results.' };
      const seen = new Set();
      const outcomes = [];
      for (const o of d.outcomes) {
        const label = String(o.label).trim();
        if (!label) return { error: 'Give every result a name.' };
        if (seen.has(label.toLowerCase())) return { error: `The result name "${label}" is used twice.` };
        seen.add(label.toLowerCase());
        if (!isInt(o.points, 0, 99)) return { error: `Points for "${label}" must be a whole number from 0 to 99.` };
        outcomes.push({ id: o.id, label, points: +o.points });
      }
      return { scoring: { type: 'custom', outcomes } };
    }

    return { error: 'Choose a scoring system.' };
  }

  /* Read the score boxes of the result form. Returns { a, b, cmpA, cmpB } or { error }. */
  function readScores(g) {
    if (g.scoreType === 'cricket') {
      const ra = $('#r-a').value.trim(), wa = $('#w-a').value.trim();
      const rb = $('#r-b').value.trim(), wb = $('#w-b').value.trim();
      if (!isInt(ra, 0, 999) || !isInt(rb, 0, 999)) return { error: 'Enter the runs of both teams (0 to 999).' };
      if (!isInt(wa, 0, 10) || !isInt(wb, 0, 10)) return { error: 'Wickets must be from 0 to 10 for both teams.' };
      return { a: { runs: +ra, wickets: +wa }, b: { runs: +rb, wickets: +wb }, cmpA: +ra, cmpB: +rb };
    }
    if (g.scoreType === 'simple') {
      const sa = $('#s-a').value.trim(), sb = $('#s-b').value.trim();
      if (!isInt(sa, 0, 9999) || !isInt(sb, 0, 9999)) return { error: 'Enter the score of both teams (whole numbers).' };
      return { a: { score: +sa }, b: { score: +sb }, cmpA: +sa, cmpB: +sb };
    }
    return { a: {}, b: {} };
  }

  /* =====================================================================
     Actions
     ===================================================================== */
  function doLogin() {
    const asAdmin = authMode === 'admin';
    const username = $('#f-username').value.trim().toLowerCase();
    const password = $('#f-password').value;
    authDraft.username = username;

    const user = db.users.find((u) => u.username === username);
    if (!user || user.pass !== hashPassword(username, password)) {
      authError = 'Wrong username or password.';
    } else if (asAdmin && user.role !== 'admin') {
      authError = 'This is not an admin account. Use the Student login tab.';
    } else if (!asAdmin && user.role === 'admin') {
      authError = 'Admins log in from the Admin login tab.';
    } else {
      authError = '';
    }

    if (authError) { renderAuth(); return; }

    authDraft = { name: '', username: '' };
    sessionUserId = user.id;
    saveSession();
    view = 'home';
    render();
  }

  function doSignup() {
    const name = $('#f-name').value.trim();
    const username = $('#f-username').value.trim().toLowerCase();
    const password = $('#f-password').value;
    const role = $('#f-role').value;
    authDraft = { name, username };

    if (name.length < 2) authError = 'Enter your full name.';
    else if (!/^[a-z0-9_.-]{3,20}$/.test(username)) authError = 'Username must be 3 to 20 characters: letters, numbers, . _ -';
    else if (db.users.some((u) => u.username === username)) authError = 'That username is already taken.';
    else if (password.length < 4) authError = 'Password must be at least 4 characters.';
    else if (role !== 'player' && role !== 'captain') authError = 'Choose Player or Captain.';
    else authError = '';

    if (authError) { renderAuth(); return; }

    const user = { id: uid(), name, username, pass: hashPassword(username, password), role };
    db.users.push(user);
    save();
    sessionUserId = user.id;
    saveSession();
    authDraft = { name: '', username: '' };
    view = 'home';
    render();
    toast(`Welcome, ${name.split(' ')[0]}!`);
  }

  async function handleAppAction(action, data, user) {
    const g = sportById(view);
    const admin = user.role === 'admin';

    if (action === 'toggle-team') {
      if (expandedTeams.has(data.team)) expandedTeams.delete(data.team); else expandedTeams.add(data.team);
      render();
      const again = $(`[data-action="toggle-team"][data-team="${data.team}"]`);
      if (again) again.focus();
      return;
    }

    if (action === 'more-matches') {
      historyLimits[data.sport] = (historyLimits[data.sport] || 5) + 5;
      render();
      return;
    }

    if (action === 'open-points') {
      if (!sportById(data.sport)) return;
      pointsSportId = data.sport;
      render();
      window.scrollTo({ top: 0 });
      return;
    }

    if (action === 'points-back') {
      pointsSportId = null;
      render();
      window.scrollTo({ top: 0 });
      return;
    }

    /* ----- Captain and player actions ----- */
    if (action === 'create-team') {
      if (user.role !== 'captain' || !g) return;
      const name = $('#new-team-name').value.trim();
      const teams = teamsOf(g.id);
      if (!name) return fail('Enter a team name.');
      if (teams.some((t) => t.captainId === user.id)) return fail(`You already have a ${g.name} team.`);
      if (g.maxTeams && teams.length >= g.maxTeams) return fail(`Registration is full: ${g.maxTeams} teams have registered.`);
      if (teams.some((t) => t.name.toLowerCase() === name.toLowerCase())) return fail(`A ${g.name} team named "${name}" already exists.`);

      const team = { id: uid(), game: g.id, name, captainId: user.id, members: [user.id], extras: [] };
      addFixturesForNewTeam(g, team);   // before the team is added, so it plays every team that is already registered
      db.teams.push(team);
      save(); render();
      toast(`${name} created.`);
      return;
    }

    if (action === 'remove-team') {
      const team = teamById(data.team);
      if (!team || user.role !== 'captain' || team.captainId !== user.id) return;
      const others = team.members.length - 1;
      const detail = others > 0 ? `\n\n${others} ${plural(others, 'player', 'players')} will be removed from the team, and its points and upcoming matches are deleted.` : '';
      if (!(await ask(`Remove the team ${team.name}?${detail}`))) return;
      db.teams = db.teams.filter((t) => t.id !== team.id);
      db.points = db.points.filter((p) => p.teamId !== team.id);
      db.fixtures = db.fixtures.filter((f) => f.a !== team.id && f.b !== team.id);
      removeTeamFromLive(team.id);
      expandedTeams.delete(team.id);
      save(); render();
      toast(`${team.name} removed.`);
      return;
    }

    if (action === 'join-team') {
      const team = teamById(data.team);
      const game = team && sportById(team.game);
      if (!team || !game || user.role !== 'player') return;
      if (teamOfUser(user.id, team.game)) return fail(`You are already in a ${game.name} team.`);
      const c = counts(team);
      let asExtra = false;
      if (c.playing < game.main) asExtra = false;
      else if (c.extra < game.extra) asExtra = true;
      else return fail('This team is full.');
      team.members.push(user.id);
      if (asExtra) team.extras.push(user.id);
      save(); render();
      toast(asExtra ? `You joined ${team.name} as an extra player.` : `You joined ${team.name}.`);
      return;
    }

    if (action === 'exit-team') {
      const team = teamById(data.team);
      if (!team || user.role !== 'player' || !team.members.includes(user.id)) return;
      if (!(await ask(`Exit ${team.name}?`))) return;
      team.members = team.members.filter((id) => id !== user.id);
      team.extras = team.extras.filter((id) => id !== user.id);
      save(); render();
      toast(`You left ${team.name}.`);
      return;
    }

    // Remove a player: the team's captain, or the admin for any team
    if (action === 'kick') {
      const team = teamById(data.team);
      if (!team) return;
      if (!admin && !isOwnerOf(user, team)) return;
      if (data.user === team.captainId || !team.members.includes(data.user)) return;
      const member = userById(data.user);
      if (!(await ask(`Remove ${member ? member.name : 'this player'} from ${team.name}?`))) return;
      team.members = team.members.filter((id) => id !== data.user);
      team.extras = team.extras.filter((id) => id !== data.user);
      save(); render();
      toast('Player removed.');
      return;
    }

    // Playing <-> Extra (captain for own team, admin for any team)
    if (action === 'set-status') {
      const team = teamById(data.team);
      const game = team && sportById(team.game);
      if (!team || !game || !team.members.includes(data.user)) return;
      const owner = isOwnerOf(user, team);
      if (!admin && !owner) return;

      const member = userById(data.user);
      const who = member ? member.name : 'Player';
      const isExtraNow = team.extras.includes(data.user);
      const c = counts(team);

      if (data.to === 'extra') {
        if (isExtraNow) return;
        if (!admin && data.user === team.captainId) return fail('A captain cannot make themselves an extra player.');
        if (c.extra >= game.extra) return fail(`Extra limit reached: only ${game.extra} extra ${plural(game.extra, 'player is', 'players are')} allowed.`);
        team.extras.push(data.user);
        save(); render();
        toast(`${who} is now an extra player.`);
      } else if (data.to === 'playing') {
        if (!isExtraNow) return;
        if (c.playing >= game.main) return fail(`The playing squad is full (${game.main} players).`);
        team.extras = team.extras.filter((id) => id !== data.user);
        save(); render();
        toast(`${who} is now a playing player.`);
      }
      return;
    }

    /* ----- Admin: enter results ----- */
    if (action === 'record-result' || action === 'record-custom') {
      if (!admin || !g) return;
      const type = g.scoring.type;
      if ((action === 'record-result' && type !== 'winloss') || (action === 'record-custom' && type !== 'custom')) return;

      const teamA = teamById($('#m-a').value);
      const teamB = teamById($('#m-b').value);
      if (!teamA || !teamB || teamA.game !== g.id || teamB.game !== g.id) return fail('Choose both teams.');
      if (teamA.id === teamB.id) return fail('Choose two different teams.');

      const scores = readScores(g);
      if (scores.error) return fail(scores.error);

      const matchId = uid();
      const date = todayISO();
      const matchName = `${teamA.name} vs ${teamB.name}`;
      const base = { matchId, game: g.id, matchName, date };

      if (action === 'record-result') {
        const win = $('#m-win').value;
        if (win !== 'a' && win !== 'b') return fail('Choose the winning team.');
        const winner = win === 'a' ? teamA : teamB;

        if (scores.cmpA !== undefined) {
          const winScore = win === 'a' ? scores.cmpA : scores.cmpB;
          const loseScore = win === 'a' ? scores.cmpB : scores.cmpA;
          if (winScore < loseScore && !(await ask(`${winner.name} has the lower score. Save this result anyway?`))) return;
        }

        const isA = win === 'a';
        db.points.push({ id: uid(), ...base, teamId: teamA.id, points: isA ? WIN_POINTS : LOSS_POINTS, result: isA ? 'win' : 'loss', ...scores.a });
        db.points.push({ id: uid(), ...base, teamId: teamB.id, points: isA ? LOSS_POINTS : WIN_POINTS, result: isA ? 'loss' : 'win', ...scores.b });
        consumeFixture(g.id, teamA.id, teamB.id);
        consumeLive(g.id, teamA.id, teamB.id);
        save(); render();
        toast(`${winner.name} won: ${WIN_POINTS} points added.`);
      } else {
        const oa = g.scoring.outcomes.find((o) => o.id === $('#c-a').value);
        const ob = g.scoring.outcomes.find((o) => o.id === $('#c-b').value);
        if (!oa || !ob) return fail('Choose a result for both teams.');
        db.points.push({ id: uid(), ...base, teamId: teamA.id, points: oa.points, outcome: oa.id, label: oa.label, ...scores.a });
        db.points.push({ id: uid(), ...base, teamId: teamB.id, points: ob.points, outcome: ob.id, label: ob.label, ...scores.b });
        consumeFixture(g.id, teamA.id, teamB.id);
        consumeLive(g.id, teamA.id, teamB.id);
        save(); render();
        toast('Result saved. Points table updated.');
      }
      return;
    }

    if (action === 'save-placement') {
      if (!admin || !g || g.scoring.type !== 'placement') return;
      const matchName = $('#award-name').value.trim();
      if (!matchName) return fail('Enter a match name.');

      const killPoints = Number(g.scoring.killPoints) || 0;
      const teamCount = teamsOf(g.id).length;
      const entries = [];
      const usedRanks = new Set();

      for (const rankInput of $$('.rank-input')) {
        const teamId = rankInput.dataset.team;
        const killInput = $(`.kill-input[data-team="${teamId}"]`);
        const rankRaw = rankInput.value.trim();
        const killRaw = killInput ? killInput.value.trim() : '';
        if (rankRaw === '' && killRaw === '') continue;

        const name = teamName(teamId);
        if (rankRaw === '') return fail(`Enter the rank for ${name}.`);
        if (!/^\d{1,3}$/.test(rankRaw) || +rankRaw < 1 || +rankRaw > teamCount) return fail(`Rank for ${name} must be from 1 to ${teamCount}.`);
        if (killRaw !== '' && !/^\d{1,2}$/.test(killRaw)) return fail(`Eliminations for ${name} must be a whole number.`);

        const rank = parseInt(rankRaw, 10);
        if (usedRanks.has(rank)) return fail(`Rank ${rank} is given to more than one team.`);
        usedRanks.add(rank);

        const kills = killRaw === '' ? 0 : parseInt(killRaw, 10);
        entries.push({ teamId, rank, kills, points: placementPoints(g, rank) + kills * killPoints });
      }
      if (!entries.length) return fail('Enter the rank for at least one team.');

      const matchId = uid();
      const date = todayISO();
      entries.forEach((e) => db.points.push({
        id: uid(), matchId, game: g.id, matchName, date,
        teamId: e.teamId, rank: e.rank, kills: e.kills, points: e.points
      }));
      if (data.live) db.live = db.live.filter((l) => l.id !== data.live);
      save(); render();
      toast('Match saved. Points table updated.');
      return;
    }

    if (action === 'delete-match') {
      if (!admin) return;
      if (!(await ask('Delete this match and the points it gave?'))) return;
      db.points = db.points.filter((p) => p.matchId !== data.match);
      save(); render();
      toast('Match deleted.');
      return;
    }

    /* ----- Admin: live scores ----- */
    if (action === 'live-start-two' || action === 'live-from-fixture') {
      if (!admin || !g || !isTwoTeam(g) || !canGoLive(g)) return;
      let aId;
      let bId;
      if (action === 'live-start-two') {
        aId = $('#lv-a').value;
        bId = $('#lv-b').value;
      } else {
        const f = db.fixtures.find((x) => x.id === data.fixture);
        if (!f) return;
        aId = f.a;
        bId = f.b;
      }
      const a = teamById(aId);
      const b = teamById(bId);
      if (!a || !b || a.game !== g.id || b.game !== g.id) return fail('Choose both teams.');
      if (a.id === b.id) return fail('Choose two different teams.');
      if (liveOf(g.id).some((l) => l.kind === 'two' && pairKey(l.a, l.b) === pairKey(a.id, b.id))) return fail('These two teams already have a live match.');
      let overs = DEFAULT_OVERS;
      if (g.scoreType === 'cricket') {
        const input = $('#lv-overs');
        const raw = input ? input.value.trim() : String(DEFAULT_OVERS);
        if (!isInt(raw, 1, 100)) return fail('Overs must be a whole number from 1 to 100.');
        overs = +raw;
      }
      db.live.push({ id: uid(), game: g.id, kind: 'two', name: `${a.name} vs ${b.name}`, a: a.id, b: b.id, overs, state: newTwoState(g), history: [], started: todayISO() });
      save(); render();
      toast('Live match started.');
      return;
    }

    if (action === 'live-start-battle') {
      if (!admin || !g || isTwoTeam(g)) return;
      const ids = $$('.lv-team:checked').map((x) => x.value).filter((id) => teamById(id) && teamById(id).game === g.id);
      if (ids.length < 2) return fail('Choose at least two teams for the live match.');
      const name = $('#lv-name').value.trim() || 'Live match';
      db.live.push({ id: uid(), game: g.id, kind: 'battle', name, teams: ids, state: newBattleState(g, ids), history: [], started: todayISO() });
      save(); render();
      toast('Live match started.');
      return;
    }

    if (action.startsWith('live-') && !action.startsWith('live-start') && action !== 'live-from-fixture') {
      const live = liveById(data.live);
      const game = live && sportById(live.game);
      if (!admin || !live || !game) return;
      const nameOf = (side) => teamName(live[side]);

      // Cricket: a delivery. Legal balls count in the over, wides and no balls do not.
      const cricketBall = (side, token, runs, legal, wicket, label) => {
        const s = live.state[side];
        const closed = closedReason(live, s);
        if (closed) return fail(`${nameOf(side)}: ${closed.toLowerCase()}. No more runs can be added.`);
        if (s.runs + runs > 999) return fail('Runs cannot be more than 999.');
        pushHistory(live, `${nameOf(side)} ${label}`);
        applyDelivery(s, token, runs, legal, wicket);
        save(); render();
      };

      if (action === 'live-ball') {
        if (game.scoreType !== 'cricket') return;
        const side = data.side === 'b' ? 'b' : 'a';
        const r = +data.r;
        if (![0, 1, 2, 3, 4, 5, 6].includes(r)) return;
        cricketBall(side, String(r), r, true, false, r === 0 ? 'dot ball' : `ball +${r}`);
        return;
      }

      if (action === 'live-extra') {
        if (game.scoreType !== 'cricket') return;
        const side = data.side === 'b' ? 'b' : 'a';
        const r = +data.r;
        if (!(r >= 1 && r <= 8)) return;
        if (data.kind === 'wd') cricketBall(side, 'Wd', r, false, false, 'wide');
        else if (data.kind === 'nb') cricketBall(side, r === 1 ? 'Nb' : `Nb+${r - 1}`, r, false, false, r === 1 ? 'no ball' : `no ball +${r - 1}`);
        return;
      }

      if (action === 'live-add') {
        if (game.scoreType === 'cricket') return;   // cricket uses the ball and extras buttons
        const side = data.side === 'b' ? 'b' : 'a';
        const n = +data.n;
        const cur = live.state[side];
        if (cur.score + n > 9999) return fail('Score cannot be more than 9999.');
        pushHistory(live, `${nameOf(side)} +${n}`);
        cur.score += n;
        save(); render();
        return;
      }

      if (action === 'live-wicket') {
        if (game.scoreType !== 'cricket') return;
        const side = data.side === 'b' ? 'b' : 'a';
        cricketBall(side, 'W', 0, true, true, 'wicket');
        return;
      }

      if (action === 'live-kill') {
        const t = live.state.t && live.state.t[data.team];
        const d = +data.d > 0 ? 1 : -1;
        if (!t) return;
        if (d < 0 && t.kills <= 0) return;
        if (d > 0 && t.kills >= 99) return fail('Eliminations cannot be more than 99.');
        pushHistory(live, `${teamName(data.team)} elimination ${d > 0 ? '+1' : '-1'}`);
        t.kills += d;
        save(); render();
        return;
      }

      if (action === 'live-pip') {
        const t = live.state.t && live.state.t[data.team];
        const i = +data.idx;
        if (!t || !(i >= 0 && i < t.p.length)) return;
        const next = { a: 'k', k: 'd', d: 'a' }[t.p[i]];
        const word = { a: 'alive', k: 'knocked', d: 'eliminated' }[next];
        pushHistory(live, `${teamName(data.team)} player ${i + 1} ${word}`);
        if (!Array.isArray(t.hist)) t.hist = [];
        t.hist.push({ p: t.p.slice(), out: t.out });   // lets the admin put this team back as it was
        if (t.hist.length > 20) t.hist.shift();
        t.p[i] = next;
        if (t.p.every((x) => x === 'd')) { if (t.out === null) { live.state.seq += 1; t.out = live.state.seq; } } else { t.out = null; }
        save(); render();
        return;
      }

      // Put one team's players back to how they were before the last tap on its bars
      if (action === 'live-pip-undo') {
        const t = live.state.t && live.state.t[data.team];
        if (!t || !Array.isArray(t.hist) || !t.hist.length) return;
        pushHistory(live, `${teamName(data.team)} status undo`);
        const prev = t.hist.pop();
        t.p = prev.p;
        t.out = prev.out;
        save(); render();
        toast(`${teamName(data.team)} status put back.`);
        return;
      }

      if (action === 'live-undo') {
        const last = live.history.pop();
        if (!last) return;
        live.state = JSON.parse(last.prev);
        normalizeLiveItem(live);
        save(); render();
        toast(`Undone: ${last.label}`);
        return;
      }

      if (action === 'live-cancel') {
        if (!(await ask('Cancel this live match? The live score will be deleted and nothing is saved to the points table.'))) return;
        db.live = db.live.filter((l) => l.id !== live.id);
        save(); render();
        toast('Live match cancelled.');
        return;
      }

      // End the match: open the result form with the live values filled in, so the admin can check and save
      if (action === 'live-finish') {
        if (live.kind === 'two') {
          prefill = {
            a: live.a, b: live.b, liveId: live.id,
            scores: game.scoreType === 'cricket'
              ? { ra: live.state.a.runs, wa: live.state.a.wickets, rb: live.state.b.runs, wb: live.state.b.wickets }
              : { sa: live.state.a.score, sb: live.state.b.score }
          };
        } else {
          const { ranks, aliveCount } = battleFinalRanks(live);
          if (aliveCount > 1 && !(await ask(`${aliveCount} teams are still alive. They will be ranked by eliminations. Continue?`))) return;
          const kills = {};
          live.teams.forEach((id) => { kills[id] = live.state.t[id].kills; });
          prefill = { name: live.name, ranks, kills, liveId: live.id };
        }
        render();
        prefill = null;
        suggestWinner();
        const form = $('#record-form') || $('#placement-form');
        if (form) form.scrollIntoView({ block: 'start' });
        toast('Check the result below and press Save.');
        return;
      }
      return;
    }

    /* ----- Admin: upcoming matches ----- */
    if (action === 'add-fixture') {
      if (!admin || !g || !isTwoTeam(g)) return;
      const a = teamById($('#nf-a').value);
      const b = teamById($('#nf-b').value);
      if (!a || !b || a.game !== g.id || b.game !== g.id) return fail('Choose both teams.');
      if (a.id === b.id) return fail('Choose two different teams.');
      db.fixtures.push({ id: uid(), game: g.id, a: a.id, b: b.id, date: $('#nf-date').value });
      save(); render();
      toast('Upcoming match added.');
      return;
    }

    if (action === 'auto-fixtures') {
      if (!admin || !g || !isTwoTeam(g)) return;
      const n = addMissingFixtures(g);
      save(); render();
      toast(n ? `${n} upcoming ${plural(n, 'match', 'matches')} added.` : 'No new matches to add.');
      return;
    }

    if (action === 'edit-fixture') {
      if (!admin) return;
      editingFixtureId = data.fixture;
      render();
      return;
    }

    if (action === 'cancel-fixture') {
      editingFixtureId = null;
      render();
      return;
    }

    if (action === 'save-fixture') {
      const f = db.fixtures.find((x) => x.id === data.fixture);
      if (!admin || !f) return;
      const a = teamById($('#fx-a').value);
      const b = teamById($('#fx-b').value);
      if (!a || !b || a.game !== f.game || b.game !== f.game) return fail('Choose both teams.');
      if (a.id === b.id) return fail('Choose two different teams.');
      f.a = a.id;
      f.b = b.id;
      f.date = $('#fx-date').value;
      editingFixtureId = null;
      save(); render();
      toast('Upcoming match updated.');
      return;
    }

    if (action === 'delete-fixture') {
      if (!admin) return;
      if (!(await ask('Delete this upcoming match?'))) return;
      db.fixtures = db.fixtures.filter((f) => f.id !== data.fixture);
      if (editingFixtureId === data.fixture) editingFixtureId = null;
      save(); render();
      toast('Upcoming match deleted.');
      return;
    }

    // Jump to the result form with the two teams already chosen
    if (action === 'fixture-result') {
      const f = db.fixtures.find((x) => x.id === data.fixture);
      if (!admin || !f) return;
      prefill = { a: f.a, b: f.b };
      render();
      prefill = null;
      const form = $('#record-form');
      if (form) form.scrollIntoView({ block: 'start' });
      return;
    }

    /* ----- Admin: sports setup ----- */
    if (action === 'new-sport') {
      if (!admin) return;
      sportDraft = newDraft();
      render();
      const nameInput = $('[data-draft="name"]');
      if (nameInput) nameInput.focus();
      return;
    }

    if (action === 'edit-sport') {
      const sport = sportById(data.sport);
      if (!admin || !sport) return;
      sportDraft = draftFromSport(sport);
      render();
      window.scrollTo({ top: 0 });
      return;
    }

    if (action === 'cancel-sport') {
      sportDraft = null;
      render();
      return;
    }

    if (action === 'add-outcome') {
      if (!sportDraft || sportDraft.outcomes.length >= 6) return;
      sportDraft.outcomes.push({ id: uid(), label: '', points: '0' });
      render();
      const inputs = $$('[data-o-label]');
      if (inputs.length) inputs[inputs.length - 1].focus();
      return;
    }

    if (action === 'remove-outcome') {
      if (!sportDraft || sportDraft.outcomes.length <= 2) return;
      sportDraft.outcomes.splice(+data.index, 1);
      render();
      return;
    }

    if (action === 'save-sport') {
      if (!admin || !sportDraft) return;
      const d = sportDraft;
      const editing = d.id ? sportById(d.id) : null;
      const name = d.name.trim();

      if (!name) return fail('Enter the sport name.');
      if (db.sports.some((s) => s.name.toLowerCase() === name.toLowerCase() && (!editing || s.id !== editing.id))) return fail(`A sport named "${name}" already exists.`);
      if (!isInt(d.main, 1, 50)) return fail('Playing players must be a whole number from 1 to 50.');
      const extraRaw = String(d.extra).trim();
      if (extraRaw !== '' && !isInt(extraRaw, 0, 20)) return fail('Extra players must be a whole number from 0 to 20.');
      const maxRaw = String(d.maxTeams).trim();
      if (maxRaw !== '' && !isInt(maxRaw, 1, 500)) return fail('Max teams must be a whole number from 1 to 500, or empty for no limit.');

      const main = +d.main;
      const extra = extraRaw === '' ? 0 : +extraRaw;
      const maxTeams = maxRaw === '' ? null : +maxRaw;

      let scoring;
      if (editing && d.lockScoring) {
        scoring = editing.scoring;
      } else {
        const built = buildScoring(d);
        if (built.error) return fail(built.error);
        scoring = built.scoring;
      }

      const headToHead = scoring.type !== 'placement';
      const scoreType = headToHead && ['simple', 'cricket', 'none'].includes(d.scoreType) ? d.scoreType : 'none';
      const autoFixtures = headToHead && d.autoFixtures === 'yes';

      if (editing && liveOf(editing.id).length && (scoreType !== editing.scoreType || scoring.type !== editing.scoring.type || main !== editing.main)) {
        return fail('A live match is running for this sport. End or cancel it before changing the players, scoring or scorecard.');
      }

      if (editing) {
        const teams = teamsOf(editing.id);
        for (const t of teams) {
          const c = counts(t);
          if (c.playing > main || c.extra > extra) {
            return fail(`${t.name} already has ${c.playing} playing and ${c.extra} extra players, which does not fit ${main} + ${extra}. Ask the captain to change the squad first.`);
          }
        }
        if (maxTeams !== null && teams.length > maxTeams) return fail(`${teams.length} teams have already registered, so the limit cannot be ${maxTeams}.`);
        Object.assign(editing, { name, main, extra, maxTeams, scoring, scoreType, autoFixtures });
      } else {
        db.sports.push({ id: uid(), name, main, extra, maxTeams, color: COLORS[db.sports.length % COLORS.length], scoring, scoreType, autoFixtures });
      }

      sportDraft = null;
      save(); render();
      toast(editing ? `${name} updated.` : `${name} added.`);
      return;
    }

    if (action === 'delete-sport') {
      const sport = sportById(data.sport);
      if (!admin || !sport) return;
      const teams = teamsOf(sport.id).length;
      const matches = new Set(db.points.filter((p) => p.game === sport.id).map((p) => p.matchId)).size;
      const detail = teams || matches ? `\n\nThis also deletes ${teams} ${plural(teams, 'team', 'teams')} and ${matches} ${plural(matches, 'match result', 'match results')}.` : '';
      if (!(await ask(`Delete ${sport.name}?${detail}`))) return;
      const teamIds = new Set(teamsOf(sport.id).map((t) => t.id));
      db.sports = db.sports.filter((s) => s.id !== sport.id);
      db.teams = db.teams.filter((t) => t.game !== sport.id);
      db.points = db.points.filter((p) => p.game !== sport.id);
      db.fixtures = db.fixtures.filter((f) => f.game !== sport.id);
      db.live = db.live.filter((l) => l.game !== sport.id);
      teamIds.forEach((id) => expandedTeams.delete(id));
      if (sportDraft && sportDraft.id === sport.id) sportDraft = null;
      save(); render();
      toast(`${sport.name} deleted.`);
    }
  }

  /* ---------- Events ---------- */
  document.addEventListener('click', async (e) => {
    // Clicking anywhere outside the profile menu closes it
    if (!e.target.closest('.profile')) setProfileMenu(false);

    const navBtn = e.target.closest('[data-nav]');
    if (navBtn) {
      const focusTeam = navBtn.dataset.focus === 'team';
      view = navBtn.dataset.nav;
      if (view !== 'manage') sportDraft = null;
      if (view === 'points') pointsSportId = null;
      render();
      const mine = focusTeam ? $('#my-team') : null;
      if (mine) mine.scrollIntoView({ block: 'start' });   // go straight to the user's team
      else window.scrollTo({ top: 0 });
      return;
    }

    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;

    if (action === 'toggle-profile') {
      const menu = $('#profile-menu');
      const open = menu.hidden;
      setProfileMenu(open);
      if (open) { const first = $('.menu-item', menu); if (first) first.focus(); }
      return;
    }

    if (action === 'auth-tab') { authMode = btn.dataset.mode; authError = ''; renderAuth(); return; }
    if (action === 'login') { doLogin(); return; }
    if (action === 'signup') { doSignup(); return; }
    if (action === 'logout') {
      sessionUserId = null; saveSession();
      sportDraft = null; editingFixtureId = null;
      view = 'home'; authMode = 'login'; authError = '';
      render();
      return;
    }

    const user = currentUser();
    if (!user) return;

    const keep = action.startsWith('live-')
      ? `[data-action="${action}"]` + Object.keys(btn.dataset).filter((k) => k !== 'action').map((k) => `[data-${k}="${btn.dataset[k]}"]`).join('')
      : null;
    await handleAppAction(action, btn.dataset, user);
    if (keep && !['live-finish', 'live-cancel'].includes(action)) {
      const again = $(keep);
      if (again) again.focus({ preventScroll: true });
    }
  });

  // Keep the "Add / Edit sport" form values while typing, and suggest the winner from the scores
  document.addEventListener('input', (e) => {
    if (['r-a', 'r-b', 's-a', 's-b'].includes(e.target.id)) suggestWinner();
    if (!sportDraft) return;
    const d = e.target.dataset;
    if (d.draft && d.draft !== 'type') sportDraft[d.draft] = e.target.value;
    else if (d.place !== undefined) sportDraft.placement[+d.place] = e.target.value;
    else if (d.oLabel !== undefined) sportDraft.outcomes[+d.oLabel].label = e.target.value;
    else if (d.oPoints !== undefined) sportDraft.outcomes[+d.oPoints].points = e.target.value;
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'm-a' || e.target.id === 'm-b') syncMatchLabels();
    if (sportDraft && e.target.dataset.draft === 'type') {
      sportDraft.type = e.target.value;
      render();
      const checked = $('[data-draft="type"]:checked');
      if (checked) checked.focus();
    }
  });

  // Tabbing out of the profile menu closes it
  document.addEventListener('focusin', (e) => {
    if (!e.target.closest('.profile')) setProfileMenu(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const menu = $('#profile-menu');
      if (menu && !menu.hidden) {
        setProfileMenu(false);
        const profileBtn = $('.profile-btn');
        if (profileBtn) profileBtn.focus();
      }
      return;
    }

    // Press Enter to submit the login, sign up and create-team fields
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    if (e.target.closest('#auth')) {
      e.preventDefault();
      const primary = $('#auth [data-action="login"], #auth [data-action="signup"]');
      if (primary) primary.click();
    } else if (e.target.id === 'new-team-name') {
      e.preventDefault();
      const create = $('[data-action="create-team"]');
      if (create) create.click();
    }
  });

  // Live scores: when the admin updates a match in another tab of this browser, refresh this page too
  window.addEventListener('storage', (e) => {
    if (e.key !== DATA_KEY || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue);
      if (!parsed || !Array.isArray(parsed.users) || !Array.isArray(parsed.teams) || !Array.isArray(parsed.points) || !Array.isArray(parsed.sports)) return;
      db = {
        users: parsed.users, teams: parsed.teams, points: parsed.points, sports: parsed.sports,
        fixtures: Array.isArray(parsed.fixtures) ? parsed.fixtures : [],
        live: Array.isArray(parsed.live) ? parsed.live : []
      };
    } catch (err) { return; }
    const active = document.activeElement;
    if (active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) return;   // do not disturb someone who is typing
    if (currentUser() && !sportDraft) render();
  });

  /* ---------- Safety net: if styles.css could not be loaded, use this copy of the styles ---------- */
  // (styles.css is still the file to edit. This copy is only used when styles.css is missing.)
  const FALLBACK_CSS = ":root{color-scheme: dark;--bg: #09090b;--surface: #141417;--surface-2: #1c1c21;--line: #2b2b33;--line-strong: #3d3d48;--text: #f4f4f5;--muted: #a1a1ab;--volt: #ffc800;--on-volt: #111111;--danger: #ff6b63;--good: #3ddc84;--info: #7db8ff;--accent: #3b6fe0;--font-display: \"Barlow Condensed\", \"Arial Narrow\", \"Helvetica Neue\", sans-serif;--font-body: \"Barlow\", \"Segoe UI\", system-ui, sans-serif;--radius: 6px;--sidebar-w: 232px;--topbar-h: 64px;}*, *::before, *::after{box-sizing: border-box;}[hidden]{display: none !important;}html{-webkit-text-size-adjust: 100%;}body{margin: 0;font-family: var(--font-body);font-size: 16px;line-height: 1.5;color: var(--text);background-color: var(--bg);background-image: radial-gradient(900px 420px at 100% -5%, rgba(255, 200, 0, 0.07), transparent 65%), repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.018) 0 2px, transparent 2px 16px);}h1, h2, h3{font-family: var(--font-display);font-weight: 700;font-style: italic;text-transform: uppercase;line-height: 1.05;margin: 0;letter-spacing: 0.02em;}h1{font-size: 2.6rem;}h2{font-size: 1.6rem;margin-bottom: 0.75rem;}h3{font-size: 1.45rem;}p{margin: 0;}button, input, select{font: inherit;color: inherit;}:focus-visible{outline: 3px solid var(--volt);outline-offset: 2px;}.muted{color: var(--muted);}label{display: flex;flex-direction: column;gap: 0.3rem;font-size: 0.9rem;font-weight: 500;}input, select{padding: 0.55rem 0.7rem;background: #0e0e11;border: 1px solid var(--line-strong);border-radius: 4px;min-height: 42px;width: 100%;}input::placeholder{color: #707080;}input:focus, select:focus{border-color: var(--volt);}input[type=\"radio\"]{width: auto;min-height: 0;padding: 0;margin: 0.25rem 0 0;accent-color: var(--volt);}.btn{min-height: 42px;padding: 0.55rem 1.1rem;border: 1px solid var(--line-strong);border-radius: 4px;background: var(--surface-2);color: var(--text);font-weight: 600;cursor: pointer;}.btn:hover:not(:disabled){background: #26262d;border-color: #55555f;}.btn.primary{background: var(--volt);border-color: var(--volt);color: var(--on-volt);font-family: var(--font-display);font-style: italic;font-weight: 700;font-size: 1.1rem;letter-spacing: 0.04em;text-transform: uppercase;}.btn.primary:hover:not(:disabled){background: #ffd83a;border-color: #ffd83a;}.btn.small{min-height: 34px;padding: 0.3rem 0.75rem;font-size: 0.92rem;}.btn.primary.small{font-size: 1rem;}.btn.block{width: 100%;}.btn.danger{border-color: rgba(255, 107, 99, 0.6);color: var(--danger);background: transparent;}.btn.danger:hover:not(:disabled){background: rgba(255, 107, 99, 0.12);border-color: var(--danger);}.btn:disabled{opacity: 0.45;cursor: not-allowed;}.link-btn{padding: 0;border: 0;background: none;color: var(--info);text-decoration: underline;cursor: pointer;font-size: 0.95rem;}.form-row{display: flex;flex-wrap: wrap;gap: 1rem;align-items: flex-end;}.form-row label{flex: 1 1 200px;}.form-row label.narrow{flex: 0 1 140px;}.form-error{padding: 0.6rem 0.8rem;border: 1px solid rgba(255, 107, 99, 0.5);border-radius: 4px;background: rgba(255, 107, 99, 0.12);color: var(--danger);font-size: 0.95rem;}.auth{min-height: 100vh;display: grid;place-items: center;padding: 1rem;}.auth-card{width: 100%;max-width: 420px;display: flex;flex-direction: column;gap: 1rem;padding: 1.5rem;background: var(--surface);border: 1px solid var(--line);border-top: 4px solid var(--volt);border-radius: var(--radius);}.tabs{display: flex;border-bottom: 1px solid var(--line);}.tab{flex: 1;padding: 0.6rem 0.25rem;font-size: 0.92rem;white-space: nowrap;border: 0;border-bottom: 3px solid transparent;background: none;font-weight: 600;color: var(--muted);cursor: pointer;}.tab:hover{color: var(--text);}.tab.is-active{color: var(--text);border-bottom-color: var(--volt);}.app{display: grid;grid-template-columns: var(--sidebar-w) minmax(0, 1fr);grid-template-rows: auto 1fr;grid-template-areas: \"top top\" \"side main\";min-height: 100vh;}.topbar{grid-area: top;position: sticky;top: 0;z-index: 15;display: flex;align-items: center;justify-content: space-between;gap: 1rem;height: var(--topbar-h);padding: 0 1.25rem;background: rgba(9, 9, 11, 0.96);border-bottom: 1px solid var(--line);box-shadow: 0 1px 0 rgba(255, 200, 0, 0.35);}.sidebar{grid-area: side;min-width: 0;position: sticky;top: var(--topbar-h);height: calc(100vh - var(--topbar-h));overflow-y: auto;display: flex;flex-direction: column;gap: 1.5rem;padding: 1.25rem 1.25rem;background: #0d0d10;border-right: 1px solid var(--line);}.main{grid-area: main;padding: 2rem clamp(1rem, 4vw, 3rem) 4rem;max-width: 1100px;width: 100%;min-width: 0;}.brand{display: flex;align-items: center;gap: 0.75rem;}.brand-mark{width: 38px;height: 38px;flex: none;border-radius: 50%;border: 3px solid var(--volt);background: linear-gradient(var(--volt), var(--volt)) center / 3px 100% no-repeat, radial-gradient(circle, var(--volt) 0 4px, transparent 5px);}.brand-name{font-family: var(--font-display);font-weight: 800;font-style: italic;text-transform: uppercase;font-size: 1.35rem;line-height: 1;letter-spacing: 0.03em;}.nav{display: flex;flex-direction: column;gap: 0.25rem;}.nav-btn{display: flex;align-items: center;gap: 0.6rem;text-align: left;padding: 0.6rem 0.85rem;border: 0;border-left: 4px solid transparent;border-radius: 0 4px 4px 0;background: transparent;color: var(--muted);font-weight: 500;cursor: pointer;}.nav-btn:hover{background: var(--surface-2);color: var(--text);}.nav-btn.is-active{background: var(--surface-2);border-left-color: var(--volt);color: var(--text);font-weight: 600;}.nav-btn .dot{width: 10px;height: 10px;flex: none;border-radius: 50%;background: var(--accent);}.profile{position: relative;}.profile-btn{display: flex;align-items: center;gap: 0.55rem;max-width: 100%;padding: 0.3rem 0.6rem 0.3rem 0.35rem;background: var(--surface-2);border: 1px solid var(--line-strong);border-radius: 999px;cursor: pointer;}.profile-btn:hover, .profile-btn[aria-expanded=\"true\"]{background: #26262d;border-color: #55555f;}.avatar{display: grid;place-items: center;flex: none;width: 32px;height: 32px;border-radius: 50%;background: var(--volt);color: var(--on-volt);}.profile-name{font-weight: 600;max-width: 140px;overflow: hidden;text-overflow: ellipsis;white-space: nowrap;}.chevron{display: grid;place-items: center;flex: none;color: var(--muted);}.profile-btn[aria-expanded=\"true\"] .chevron{transform: rotate(180deg);}.profile-menu{position: absolute;right: 0;top: calc(100% + 8px);min-width: 180px;padding: 0.3rem;background: var(--surface-2);border: 1px solid var(--line-strong);border-radius: var(--radius);box-shadow: 0 10px 28px rgba(0, 0, 0, 0.6);z-index: 20;}.menu-item{display: block;width: 100%;padding: 0.65rem 0.8rem;border: 0;border-radius: 4px;background: none;text-align: left;font-weight: 500;cursor: pointer;}.menu-item:hover, .menu-item:focus-visible{background: #2a2a31;}.panel{background: var(--surface);border: 1px solid var(--line);border-radius: var(--radius);padding: 1.25rem;margin-bottom: 1.25rem;}.panel > p{margin-bottom: 0.75rem;}.panel.note{background: rgba(255, 200, 0, 0.07);border-color: rgba(255, 200, 0, 0.3);}.panel.warn{background: rgba(255, 107, 99, 0.1);border-color: rgba(255, 107, 99, 0.4);}.section-head{display: flex;flex-wrap: wrap;align-items: baseline;justify-content: space-between;gap: 0.5rem;margin: 1.75rem 0 0.75rem;}.section-head h2{margin: 0;}.badge{display: inline-block;padding: 0.1rem 0.55rem;border: 1px solid var(--line-strong);border-radius: 999px;background: #23232a;color: var(--text);font-size: 0.78rem;font-weight: 600;white-space: nowrap;}.badge.captain{background: #f4f4f5;color: #111;border-color: #f4f4f5;}.badge.admin{background: rgba(125, 184, 255, 0.16);color: var(--info);border-color: rgba(125, 184, 255, 0.5);}.badge.extra{background: var(--volt);color: var(--on-volt);border-color: var(--volt);}.badge.open{background: rgba(61, 220, 132, 0.12);color: var(--good);border-color: rgba(61, 220, 132, 0.4);}.badge.full{background: rgba(255, 107, 99, 0.12);color: var(--danger);border-color: rgba(255, 107, 99, 0.45);}.badge.yours{background: rgba(125, 184, 255, 0.14);color: var(--info);border-color: rgba(125, 184, 255, 0.45);}.hint{margin-top: 0.6rem;font-size: 0.9rem;color: var(--muted);}.panel-actions{margin-top: 0.25rem;}.page-head{margin-bottom: 1rem;}.hero{position: relative;overflow: hidden;margin-bottom: 1.5rem;padding: 2rem 1.5rem 2.25rem 2rem;color: #fff;border-radius: var(--radius);background: repeating-linear-gradient(115deg, rgba(255, 255, 255, 0.06) 0 2px, transparent 2px 20px), linear-gradient(rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.4)), linear-gradient(120deg, var(--accent) -10%, #0c0c0f 75%);border: 1px solid var(--line);clip-path: polygon(0 0, 100% 0, 100% calc(100% - 18px), calc(100% - 30px) 100%, 0 100%);}.hero::before{content: \"\";position: absolute;left: 0;top: 0;bottom: 0;width: 8px;background: var(--volt);}.hero::after{content: \"\";position: absolute;top: 50%;right: -50px;width: 210px;height: 210px;margin-top: -105px;border: 3px solid rgba(255, 255, 255, 0.14);border-radius: 50%;}.hero > *{position: relative;z-index: 1;}.hero h1{font-size: clamp(2.6rem, 9vw, 4.4rem);font-weight: 800;}.hero p{margin-top: 0.5rem;max-width: 52ch;color: #e8e8ec;}.hero-stats{display: flex;flex-wrap: wrap;gap: 0.5rem 2rem;margin-top: 1.25rem;}.hero-stats b{display: block;font-family: var(--font-display);font-style: italic;font-weight: 800;font-size: 2.2rem;line-height: 1;color: var(--volt);}.hero-stats span{font-size: 0.9rem;color: #d6d6dc;}.meter{margin-top: 1rem;max-width: 420px;height: 10px;background: rgba(255, 255, 255, 0.2);border-radius: 999px;overflow: hidden;}.meter > span{display: block;height: 100%;background: var(--volt);}.game-cards{display: grid;grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));gap: 1rem;margin-bottom: 1.5rem;}.game-card{display: flex;flex-direction: column;gap: 0.5rem;align-items: flex-start;padding: 1.25rem;background: var(--surface);border: 1px solid var(--line);border-left: 8px solid var(--accent);border-radius: var(--radius);}.game-card h2{margin: 0;}.game-card .btn{margin-top: auto;}.points-link{display: flex;flex-wrap: wrap;align-items: center;justify-content: space-between;gap: 1rem;}.points-link h2{margin-bottom: 0.15rem;}.plain-list{list-style: none;margin: 0;padding: 0;}.plain-list li{display: flex;flex-wrap: wrap;align-items: center;justify-content: space-between;gap: 0.5rem;padding: 0.6rem 0;border-bottom: 1px solid var(--line);}.plain-list li:last-child{border-bottom: 0;}.table-wrap{padding: 0;overflow-x: auto;}table{width: 100%;border-collapse: collapse;}th, td{padding: 0.7rem 1rem;text-align: left;border-bottom: 1px solid var(--line);vertical-align: middle;}th{font-size: 0.85rem;font-weight: 600;color: var(--muted);background: #191920;}tbody tr:last-child td{border-bottom: 0;}tbody tr:hover td{background: #1a1a20;}.num{text-align: right;font-variant-numeric: tabular-nums;}.empty{padding: 1.5rem 1rem;color: var(--muted);text-align: center;}tr.mine td{background: rgba(125, 184, 255, 0.12);font-weight: 600;}.table-wrap tbody tr:first-child td:first-child{box-shadow: inset 4px 0 0 var(--volt);}td.pts{font-family: var(--font-display);font-style: italic;font-weight: 800;font-size: 1.35rem;color: var(--volt);}.pt-input{width: 96px;text-align: center;}.mini-table{overflow-x: auto;border: 1px solid var(--line);border-radius: var(--radius);}.mini-table th, .mini-table td{padding: 0.5rem 0.75rem;}.sub-head{margin: 1.25rem 0 0.6rem;font-size: 1.2rem;color: var(--muted);}.sub-head:first-child{margin-top: 0;}.team-card{max-width: 680px;background: var(--surface);border: 1px solid var(--line);border-top: 6px solid var(--accent);border-radius: var(--radius);padding: 1rem 1.1rem 1.1rem;}.team-card.mine{border-color: rgba(255, 200, 0, 0.45);border-top-color: var(--accent);box-shadow: 0 0 0 1px rgba(255, 200, 0, 0.18);}.team-head{display: flex;flex-wrap: wrap;align-items: center;justify-content: space-between;gap: 0.5rem;}.team-head h3{overflow-wrap: anywhere;}.team-meta{margin: 0.25rem 0 0.75rem;font-size: 0.92rem;color: var(--muted);}.team-badges{display: flex;gap: 0.35rem;flex-wrap: wrap;}.team-actions{margin-top: 1rem;display: flex;gap: 0.5rem;flex-wrap: wrap;}.my-team{scroll-margin-top: calc(var(--topbar-h) + 12px);margin-bottom: 0.5rem;}#record-form{scroll-margin-top: calc(var(--topbar-h) + 12px);}.squad{list-style: none;margin: 0;padding: 0;}.slot{display: flex;flex-wrap: wrap;align-items: center;gap: 0.4rem 0.6rem;min-height: 42px;padding: 0.35rem 0.4rem;border-bottom: 1px solid var(--line);}.slot-no{width: 2rem;flex: none;font-family: var(--font-display);font-style: italic;font-weight: 800;font-size: 1.2rem;color: var(--muted);}.slot-name{flex: 1 1 100px;min-width: 0;overflow-wrap: anywhere;}.slot.empty .slot-name{color: #6d6d78;}.slot.is-extra{background: rgba(255, 200, 0, 0.07);}.slot-actions{display: flex;gap: 0.3rem;flex-wrap: wrap;}.squad-divider{padding: 0.5rem 0.4rem 0.35rem;border-bottom: 2px solid var(--volt);font-weight: 600;font-size: 0.92rem;color: var(--volt);}.team-list{display: flex;flex-direction: column;gap: 0.75rem;max-width: 680px;}.team-row{background: var(--surface);border: 1px solid var(--line);border-left: 6px solid var(--accent);border-radius: var(--radius);padding: 0.8rem 1rem;}.team-row-main{display: flex;flex-wrap: wrap;align-items: center;justify-content: space-between;gap: 0.6rem 1rem;}.team-row-info{min-width: 0;}.team-row-info h3{font-size: 1.3rem;overflow-wrap: anywhere;}.team-row .team-meta{margin: 0.15rem 0 0;}.team-row-actions{display: flex;flex-wrap: wrap;align-items: center;gap: 0.5rem;}.team-row .squad{margin-top: 0.75rem;}.fixture-list{list-style: none;margin: 0;padding: 0;}.fixture{display: flex;flex-wrap: wrap;align-items: center;justify-content: space-between;gap: 0.6rem 1rem;padding: 0.75rem 0.5rem;border-bottom: 1px solid var(--line);}.fixture:last-child{border-bottom: 0;}.fixture.mine{background: rgba(125, 184, 255, 0.1);border-radius: var(--radius);}.fixture.editing{display: block;}.fixture-main{display: flex;flex-direction: column;gap: 0.15rem;align-items: flex-start;min-width: 0;}.fixture-date{font-size: 0.88rem;color: var(--muted);}.fixture-teams{font-size: 1.1rem;overflow-wrap: anywhere;}.fixture-actions{display: flex;flex-wrap: wrap;gap: 0.4rem;}.fixture.editing .fixture-actions{margin-top: 0.75rem;}.history-item{padding: 0.9rem 0;border-bottom: 1px solid var(--line);}.history-item:last-child{border-bottom: 0;padding-bottom: 0;}.history-item:first-child{padding-top: 0;}.history-head{display: flex;flex-wrap: wrap;align-items: center;gap: 0.5rem 1rem;margin-bottom: 0.6rem;}.history-head .btn{margin-left: auto;}.scorecard{display: grid;grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);gap: 0.5rem 1rem;align-items: start;text-align: center;padding: 0.9rem 0.75rem;background: #0e0e11;border: 1px solid var(--line);border-radius: var(--radius);}.sc-team{display: flex;flex-direction: column;align-items: center;gap: 0.2rem;min-width: 0;}.sc-name{font-weight: 600;overflow-wrap: anywhere;}.sc-score{font-family: var(--font-display);font-style: italic;font-weight: 800;font-size: 2.4rem;line-height: 1;color: var(--text);}.sc-vs{padding-top: 0.15rem;color: var(--muted);font-weight: 600;}.sc-team.win .sc-name, .sc-team.win .sc-score{color: var(--volt);}.sc-result{grid-column: 1 / -1;font-weight: 600;}.chips{list-style: none;margin: 0;padding: 0;display: flex;flex-wrap: wrap;gap: 0.4rem;}.chips li{padding: 0.2rem 0.65rem;background: #23232a;border: 1px solid var(--line-strong);border-radius: 999px;font-size: 0.92rem;}.chips b{margin-left: 0.3rem;color: var(--volt);}.sport-list{display: grid;grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));gap: 1rem;align-items: start;}.sport-card{display: flex;flex-direction: column;gap: 0.4rem;padding: 1.1rem 1.25rem;background: var(--surface);border: 1px solid var(--line);border-left: 8px solid var(--accent);border-radius: var(--radius);}.sport-card-head{display: flex;flex-wrap: wrap;align-items: center;justify-content: space-between;gap: 0.5rem;}.sport-card .team-actions{margin-top: 0.5rem;}.sport-form h2{margin-bottom: 1rem;}fieldset.scoring{margin: 1.25rem 0 0;padding: 0;border: 0;min-width: 0;}fieldset.scoring legend{padding: 0;margin-bottom: 0.5rem;font-weight: 600;}.choices{display: grid;grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));gap: 0.75rem;}.choice{flex-direction: row;align-items: flex-start;gap: 0.6rem;padding: 0.8rem 0.9rem;border: 1px solid var(--line-strong);border-radius: var(--radius);background: #0e0e11;font-weight: 400;cursor: pointer;}.choice.is-selected{border-color: var(--volt);box-shadow: 0 0 0 1px var(--volt);}.choice span{display: flex;flex-direction: column;gap: 0.15rem;}.choice small{color: var(--muted);font-size: 0.88rem;}.scoring-details{margin-top: 1rem;padding-top: 1rem;border-top: 1px solid var(--line);}.place-grid{display: grid;grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));gap: 0.75rem;margin-top: 0.75rem;}.place-grid .place{font-weight: 600;}.outcome-row{display: flex;flex-wrap: wrap;gap: 0.75rem;align-items: flex-end;margin: 0.75rem 0;}.outcome-row label{flex: 1 1 160px;}.outcome-row label.narrow{flex: 0 1 110px;}.form-buttons{display: flex;flex-wrap: wrap;gap: 0.5rem;margin-top: 1.25rem;}.modal{position: fixed;inset: 0;z-index: 40;display: flex;align-items: center;justify-content: center;padding: 1rem;background: rgba(0, 0, 0, 0.72);}.modal-box{width: 100%;max-width: 380px;padding: 1.25rem;background: var(--surface-2);border: 1px solid var(--line-strong);border-top: 4px solid var(--volt);border-radius: var(--radius);}.modal-box p{white-space: pre-line;margin-bottom: 1rem;}.modal-actions{display: flex;justify-content: flex-end;gap: 0.5rem;}.toast{position: fixed;left: 50%;bottom: 1.5rem;transform: translate(-50%, 20px);width: max-content;max-width: calc(100vw - 2rem);padding: 0.7rem 1.2rem;background: var(--text);color: #111;font-weight: 600;border-radius: var(--radius);opacity: 0;pointer-events: none;transition: opacity 0.2s ease, transform 0.2s ease;z-index: 50;}.toast.show{opacity: 1;transform: translate(-50%, 0);}.toast.error{background: var(--danger);color: #111;}@media (max-width: 820px){.app{grid-template-columns: minmax(0, 1fr);grid-template-areas: \"top\" \"side\" \"main\";}.topbar{padding: 0 1rem;}.sidebar{position: static;height: auto;overflow: visible;padding: 0.5rem 1rem 0;border-right: 0;border-bottom: 1px solid var(--line);}.nav{flex-direction: row;width: 100%;overflow-x: auto;gap: 0.25rem;}.nav-btn{border-left: 0;border-bottom: 3px solid transparent;border-radius: 4px 4px 0 0;white-space: nowrap;}.nav-btn.is-active{border-bottom-color: var(--volt);}h1{font-size: 2.1rem;}th, td{padding: 0.6rem 0.6rem;}}@media (max-width: 560px){.topbar .brand-name{display: none;}.profile-name{max-width: 110px;}}@media (max-width: 360px){.profile-name{max-width: 64px;}.profile-btn{gap: 0.4rem;}}@media (prefers-reduced-motion: reduce){.toast{transition: none;}}.live-badge{display: inline-flex;align-items: center;gap: 0.4rem;padding: 0.12rem 0.6rem;border-radius: 999px;background: #e11d2e;color: #fff;font-family: var(--font-body);font-style: normal;text-transform: uppercase;font-size: 0.75rem;font-weight: 700;letter-spacing: 0.06em;line-height: 1.4;vertical-align: middle;}.live-badge::before{content: \"\";width: 7px;height: 7px;border-radius: 50%;background: #fff;animation: live-pulse 1.2s ease-in-out infinite;}.live-dot{display: inline-block;flex: none;width: 8px;height: 8px;margin-left: auto;border-radius: 50%;background: #ff3b4a;animation: live-pulse 1.2s ease-in-out infinite;}@keyframes live-pulse{50%{opacity: 0.25;}}.live-card{border-top: 4px solid #e11d2e;}.live-head{display: flex;flex-wrap: wrap;align-items: center;gap: 0.5rem 0.75rem;margin-bottom: 0.9rem;}.live-card .sc-score{font-size: clamp(2.8rem, 12vw, 4.4rem);color: var(--volt);}.live-controls{display: grid;grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));gap: 1rem;margin-top: 1rem;}.live-side strong{display: block;margin-bottom: 0.4rem;overflow-wrap: anywhere;}.pad{display: flex;flex-wrap: wrap;gap: 0.4rem;}.pad .btn{min-width: 48px;}.live-actions{display: flex;flex-wrap: wrap;gap: 0.5rem;margin-top: 1rem;padding-top: 1rem;border-top: 1px solid var(--line);}.board-wrap{overflow-x: auto;border: 1px solid var(--line);border-radius: var(--radius);background: #0c0d12;}table.board{width: 100%;border-collapse: collapse;}table.board th{padding: 0.5rem 0.6rem;background: var(--volt);color: #111;font-size: 0.8rem;font-weight: 700;text-align: center;white-space: nowrap;}table.board th:nth-child(2){text-align: left;}table.board td{padding: 0.5rem 0.6rem;text-align: center;border-bottom: 1px solid #23252e;}table.board tbody tr:hover td{background: transparent;}table.board .rank{width: 2.4rem;font-family: var(--font-display);font-style: italic;font-weight: 800;font-size: 1.2rem;}table.board .team-cell{text-align: left;font-weight: 700;min-width: 4.6rem;overflow-wrap: break-word;word-break: normal;}table.board td.pts{font-size: 1.5rem;}table.board tr.out td{opacity: 0.4;}.kill-ctl{display: inline-flex;align-items: center;gap: 0.4rem;}.kill-ctl .btn{min-width: 32px;min-height: 32px;padding: 0;}.pips{display: inline-flex;align-items: flex-end;gap: 4px;}.pip{display: inline-block;width: 6px;height: 22px;padding: 0;border: 0;border-radius: 2px;background: #4a4a55;}.pip.a{background: #ffffff;}.pip.k{background: #ff4d4d;}.pip.d{background: #4a4a55;}.pips.edit{gap: 6px;}.pips.edit .pip{width: 14px;height: 30px;cursor: pointer;}.board-legend{display: flex;justify-content: center;flex-wrap: wrap;gap: 0.5rem 1.5rem;padding: 0.6rem;background: #101118;font-size: 0.85rem;color: var(--muted);}.board-legend .pip{width: 5px;height: 14px;margin-right: 0.4rem;vertical-align: -2px;}.team-checks{display: grid;grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));gap: 0.5rem;}.check{flex-direction: row;align-items: center;gap: 0.55rem;padding: 0.45rem 0.6rem;background: #0e0e11;border: 1px solid var(--line-strong);border-radius: 4px;font-weight: 500;cursor: pointer;}input[type=\"checkbox\"]{width: auto;min-height: 0;padding: 0;margin: 0;accent-color: var(--volt);}@media (prefers-reduced-motion: reduce){.live-badge::before, .live-dot{animation: none;}}@media (max-width: 560px){.live-card{padding: 0.9rem 0.7rem;}table.board th, table.board td{padding: 0.45rem 0.3rem;}table.board .rank{width: 1.6rem;font-size: 1.05rem;}table.board .team-cell{font-size: 0.95rem;}table.board td.pts{font-size: 1.25rem;}.kill-ctl{gap: 0.2rem;}.kill-ctl .btn{min-width: 28px;min-height: 28px;font-size: 0.9rem;}.pips{gap: 3px;}.pip{width: 5px;}.pips.edit{gap: 4px;}.pips.edit .pip{width: 12px;height: 28px;}}.sc-overs{font-size: 0.95rem;color: var(--muted);font-variant-numeric: tabular-nums;}.over-line{display: flex;flex-direction: column;align-items: center;gap: 0.25rem;margin-top: 0.3rem;font-size: 0.8rem;}.over-balls{display: flex;flex-wrap: wrap;justify-content: center;gap: 4px;}.ball{display: inline-flex;align-items: center;justify-content: center;min-width: 26px;height: 26px;padding: 0 0.3rem;border-radius: 999px;background: #2a2a33;color: var(--text);font-style: normal;font-weight: 700;font-size: 0.8rem;}.ball.bd{background: var(--volt);color: #111;}.ball.wk{background: #e11d2e;color: #fff;}.ball.ex{background: rgba(125, 184, 255, 0.18);color: var(--info);border: 1px solid rgba(125, 184, 255, 0.5);}.pad-label{margin: 0.6rem 0 0.3rem;font-size: 0.82rem;color: var(--muted);}.pips.edit{align-items: center;}.pip-undo{width: 26px;height: 26px;margin-left: 8px;padding: 0;flex: none;border: 1px solid var(--line-strong);border-radius: 4px;background: var(--surface-2);color: var(--text);font-size: 0.95rem;line-height: 1;cursor: pointer;}.pip-undo:hover:not(:disabled){border-color: var(--volt);color: var(--volt);}.pip-undo:disabled{opacity: 0.3;cursor: not-allowed;}@media (max-width: 560px){.pip-undo{width: 24px;height: 24px;margin-left: 4px;}}@media (max-width: 560px){table.board th, table.board td{padding: 0.4rem 0.2rem;}table.board th{font-size: 0.72rem;}table.board .rank{width: 1.3rem;}table.board .team-cell{min-width: 0;font-size: 0.9rem;}table.board td.pts{font-size: 1.15rem;}.kill-ctl{gap: 0.1rem;}.kill-ctl .btn{min-width: 24px;min-height: 28px;padding: 0;}.pips.edit{gap: 3px;}.pips.edit .pip{width: 11px;height: 28px;}.pip-undo{width: 22px;height: 24px;margin-left: 3px;}}";

  function ensureStyles() {
    const loaded = getComputedStyle(document.documentElement).getPropertyValue('--volt').trim();
    if (loaded) return;
    const style = document.createElement('style');
    style.textContent = FALLBACK_CSS;
    document.head.appendChild(style);
    console.warn('styles.css was not found next to index.html, so the built-in styles are being used.');
  }

  /* ---------- Start ---------- */
  try {
    ensureStyles();
    load();
    render();
    const loading = $('#load-error');
    if (loading) loading.remove();
  } catch (err) {
    console.error(err);
    const loading = $('#load-error');
    if (loading) loading.textContent = 'Something went wrong while starting the app: ' + err.message;
  }
})();
