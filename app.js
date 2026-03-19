// ════════════════════════════════════════════════════════════
//  CROSSY ROAD TOURNAMENT v5 — app.js
//  Features: Leaderboard · Match history · Countdown timer
//  Sound effects · Confetti · Undo · Check-in · Match notes
//  Print bracket · localStorage persistence
// ════════════════════════════════════════════════════════════
'use strict';

const SAVE_KEY = 'crossy_tournament_v5';

// ─── State ───────────────────────────────────────────────────
let state = {
  settings: { name: 'Crossy Road Cup', numTeams: 8, date: '', location: '', timerSecs: 0, preseasonEnabled: false, preseasonNumSeasons: 2, preseasonGamesPerTeam: 4 },
  teams:    [],
  matches:  [],
  history:  [],
  checkins: {},
  preseason: null,  // { seasons: [{num, games:[{id,homeId,awayId,scoreA,scoreB,winner,status}], ...}], activeSeasonIdx, complete }
  currentMatchId: null
};

let undoStack      = [];
let timerInterval  = null;
let timerRemaining = 0;
let timerRunning   = false;

// ─── Init ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  loadState();

  // Score input clear-on-focus
  ['entry-pts-a', 'entry-pts-b'].forEach(id => {
    const input = document.getElementById(id);
    input.addEventListener('focus', () => { if (input.value === '0') input.value = ''; });
    input.addEventListener('blur',  () => { if (!input.value || input.value === '-') input.value = '0'; });
  });

  // Toast container
  const tc = document.createElement('div');
  tc.id = 'toast-container';
  document.body.appendChild(tc);

  // Splash dismiss
  setTimeout(() => {
    document.getElementById('splash-screen').style.display = 'none';
    document.getElementById('app').classList.remove('hidden');
    // Sync preseason nav button from persisted state
    document.getElementById('btn-preseason').classList.toggle('hidden', !state.settings.preseasonEnabled);
    showPage('home');
    renderAll();
  }, 2900);
});

// ─── Persistence ──────────────────────────────────────────────
function saveState() {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}
function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
             || localStorage.getItem('crossy_tournament_v4')
             || localStorage.getItem('crossy_tournament_v3')
             || localStorage.getItem('crossy_tournament');
    if (!raw) return;
    const p = JSON.parse(raw);
    state.settings = Object.assign(state.settings, p.settings || {});
    delete state.settings.numRounds;
    state.teams    = p.teams    || [];
    state.matches  = p.matches  || [];
    state.history  = p.history  || [];
    state.checkins = p.checkins || {};
    state.preseason = p.preseason || null;
    state.preseason = p.preseason || null;
  } catch(e) { console.warn('loadState failed', e); }
}

// ─── Navigation ───────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const map = { home:'btn-home', leaderboard:'btn-leaderboard', history:'btn-history', settings:'btn-settings', preseason:'btn-preseason' };
  if (map[name]) document.getElementById(map[name])?.classList.add('active');
  document.getElementById('fab-add').style.display     = (name === 'home') ? 'flex' : 'none';
  document.getElementById('fab-checkin').style.display = (name === 'home') ? 'flex' : 'none';
  if (name === 'home')        renderBracket();
  if (name === 'settings')    renderSettings();
  if (name === 'leaderboard') renderLeaderboard();
  if (name === 'history')     renderHistory();
  if (name === 'preseason')   renderPreseasonPage();
}
function renderAll() { renderBracket(); }

// ─── Undo ─────────────────────────────────────────────────────
function snapshot() {
  undoStack.push(JSON.stringify({ teams:state.teams, matches:state.matches, history:state.history, checkins:state.checkins }));
  if (undoStack.length > 20) undoStack.shift();
}
function undoLastAction() {
  if (!undoStack.length) { showToast('Nothing to undo.', 'info'); return; }
  const prev = JSON.parse(undoStack.pop());
  state.teams    = prev.teams;
  state.matches  = prev.matches;
  state.history  = prev.history;
  state.checkins = prev.checkins;
  saveState();
  renderAll();
  showToast('↩ Undone!', 'success');
}

// ─── Check-in ─────────────────────────────────────────────────
function toggleCheckin() {
  const bar = document.getElementById('checkin-bar');
  if (bar.classList.contains('hidden')) {
    bar.classList.remove('hidden');
    renderCheckinList();
  } else {
    bar.classList.add('hidden');
  }
}
function renderCheckinList() {
  const list = document.getElementById('checkin-list');
  list.innerHTML = state.teams.map(t => `
    <div class="checkin-chip ${state.checkins[t.id] ? 'checked' : ''}"
         onclick="toggleTeamCheckin('${t.id}')">
      ${t.emoji || '🐔'} ${escHtml(t.name)}${state.checkins[t.id] ? ' ✓' : ''}
    </div>`).join('');
}
function toggleTeamCheckin(id) {
  state.checkins[id] = !state.checkins[id];
  saveState();
  renderCheckinList();
  renderRoster();
}

// ─── Bracket Math ─────────────────────────────────────────────
function calcRounds(n) { return n <= 1 ? 1 : Math.ceil(Math.log2(n)); }
function bracketSize(n) { return Math.pow(2, calcRounds(n)); }
function getMaxRound()  { return state.matches.length ? Math.max(...state.matches.map(m => m.round)) : 0; }

function getRoundNames(total) {
  return Array.from({ length: total }, (_, i) => {
    const r = i + 1;
    if (r === total)                  return '🏆 FINAL';
    if (r === total - 1)              return 'SEMIFINALS';
    if (r === total - 2 && total > 3) return 'QUARTERFINALS';
    return 'ROUND ' + r;
  });
}

function buildSeedOrder(size) {
  if (size === 2) return [1, 2];
  const half = size / 2, prev = buildSeedOrder(half), out = [];
  for (let i = 0; i < half; i++) { out.push(prev[i]); out.push(size + 1 - prev[i]); }
  return out;
}

// ─── Build Bracket ────────────────────────────────────────────
function buildBracket() {
  snapshot();
  const n = state.teams.length;
  const sz = bracketSize(Math.max(n, 2));
  const rounds = calcRounds(Math.max(n, 2));
  const sorted = [...state.teams].sort((a, b) => (a.seed || 999) - (b.seed || 999));
  const seedOrder = buildSeedOrder(sz);
  const slotTeams = seedOrder.map(pos => { const t = sorted[pos - 1]; return t ? t.id : null; });

  state.matches = [];
  let mid = 1;
  const r1Count = sz / 2;
  for (let i = 0; i < r1Count; i++) {
    state.matches.push({ id:mid++, round:1, matchIndex:i, teamA:slotTeams[i*2]||null, teamB:slotTeams[i*2+1]||null, scoreA:0, scoreB:0, winner:null, status:'pending', notes:'' });
  }
  for (let r = 2; r <= rounds; r++) {
    const cnt = sz / Math.pow(2, r);
    for (let i = 0; i < cnt; i++) {
      state.matches.push({ id:mid++, round:r, matchIndex:i, teamA:null, teamB:null, scoreA:0, scoreB:0, winner:null, status:'pending', notes:'' });
    }
  }
  saveState();
  renderBracket();
}

// ─── Dynamic bracket sizing ───────────────────────────────────
function getBracketScale(n) {
  const tiers = [
    [4,  260, 130, 10, 14, 0.95, 1.35, 0.78, 22, 18],
    [8,  210, 108,  8, 12, 0.82, 1.15, 0.70, 16, 14],
    [16, 186,  96,  6, 10, 0.74, 1.05, 0.62, 12, 12],
    [32, 160,  82,  5,  8, 0.66, 0.92, 0.56, 10, 10],
  ];
  const tier = tiers.find(t => n <= t[0]) || tiers[tiers.length - 1];
  return { cardW:tier[1], cardH:tier[2], slotPadV:tier[3], slotPadH:tier[4], nameFontSize:tier[5], scoreFontSize:tier[6], seedFontSize:tier[7], baseGap:tier[8], marginX:tier[9] };
}

// ─── Bracket Rendering ────────────────────────────────────────
function renderBracket() {
  const board  = document.getElementById('bracket-board');
  const empty  = document.getElementById('bracket-empty');
  const scroll = document.getElementById('bracket-scroll');
  const meta   = document.getElementById('tournament-meta');

  meta.textContent = state.settings.name
    + (state.settings.date     ? '  •  ' + state.settings.date     : '')
    + (state.settings.location ? '  •  ' + state.settings.location : '');

  if (!state.teams.length || !state.matches.length) {
    empty.style.display = 'block'; scroll.style.display = 'none'; return;
  }
  empty.style.display = 'none'; scroll.style.display = 'block';

  const rounds = getMaxRound(), roundNames = getRoundNames(rounds);
  const scale  = getBracketScale(state.teams.length);
  board.innerHTML = '';

  for (let r = 1; r <= rounds; r++) {
    const mult = Math.pow(2, r - 1), gap = mult * scale.baseGap;

    const roundDiv  = document.createElement('div'); roundDiv.className = 'bracket-round';
    const label     = document.createElement('div'); label.className = 'round-label'; label.textContent = roundNames[r-1] || 'ROUND ' + r;
    const matchesDiv = document.createElement('div'); matchesDiv.className = 'round-matches'; matchesDiv.style.gap = gap + 'px';
    if (r > 1) matchesDiv.style.paddingTop = ((mult - 1) * (scale.cardH / 2 + scale.baseGap / 2)) + 'px';

    roundDiv.appendChild(label);
    state.matches.filter(m => m.round === r).forEach(m => matchesDiv.appendChild(buildMatchCard(m, scale)));
    roundDiv.appendChild(matchesDiv);
    board.appendChild(roundDiv);

    if (r < rounds) { const conn = document.createElement('div'); conn.className = 'bracket-connector'; board.appendChild(conn); }
  }
}

function buildMatchCard(match, scale) {
  scale = scale || getBracketScale(state.teams.length);
  const card = document.createElement('div');
  card.className = 'match-card' + (match.winner ? ' completed' : '');
  card.onclick   = () => openGame(match.id);
  card.style.width  = scale.cardW + 'px';
  card.style.margin = '5px ' + scale.marginX + 'px';
  card.appendChild(buildSlot(getTeamById(match.teamA), match.scoreA, match.winner === match.teamA, scale));
  card.appendChild(buildSlot(getTeamById(match.teamB), match.scoreB, match.winner === match.teamB, scale));

  let txt = 'Click to score', cls = '';
  if (!match.teamA && !match.teamB) txt = 'Awaiting teams';
  if (match.status === 'live')  { txt = '🔴 LIVE';      cls = 'live'; }
  if (match.winner)             { txt = '✓ Complete';   cls = 'done'; }

  const bar = document.createElement('div');
  bar.className   = 'match-status-bar ' + cls;
  bar.textContent = txt;
  bar.style.fontSize = (scale.seedFontSize * 0.85) + 'rem';
  card.appendChild(bar);
  return card;
}

function buildSlot(team, score, isWinner, scale) {
  scale = scale || getBracketScale(state.teams.length);
  const slot = document.createElement('div');
  slot.className = 'match-slot' + (isWinner ? ' winner' : '') + (!team ? ' empty' : '');
  slot.style.padding = scale.slotPadV + 'px ' + scale.slotPadH + 'px';
  slot.style.gap = Math.max(4, scale.slotPadH * 0.4) + 'px';

  if (team) {
    const seed = mkEl('span', 'slot-seed',  '#' + (team.seed || '?')); seed.style.fontSize = scale.seedFontSize + 'rem';
    const emo  = mkEl('span', 'slot-emoji', team.emoji || '🐔');       emo.style.fontSize  = scale.nameFontSize + 'rem';
    const nm   = mkEl('span', 'slot-name',  team.name);                nm.style.fontSize   = scale.nameFontSize + 'rem';
    const sc   = mkEl('span', 'slot-score' + (isWinner ? ' winner-score' : ''), String(score ?? 0)); sc.style.fontSize = scale.scoreFontSize + 'rem';
    slot.append(seed, emo, nm);
    if ((team.preWins || 0) + (team.preLosses || 0) > 0) {
      const rec = mkEl('span', 'slot-record', (team.preWins||0) + '-' + (team.preLosses||0));
      rec.style.fontSize = (scale.seedFontSize * 0.9) + 'rem';
      slot.append(rec);
    }
    slot.append(sc);
  } else {
    const tbd = mkEl('span', 'slot-name tbd', 'TBD'); tbd.style.fontSize = scale.nameFontSize + 'rem';
    slot.appendChild(tbd);
  }
  return slot;
}

function mkEl(tag, cls, text) {
  const e = document.createElement(tag); e.className = cls; e.textContent = text; return e;
}

// ─── Team Management ──────────────────────────────────────────
function getTeamById(id) { return state.teams.find(t => t.id === id) || null; }

function openAddTeamModal() {
  if (state.teams.length >= state.settings.numTeams) {
    showToast('Max ' + state.settings.numTeams + ' teams. Increase in Settings.', 'error'); return;
  }
  ['new-team-name', 'new-team-seed', 'new-team-emoji', 'new-team-wins', 'new-team-losses'].forEach(id => document.getElementById(id).value = '');
  openModal('modal-add-team');
  setTimeout(() => document.getElementById('new-team-name').focus(), 120);
}

function addTeam() {
  const name = document.getElementById('new-team-name').value.trim();
  if (!name) { showToast('Please enter a team name!', 'error'); return; }
  if (state.teams.length >= state.settings.numTeams) { showToast('Max ' + state.settings.numTeams + ' teams!', 'error'); return; }
  const seedIn = parseInt(document.getElementById('new-team-seed').value);
  const seed   = isNaN(seedIn) ? state.teams.length + 1 : seedIn;
  const emoji  = document.getElementById('new-team-emoji').value.trim() || randomBird();
  const preWins   = Math.max(0, parseInt(document.getElementById('new-team-wins').value)   || 0);
  const preLosses = Math.max(0, parseInt(document.getElementById('new-team-losses').value) || 0);
  snapshot();
  state.teams.push({ id: 'team_' + Date.now(), name, seed, emoji, preWins, preLosses });
  renumber();
  saveState();
  buildBracket();
  closeModal('modal-add-team');
  showToast('🐔 ' + name + ' added!', 'success');
  renderRoster();
}

function deleteTeam(id) {
  snapshot();
  state.teams = state.teams.filter(t => t.id !== id);
  delete state.checkins[id];
  renumber();
  saveState();
  buildBracket();
  renderRoster();
  showToast('Team removed.', 'info');
}

function renumber() {
  state.teams.sort((a, b) => (a.seed || 999) - (b.seed || 999));
  state.teams.forEach((t, i) => { t.seed = i + 1; });
}

function randomBird() {
  return ['🐔','🐓','🦃','🐣','🦊','🐸','🐰','🐷','🐮','🦁'][Math.floor(Math.random() * 10)];
}

// ─── Settings ─────────────────────────────────────────────────
function renderSettings() {
  document.getElementById('setting-name').value     = state.settings.name      || '';
  document.getElementById('setting-teams').value    = state.settings.numTeams  || 8;
  document.getElementById('setting-date').value     = state.settings.date      || '';
  document.getElementById('setting-location').value = state.settings.location  || '';
  document.getElementById('setting-timer').value    = state.settings.timerSecs || 0;

  const psEnabled = state.settings.preseasonEnabled || false;
  document.getElementById('setting-preseason').checked = psEnabled;
  document.getElementById('preseason-config').style.display = psEnabled ? 'flex' : 'none';
  document.getElementById('btn-preseason').classList.toggle('hidden', !psEnabled);

  const nsEl = document.getElementById('preseason-num-seasons');
  if (nsEl) nsEl.value = state.settings.preseasonNumSeasons || 2;
  const gpEl = document.getElementById('preseason-games-per-team');
  if (gpEl) gpEl.value = state.settings.preseasonGamesPerTeam || 4;

  const asEl = document.getElementById('setting-autosim');
  if (asEl) asEl.checked = state.settings.preseasonAutoSim || false;
  const hintEl = document.getElementById('autosim-hint');
  if (hintEl) hintEl.style.display = (state.settings.preseasonAutoSim) ? 'block' : 'none';

  renderRoster();
}

function saveSettings() {
  state.settings.name      = document.getElementById('setting-name').value.trim()      || 'Crossy Road Cup';
  const newNumTeams        = parseInt(document.getElementById('setting-teams').value)  || 8;
  state.settings.date      = document.getElementById('setting-date').value;
  state.settings.location  = document.getElementById('setting-location').value.trim();
  state.settings.timerSecs = parseInt(document.getElementById('setting-timer').value)  || 0;

  const psEnabled = document.getElementById('setting-preseason').checked;
  state.settings.preseasonEnabled = psEnabled;
  const nsEl = document.getElementById('preseason-num-seasons');
  const gpEl = document.getElementById('preseason-games-per-team');
  const asEl = document.getElementById('setting-autosim');
  if (nsEl) state.settings.preseasonNumSeasons   = parseInt(nsEl.value)   || 2;
  if (gpEl) state.settings.preseasonGamesPerTeam = gpEl.value === 'all' ? 'all' : (parseInt(gpEl.value) || 4);
  if (asEl) state.settings.preseasonAutoSim      = asEl.checked;

  document.getElementById('preseason-config').style.display = psEnabled ? 'flex' : 'none';
  document.getElementById('btn-preseason').classList.toggle('hidden', !psEnabled);
  const hintEl = document.getElementById('autosim-hint');
  if (hintEl) hintEl.style.display = (asEl && asEl.checked) ? 'block' : 'none';

  // Only trim teams / rebuild bracket if the team cap actually changed
  if (newNumTeams !== state.settings.numTeams) {
    state.settings.numTeams = newNumTeams;
    if (state.teams.length > state.settings.numTeams) {
      snapshot();
      state.teams = state.teams.slice(0, state.settings.numTeams);
      renumber();
      showToast('Teams trimmed to ' + state.settings.numTeams + '.', 'info');
      saveState();
      buildBracket();
    } else {
      state.settings.numTeams = newNumTeams;
      saveState();
      renderBracket();
    }
  } else {
    state.settings.numTeams = newNumTeams;
    saveState();
  }

  // Update meta display without re-rendering the whole settings form
  const meta = document.getElementById('tournament-meta');
  if (meta) {
    meta.textContent = state.settings.name
      + (state.settings.date     ? '  •  ' + state.settings.date     : '')
      + (state.settings.location ? '  •  ' + state.settings.location : '');
  }

  const msg = document.getElementById('settings-saved-msg');
  if (msg) { msg.classList.remove('hidden'); setTimeout(() => msg.classList.add('hidden'), 3000); }
  showToast('Settings saved!', 'success');
}

function renderRoster() {
  const list = document.getElementById('team-roster-list');
  if (!state.teams.length) {
    list.innerHTML = '<p style="color:var(--text-tertiary);font-size:.85rem;margin-bottom:1rem;">No teams yet. Add below or via the + button.</p>'; return;
  }
  const sorted = [...state.teams].sort((a, b) => (a.seed || 999) - (b.seed || 999));
  list.innerHTML = sorted.map(t => `
    <div class="roster-item" draggable="true" data-id="${t.id}"
         ondragstart="dragStart(event,'${t.id}')" ondragover="dragOver(event)" ondrop="dropTeam(event,'${t.id}')">
      <span class="roster-drag-handle">⠿</span>
      <span class="roster-seed">#${t.seed}</span>
      <span class="roster-emoji">${t.emoji || '🐔'}</span>
      <span class="roster-name">${escHtml(t.name)}</span>
      <span class="roster-checkin ${state.checkins[t.id] ? 'in' : 'out'}">${state.checkins[t.id] ? '✓ In' : '–'}</span>
      <button class="roster-delete" onclick="deleteTeam('${t.id}')" title="Remove">✕</button>
    </div>`).join('');
}

// ─── Drag & Drop ──────────────────────────────────────────────
let draggedId = null;
function dragStart(e, id) { draggedId = id; e.dataTransfer.effectAllowed = 'move'; setTimeout(() => e.target.classList.add('dragging'), 0); }
function dragOver(e)      { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
function dropTeam(e, targetId) {
  e.preventDefault();
  if (!draggedId || draggedId === targetId) return;
  const fi = state.teams.findIndex(t => t.id === draggedId);
  const ti = state.teams.findIndex(t => t.id === targetId);
  if (fi < 0 || ti < 0) return;
  const [moved] = state.teams.splice(fi, 1);
  state.teams.splice(ti, 0, moved);
  renumber();
  draggedId = null;
  saveState(); buildBracket(); renderRoster();
}

// ─── Countdown Timer ──────────────────────────────────────────
function initTimer(secs) {
  const wrap = document.getElementById('match-timer-wrap');
  if (!secs) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  timerRemaining = secs;
  timerRunning   = false;
  updateTimerDisplay();
}
function startTimer() {
  if (timerRunning) return;
  timerRunning = true;
  timerInterval = setInterval(() => {
    timerRemaining = Math.max(0, timerRemaining - 1);
    updateTimerDisplay();
    if (timerRemaining <= 10 && timerRemaining > 0) playSound('tick');
    if (timerRemaining === 0) { clearInterval(timerInterval); timerRunning = false; playSound('buzzer'); showToast('⏰ Time is up!', 'error'); }
  }, 1000);
}
function pauseTimer() { timerRunning = false; clearInterval(timerInterval); }
function resetTimer() {
  pauseTimer();
  timerRemaining = state.settings.timerSecs || 0;
  updateTimerDisplay();
}
function updateTimerDisplay() {
  const m = Math.floor(timerRemaining / 60), s = timerRemaining % 60;
  const disp = document.getElementById('match-timer-display');
  disp.textContent = m + ':' + (s < 10 ? '0' : '') + s;
  disp.className = 'match-timer-display';
  if (timerRemaining <= 10 && timerRemaining > 0) disp.classList.add('warning');
  if (timerRemaining === 0) disp.classList.add('expired');
}

// ─── Game Page ────────────────────────────────────────────────
function openGame(matchId) {
  const match = state.matches.find(m => m.id === matchId); if (!match) return;
  state.currentMatchId = matchId;
  const tA = getTeamById(match.teamA), tB = getTeamById(match.teamB);
  const roundNames = getRoundNames(getMaxRound());

  document.getElementById('game-page-title').textContent  = roundNames[match.round - 1] || 'MATCH';
  document.getElementById('game-round-badge').textContent = 'Match ' + (match.matchIndex + 1);
  document.getElementById('score-name-a').textContent = tA?.name || 'TBD';
  document.getElementById('score-name-b').textContent = tB?.name || 'TBD';
  document.getElementById('rank-a').textContent = tA ? 'Seed #' + tA.seed : '';
  document.getElementById('rank-b').textContent = tB ? 'Seed #' + tB.seed : '';
  document.getElementById('score-val-a').textContent = match.scoreA ?? 0;
  document.getElementById('score-val-b').textContent = match.scoreB ?? 0;
  document.getElementById('entry-label-a').textContent = tA?.name || 'Team A';
  document.getElementById('entry-label-b').textContent = tB?.name || 'Team B';
  document.getElementById('entry-pts-a').value = '0';
  document.getElementById('entry-pts-b').value = '0';
  document.getElementById('match-notes').value = match.notes || '';
  document.getElementById('modal-winner-a').textContent = (tA?.emoji || '🐔') + ' ' + (tA?.name || 'Team A');
  document.getElementById('modal-winner-b').textContent = (tB?.emoji || '🐔') + ' ' + (tB?.name || 'Team B');

  initTimer(state.settings.timerSecs || 0);
  updateScorePanels(match);
  updateWinnerBanner(match);
  showPage('game');
}

function updateScorePanels(match) {
  const sa = match.scoreA ?? 0, sb = match.scoreB ?? 0;
  document.getElementById('score-panel-a').classList.toggle('winning', sa > sb && !match.winner);
  document.getElementById('score-panel-b').classList.toggle('winning', sb > sa && !match.winner);
}

function updateWinnerBanner(match) {
  const banner = document.getElementById('winner-banner');
  if (match.winner) {
    const t = getTeamById(match.winner);
    document.getElementById('winner-name').textContent = (t?.emoji || '🐔') + ' ' + (t?.name || 'Winner');
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function confirmScoreEntry() {
  const match = state.matches.find(m => m.id === state.currentMatchId); if (!match) return;
  const addA = parseInt(document.getElementById('entry-pts-a').value) || 0;
  const addB = parseInt(document.getElementById('entry-pts-b').value) || 0;
  if (addA === 0 && addB === 0) { showToast('Enter at least 1 point!', 'error'); return; }
  snapshot();
  match.scoreA = (match.scoreA || 0) + addA;
  match.scoreB = (match.scoreB || 0) + addB;
  match.status = 'live';
  document.getElementById('score-val-a').textContent = match.scoreA;
  document.getElementById('score-val-b').textContent = match.scoreB;
  if (addA > 0) bumpScore('score-val-a');
  if (addB > 0) bumpScore('score-val-b');
  document.getElementById('entry-pts-a').value = '0';
  document.getElementById('entry-pts-b').value = '0';
  updateScorePanels(match);
  saveState();
  playSound('point');
  showToast('Points added!', 'success');
}

function bumpScore(id) {
  const e = document.getElementById(id); e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump');
}

function clearScoreEntry() {
  document.getElementById('entry-pts-a').value = '0';
  document.getElementById('entry-pts-b').value = '0';
}

function resetGameScore() {
  const match = state.matches.find(m => m.id === state.currentMatchId); if (!match) return;
  snapshot();
  match.scoreA = 0; match.scoreB = 0; match.winner = null; match.status = 'pending';
  document.getElementById('score-val-a').textContent = 0;
  document.getElementById('score-val-b').textContent = 0;
  updateScorePanels(match); updateWinnerBanner(match);
  saveState(); showToast('Score reset.', 'info');
}

function saveMatchNotes() {
  const match = state.matches.find(m => m.id === state.currentMatchId); if (!match) return;
  match.notes = document.getElementById('match-notes').value.trim();
  saveState(); showToast('Notes saved.', 'success');
}

function setWinnerManually() { openModal('modal-winner'); }

function declareWinner(side) {
  const match = state.matches.find(m => m.id === state.currentMatchId); if (!match) return;
  const winnerId = side === 'a' ? match.teamA : match.teamB;
  if (!winnerId) { showToast('No team in that slot!', 'error'); closeModal('modal-winner'); return; }
  snapshot();
  match.winner = winnerId; match.status = 'done';
  closeModal('modal-winner');

  // Log to history
  const tA = getTeamById(match.teamA), tB = getTeamById(match.teamB), tW = getTeamById(winnerId);
  const roundNames = getRoundNames(getMaxRound());
  state.history.push({
    id: 'hist_' + Date.now(),
    round: match.round, roundName: roundNames[match.round - 1] || 'Round ' + match.round,
    teamA: tA?.name || 'TBD', teamB: tB?.name || 'TBD',
    emojiA: tA?.emoji || '🐔', emojiB: tB?.emoji || '🐔',
    scoreA: match.scoreA || 0, scoreB: match.scoreB || 0,
    winnerId, winnerName: tW?.name || '?', winnerEmoji: tW?.emoji || '🐔',
    timestamp: new Date().toISOString(), notes: match.notes || ''
  });

  advanceWinner(match); updateWinnerBanner(match); saveState();
  pauseTimer();
  playSound('win'); triggerConfetti();
  showToast('🏆 ' + (tW?.name || 'Winner') + ' advances!', 'success');
  renderBracket();
}

function advanceWinner(match) {
  const next = state.matches.find(m => m.round === match.round + 1 && m.matchIndex === Math.floor(match.matchIndex / 2));
  if (next) next[match.matchIndex % 2 === 0 ? 'teamA' : 'teamB'] = match.winner;
}

// ─── Leaderboard ──────────────────────────────────────────────
function renderLeaderboard() {
  const container = document.getElementById('leaderboard-content');
  if (!state.teams.length) {
    container.innerHTML = '<div class="empty-state"><div style="font-size:3rem">📊</div><h3>No data yet</h3><p>Complete some matches to see stats.</p></div>'; return;
  }
  const stats = {};
  state.teams.forEach(t => { stats[t.id] = { name:t.name, emoji:t.emoji||'🐔', wins: t.preWins||0, losses: t.preLosses||0, ptsFor:0, ptsAgainst:0, hasRecord: !!(t.preWins||t.preLosses), preWins: t.preWins||0, preLosses: t.preLosses||0 }; });
  state.history.forEach(h => {
    const aId = state.teams.find(t => t.name === h.teamA)?.id;
    const bId = state.teams.find(t => t.name === h.teamB)?.id;
    if (aId && stats[aId]) { stats[aId].ptsFor += h.scoreA; stats[aId].ptsAgainst += h.scoreB; if (h.winnerId === aId) stats[aId].wins++; else stats[aId].losses++; }
    if (bId && stats[bId]) { stats[bId].ptsFor += h.scoreB; stats[bId].ptsAgainst += h.scoreA; if (h.winnerId === bId) stats[bId].wins++; else stats[bId].losses++; }
  });
  const sorted = Object.values(stats).sort((a, b) => b.wins - a.wins || a.losses - b.losses || (b.ptsFor - b.ptsAgainst) - (a.ptsFor - a.ptsAgainst));
  const rankClass = i => ['gold','silver','bronze'][i] || '';
  const rankLabel = i => ['🥇','🥈','🥉'][i] || '#'+(i+1);

  container.innerHTML = `
    <div class="glass-card">
      <h3 class="card-title">All-Time Standings</h3>
      <div class="lb-header">
        <span></span><span>Team</span><span style="text-align:center">W</span><span style="text-align:center">L</span><span style="text-align:center">PTS</span><span style="text-align:center">+/-</span>
      </div>
      ${sorted.map((s, i) => `
        <div class="lb-row ${rankClass(i)}">
          <div class="lb-rank ${rankClass(i)+'-text'}">${rankLabel(i)}</div>
          <div class="lb-team">${s.emoji} ${escHtml(s.name)}${s.hasRecord ? `<span class="lb-prerecord">(${s.preWins}-${s.preLosses} pre)</span>` : ''}</div>
          <div class="lb-stat"><div class="lb-stat-val">${s.wins}</div><div class="lb-stat-label">Wins</div></div>
          <div class="lb-stat"><div class="lb-stat-val">${s.losses}</div><div class="lb-stat-label">Loss</div></div>
          <div class="lb-stat"><div class="lb-stat-val">${s.ptsFor}</div><div class="lb-stat-label">For</div></div>
          <div class="lb-stat">
            <div class="lb-stat-val" style="color:${s.ptsFor-s.ptsAgainst>=0?'var(--green-400)':'var(--red-400)'}">
              ${s.ptsFor-s.ptsAgainst >= 0 ? '+' : ''}${s.ptsFor-s.ptsAgainst}
            </div>
            <div class="lb-stat-label">Diff</div>
          </div>
        </div>`).join('')}
    </div>`;
}

// ─── Match History ────────────────────────────────────────────
function renderHistory() {
  const container = document.getElementById('history-content');
  if (!state.history.length) {
    container.innerHTML = '<div class="empty-state"><div style="font-size:3rem">📋</div><h3>No matches played yet</h3></div>'; return;
  }
  const rev = [...state.history].reverse();
  container.innerHTML = `<div class="glass-card"><h3 class="card-title">Match Log (${state.history.length} matches)</h3>`
    + rev.map(h => {
        const dt = new Date(h.timestamp);
        const timeStr = isNaN(dt) ? '' : dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
        return `<div class="history-item">
          <div class="history-round">${h.roundName}</div>
          <div class="history-teams">${h.emojiA||'🐔'} ${escHtml(h.teamA)} vs ${h.emojiB||'🐔'} ${escHtml(h.teamB)}</div>
          <div class="history-score">${h.scoreA} — ${h.scoreB}</div>
          <div class="history-winner">🏆 ${h.winnerEmoji||'🐔'} ${escHtml(h.winnerName)}</div>
          <div class="history-time">${timeStr}</div>
          ${h.notes ? `<div class="history-note">📝 ${escHtml(h.notes)}</div>` : ''}
        </div>`;
      }).join('') + '</div>';
}

// ─── Print Bracket ────────────────────────────────────────────
function printBracket() { window.print(); }

// ─── Reset ────────────────────────────────────────────────────
function confirmReset() { openModal('modal-reset'); }
function resetTournament() {
  snapshot();
  state.teams = []; state.matches = []; state.history = []; state.checkins = {};
  saveState(); closeModal('modal-reset'); renderAll(); showPage('home');
  showToast('Tournament reset!', 'info');
}

// ─── Modals ───────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
document.addEventListener('click', e => { if (e.target.classList.contains('modal-overlay')) e.target.classList.add('hidden'); });
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !document.getElementById('modal-add-team').classList.contains('hidden')) addTeam();
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
});

// ─── Sound Effects ────────────────────────────────────────────
const audioCtx = window.AudioContext ? new AudioContext() : null;

function playSound(type) {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    if (type === 'point') {
      osc.frequency.setValueAtTime(440, t);
      osc.frequency.exponentialRampToValueAtTime(880, t + 0.1);
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.start(t); osc.stop(t + 0.2);
    } else if (type === 'win') {
      osc.type = 'square';
      [523, 659, 784, 1047].forEach((f, i) => osc.frequency.setValueAtTime(f, t + i * 0.1));
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.start(t); osc.stop(t + 0.5);
    } else if (type === 'tick') {
      osc.frequency.setValueAtTime(1000, t);
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      osc.start(t); osc.stop(t + 0.05);
    } else if (type === 'buzzer') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(200, t);
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      osc.start(t); osc.stop(t + 0.6);
    }
  } catch(e) {}
}

// ─── Confetti ─────────────────────────────────────────────────
function triggerConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  const ctx    = canvas.getContext('2d');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const pieces = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width, y: -10,
    r: 4 + Math.random() * 6, d: 20 + Math.random() * 40,
    color: ['#f97316','#3b72f5','#fbbf24','#4ade80','#f472b6','#a78bfa'][Math.floor(Math.random() * 6)],
    tilt: Math.random() * 10 - 10, tiltAngle: 0, tiltSpeed: 0.1 + Math.random() * 0.3
  }));
  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      ctx.beginPath(); ctx.lineWidth = p.r; ctx.strokeStyle = p.color;
      ctx.moveTo(p.x + p.tilt + p.r / 3, p.y);
      ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 5);
      ctx.stroke();
      p.tiltAngle += p.tiltSpeed; p.y += 3 + Math.cos(frame * 0.01) * 2;
      p.x += Math.sin(frame * 0.02) * 1.5; p.tilt = Math.sin(p.tiltAngle) * 15;
    });
    frame++;
    if (frame < 180) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  draw();
}

// ─── Toast ────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const tc = document.getElementById('toast-container');
  const t  = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg;
  tc.appendChild(t); setTimeout(() => t.remove(), 2900);
}

// ─── Helpers ──────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
//  PRE-SEASON — INTERACTIVE PLAYABLE SEASONS
// ══════════════════════════════════════════════════════════════

let psCurrentGameId = null;  // id of the ps game being played

// ── Schedule Generator ────────────────────────────────────────
function buildRoundRobinSchedule(teams, gamesPerTeam) {
  const n = teams.length;
  if (n < 2) return [];
  // All unique matchups
  const pairs = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      pairs.push([teams[i].id, teams[j].id]);

  // Shuffle
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }

  let schedule = [];
  if (gamesPerTeam === 'all') {
    schedule = pairs;
  } else {
    // Repeat pairs until every team has ~gamesPerTeam games
    const count = {};
    teams.forEach(t => { count[t.id] = 0; });
    let pIdx = 0;
    const maxGames = Math.ceil(gamesPerTeam * n / 2);
    while (schedule.length < maxGames) {
      const [a, b] = pairs[pIdx % pairs.length];
      schedule.push([a, b]);
      count[a]++; count[b]++;
      pIdx++;
    }
  }

  let mid = 1;
  return schedule.map(([a, b]) => ({
    id: 'psg_' + (mid++),
    homeId: a,
    awayId: b,
    scoreA: 0,
    scoreB: 0,
    winner: null,
    status: 'pending'
  }));
}

// ── Init Pre-Season ───────────────────────────────────────────
function initPreseason() {
  if (state.teams.length < 2) {
    showToast('Need at least 2 teams first!', 'error'); return;
  }
  const numSeasons = parseInt(document.getElementById('preseason-num-seasons').value) || 2;
  const gpt = document.getElementById('preseason-games-per-team').value;
  const gamesPerTeam = gpt === 'all' ? 'all' : (parseInt(gpt) || 4);

  snapshot();
  const seasons = [];
  for (let s = 0; s < numSeasons; s++) {
    seasons.push({
      num: s + 1,
      games: buildRoundRobinSchedule(state.teams, gamesPerTeam),
      complete: false
    });
  }
  state.preseason = {
    seasons,
    activeSeasonIdx: 0,
    complete: false,
    appliedAt: null
  };
  saveState();
  showToast('🏅 Pre-season schedule generated!', 'success');
  renderSettings();
  showPage('preseason');
}

function resetPreseason() {
  snapshot();
  state.preseason = null;
  saveState();
  renderSettings();
  showToast('Pre-season cleared.', 'info');
}

// ── Standings Calculator ──────────────────────────────────────
function calcPSStandings(seasonGames) {
  const stats = {};
  state.teams.forEach(t => {
    stats[t.id] = { id: t.id, name: t.name, emoji: t.emoji || '🐔',
                    wins: 0, losses: 0, ptsFor: 0, ptsAgainst: 0, gp: 0 };
  });
  seasonGames.filter(g => g.winner).forEach(g => {
    const home = stats[g.homeId], away = stats[g.awayId];
    if (!home || !away) return;
    home.ptsFor += g.scoreA; home.ptsAgainst += g.scoreB; home.gp++;
    away.ptsFor += g.scoreB; away.ptsAgainst += g.scoreA; away.gp++;
    if (g.winner === g.homeId) { home.wins++; away.losses++; }
    else                       { away.wins++; home.losses++; }
  });
  return Object.values(stats).sort((a, b) =>
    b.wins - a.wins || (b.ptsFor - b.ptsAgainst) - (a.ptsFor - a.ptsAgainst) || b.ptsFor - a.ptsFor
  );
}

function calcAggregateStandings() {
  const agg = {};
  state.teams.forEach(t => {
    agg[t.id] = { id: t.id, name: t.name, emoji: t.emoji || '🐔',
                  wins: 0, losses: 0, ptsFor: 0, ptsAgainst: 0, gp: 0 };
  });
  state.preseason.seasons.forEach(s => {
    calcPSStandings(s.games).forEach(row => {
      if (!agg[row.id]) return;
      agg[row.id].wins       += row.wins;
      agg[row.id].losses     += row.losses;
      agg[row.id].ptsFor     += row.ptsFor;
      agg[row.id].ptsAgainst += row.ptsAgainst;
      agg[row.id].gp         += row.gp;
    });
  });
  return Object.values(agg).sort((a, b) =>
    b.wins - a.wins || (b.ptsFor - b.ptsAgainst) - (a.ptsFor - a.ptsAgainst) || b.ptsFor - a.ptsFor
  );
}

// ── Render Pre-Season Page ────────────────────────────────────
let psFilterMode = 'all';
function setPSFilter(mode) {
  psFilterMode = mode;
  ['all','pending','done'].forEach(f => {
    document.getElementById('psf-' + f)?.classList.toggle('active', f === mode);
  });
  renderPSGamesList();
}

function renderPreseasonPage() {
  if (!state.preseason) {
    // Show empty state
    document.getElementById('ps-season-tabs').innerHTML = '';
    document.getElementById('ps-standings-body').innerHTML =
      '<div class="empty-state" style="padding:2rem 0"><p>No pre-season schedule yet. Go to <strong>Settings</strong> to generate one.</p></div>';
    document.getElementById('ps-games-list').innerHTML = '';
    document.getElementById('ps-season-actions').classList.add('hidden');
    document.getElementById('ps-complete-banner').classList.add('hidden');
    document.getElementById('ps-progress-meta').textContent = '';
    return;
  }

  const ps = state.preseason;

  // Progress meta
  const totalGames  = ps.seasons.reduce((s, season) => s + season.games.length, 0);
  const doneGames   = ps.seasons.reduce((s, season) => s + season.games.filter(g => g.winner).length, 0);
  document.getElementById('ps-progress-meta').textContent = doneGames + ' / ' + totalGames + ' games played';

  // Season tabs
  const tabsEl = document.getElementById('ps-season-tabs');
  tabsEl.innerHTML = ps.seasons.map((s, i) => {
    const done = s.games.filter(g => g.winner).length;
    const total = s.games.length;
    const cls = i === ps.activeSeasonIdx ? 'active' : '';
    const completeCls = s.complete ? 'done' : '';
    return `<button class="ps-tab ${cls} ${completeCls}" onclick="setActiveSeason(${i})">
      Season ${s.num}
      <span class="ps-tab-badge">${done}/${total}</span>
    </button>`;
  }).join('');

  // Aggregate tab
  if (ps.complete) {
    const aggActive = ps.activeSeasonIdx === -1 ? 'active' : '';
    tabsEl.innerHTML += `<button class="ps-tab ps-tab-agg ${aggActive}" onclick="setActiveSeason(-1)">📊 Final</button>`;
  }

  // Show complete banner or standings + games
  if (ps.complete && ps.activeSeasonIdx === -1) {
    document.getElementById('ps-season-view').style.display = 'none';
    document.getElementById('ps-complete-banner').classList.remove('hidden');
    renderAggregateStandingsInBanner();
    return;
  }

  document.getElementById('ps-season-view').style.display = '';
  document.getElementById('ps-complete-banner').classList.add('hidden');

  // Auto-sim bar — show when enabled and there are pending games
  const autosimBar = document.getElementById('ps-autosim-bar');
  const autosimEnabled = state.settings.preseasonAutoSim || false;
  const hasPending = ps.seasons.some(s => s.games.some(g => !g.winner));
  autosimBar.classList.toggle('hidden', !autosimEnabled || !hasPending || ps.complete);

  const season = ps.seasons[ps.activeSeasonIdx >= 0 ? ps.activeSeasonIdx : 0];
  const standings = calcPSStandings(season.games);

  // Standings
  document.getElementById('ps-standings-title').textContent = 'Season ' + season.num + ' Standings';
  renderPSStandingsTable(standings, 'ps-standings-body');

  // Games
  document.getElementById('ps-games-title').textContent = 'Season ' + season.num + ' Games';
  renderPSGamesList();

  // Season action buttons
  const actEl = document.getElementById('ps-season-actions');
  const allDone = season.games.every(g => g.winner);
  const isLast = ps.activeSeasonIdx === ps.seasons.length - 1;
  if (allDone && !season.complete) {
    actEl.classList.remove('hidden');
    actEl.innerHTML = isLast
      ? `<button class="btn-primary btn-lg" onclick="finalizeSeason(true)">🏅 Finish Pre-Season & See Final Standings →</button>`
      : `<button class="btn-primary btn-lg" onclick="finalizeSeason(false)">➡ Start Season ${season.num + 1}</button>`;
  } else {
    actEl.classList.add('hidden');
  }
}

function renderAggregateStandingsInBanner() {
  const standings = calcAggregateStandings();
  let html = '<div class="ps-agg-in-banner"><h4>Combined Standings</h4>';
  html += '<div class="ps-standings-table">';
  html += '<div class="ps-table-header"><span>Rank</span><span>Team</span><span>W</span><span>L</span><span>Diff</span></div>';
  standings.forEach((row, i) => {
    const diff = row.ptsFor - row.ptsAgainst;
    const rankEmoji = ['🥇','🥈','🥉'][i] || ('#'+(i+1));
    const cls = ['ps-gold','ps-silver','ps-bronze'][i] || '';
    html += `<div class="ps-table-row ${cls}">
      <span class="ps-rank">${rankEmoji}</span>
      <span class="ps-team-name">${row.emoji} ${escHtml(row.name)}</span>
      <span class="ps-stat ps-wins">${row.wins}</span>
      <span class="ps-stat">${row.losses}</span>
      <span class="ps-stat ps-diff" style="color:${diff>=0?'var(--green-400)':'var(--red-400)'}">${diff>=0?'+':''}${diff}</span>
    </div>`;
  });
  html += '</div></div>';
  const banner = document.getElementById('ps-complete-banner');
  const existing = banner.querySelector('.ps-agg-in-banner');
  if (existing) existing.remove();
  banner.querySelector('.ps-complete-inner').insertAdjacentHTML('beforeend', html);
}

function renderPSStandingsTable(standings, containerId) {
  const el = document.getElementById(containerId);
  let html = '<div class="ps-standings-table">';
  html += '<div class="ps-table-header"><span>Rank</span><span>Team</span><span>W</span><span>L</span><span>GP</span><span>PF</span><span>+/-</span></div>';
  standings.forEach((row, i) => {
    const diff = row.ptsFor - row.ptsAgainst;
    const rankEmoji = ['🥇','🥈','🥉'][i] || ('#'+(i+1));
    const cls = ['ps-gold','ps-silver','ps-bronze'][i] || '';
    html += `<div class="ps-table-row ${cls}">
      <span class="ps-rank">${rankEmoji}</span>
      <span class="ps-team-name">${row.emoji} ${escHtml(row.name)}</span>
      <span class="ps-stat ps-wins">${row.wins}</span>
      <span class="ps-stat">${row.losses}</span>
      <span class="ps-stat">${row.gp}</span>
      <span class="ps-stat">${row.ptsFor}</span>
      <span class="ps-stat ps-diff" style="color:${diff>=0?'var(--green-400)':'var(--red-400)'}">${diff>=0?'+':''}${diff}</span>
    </div>`;
  });
  html += '</div>';
  el.innerHTML = html;
}

function renderPSGamesList() {
  if (!state.preseason) return;
  const season = state.preseason.seasons[state.preseason.activeSeasonIdx >= 0 ? state.preseason.activeSeasonIdx : 0];
  const el = document.getElementById('ps-games-list');

  let games = season.games;
  if (psFilterMode === 'pending') games = games.filter(g => !g.winner);
  if (psFilterMode === 'done')    games = games.filter(g =>  g.winner);

  if (!games.length) {
    el.innerHTML = '<p style="color:var(--text-tertiary);padding:1rem 0;text-align:center;">No games here.</p>';
    return;
  }

  el.innerHTML = games.map((g, idx) => {
    const home = getTeamById(g.homeId), away = getTeamById(g.awayId);
    const isDone = !!g.winner;
    const isWinnerHome = g.winner === g.homeId;
    return `<div class="ps-game-card ${isDone ? 'ps-game-done' : ''}" onclick="openPSGame('${g.id}')">
      <div class="ps-game-num">G${idx+1}</div>
      <div class="ps-game-teams">
        <span class="ps-game-team ${isDone && isWinnerHome ? 'ps-winner-team' : ''}">${home?.emoji||'🐔'} ${escHtml(home?.name||'TBD')}</span>
        <span class="ps-game-vs">vs</span>
        <span class="ps-game-team ${isDone && !isWinnerHome ? 'ps-winner-team' : ''}">${away?.emoji||'🐔'} ${escHtml(away?.name||'TBD')}</span>
      </div>
      ${isDone
        ? `<div class="ps-game-score">${g.scoreA} — ${g.scoreB}</div>`
        : `<div class="ps-game-status">Tap to play</div>`
      }
    </div>`;
  }).join('');
}

function setActiveSeason(idx) {
  state.preseason.activeSeasonIdx = idx;
  saveState();
  renderPreseasonPage();
}

function finalizeSeason(isLast) {
  const season = state.preseason.seasons[state.preseason.activeSeasonIdx];
  season.complete = true;
  if (isLast) {
    state.preseason.complete = true;
    state.preseason.activeSeasonIdx = -1;
  } else {
    state.preseason.activeSeasonIdx++;
  }
  saveState();
  renderPreseasonPage();
  if (isLast) {
    showToast('🏅 Pre-season complete! Apply seeds to the bracket.', 'success');
    triggerConfetti();
  } else {
    showToast('Season ' + season.num + ' done! Starting next season.', 'success');
  }
}

// ── Open PS Game (scoring page) ───────────────────────────────
function openPSGame(gameId) {
  if (!state.preseason) return;
  let game = null;
  let season = null;
  for (const s of state.preseason.seasons) {
    const found = s.games.find(g => g.id === gameId);
    if (found) { game = found; season = s; break; }
  }
  if (!game) return;

  psCurrentGameId = gameId;
  const home = getTeamById(game.homeId), away = getTeamById(game.awayId);

  document.getElementById('ps-game-title').textContent = 'PRE-SEASON S' + season.num;
  document.getElementById('ps-game-badge').textContent  = 'Game';
  document.getElementById('ps-score-name-a').textContent = home?.name || 'TBD';
  document.getElementById('ps-score-name-b').textContent = away?.name || 'TBD';
  document.getElementById('ps-rank-a').textContent = home?.emoji || '🐔';
  document.getElementById('ps-rank-b').textContent = away?.emoji || '🐔';
  document.getElementById('ps-score-val-a').textContent = game.scoreA || 0;
  document.getElementById('ps-score-val-b').textContent = game.scoreB || 0;
  document.getElementById('ps-entry-label-a').textContent = home?.name || 'Home';
  document.getElementById('ps-entry-label-b').textContent = away?.name || 'Away';
  document.getElementById('ps-entry-pts-a').value = '0';
  document.getElementById('ps-entry-pts-b').value = '0';
  document.getElementById('ps-modal-winner-a').textContent = (home?.emoji||'🐔') + ' ' + (home?.name||'Home');
  document.getElementById('ps-modal-winner-b').textContent = (away?.emoji||'🐔') + ' ' + (away?.name||'Away');

  psUpdateScorePanels(game);
  psUpdateWinnerBanner(game);
  initTimerPS();
  showPage('ps-game');
}

function psUpdateScorePanels(game) {
  const sa = game.scoreA || 0, sb = game.scoreB || 0;
  document.getElementById('ps-score-panel-a').classList.toggle('winning', sa > sb && !game.winner);
  document.getElementById('ps-score-panel-b').classList.toggle('winning', sb > sa && !game.winner);
}

function psUpdateWinnerBanner(game) {
  const banner = document.getElementById('ps-winner-banner');
  if (game.winner) {
    const t = getTeamById(game.winner);
    document.getElementById('ps-winner-name').textContent = (t?.emoji||'🐔') + ' ' + (t?.name||'Winner');
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function getPSGame() {
  if (!state.preseason || !psCurrentGameId) return null;
  for (const s of state.preseason.seasons) {
    const g = s.games.find(g => g.id === psCurrentGameId);
    if (g) return g;
  }
  return null;
}

function psConfirmPoints() {
  const game = getPSGame(); if (!game) return;
  const addA = parseInt(document.getElementById('ps-entry-pts-a').value) || 0;
  const addB = parseInt(document.getElementById('ps-entry-pts-b').value) || 0;
  if (addA === 0 && addB === 0) { showToast('Enter at least 1 point!', 'error'); return; }
  game.scoreA = (game.scoreA || 0) + addA;
  game.scoreB = (game.scoreB || 0) + addB;
  document.getElementById('ps-score-val-a').textContent = game.scoreA;
  document.getElementById('ps-score-val-b').textContent = game.scoreB;
  if (addA > 0) bumpScore('ps-score-val-a');
  if (addB > 0) bumpScore('ps-score-val-b');
  document.getElementById('ps-entry-pts-a').value = '0';
  document.getElementById('ps-entry-pts-b').value = '0';
  psUpdateScorePanels(game);
  saveState();
  playSound('point');
  showToast('Points added!', 'success');
}

function psClearEntry() {
  document.getElementById('ps-entry-pts-a').value = '0';
  document.getElementById('ps-entry-pts-b').value = '0';
}

function psResetScore() {
  const game = getPSGame(); if (!game) return;
  game.scoreA = 0; game.scoreB = 0; game.winner = null; game.status = 'pending';
  document.getElementById('ps-score-val-a').textContent = 0;
  document.getElementById('ps-score-val-b').textContent = 0;
  psUpdateScorePanels(game); psUpdateWinnerBanner(game);
  saveState(); showToast('Score reset.', 'info');
}

function psOpenDeclare() { openModal('modal-ps-winner'); }

function psDeclareWinner(side) {
  const game = getPSGame(); if (!game) return;
  const winnerId = side === 'a' ? game.homeId : game.awayId;
  if (!winnerId) { closeModal('modal-ps-winner'); return; }
  game.winner = winnerId;
  game.status = 'done';
  closeModal('modal-ps-winner');
  psUpdateWinnerBanner(game);
  saveState();
  playSound('win');
  triggerConfetti();
  const t = getTeamById(winnerId);
  showToast('🏅 ' + (t?.name||'Winner') + ' wins!', 'success');
}

function initTimerPS() {
  const wrap = document.getElementById('match-timer-wrap-ps');
  const secs = state.settings.timerSecs || 0;
  if (!secs) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  timerRemaining = secs;
  timerRunning = false;
  const disp = document.getElementById('match-timer-display-ps');
  const m = Math.floor(timerRemaining/60), s = timerRemaining%60;
  disp.textContent = m+':'+(s<10?'0':'')+s;
}

// ── Apply Seeds to Bracket ────────────────────────────────────
function applyPreseasonSeeds() {
  if (!state.preseason) return;
  snapshot();
  const standings = calcAggregateStandings();
  standings.forEach((row, i) => {
    const team = state.teams.find(t => t.id === row.id);
    if (team) { team.seed = i + 1; team.preWins = row.wins; team.preLosses = row.losses; }
  });
  renumber();
  state.preseason.appliedAt = new Date().toISOString();
  saveState();
  buildBracket();
  showToast('🏆 Seeds applied! Bracket is ready.', 'success');
  playSound('win');
  triggerConfetti();
  showPage('home');
}

// ══════════════════════════════════════════════════════════════
//  AUTO-SIM
// ══════════════════════════════════════════════════════════════

function simOneGame(game) {
  // Strength based on seed — lower seed = stronger team
  const n = state.teams.length || 1;
  const home = getTeamById(game.homeId);
  const away = getTeamById(game.awayId);
  const strA = (n + 1 - (home?.seed || n)) / n;
  const strB = (n + 1 - (away?.seed || n)) / n;
  const total = Math.max(strA, 0.05) + Math.max(strB, 0.05);
  const probA = Math.max(strA, 0.05) / total;
  const aWins = Math.random() < probA;
  const winScore  = 8 + Math.floor(Math.random() * 8);
  const lossScore = Math.floor(Math.random() * winScore);
  game.scoreA = aWins ? winScore : lossScore;
  game.scoreB = aWins ? lossScore : winScore;
  game.winner = aWins ? game.homeId : game.awayId;
  game.status = 'done';
}

function autoSimSeason() {
  if (!state.preseason) return;
  const idx = state.preseason.activeSeasonIdx >= 0 ? state.preseason.activeSeasonIdx : 0;
  const season = state.preseason.seasons[idx];
  const pending = season.games.filter(g => !g.winner);
  if (!pending.length) { showToast('No pending games in this season.', 'info'); return; }

  snapshot();
  pending.forEach(g => simOneGame(g));

  // Auto-finalize this season
  season.complete = true;
  const isLast = idx === state.preseason.seasons.length - 1;
  if (isLast) {
    state.preseason.complete = true;
    state.preseason.activeSeasonIdx = -1;
  } else {
    state.preseason.activeSeasonIdx = idx + 1;
  }

  saveState();
  renderPreseasonPage();
  showToast('⚡ Season ' + season.num + ' simulated! (' + pending.length + ' games)', 'success');
  if (isLast) triggerConfetti();
}

function autoSimAll() {
  if (!state.preseason) return;
  snapshot();
  let totalSimed = 0;

  state.preseason.seasons.forEach(season => {
    const pending = season.games.filter(g => !g.winner);
    pending.forEach(g => simOneGame(g));
    totalSimed += pending.length;
    season.complete = true;
  });

  state.preseason.complete = true;
  state.preseason.activeSeasonIdx = -1;
  saveState();
  renderPreseasonPage();
  showToast('⚡⚡ All seasons simulated! ' + totalSimed + ' games auto-played.', 'success');
  triggerConfetti();
}
