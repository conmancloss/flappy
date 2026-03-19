// ════════════════════════════════════════════════════════════
//  CROSSY ROAD TOURNAMENT v4 — app.js
//  Features: Live Upstash Redis sync · Leaderboard · Match history
//  Countdown timer · Spectator/TV mode · Sound effects · Confetti
//  Undo · Check-in · Match notes · Print bracket
// ════════════════════════════════════════════════════════════
'use strict';

// ─── Upstash Redis Config ────────────────────────────────────
const REDIS_URL   = 'https://cuddly-gelding-77491.upstash.io';
const REDIS_TOKEN = 'gQAAAAAAAS6zAAIncDIyYTZjYzkwZmE3OWQ0N2EzODI5OTExZjQ1MTkwMmE1NXAyNzc0OTE';
const REDIS_KEY   = 'crossy_tournament_v4';
const POLL_MS     = 3000; // sync every 3 seconds

// ─── State ───────────────────────────────────────────────────
let state = {
  settings: { name: 'Crossy Road Cup', numTeams: 8, date: '', location: '', timerSecs: 0 },
  teams:    [],
  matches:  [],
  history:  [],   // { id, round, roundName, teamA, teamB, scoreA, scoreB, winnerId, winnerName, timestamp, notes }
  checkins: {},   // { teamId: true/false }
  currentMatchId: null
};

let undoStack      = [];   // snapshots for undo
let syncInterval   = null;
let lastSyncHash   = '';
let timerInterval  = null;
let timerRemaining = 0;
let timerRunning   = false;
let spectatorMode  = false;

// ─── Init ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  loadLocal();

  // Score input clear-on-focus
  ['entry-pts-a', 'entry-pts-b'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('focus', () => { if (el.value === '0') el.value = ''; });
    el.addEventListener('blur',  () => { if (!el.value || el.value === '-') el.value = '0'; });
  });

  // Toast container
  const tc = document.createElement('div');
  tc.id = 'toast-container';
  document.body.appendChild(tc);

  // Init sounds
  initSounds();

  // Splash dismiss
  setTimeout(async () => {
    document.getElementById('splash-screen').style.display = 'none';
    document.getElementById('app').classList.remove('hidden');
    showPage('home');
    renderAll();

    // Start cloud sync
    await syncFromCloud();
    startSyncLoop();
  }, 2900);
});

// ─── Persistence: Local ───────────────────────────────────────
function saveLocal() {
  localStorage.setItem(REDIS_KEY, JSON.stringify(state));
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(REDIS_KEY)
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
  } catch(e) { console.warn('loadLocal failed', e); }
}

// ─── Persistence: Cloud (Upstash Redis REST) ──────────────────
async function redisGet(key) {
  const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  });
  const json = await res.json();
  return json.result; // null or string
}

async function redisSet(key, value) {
  const res = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  });
  return res.ok;
}

async function syncFromCloud() {
  try {
    const raw = await redisGet(REDIS_KEY);
    if (!raw) { await pushToCloud(); setSyncStatus('online'); return; }

    const cloudHash = hashStr(raw);
    if (cloudHash === lastSyncHash) { setSyncStatus('online'); return; }

    const cloudState = JSON.parse(raw);
    // Merge: cloud wins unless local is newer (compare history length + match state)
    const cloudHistLen  = (cloudState.history  || []).length;
    const localHistLen  = state.history.length;
    const cloudMatchSum = sumMatchScores(cloudState.matches || []);
    const localMatchSum = sumMatchScores(state.matches);

    if (cloudHistLen > localHistLen || cloudMatchSum > localMatchSum) {
      state.settings = Object.assign(state.settings, cloudState.settings || {});
      state.teams    = cloudState.teams    || state.teams;
      state.matches  = cloudState.matches  || state.matches;
      state.history  = cloudState.history  || state.history;
      state.checkins = cloudState.checkins || state.checkins;
      saveLocal();
      renderAll();
      showSyncIndicator('Updated from cloud');
    }
    lastSyncHash = cloudHash;
    setSyncStatus('online');
  } catch(e) {
    console.warn('syncFromCloud error', e);
    setSyncStatus('offline');
  }
}

async function pushToCloud() {
  try {
    const payload = JSON.stringify(state);
    await redisSet(REDIS_KEY, payload);
    lastSyncHash = hashStr(payload);
    setSyncStatus('online');
  } catch(e) {
    console.warn('pushToCloud error', e);
    setSyncStatus('offline');
  }
}

function saveState() {
  saveLocal();
  pushToCloud();
}

function startSyncLoop() {
  syncInterval = setInterval(syncFromCloud, POLL_MS);
}

function sumMatchScores(matches) {
  return (matches || []).reduce((s, m) => s + (m.scoreA || 0) + (m.scoreB || 0), 0);
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; }
  return String(h);
}

// ─── Sync UI ──────────────────────────────────────────────────
function setSyncStatus(status) {
  const dot  = document.getElementById('sync-dot-lg');
  const text = document.getElementById('sync-status-text');
  if (!dot) return;
  dot.className = 'sync-dot-lg ' + (status === 'online' ? 'online' : 'offline');
  text.textContent = status === 'online' ? '✓ Connected — live sync active' : '✗ Offline — using local data';
}

function showSyncIndicator(msg) {
  const ind   = document.getElementById('sync-indicator');
  const label = document.getElementById('sync-label');
  const dot   = ind.querySelector('.sync-dot');
  label.textContent = msg;
  dot.className = 'sync-dot synced';
  ind.classList.remove('hidden');
  setTimeout(() => ind.classList.add('hidden'), 3000);
}

// ─── Navigation ───────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const map = { home:'btn-home', leaderboard:'btn-leaderboard', history:'btn-history', settings:'btn-settings' };
  if (map[name]) document.getElementById(map[name])?.classList.add('active');
  document.getElementById('fab-add').style.display      = (name === 'home') ? 'flex' : 'none';
  document.getElementById('fab-checkin').style.display  = (name === 'home') ? 'flex' : 'none';
  if (name === 'home')        renderBracket();
  if (name === 'settings')    renderSettings();
  if (name === 'leaderboard') renderLeaderboard();
  if (name === 'history')     renderHistory();
}
function renderAll() { renderBracket(); renderSettings(); }

// ─── Undo ─────────────────────────────────────────────────────
function snapshot() {
  undoStack.push(JSON.stringify({ teams: state.teams, matches: state.matches, history: state.history, checkins: state.checkins }));
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
      ${t.emoji || '🐔'} ${escHtml(t.name)}
      ${state.checkins[t.id] ? ' ✓' : ''}
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
  const sorted = [...state.teams].sort((a,b) => (a.seed||999)-(b.seed||999));
  const seedOrder = buildSeedOrder(sz);
  const slotTeams = seedOrder.map(pos => { const t = sorted[pos-1]; return t ? t.id : null; });
  state.matches = [];
  let mid = 1;
  const r1Count = sz / 2;
  for (let i = 0; i < r1Count; i++) {
    state.matches.push({ id: mid++, round:1, matchIndex:i, teamA:slotTeams[i*2]||null, teamB:slotTeams[i*2+1]||null, scoreA:0, scoreB:0, winner:null, status:'pending', notes:'' });
  }
  for (let r = 2; r <= rounds; r++) {
    const cnt = sz / Math.pow(2, r);
    for (let i = 0; i < cnt; i++) { state.matches.push({ id:mid++, round:r, matchIndex:i, teamA:null, teamB:null, scoreA:0, scoreB:0, winner:null, status:'pending', notes:'' }); }
  }
  saveState();
  renderBracket();
}

// ─── Dynamic bracket sizing ───────────────────────────────────
function getBracketScale(n) {
  const tiers = [
    [4,  260,130,10,14,0.95,1.35,0.78,22,18],
    [8,  210,108, 8,12,0.82,1.15,0.70,16,14],
    [16, 186, 96, 6,10,0.74,1.05,0.62,12,12],
    [32, 160, 82, 5, 8,0.66,0.92,0.56,10,10],
  ];
  const tier = tiers.find(t => n <= t[0]) || tiers[tiers.length-1];
  return { cardW:tier[1], cardH:tier[2], slotPadV:tier[3], slotPadH:tier[4], nameFontSize:tier[5], scoreFontSize:tier[6], seedFontSize:tier[7], baseGap:tier[8], marginX:tier[9] };
}

// ─── Bracket Rendering ────────────────────────────────────────
function renderBracket() {
  const board  = document.getElementById('bracket-board');
  const empty  = document.getElementById('bracket-empty');
  const scroll = document.getElementById('bracket-scroll');
  const meta   = document.getElementById('tournament-meta');
  meta.textContent = state.settings.name + (state.settings.date ? '  •  '+state.settings.date : '') + (state.settings.location ? '  •  '+state.settings.location : '');

  if (!state.teams.length || !state.matches.length) {
    empty.style.display = 'block'; scroll.style.display = 'none'; return;
  }
  empty.style.display = 'none'; scroll.style.display = 'block';

  const rounds = getMaxRound(), roundNames = getRoundNames(rounds);
  const scale  = getBracketScale(state.teams.length);
  board.innerHTML = '';

  for (let r = 1; r <= rounds; r++) {
    const mult = Math.pow(2, r-1), gap = mult * scale.baseGap;
    const roundDiv  = document.createElement('div'); roundDiv.className = 'bracket-round';
    const label     = document.createElement('div'); label.className = 'round-label'; label.textContent = roundNames[r-1]||'ROUND '+r;
    const matchesDiv = document.createElement('div'); matchesDiv.className = 'round-matches'; matchesDiv.style.gap = gap+'px';
    if (r > 1) matchesDiv.style.paddingTop = ((mult-1)*(scale.cardH/2+scale.baseGap/2))+'px';
    roundDiv.appendChild(label);
    state.matches.filter(m => m.round===r).forEach(m => matchesDiv.appendChild(buildMatchCard(m, scale)));
    roundDiv.appendChild(matchesDiv);
    board.appendChild(roundDiv);
    if (r < rounds) { const conn = document.createElement('div'); conn.className = 'bracket-connector'; board.appendChild(conn); }
  }
}

function buildMatchCard(match, scale) {
  scale = scale || getBracketScale(state.teams.length);
  const card = document.createElement('div');
  card.className = 'match-card' + (match.winner ? ' completed' : '');
  card.onclick = () => openGame(match.id);
  card.style.width = scale.cardW+'px';
  card.style.margin = '5px '+scale.marginX+'px';
  card.appendChild(buildSlot(getTeamById(match.teamA), match.scoreA, match.winner===match.teamA, scale));
  card.appendChild(buildSlot(getTeamById(match.teamB), match.scoreB, match.winner===match.teamB, scale));
  let txt = 'Click to score', cls = '';
  if (!match.teamA && !match.teamB) txt = 'Awaiting teams';
  if (match.status==='live')  { txt='🔴 LIVE'; cls='live'; }
  if (match.winner)           { txt='✓ Complete'; cls='done'; }
  const bar = document.createElement('div'); bar.className='match-status-bar '+cls; bar.textContent=txt; bar.style.fontSize=scale.seedFontSize*0.85+'rem';
  card.appendChild(bar);
  return card;
}

function buildSlot(team, score, isWinner, scale) {
  scale = scale || getBracketScale(state.teams.length);
  const slot = document.createElement('div');
  slot.className = 'match-slot'+(isWinner?' winner':'')+(! team?' empty':'');
  slot.style.padding = scale.slotPadV+'px '+scale.slotPadH+'px';
  slot.style.gap = Math.max(4,scale.slotPadH*0.4)+'px';
  if (team) {
    const seed=el('span','slot-seed','#'+(team.seed||'?')); seed.style.fontSize=scale.seedFontSize+'rem';
    const emo=el('span','slot-emoji',team.emoji||'🐔'); emo.style.fontSize=scale.nameFontSize+'rem';
    const nm=el('span','slot-name',team.name); nm.style.fontSize=scale.nameFontSize+'rem';
    const sc=el('span','slot-score'+(isWinner?' winner-score':''),String(score??0)); sc.style.fontSize=scale.scoreFontSize+'rem';
    slot.append(seed,emo,nm,sc);
  } else {
    const tbd=el('span','slot-name tbd','TBD'); tbd.style.fontSize=scale.nameFontSize+'rem'; slot.appendChild(tbd);
  }
  return slot;
}

function el(tag, cls, text) { const e=document.createElement(tag); e.className=cls; e.textContent=text; return e; }

// ─── Team Management ──────────────────────────────────────────
function getTeamById(id) { return state.teams.find(t => t.id===id)||null; }

function openAddTeamModal() {
  if (state.teams.length >= state.settings.numTeams) { showToast('Max '+state.settings.numTeams+' teams. Increase in Settings.','error'); return; }
  ['new-team-name','new-team-seed','new-team-emoji'].forEach(id => document.getElementById(id).value='');
  openModal('modal-add-team');
  setTimeout(() => document.getElementById('new-team-name').focus(), 120);
}

function addTeam() {
  const name = document.getElementById('new-team-name').value.trim();
  if (!name) { showToast('Please enter a team name!','error'); return; }
  if (state.teams.length >= state.settings.numTeams) { showToast('Max '+state.settings.numTeams+' teams!','error'); return; }
  const seedIn = parseInt(document.getElementById('new-team-seed').value);
  const seed   = isNaN(seedIn) ? state.teams.length+1 : seedIn;
  const emoji  = document.getElementById('new-team-emoji').value.trim() || randomBird();
  snapshot();
  state.teams.push({ id:'team_'+Date.now(), name, seed, emoji });
  renumber();
  saveState();
  buildBracket();
  closeModal('modal-add-team');
  showToast('🐔 '+name+' added!','success');
  renderRoster();
}

function deleteTeam(id) {
  snapshot();
  state.teams = state.teams.filter(t => t.id!==id);
  delete state.checkins[id];
  renumber();
  saveState();
  buildBracket();
  renderRoster();
  showToast('Team removed.','info');
}

function renumber() {
  state.teams.sort((a,b) => (a.seed||999)-(b.seed||999));
  state.teams.forEach((t,i) => { t.seed=i+1; });
}

function randomBird() { return ['🐔','🐓','🦃','🐣','🦊','🐸','🐰','🐷','🐮','🦁'][Math.floor(Math.random()*10)]; }

// ─── Settings ─────────────────────────────────────────────────
function renderSettings() {
  document.getElementById('setting-name').value     = state.settings.name     || '';
  document.getElementById('setting-teams').value    = state.settings.numTeams || 8;
  document.getElementById('setting-date').value     = state.settings.date     || '';
  document.getElementById('setting-location').value = state.settings.location || '';
  document.getElementById('setting-timer').value    = state.settings.timerSecs || 0;
  renderRoster();
}

function saveSettings() {
  state.settings.name      = document.getElementById('setting-name').value.trim()||'Crossy Road Cup';
  state.settings.numTeams  = parseInt(document.getElementById('setting-teams').value)||8;
  state.settings.date      = document.getElementById('setting-date').value;
  state.settings.location  = document.getElementById('setting-location').value.trim();
  state.settings.timerSecs = parseInt(document.getElementById('setting-timer').value)||0;
  if (state.teams.length > state.settings.numTeams) {
    state.teams = state.teams.slice(0, state.settings.numTeams); renumber();
    showToast('Teams trimmed to '+state.settings.numTeams+'.','info');
  }
  saveState(); buildBracket();
  const msg = document.getElementById('settings-saved-msg');
  msg.classList.remove('hidden'); setTimeout(() => msg.classList.add('hidden'),3000);
  showToast('Settings saved!','success');
}

function renderRoster() {
  const list = document.getElementById('team-roster-list');
  if (!state.teams.length) { list.innerHTML='<p style="color:var(--text-tertiary);font-size:.85rem;margin-bottom:1rem;">No teams yet.</p>'; return; }
  const sorted = [...state.teams].sort((a,b)=>(a.seed||999)-(b.seed||999));
  list.innerHTML = sorted.map(t => `
    <div class="roster-item" draggable="true" data-id="${t.id}"
         ondragstart="dragStart(event,'${t.id}')" ondragover="dragOver(event)" ondrop="dropTeam(event,'${t.id}')">
      <span class="roster-drag-handle">⠿</span>
      <span class="roster-seed">#${t.seed}</span>
      <span class="roster-emoji">${t.emoji||'🐔'}</span>
      <span class="roster-name">${escHtml(t.name)}</span>
      <span class="roster-checkin ${state.checkins[t.id]?'in':'out'}">${state.checkins[t.id]?'✓ In':'–'}</span>
      <button class="roster-delete" onclick="deleteTeam('${t.id}')" title="Remove">✕</button>
    </div>`).join('');
}

// ─── Drag & Drop ──────────────────────────────────────────────
let draggedId = null;
function dragStart(e,id){ draggedId=id; e.dataTransfer.effectAllowed='move'; setTimeout(()=>e.target.classList.add('dragging'),0); }
function dragOver(e){ e.preventDefault(); e.dataTransfer.dropEffect='move'; }
function dropTeam(e,targetId){
  e.preventDefault(); if(!draggedId||draggedId===targetId) return;
  const fi=state.teams.findIndex(t=>t.id===draggedId), ti=state.teams.findIndex(t=>t.id===targetId);
  if(fi<0||ti<0) return;
  const [moved]=state.teams.splice(fi,1); state.teams.splice(ti,0,moved); renumber();
  draggedId=null; saveState(); buildBracket(); renderRoster();
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
    if (!timerRunning) return;
    timerRemaining = Math.max(0, timerRemaining-1);
    updateTimerDisplay();
    if (timerRemaining <= 10 && timerRemaining > 0) playSound('tick');
    if (timerRemaining === 0) { clearInterval(timerInterval); timerRunning=false; playSound('buzzer'); showToast('⏰ Time is up!','error'); }
  }, 1000);
}
function pauseTimer() { timerRunning=false; clearInterval(timerInterval); }
function resetTimer() {
  pauseTimer();
  timerRemaining = state.settings.timerSecs || 0;
  updateTimerDisplay();
}
function updateTimerDisplay() {
  const m = Math.floor(timerRemaining/60), s = timerRemaining%60;
  const disp = document.getElementById('match-timer-display');
  disp.textContent = m+':'+(s<10?'0':'')+s;
  disp.className = 'match-timer-display';
  if (timerRemaining <= 10 && timerRemaining > 0) disp.classList.add('warning');
  if (timerRemaining === 0) disp.classList.add('expired');
}

// ─── Game Page ────────────────────────────────────────────────
function openGame(matchId) {
  const match = state.matches.find(m => m.id===matchId); if(!match) return;
  state.currentMatchId = matchId;
  const tA=getTeamById(match.teamA), tB=getTeamById(match.teamB);
  const roundNames=getRoundNames(getMaxRound());
  document.getElementById('game-page-title').textContent  = roundNames[match.round-1]||'MATCH';
  document.getElementById('game-round-badge').textContent = 'Match '+(match.matchIndex+1);
  document.getElementById('score-name-a').textContent = tA?.name||'TBD';
  document.getElementById('score-name-b').textContent = tB?.name||'TBD';
  document.getElementById('rank-a').textContent = tA?'Seed #'+tA.seed:'';
  document.getElementById('rank-b').textContent = tB?'Seed #'+tB.seed:'';
  document.getElementById('score-val-a').textContent = match.scoreA??0;
  document.getElementById('score-val-b').textContent = match.scoreB??0;
  document.getElementById('entry-label-a').textContent = tA?.name||'Team A';
  document.getElementById('entry-label-b').textContent = tB?.name||'Team B';
  document.getElementById('entry-pts-a').value = '0';
  document.getElementById('entry-pts-b').value = '0';
  document.getElementById('match-notes').value = match.notes||'';
  document.getElementById('modal-winner-a').textContent = (tA?.emoji||'🐔')+' '+(tA?.name||'Team A');
  document.getElementById('modal-winner-b').textContent = (tB?.emoji||'🐔')+' '+(tB?.name||'Team B');
  initTimer(state.settings.timerSecs||0);
  updateScorePanels(match); updateWinnerBanner(match);
  showPage('game');
}

function updateScorePanels(match) {
  const sa=match.scoreA??0, sb=match.scoreB??0;
  document.getElementById('score-panel-a').classList.toggle('winning',sa>sb&&!match.winner);
  document.getElementById('score-panel-b').classList.toggle('winning',sb>sa&&!match.winner);
}
function updateWinnerBanner(match) {
  const banner=document.getElementById('winner-banner');
  if(match.winner){ const t=getTeamById(match.winner); document.getElementById('winner-name').textContent=(t?.emoji||'🐔')+' '+(t?.name||'Winner'); banner.classList.remove('hidden'); }
  else banner.classList.add('hidden');
}

function confirmScoreEntry() {
  const match=state.matches.find(m=>m.id===state.currentMatchId); if(!match) return;
  const addA=parseInt(document.getElementById('entry-pts-a').value)||0;
  const addB=parseInt(document.getElementById('entry-pts-b').value)||0;
  if(addA===0&&addB===0){ showToast('Enter at least 1 point!','error'); return; }
  snapshot();
  match.scoreA=(match.scoreA||0)+addA;
  match.scoreB=(match.scoreB||0)+addB;
  match.status='live';
  document.getElementById('score-val-a').textContent=match.scoreA;
  document.getElementById('score-val-b').textContent=match.scoreB;
  if(addA>0) bumpScore('score-val-a');
  if(addB>0) bumpScore('score-val-b');
  document.getElementById('entry-pts-a').value='0';
  document.getElementById('entry-pts-b').value='0';
  updateScorePanels(match); saveState(); playSound('point');
  showToast('Points added!','success');
}

function bumpScore(id){ const e=document.getElementById(id); e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump'); }
function clearScoreEntry(){ document.getElementById('entry-pts-a').value='0'; document.getElementById('entry-pts-b').value='0'; }

function resetGameScore() {
  const match=state.matches.find(m=>m.id===state.currentMatchId); if(!match) return;
  snapshot();
  match.scoreA=0; match.scoreB=0; match.winner=null; match.status='pending';
  document.getElementById('score-val-a').textContent=0;
  document.getElementById('score-val-b').textContent=0;
  updateScorePanels(match); updateWinnerBanner(match);
  saveState(); showToast('Score reset.','info');
}

function saveMatchNotes() {
  const match=state.matches.find(m=>m.id===state.currentMatchId); if(!match) return;
  match.notes=document.getElementById('match-notes').value.trim();
  saveState(); showToast('Notes saved.','success');
}

function setWinnerManually() { openModal('modal-winner'); }

function declareWinner(side) {
  const match=state.matches.find(m=>m.id===state.currentMatchId); if(!match) return;
  const winnerId=side==='a'?match.teamA:match.teamB;
  if(!winnerId){ showToast('No team in that slot!','error'); closeModal('modal-winner'); return; }
  snapshot();
  match.winner=winnerId; match.status='done';
  closeModal('modal-winner');

  // Record history
  const tA=getTeamById(match.teamA), tB=getTeamById(match.teamB), tW=getTeamById(winnerId);
  const roundNames=getRoundNames(getMaxRound());
  state.history.push({
    id:'hist_'+Date.now(), round:match.round, roundName:roundNames[match.round-1]||'Round '+match.round,
    teamA:tA?.name||'TBD', teamB:tB?.name||'TBD',
    emojiA:tA?.emoji||'🐔', emojiB:tB?.emoji||'🐔',
    scoreA:match.scoreA||0, scoreB:match.scoreB||0,
    winnerId, winnerName:tW?.name||'?', winnerEmoji:tW?.emoji||'🐔',
    timestamp:new Date().toISOString(), notes:match.notes||''
  });

  advanceWinner(match); updateWinnerBanner(match); saveState();
  pauseTimer();
  playSound('win'); triggerConfetti();
  showToast('🏆 '+(tW?.name||'Winner')+' advances!','success');
  renderBracket();
}

function advanceWinner(match) {
  const next=state.matches.find(m=>m.round===match.round+1&&m.matchIndex===Math.floor(match.matchIndex/2));
  if(next) next[match.matchIndex%2===0?'teamA':'teamB']=match.winner;
}

// ─── Leaderboard ──────────────────────────────────────────────
function renderLeaderboard() {
  const el = document.getElementById('leaderboard-content');
  if (!state.teams.length) { el.innerHTML='<div class="empty-state"><div class="empty-bird" style="font-size:3rem">📊</div><h3>No data yet</h3><p>Complete some matches to see stats.</p></div>'; return; }

  // Build stats from history
  const stats = {};
  state.teams.forEach(t => { stats[t.id]={ name:t.name, emoji:t.emoji||'🐔', seed:t.seed, wins:0, losses:0, ptsFor:0, ptsAgainst:0, matches:0 }; });
  state.history.forEach(h => {
    const aId = state.teams.find(t=>t.name===h.teamA)?.id;
    const bId = state.teams.find(t=>t.name===h.teamB)?.id;
    if(aId&&stats[aId]){ stats[aId].ptsFor+=h.scoreA; stats[aId].ptsAgainst+=h.scoreB; stats[aId].matches++; if(h.winnerId===aId) stats[aId].wins++; else stats[aId].losses++; }
    if(bId&&stats[bId]){ stats[bId].ptsFor+=h.scoreB; stats[bId].ptsAgainst+=h.scoreA; stats[bId].matches++; if(h.winnerId===bId) stats[bId].wins++; else stats[bId].losses++; }
  });

  const sorted = Object.values(stats).sort((a,b)=>b.wins-a.wins||a.losses-b.losses||(b.ptsFor-b.ptsAgainst)-(a.ptsFor-a.ptsAgainst));
  const rankClass = i => i===0?'gold':i===1?'silver':i===2?'bronze':'';
  const rankLabel = i => i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1);

  el.innerHTML = `
    <div class="glass-card">
      <h3 class="card-title">All-Time Standings</h3>
      <div class="lb-header">
        <span></span><span>Team</span><span style="text-align:center">W</span><span style="text-align:center">L</span><span style="text-align:center">PTS</span><span style="text-align:center">+/-</span>
      </div>
      ${sorted.map((s,i)=>`
        <div class="lb-row ${rankClass(i)}">
          <div class="lb-rank ${rankClass(i)+'-text'}">${rankLabel(i)}</div>
          <div class="lb-team">${s.emoji} ${escHtml(s.name)}</div>
          <div class="lb-stat"><div class="lb-stat-val">${s.wins}</div><div class="lb-stat-label">Wins</div></div>
          <div class="lb-stat"><div class="lb-stat-val">${s.losses}</div><div class="lb-stat-label">Loss</div></div>
          <div class="lb-stat"><div class="lb-stat-val">${s.ptsFor}</div><div class="lb-stat-label">For</div></div>
          <div class="lb-stat"><div class="lb-stat-val" style="color:${s.ptsFor-s.ptsAgainst>=0?'var(--green-400)':'var(--red-400)'}">${s.ptsFor-s.ptsAgainst>=0?'+':''}${s.ptsFor-s.ptsAgainst}</div><div class="lb-stat-label">Diff</div></div>
        </div>`).join('')}
    </div>`;
}

// ─── Match History ────────────────────────────────────────────
function renderHistory() {
  const el = document.getElementById('history-content');
  if (!state.history.length) { el.innerHTML='<div class="empty-state"><div style="font-size:3rem">📋</div><h3>No matches played yet</h3></div>'; return; }
  const rev = [...state.history].reverse();
  el.innerHTML = `<div class="glass-card"><h3 class="card-title">Match Log (${state.history.length} matches)</h3>` +
    rev.map(h=>{
      const dt = new Date(h.timestamp);
      const timeStr = isNaN(dt)?'':dt.toLocaleDateString()+' '+dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
      return `<div class="history-item">
        <div class="history-round">${h.roundName}</div>
        <div class="history-teams">${h.emojiA||'🐔'} ${escHtml(h.teamA)} vs ${h.emojiB||'🐔'} ${escHtml(h.teamB)}</div>
        <div class="history-score">${h.scoreA} — ${h.scoreB}</div>
        <div class="history-winner">🏆 ${h.winnerEmoji||'🐔'} ${escHtml(h.winnerName)}</div>
        <div class="history-time">${timeStr}</div>
        ${h.notes?`<div class="history-note">📝 ${escHtml(h.notes)}</div>`:''}
      </div>`;
    }).join('')+'</div>';
}

// ─── Spectator / TV Mode ──────────────────────────────────────
function enterSpectatorMode() {
  spectatorMode = true;
  const ov = document.getElementById('spectator-overlay');
  ov.classList.remove('hidden');
  renderSpectatorBracket();
  renderTicker();
  // Keep refreshing while in spectator mode
  setInterval(() => { if(spectatorMode){ renderSpectatorBracket(); renderTicker(); } }, 5000);
}
function exitSpectatorMode() {
  spectatorMode = false;
  document.getElementById('spectator-overlay').classList.add('hidden');
}
function renderSpectatorBracket() {
  const board = document.getElementById('spec-bracket');
  if (!state.matches.length) { board.innerHTML='<p style="color:var(--text-secondary);text-align:center;padding:3rem">No bracket yet</p>'; return; }
  const rounds=getMaxRound(), roundNames=getRoundNames(rounds);
  const scale=getBracketScale(state.teams.length);
  board.innerHTML='';
  const wrap=document.createElement('div'); wrap.style.cssText='display:flex;align-items:flex-start;gap:0;';
  for(let r=1;r<=rounds;r++){
    const mult=Math.pow(2,r-1), gap=mult*scale.baseGap;
    const rd=document.createElement('div'); rd.className='bracket-round';
    const lbl=document.createElement('div'); lbl.className='round-label'; lbl.textContent=roundNames[r-1]||'ROUND '+r;
    const md=document.createElement('div'); md.className='round-matches'; md.style.gap=gap+'px';
    if(r>1) md.style.paddingTop=((mult-1)*(scale.cardH/2+scale.baseGap/2))+'px';
    state.matches.filter(m=>m.round===r).forEach(m=>md.appendChild(buildMatchCard(m,scale)));
    rd.append(lbl,md); wrap.appendChild(rd);
    if(r<rounds){const c=document.createElement('div');c.className='bracket-connector';wrap.appendChild(c);}
  }
  board.appendChild(wrap);
}
function renderTicker() {
  const ticker = document.getElementById('spec-ticker');
  const recentWins = state.history.slice(-5).map(h=>`🏆 ${h.winnerEmoji} ${h.winnerName} defeated ${h.teamA=== h.winnerName?h.teamB:h.teamA} (${h.scoreA}–${h.scoreB})`).join('   ·   ');
  const liveMatches = state.matches.filter(m=>m.status==='live').map(m=>{ const tA=getTeamById(m.teamA),tB=getTeamById(m.teamB); return `🔴 LIVE: ${tA?.name||'?'} ${m.scoreA}–${m.scoreB} ${tB?.name||'?'}`; }).join('   ·   ');
  const text = (liveMatches||recentWins||state.settings.name+' — '+state.settings.date) + '   ·   ';
  ticker.innerHTML=`<span class="spec-ticker-inner">${escHtml(text)}</span>`;
}

// ─── Print Bracket ────────────────────────────────────────────
function printBracket() { window.print(); }

// ─── Reset ────────────────────────────────────────────────────
function confirmReset() { openModal('modal-reset'); }
function resetTournament() {
  snapshot();
  state.teams=[]; state.matches=[]; state.history=[]; state.checkins={};
  saveState(); closeModal('modal-reset'); renderAll(); showPage('home');
  showToast('Tournament reset!','info');
}

// ─── Modals ───────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
document.addEventListener('click', e => { if(e.target.classList.contains('modal-overlay')) e.target.classList.add('hidden'); });
document.addEventListener('keydown', e => {
  if(e.key==='Enter'&&!document.getElementById('modal-add-team').classList.contains('hidden')) addTeam();
  if(e.key==='Escape') document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m=>m.classList.add('hidden'));
});

// ─── Sound Effects ────────────────────────────────────────────
const audioCtx = window.AudioContext ? new AudioContext() : null;
function initSounds() { /* AudioContext created lazily on first user gesture */ }

function playSound(type) {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;

    if (type === 'point') {
      osc.frequency.setValueAtTime(440, t);
      osc.frequency.exponentialRampToValueAtTime(880, t+0.1);
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t+0.2);
      osc.start(t); osc.stop(t+0.2);
    } else if (type === 'win') {
      osc.type = 'square';
      [523,659,784,1047].forEach((f,i) => {
        osc.frequency.setValueAtTime(f, t+i*0.1);
      });
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t+0.5);
      osc.start(t); osc.stop(t+0.5);
    } else if (type === 'tick') {
      osc.frequency.setValueAtTime(1000, t);
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t+0.05);
      osc.start(t); osc.stop(t+0.05);
    } else if (type === 'buzzer') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(200, t);
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t+0.6);
      osc.start(t); osc.stop(t+0.6);
    }
  } catch(e) {}
}

// ─── Confetti ─────────────────────────────────────────────────
function triggerConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  const ctx    = canvas.getContext('2d');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const pieces = Array.from({length:120}, () => ({
    x: Math.random()*canvas.width, y: -10,
    r: 4+Math.random()*6,
    d: 20+Math.random()*40,
    color: ['#f97316','#3b72f5','#fbbf24','#4ade80','#f472b6','#a78bfa'][Math.floor(Math.random()*6)],
    tilt: Math.random()*10-10, tiltAngle:0, tiltSpeed:0.1+Math.random()*0.3
  }));
  let frame=0;
  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    pieces.forEach(p=>{
      ctx.beginPath(); ctx.lineWidth=p.r;
      ctx.strokeStyle=p.color;
      ctx.moveTo(p.x+p.tilt+p.r/3, p.y);
      ctx.lineTo(p.x+p.tilt, p.y+p.tilt+p.r/5);
      ctx.stroke();
      p.tiltAngle+=p.tiltSpeed; p.y+=3+Math.cos(frame*0.01)*2;
      p.x+=Math.sin(frame*0.02)*1.5; p.tilt=Math.sin(p.tiltAngle)*15;
    });
    frame++;
    if(frame<180) requestAnimationFrame(draw);
    else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  draw();
}

// ─── Toast ────────────────────────────────────────────────────
function showToast(msg, type='info') {
  const tc=document.getElementById('toast-container');
  const t=document.createElement('div'); t.className='toast '+type; t.textContent=msg;
  tc.appendChild(t); setTimeout(()=>t.remove(),2900);
}

// ─── Helpers ──────────────────────────────────────────────────
function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
