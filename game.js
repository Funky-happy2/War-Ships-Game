// SALVO — v0.4 (auth + browser multiplayer)
// Adds: local profile auth, peer-to-peer multiplayer via PeerJS, myTeam refactor.
// Caveats:
//   - Auth is local-only. Anyone with dev tools can read stored data.
//   - MP uses PeerJS's free public broker. Not bulletproof.
//   - In MP, upgrades are disabled for fairness (host can't know client's purchases).
//   - Host runs authoritative simulation. Client renders host state + sends inputs.

// ===== Config =====
const MAP_W = 1100, MAP_H = 700;
const CAPTURE_RADIUS = 50;
const CAPTURE_TIME = 10;
const CAPTURE_DECAY = 20;
const RESOURCE_START = 100;
const RESOURCE_BASE = 1.0;
const RESOURCE_PER_POINT = 0.6;

const WIN_HOLD_TARGET = 8;   // total strategic points on the map
const WIN_HOLD_TIME = 4;      // seconds you must hold all of them
const CAPTURE_TIME_MAJOR = 15; // longer to capture for valuable points

const STARTING_CREDITS = 100;
const CREDITS_WIN = 80;
const CREDITS_LOSS = 30;
const USERS_KEY = 'salvo_users';
const CURRENT_USER_KEY = 'salvo_current_user';

const UNIT_TYPES = {
  infantry:  { cost: 50,  hp: 60,  atk: 10, speed: 55, vision: 170, range: 32,  atkCd: 1.1, canCapture: ['land'],             icon: 'I', label: 'INFANTRY',  role: 'cheap line trooper' },
  sniper:    { cost: 75,  hp: 40,  atk: 18, speed: 50, vision: 250, range: 90,  atkCd: 2.5, canCapture: ['land'],             icon: 'S', label: 'SNIPER',    role: 'long-range, fragile' },
  tank:      { cost: 110, hp: 170, atk: 22, speed: 35, vision: 160, range: 40,  atkCd: 1.6, canCapture: ['land'],             icon: 'T', label: 'TANK',      role: 'tough land bruiser' },
  gunboat:   { cost: 80,  hp: 100, atk: 16, speed: 42, vision: 200, range: 50,  atkCd: 1.6, canCapture: ['sea'],              icon: 'G', label: 'GUNBOAT',   role: 'basic sea fighter' },
  destroyer: { cost: 140, hp: 160, atk: 26, speed: 38, vision: 220, range: 65,  atkCd: 1.8, canCapture: ['sea'],              icon: 'D', label: 'DESTROYER', role: 'heavy long-range sea' },
  fighter:   { cost: 120, hp: 50,  atk: 24, speed: 92, vision: 240, range: 38,  atkCd: 1.0, canCapture: ['land','sea','air'], icon: 'F', label: 'FIGHTER',   role: 'fast, captures any terrain' },
  bomber:    { cost: 180, hp: 70,  atk: 40, speed: 72, vision: 220, range: 55,  atkCd: 2.5, canCapture: ['land','sea','air'], icon: 'B', label: 'BOMBER',    role: 'huge alpha damage' },
  artillery: { cost: 160, hp: 75,  atk: 30, speed: 28, vision: 230, range: 110, atkCd: 2.8, canCapture: ['land'],             icon: 'A', label: 'ARTILLERY', role: 'longest range, slow', locked: true, unlockCost: 300 },
  submarine: { cost: 130, hp: 60,  atk: 32, speed: 55, vision: 200, range: 32,  atkCd: 1.4, canCapture: ['sea'],              icon: 'U', label: 'SUBMARINE', role: 'fast melee sea',     locked: true, unlockCost: 350 },
};

const ABILITIES = {
  airstrike: { cd: 30, radius: 85,  damage: 35, needsTarget: true,  name: 'AIRSTRIKE' },
  reinforce: { cd: 25,                          needsTarget: false, name: 'REINFORCE' },
  recon:     { cd: 20, radius: 220, duration: 8, needsTarget: true, name: 'RECON' },
};

const BUILDINGS = {
  barracks: { cost: 100, time: 20, key: 'B', hp: 220, desc: 'land cost -30% · spawns infantry · shoots' },
  shipyard: { cost: 130, time: 25, key: 'Y', hp: 260, desc: 'sea cost -30% · spawns gunboat · shoots' },
  airbase:  { cost: 160, time: 30, key: 'A', hp: 200, desc: 'air cost -30% · spawns fighter · shoots' },
  depot:    { cost: 150, time: 25, key: 'S', hp: 300, desc: '+0.5 supply / sec' },
};
// Defense towers — buildings auto-attack nearby enemies (depot doesn't)
const BUILDING_DEFENSE = {
  barracks: { range: 95,  atk: 12, atkCd: 1.5 },
  shipyard: { range: 110, atk: 14, atkCd: 1.7 },
  airbase:  { range: 90,  atk: 14, atkCd: 1.3 },
};
// Production — completed building spawns a unit on this interval
const BUILDING_PRODUCTION = {
  barracks: { unit: 'infantry', interval: 30 },
  shipyard: { unit: 'gunboat',  interval: 40 },
  airbase:  { unit: 'fighter',  interval: 55 },
};

const SKINS = {
  default: { name: 'Default', cost: 0,   primary: '#38bdf8', halo: 'rgba(56, 189, 248, 0.22)' },
  gold:    { name: 'Gold',    cost: 200, primary: '#fcd34d', halo: 'rgba(252, 211, 77, 0.22)' },
  forest:  { name: 'Forest',  cost: 250, primary: '#4ade80', halo: 'rgba(74, 222, 128, 0.22)' },
  ember:   { name: 'Ember',   cost: 300, primary: '#fb923c', halo: 'rgba(251, 146, 60, 0.22)' },
  steel:   { name: 'Steel',   cost: 350, primary: '#a8a29e', halo: 'rgba(168, 162, 158, 0.22)' },
  crimson: { name: 'Crimson', cost: 400, primary: '#dc2626', halo: 'rgba(220, 38, 38, 0.22)' },
  ocean:   { name: 'Ocean',   cost: 450, primary: '#06b6d4', halo: 'rgba(6, 182, 212, 0.22)' },
};

const UPGRADES = {
  vets:          { name: 'Veteran Training',  cost: 200, desc: 'infantry +20% HP & damage' },
  long_guns:     { name: 'Long Guns',         cost: 250, desc: 'all units +15% attack range' },
  quartermaster: { name: 'Quartermaster',     cost: 300, desc: '+0.5 base supply / sec' },
  medics:        { name: 'Field Medics',      cost: 400, desc: 'units regenerate 1 hp / sec' },
  engineers:     { name: 'Engineering Corps', cost: 350, desc: 'buildings construct 30% faster' },
  armor:         { name: 'Reinforced Armor',  cost: 450, desc: 'all units +15% max HP' },
  radar:         { name: 'Advanced Radar',    cost: 500, desc: 'all units +20% vision range' },
};

// 3 land · 2 air · 3 sea · 2 are MAJOR (worth 2× supply, 15s capture, gold star)
const STRAT_POINTS = [
  { id: 'west-town',   x: 140, y: 480, type: 'land', name: 'West Town' },
  { id: 'forest',      x: 290, y: 210, type: 'land', name: 'Forest', major: true },
  { id: 'east-hills',  x: 940, y: 260, type: 'land', name: 'East Hills', major: true },
  { id: 'air-base',    x: 560, y: 130, type: 'air',  name: 'Air Base' },
  { id: 'sky-station', x: 840, y: 70,  type: 'air',  name: 'Sky Station' },
  { id: 'port',        x: 680, y: 380, type: 'sea',  name: 'Port' },
  { id: 'coast',       x: 440, y: 580, type: 'sea',  name: 'Coast' },
  { id: 'deep-strait', x: 400, y: 340, type: 'sea',  name: 'Deep Strait', major: true },
];
const HQ_BLUE = { id: 'hq-blue', x: 80,   y: 620, team: 'blue', name: 'Blue HQ', naval: { x: 280, y: 670 } };
const HQ_RED  = { id: 'hq-red',  x: 1020, y: 80,  team: 'red',  name: 'Red HQ',  naval: { x: 920, y: 470 } };

const DIFFICULTY = {
  easy:   { decisionInterval: 1.6, abilityInterval: 14, maxUnits: 6,  deployChance: 0.55, abilityChance: 0.35, clusterThreshold: 4, useReinforce: false, build: false },
  normal: { decisionInterval: 0.8, abilityInterval: 4,  maxUnits: 10, deployChance: 0.95, abilityChance: 0.9,  clusterThreshold: 3, useReinforce: true,  build: true  },
  hard:   { decisionInterval: 0.5, abilityInterval: 3,  maxUnits: 14, deployChance: 1.0,  abilityChance: 1.0,  clusterThreshold: 2, useReinforce: true,  build: true  },
};
const BOT_DEPLOY_WEIGHTS = {
  easy:   { infantry: 70, gunboat: 25, sniper: 5 },
  normal: { infantry: 20, sniper: 12, tank: 11, gunboat: 14, destroyer: 9, fighter: 14, bomber: 10, artillery: 5, submarine: 5 },
  hard:   { infantry: 12, sniper: 16, tank: 14, gunboat: 11, destroyer: 12, fighter: 12, bomber: 10, artillery: 7, submarine: 6 },
};
let botDifficulty = 'normal';

const TUTORIAL_STEPS = [
  { id: 'deploy',  text: 'Deploy any unit (press 1–9 or click a deploy button)' },
  { id: 'select',  text: 'Select one of your units (left-click on it)' },
  { id: 'move',    text: 'Order a unit to move (right-click on the map)' },
  { id: 'capture', text: 'Capture a strategic point (move a unit onto one)' },
  { id: 'ability', text: 'Use a commander ability (Q, E, or R)' },
  { id: 'build',   text: 'Construct a building (B / Y / A / S)' },
];
let tutorial = { active: false, doneSet: new Set(), currentIdx: 0 };

// ===== State =====
let scene = 'auth';
let myTeam = 'blue';   // 'blue' in SP and MP host, 'red' in MP client
let units = [];
let nextUnitId = 1;
let buildings = [];
let nextBuildingId = 1;
let selectedIds = new Set();
let pointOwner = {};
let pointProgress = {};
let resources = { blue: RESOURCE_START, red: RESOURCE_START };
let cooldowns = {
  blue: { airstrike: 0, reinforce: 0, recon: 0 },
  red:  { airstrike: 0, reinforce: 0, recon: 0 },
};
let reconZones = [];
let strikes = [];
let floats = [];
let holdTimer = { blue: 0, red: 0 };
let matchEnded = false;
let matchStart = 0;
let lastTime = 0;
let paused = false;

let ability = { active: null };
const keys = Object.create(null);
const mouse = { x: 0, y: 0 };
let botDecisionTimer = 0;
let botAbilityTimer = 5;
let botBuildTimer = 8;
let regenTimer = 0;

let currentUser = null;
let saveData = { credits: STARTING_CREDITS, skin: 'default', skins: ['default'], upgrades: [], unlocks: [] };

let mp = { enabled: false, isHost: false, peer: null, conn: null, code: null, syncTimer: 0 };

let fogCanvas = null;
function ensureFogCanvas() {
  if (!fogCanvas) { fogCanvas = document.createElement('canvas'); fogCanvas.width = MAP_W; fogCanvas.height = MAP_H; }
}

// ===== Auth =====
async function hashPassword(plain) {
  const data = new TextEncoder().encode(plain);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleAuth() {
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!username || !password) return setAuthMsg('callsign and password required');
  if (username.length < 2 || username.length > 20) return setAuthMsg('callsign 2–20 chars');
  if (password.length < 4) return setAuthMsg('password at least 4 chars');
  const hash = await hashPassword(password);
  let users = {};
  try { users = JSON.parse(localStorage.getItem(USERS_KEY) || '{}'); } catch (e) {}
  if (users[username]) {
    if (users[username].passHash !== hash) return setAuthMsg('wrong password');
  } else {
    users[username] = { passHash: hash, credits: STARTING_CREDITS, skin: 'default', skins: ['default'], upgrades: [], unlocks: [] };
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
    setAuthMsg(`callsign ${username} registered`, true);
  }
  currentUser = username;
  localStorage.setItem(CURRENT_USER_KEY, username);
  loadSaveData();
  showAccountWidget();
  setAuthMsg('');
  document.getElementById('auth-password').value = '';
  showScene('lobby');
}

function setAuthMsg(text, ok = false) {
  const el = document.getElementById('auth-message');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('ok', !!ok);
}

function showAccountWidget() {
  const w = document.getElementById('account-widget');
  if (!w) return;
  w.classList.remove('hidden');
  document.getElementById('account-name').textContent = currentUser || '—';
}
function hideAccountWidget() {
  const w = document.getElementById('account-widget');
  if (w) w.classList.add('hidden');
}

function logout() {
  if (mp.enabled) cleanupMp();
  currentUser = null;
  localStorage.removeItem(CURRENT_USER_KEY);
  saveData = { credits: STARTING_CREDITS, skin: 'default', skins: ['default'], upgrades: [], unlocks: [] };
  hideAccountWidget();
  showScene('auth');
}

function loadSaveData() {
  if (!currentUser) {
    saveData = { credits: STARTING_CREDITS, skin: 'default', skins: ['default'], upgrades: [], unlocks: [] };
    return;
  }
  try {
    const users = JSON.parse(localStorage.getItem(USERS_KEY) || '{}');
    const u = users[currentUser];
    if (!u) return;
    saveData = {
      credits: u.credits ?? STARTING_CREDITS,
      skin: u.skin || 'default',
      skins: Array.isArray(u.skins) ? u.skins : ['default'],
      upgrades: Array.isArray(u.upgrades) ? u.upgrades : [],
      unlocks: Array.isArray(u.unlocks) ? u.unlocks : [],
    };
    if (!saveData.skins.includes(saveData.skin)) saveData.skin = 'default';
  } catch (e) {}
}
function saveSaveData() {
  if (!currentUser) return;
  try {
    const users = JSON.parse(localStorage.getItem(USERS_KEY) || '{}');
    const existing = users[currentUser] || {};
    users[currentUser] = {
      ...existing,
      credits: saveData.credits,
      skin: saveData.skin,
      skins: saveData.skins,
      upgrades: saveData.upgrades,
      unlocks: saveData.unlocks,
    };
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  } catch (e) {}
}
function hasUpgrade(id) {
  if (mp.enabled) return false;   // disabled in MP for fairness
  return saveData.upgrades.includes(id);
}
function isUnitUnlocked(type) {
  if (!UNIT_TYPES[type].locked) return true;
  return saveData.unlocks.includes(type);
}

// ===== Util =====
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickWeighted(weights) {
  const types = Object.keys(weights);
  const total = types.reduce((a, t) => a + weights[t], 0);
  let r = Math.random() * total;
  for (const t of types) { r -= weights[t]; if (r <= 0) return t; }
  return types[0];
}
function isSeaUnit(type) {
  const c = UNIT_TYPES[type].canCapture;
  return c.length === 1 && c[0] === 'sea';
}
function enemyTeam(team) { return team === 'blue' ? 'red' : 'blue'; }
function teamColor(team) {
  if (team === myTeam) return SKINS[saveData.skin].primary;
  return '#f87171';
}
function teamHalo(team) {
  if (team === myTeam) return SKINS[saveData.skin].halo;
  return 'rgba(248, 113, 113, 0.22)';
}

// ===== Scene =====
function showScene(s) {
  scene = s;
  document.getElementById('auth').classList.toggle('hidden',  s !== 'auth');
  document.getElementById('lobby').classList.toggle('hidden', s !== 'lobby');
  document.getElementById('shop').classList.toggle('hidden',  s !== 'shop');
  document.getElementById('match').classList.toggle('hidden', s !== 'match');
  document.getElementById('scene-label').textContent =
    s === 'auth' ? 'sign in' :
    s === 'shop' ? 'quartermaster' :
    s === 'lobby' ? 'command room' :
    (tutorial.active ? 'tutorial' : (mp.enabled ? 'multiplayer match' : 'in battle'));
  if (s === 'lobby') {
    document.getElementById('lobby-credits-display').textContent = `${saveData.credits} cr`;
    buildDeployButtons();
  }
  if (s === 'shop') renderShop();
}

function resetMatchState() {
  units = []; buildings = [];
  selectedIds = new Set();
  pointOwner = {};
  pointProgress = {};
  for (const p of STRAT_POINTS) pointOwner[p.id] = null;
  pointOwner[HQ_BLUE.id] = 'blue';
  pointOwner[HQ_RED.id]  = 'red';
  resources = { blue: RESOURCE_START, red: RESOURCE_START };
  cooldowns = { blue: { airstrike: 0, reinforce: 0, recon: 0 }, red: { airstrike: 0, reinforce: 0, recon: 0 } };
  reconZones = []; strikes = []; floats = [];
  holdTimer = { blue: 0, red: 0 };
  matchEnded = false; paused = false; ability.active = null;
  matchStart = performance.now();
  botDecisionTimer = 1; botAbilityTimer = 8; botBuildTimer = 10;
  regenTimer = 0;
  mp.syncTimer = 0;
}

function startMatch() {
  tutorial.active = false;
  document.getElementById('tutorial-panel').classList.add('hidden');
  myTeam = 'blue';
  resetMatchState();
  spawnUnit('blue', 'infantry', HQ_BLUE.x + 30, HQ_BLUE.y - 20);
  spawnUnit('blue', 'infantry', HQ_BLUE.x + 50, HQ_BLUE.y + 5);
  spawnUnit('blue', 'gunboat',  HQ_BLUE.naval.x, HQ_BLUE.naval.y);
  spawnUnit('red',  'infantry', HQ_RED.x - 30,  HQ_RED.y + 20);
  spawnUnit('red',  'infantry', HQ_RED.x - 50,  HQ_RED.y - 5);
  spawnUnit('red',  'gunboat',  HQ_RED.naval.x, HQ_RED.naval.y);
  removeOverlay(); hideTargeting();
  buildDeployButtons(); buildBuildButtons();
  showScene('match');
}

function startTutorial() {
  myTeam = 'blue';
  resetMatchState();
  resources.blue = 220;
  tutorial = { active: true, doneSet: new Set(), currentIdx: 0 };
  const starter = spawnUnit('blue', 'infantry', HQ_BLUE.x + 40, HQ_BLUE.y - 20, { silent: true, skipRally: true });
  if (starter) starter.target = null;
  document.getElementById('tutorial-panel').classList.remove('hidden');
  renderTutorial();
  removeOverlay(); hideTargeting();
  buildDeployButtons(); buildBuildButtons();
  showScene('match');
  pushFloat(MAP_W / 2, 90, 'training grounds — no enemy', '#fcd34d', 2.0);
}

function showGameOver(result) {
  if (matchEnded && document.querySelector('.overlay')) return;
  matchEnded = true;
  const amt = (result === 'win') ? CREDITS_WIN : CREDITS_LOSS;
  if (currentUser) {
    saveData.credits += amt;
    saveSaveData();
  }
  const ov = document.createElement('div');
  ov.className = 'overlay';
  const elapsed = Math.floor((performance.now() - matchStart) / 1000);
  const mm = Math.floor(elapsed / 60), ss = String(elapsed % 60).padStart(2,'0');
  const mpLabel = mp.enabled ? ' · multiplayer' : '';
  ov.innerHTML = `
    <h1 class="${result}">${result === 'win' ? 'VICTORY' : 'DEFEAT'}</h1>
    <p>${result === 'win' ? `total conquest achieved in ${mm}:${ss}${mpLabel}` : `enemy holds the field after ${mm}:${ss}${mpLabel}`}</p>
    <p class="credits-earned">+${amt} credits · total ${saveData.credits}</p>
    <div class="overlay-actions">
      ${mp.enabled ? '' : '<button id="btn-rematch" class="primary">rematch</button>'}
      <button id="btn-shop-overlay">visit shop</button>
      <button id="btn-tolobby">command room</button>
    </div>
  `;
  document.body.appendChild(ov);
  const rm = document.getElementById('btn-rematch');
  if (rm) rm.onclick = () => startMatch();
  document.getElementById('btn-shop-overlay').onclick = () => { if (mp.enabled) cleanupMp(); removeOverlay(); showScene('shop'); };
  document.getElementById('btn-tolobby').onclick = () => { if (mp.enabled) cleanupMp(); removeOverlay(); showScene('lobby'); };
}

function showTutorialComplete() {
  matchEnded = true;
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `
    <h1 class="win">TRAINING COMPLETE</h1>
    <p>you understand the basics — good luck commander</p>
    <div class="overlay-actions">
      <button id="btn-real-match" class="primary">deploy to battle</button>
      <button id="btn-tolobby">command room</button>
    </div>
  `;
  document.body.appendChild(ov);
  document.getElementById('btn-real-match').onclick = () => startMatch();
  document.getElementById('btn-tolobby').onclick = () => {
    document.getElementById('tutorial-panel').classList.add('hidden');
    removeOverlay(); showScene('lobby');
  };
}

function removeOverlay() { const ov = document.querySelector('.overlay'); if (ov) ov.remove(); }

// ===== Tutorial =====
function tutorialMark(id) {
  if (!tutorial.active) return;
  if (tutorial.doneSet.has(id)) return;
  tutorial.doneSet.add(id);
  while (tutorial.currentIdx < TUTORIAL_STEPS.length && tutorial.doneSet.has(TUTORIAL_STEPS[tutorial.currentIdx].id)) tutorial.currentIdx++;
  pushFloat(MAP_W / 2, 110, `✓ ${TUTORIAL_STEPS.find(s => s.id === id).text.split('(')[0].trim()}`, '#22c55e', 1.4);
  renderTutorial();
  if (tutorial.doneSet.size >= TUTORIAL_STEPS.length) setTimeout(() => { if (tutorial.active) showTutorialComplete(); }, 900);
}
function renderTutorial() {
  const ul = document.getElementById('tutorial-steps');
  if (!ul) return;
  ul.innerHTML = '';
  for (let i = 0; i < TUTORIAL_STEPS.length; i++) {
    const s = TUTORIAL_STEPS[i];
    const li = document.createElement('li');
    const done = tutorial.doneSet.has(s.id);
    li.className = 'tutorial-step' + (done ? ' done' : (i === tutorial.currentIdx ? ' current' : ''));
    li.textContent = s.text;
    ul.appendChild(li);
  }
  document.getElementById('tutorial-progress').textContent = `${tutorial.doneSet.size} / ${TUTORIAL_STEPS.length}`;
}

// ===== Units =====
function spawnUnit(team, type, x, y, opts = {}) {
  const t = UNIT_TYPES[type];
  if (!t) return null;
  let hp = t.hp, atk = t.atk, range = t.range;
  // Upgrades apply only to myTeam in SP. In MP, hasUpgrade returns false (disabled).
  if (team === myTeam && !mp.enabled) {
    if (hasUpgrade('vets') && type === 'infantry') {
      hp = Math.round(hp * 1.2);
      atk = Math.round(atk * 1.2);
    }
    if (hasUpgrade('long_guns')) range = Math.round(range * 1.15);
  }
  const u = {
    id: nextUnitId++,
    team, type, x, y,
    hp, maxHp: hp, atk, range,
    speed: t.speed, vision: t.vision,
    target: null, atkCd: 0,
  };
  units.push(u);
  if (!opts.silent) pushFloat(x, y - 14, `+${type}`, teamColor(team), 0.8);
  if (!opts.skipRally) autoRallyUnit(u);
  return u;
}

function autoRallyUnit(u) {
  if (u.target) return;
  const cap = UNIT_TYPES[u.type].canCapture;
  let best = null, bd = Infinity;
  for (const p of STRAT_POINTS) {
    if (pointOwner[p.id] === u.team) continue;
    if (!cap.includes(p.type)) continue;
    const d = dist(u, p);
    if (d < bd) { bd = d; best = p; }
  }
  if (!best) {
    const enemy = enemyTeam(u.team);
    const enemyHq = enemy === 'blue' ? HQ_BLUE : HQ_RED;
    u.target = { kind: 'pos', x: enemyHq.x + (Math.random() - 0.5) * 100, y: enemyHq.y + (Math.random() - 0.5) * 100 };
  } else {
    u.target = { kind: 'point', pointId: best.id };
  }
}

function unitById(id) { return units.find(u => u.id === id); }

function updateUnits(dt) {
  for (const u of units) {
    if (u.hp <= 0) continue;
    if (u.atkCd > 0) u.atkCd = Math.max(0, u.atkCd - dt);
    if (!u.target) continue;
    let tx, ty, stopDist;
    if (u.target.kind === 'unit') {
      const tgt = unitById(u.target.unitId);
      if (!tgt || tgt.hp <= 0) { u.target = null; continue; }
      tx = tgt.x; ty = tgt.y;
      stopDist = u.range * 0.75;
    } else if (u.target.kind === 'point') {
      const p = STRAT_POINTS.find(pp => pp.id === u.target.pointId);
      if (!p) { u.target = null; continue; }
      tx = p.x; ty = p.y;
      stopDist = CAPTURE_RADIUS * 0.6;
    } else {
      tx = u.target.x; ty = u.target.y;
      stopDist = 4;
    }
    const dx = tx - u.x, dy = ty - u.y;
    const d = Math.hypot(dx, dy);
    if (d <= stopDist) { if (u.target.kind === 'pos') u.target = null; continue; }
    const step = Math.min(u.speed * dt, d);
    u.x += dx / d * step;
    u.y += dy / d * step;
  }
}

function updateCombat(dt) {
  for (const u of units) {
    if (u.hp <= 0) continue;
    if (u.atkCd > 0) continue;
    let nearest = null, nd = Infinity, isBuilding = false;
    for (const o of units) {
      if (o.team === u.team || o.hp <= 0) continue;
      const d = dist(u, o);
      if (d < u.range && d < nd) { nearest = o; nd = d; isBuilding = false; }
    }
    for (const b of buildings) {
      if (b.team === u.team || b.hp <= 0) continue;
      const d = dist(u, b);
      if (d < u.range && d < nd) { nearest = b; nd = d; isBuilding = true; }
    }
    if (nearest) {
      nearest.hp -= u.atk;
      u.atkCd = UNIT_TYPES[u.type].atkCd;
      pushFloat(nearest.x, nearest.y - 12, `-${u.atk}`, u.team === myTeam ? '#fcd34d' : '#f87171', 0.55);
      if (nearest.hp <= 0) {
        const label = isBuilding ? `${nearest.type.toUpperCase()} DESTROYED` : 'KIA';
        pushFloat(nearest.x, nearest.y, label, '#ef4444', 1.2);
      }
    }
  }
  units = units.filter(u => u.hp > 0);
}

function updateRegen(dt) {
  if (!hasUpgrade('medics')) return;
  regenTimer += dt;
  if (regenTimer < 0.25) return;
  const heal = regenTimer * 1.0;
  regenTimer = 0;
  for (const u of units) {
    if (u.team !== myTeam || u.hp <= 0) continue;
    if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + heal);
  }
}

// ===== Buildings =====
function startConstruction(team, type) {
  if (matchEnded || paused) return;
  const cfg = BUILDINGS[type];
  if (!cfg) return;
  if (resources[team] < cfg.cost) {
    if (team === myTeam) flash(`need ${cfg.cost} supply`);
    return;
  }
  if (hasBuilding(team, type)) {
    if (team === myTeam) flash(`${type} already built`);
    return;
  }
  resources[team] -= cfg.cost;
  const hq = team === 'blue' ? HQ_BLUE : HQ_RED;
  const myCount = buildings.filter(b => b.team === team).length;
  const baseAngle = team === 'blue' ? -Math.PI * 0.30 : -Math.PI * 0.70;
  const angle = baseAngle + (myCount - 1.5) * 0.45;
  const r = 60;
  buildings.push({
    id: nextBuildingId++, team, type,
    x: hq.x + Math.cos(angle) * r,
    y: hq.y + Math.sin(angle) * r,
    progress: 0, completed: false,
    hp: cfg.hp, maxHp: cfg.hp,
    atkCd: 0,
    productionTimer: 0,
  });
  if (team === myTeam) {
    pushFloat(hq.x, hq.y - 42, `building ${type}…`, '#fcd34d', 1.2);
    tutorialMark('build');
  }
}

function hasBuilding(team, type) {
  return buildings.some(b => b.team === team && b.type === type);
}
function hasCompletedBuilding(team, type) {
  return buildings.some(b => b.team === team && b.type === type && b.completed);
}
function updateBuildings(dt) {
  for (const b of buildings) {
    if (!b.completed) {
      // construction
      const cfg = BUILDINGS[b.type];
      let mult = 1.0;
      if (b.team === myTeam && hasUpgrade('engineers')) mult *= 1.3;
      b.progress += (dt / cfg.time) * mult;
      if (b.progress >= 1) {
        b.progress = 1; b.completed = true;
        const prod = BUILDING_PRODUCTION[b.type];
        if (prod) b.productionTimer = prod.interval;
        pushFloat(b.x, b.y - 26, `${b.type.toUpperCase()} ONLINE`, '#22c55e', 1.6);
      }
    } else {
      // auto-production tick
      const prod = BUILDING_PRODUCTION[b.type];
      if (prod) {
        b.productionTimer = Math.max(0, b.productionTimer - dt);
        if (b.productionTimer <= 0) {
          const hq = b.team === 'blue' ? HQ_BLUE : HQ_RED;
          const spawn = isSeaUnit(prod.unit) ? hq.naval : hq;
          spawnUnit(b.team, prod.unit, spawn.x + (Math.random() - 0.5) * 30, spawn.y + (Math.random() - 0.5) * 30, { silent: true });
          b.productionTimer = prod.interval;
          if (b.team === myTeam) pushFloat(b.x, b.y - 28, `+${prod.unit}`, '#22c55e', 1.0);
        }
      }
    }
    if (b.atkCd > 0) b.atkCd = Math.max(0, b.atkCd - dt);
  }
  // remove destroyed (after tick)
  buildings = buildings.filter(b => b.hp > 0);
}

function updateBuildingCombat() {
  for (const b of buildings) {
    if (!b.completed) continue;
    const def = BUILDING_DEFENSE[b.type];
    if (!def) continue;
    if (b.atkCd > 0) continue;
    let nearest = null, nd = Infinity;
    for (const u of units) {
      if (u.team === b.team || u.hp <= 0) continue;
      const d = dist(u, b);
      if (d < def.range && d < nd) { nearest = u; nd = d; }
    }
    if (nearest) {
      nearest.hp -= def.atk;
      b.atkCd = def.atkCd;
      pushFloat(nearest.x, nearest.y - 14, `-${def.atk}`, b.team === myTeam ? '#fcd34d' : '#f87171', 0.55);
      if (nearest.hp <= 0) pushFloat(nearest.x, nearest.y, 'KIA', '#94a3b8', 1.0);
    }
  }
  units = units.filter(u => u.hp > 0);
}
function getCostMultiplier(team, type) {
  let m = 1;
  if (['infantry','sniper','tank','artillery'].includes(type) && hasCompletedBuilding(team, 'barracks')) m *= 0.7;
  if (['gunboat','destroyer','submarine'].includes(type) && hasCompletedBuilding(team, 'shipyard')) m *= 0.7;
  if (['fighter','bomber'].includes(type) && hasCompletedBuilding(team, 'airbase')) m *= 0.7;
  return m;
}
function getCost(team, type) {
  return Math.round(UNIT_TYPES[type].cost * getCostMultiplier(team, type));
}
function getBaseSupplyRate(team) {
  let base = RESOURCE_BASE;
  if (team === myTeam && hasUpgrade('quartermaster')) base += 0.5;
  if (hasCompletedBuilding(team, 'depot')) base += 0.5;
  return base;
}

// ===== Capture =====
function updateCapture(dt) {
  for (const p of STRAT_POINTS) {
    const r = CAPTURE_RADIUS;
    let blueCap = 0, redCap = 0, blueAny = 0, redAny = 0;
    for (const u of units) {
      if (u.hp <= 0) continue;
      if (dist(u, p) > r) continue;
      const cap = UNIT_TYPES[u.type].canCapture.includes(p.type);
      if (u.team === 'blue') { blueAny++; if (cap) blueCap++; }
      else                   { redAny++;  if (cap) redCap++; }
    }
    const owner = pointOwner[p.id];
    const capTime = p.major ? CAPTURE_TIME_MAJOR : CAPTURE_TIME;
    if (blueCap >= 1 && redAny === 0) {
      if (owner === 'blue') continue;
      let prog = pointProgress[p.id];
      if (!prog || prog.team !== 'blue') prog = { team: 'blue', value: 0 };
      prog.value += dt / capTime;
      if (prog.value >= 1) {
        pointOwner[p.id] = 'blue';
        delete pointProgress[p.id];
        const tag = (myTeam === 'blue') ? 'CAPTURED' : 'LOST';
        const color = (myTeam === 'blue') ? '#38bdf8' : '#f87171';
        pushFloat(p.x, p.y - 10, `${p.name.toUpperCase()} ${tag}`, color, 1.6);
        if (myTeam === 'blue') tutorialMark('capture');
      } else pointProgress[p.id] = prog;
    } else if (redCap >= 1 && blueAny === 0) {
      if (owner === 'red') continue;
      let prog = pointProgress[p.id];
      if (!prog || prog.team !== 'red') prog = { team: 'red', value: 0 };
      prog.value += dt / capTime;
      if (prog.value >= 1) {
        pointOwner[p.id] = 'red';
        delete pointProgress[p.id];
        const tag = (myTeam === 'red') ? 'CAPTURED' : 'LOST';
        const color = (myTeam === 'red') ? '#38bdf8' : '#f87171';
        pushFloat(p.x, p.y - 10, `${p.name.toUpperCase()} ${tag}`, color, 1.6);
        if (myTeam === 'red') tutorialMark('capture');
      } else pointProgress[p.id] = prog;
    } else {
      const prog = pointProgress[p.id];
      if (prog) {
        prog.value = Math.max(0, prog.value - dt / CAPTURE_DECAY);
        if (prog.value === 0) delete pointProgress[p.id];
      }
    }
  }
}

function updateResources(dt) {
  for (const team of ['blue', 'red']) {
    let supply = 0;
    for (const p of STRAT_POINTS) {
      if (pointOwner[p.id] === team) supply += RESOURCE_PER_POINT * (p.major ? 2 : 1);
    }
    resources[team] += (getBaseSupplyRate(team) + supply) * dt;
  }
}

// supply rate for HUD display (must match updateResources)
function getSupplyForTeam(team) {
  let supply = 0;
  for (const p of STRAT_POINTS) {
    if (pointOwner[p.id] === team) supply += RESOURCE_PER_POINT * (p.major ? 2 : 1);
  }
  return getBaseSupplyRate(team) + supply;
}

function updateWin(dt) {
  if (tutorial.active) return;
  let blueOwned = 0, redOwned = 0;
  for (const p of STRAT_POINTS) {
    if (pointOwner[p.id] === 'blue') blueOwned++;
    if (pointOwner[p.id] === 'red')  redOwned++;
  }
  holdTimer.blue = blueOwned >= WIN_HOLD_TARGET ? holdTimer.blue + dt : 0;
  holdTimer.red  = redOwned  >= WIN_HOLD_TARGET ? holdTimer.red  + dt : 0;
  if (matchEnded) return;
  if (holdTimer[myTeam] >= WIN_HOLD_TIME) showGameOver('win');
  else if (holdTimer[enemyTeam(myTeam)] >= WIN_HOLD_TIME) showGameOver('lose');
}

// ===== Player actions (with MP forwarding) =====
function deployFromHud(type) {
  if (!isUnitUnlocked(type)) { flash('unit locked — visit shop'); return; }
  if (mp.enabled && !mp.isHost) {
    mp.conn && mp.conn.send({ type: 'deploy', t: type });
    return;
  }
  doDeploy(myTeam, type);
  tutorialMark('deploy');
}

function doDeploy(team, type) {
  const t = UNIT_TYPES[type];
  if (!t) return;
  const cost = getCost(team, type);
  if (resources[team] < cost) {
    if (team === myTeam) flash(`need ${cost} supply`);
    return;
  }
  resources[team] -= cost;
  const hq = team === 'blue' ? HQ_BLUE : HQ_RED;
  const spawn = isSeaUnit(type) ? hq.naval : hq;
  spawnUnit(team, type, spawn.x + (Math.random() - 0.5) * 36, spawn.y + (Math.random() - 0.5) * 36);
}

function buildFromHud(type) {
  if (mp.enabled && !mp.isHost) {
    mp.conn && mp.conn.send({ type: 'build', t: type });
    return;
  }
  startConstruction(myTeam, type);
}

function tryAbility(name) {
  if (matchEnded || paused) return;
  // On client, we still display targeting locally; the actual fire is sent to host on click.
  if (cooldowns[myTeam][name] > 0) return;
  const a = ABILITIES[name];
  if (a.needsTarget) {
    ability.active = name;
    showTargeting(`click target — ${a.name.toLowerCase()}`);
  } else {
    if (mp.enabled && !mp.isHost) {
      mp.conn && mp.conn.send({ type: 'ability', name: 'reinforce' });
      return;
    }
    fireReinforce(myTeam);
    tutorialMark('ability');
  }
}

function fireAbility(name, x, y, team) {
  const a = ABILITIES[name];
  cooldowns[team][name] = a.cd;
  if (name === 'airstrike') {
    strikes.push({ x, y, life: 0.7, max: 0.7 });
    for (const u of units) {
      if (u.hp <= 0) continue;
      if (dist({ x, y }, u) < a.radius) {
        u.hp -= a.damage;
        pushFloat(u.x, u.y - 14, `-${a.damage}`, '#ef4444', 0.7);
      }
    }
    units = units.filter(u => u.hp > 0);
  } else if (name === 'recon') {
    reconZones.push({ x, y, radius: a.radius, life: a.duration, max: a.duration, team });
  }
}

function fireReinforce(team) {
  cooldowns[team].reinforce = ABILITIES.reinforce.cd;
  const hq = team === 'blue' ? HQ_BLUE : HQ_RED;
  spawnUnit(team, 'infantry', hq.x + (Math.random() - 0.5) * 40, hq.y + (Math.random() - 0.5) * 40);
  spawnUnit(team, 'infantry', hq.x + (Math.random() - 0.5) * 40, hq.y + (Math.random() - 0.5) * 40);
  pushFloat(hq.x, hq.y - 30, 'REINFORCED', '#22c55e', 1.2);
}

function doMove(team, unitIds, target) {
  for (const id of unitIds) {
    const u = unitById(id);
    if (u && u.team === team && u.hp > 0) u.target = target;
  }
}

function updateAbilityCooldowns(dt) {
  for (const team of ['blue', 'red']) {
    for (const k in cooldowns[team]) {
      if (cooldowns[team][k] > 0) cooldowns[team][k] = Math.max(0, cooldowns[team][k] - dt);
    }
  }
}
function updateZones(dt) {
  for (const r of reconZones) r.life -= dt;
  reconZones = reconZones.filter(r => r.life > 0);
  for (const s of strikes) s.life -= dt;
  strikes = strikes.filter(s => s.life > 0);
}

// ===== Bot =====
function updateBot(dt) {
  if (matchEnded || tutorial.active || mp.enabled) return;
  const cfg = DIFFICULTY[botDifficulty];
  botDecisionTimer -= dt;
  botAbilityTimer -= dt;
  botBuildTimer -= dt;

  if (botDecisionTimer <= 0) {
    botDecisionTimer = cfg.decisionInterval;
    const myUnits   = units.filter(u => u.team === 'red'  && u.hp > 0);
    const blueUnits = units.filter(u => u.team === 'blue' && u.hp > 0);

    for (const u of myUnits) {
      const cap = UNIT_TYPES[u.type].canCapture;
      let assigned = false;
      for (const p of STRAT_POINTS) {
        if (pointOwner[p.id] !== 'red') continue;
        const nearBlue = blueUnits.find(b => dist(b, p) < 110);
        if (nearBlue && dist(u, p) < 280 && Math.random() < 0.5) {
          u.target = { kind: 'point', pointId: p.id };
          assigned = true; break;
        }
      }
      if (assigned) continue;
      let best = null, bd = Infinity;
      for (const p of STRAT_POINTS) {
        if (pointOwner[p.id] === 'red') continue;
        if (!cap.includes(p.type)) continue;
        const d = dist(u, p) - (pointOwner[p.id] === 'blue' ? 60 : 0);
        if (d < bd) { bd = d; best = p; }
      }
      const reassign = !u.target || (u.target.kind === 'point' && pointOwner[u.target.pointId] === 'red');
      if (best && (reassign || Math.random() < 0.2)) {
        u.target = { kind: 'point', pointId: best.id };
      } else if (!u.target && blueUnits.length) {
        let bn = null, bnd = Infinity;
        for (const b of blueUnits) { const d = dist(u, b); if (d < bnd) { bnd = d; bn = b; } }
        if (bn) u.target = { kind: 'unit', unitId: bn.id };
      }
    }
    if (myUnits.length < cfg.maxUnits && Math.random() < cfg.deployChance) {
      const weights = BOT_DEPLOY_WEIGHTS[botDifficulty];
      const pick = pickWeighted(weights);
      const cost = getCost('red', pick);
      if (resources.red >= cost) {
        resources.red -= cost;
        const spawn = isSeaUnit(pick) ? HQ_RED.naval : HQ_RED;
        spawnUnit('red', pick, spawn.x + (Math.random() - 0.5) * 36, spawn.y + (Math.random() - 0.5) * 36);
      }
    }
  }

  if (botAbilityTimer <= 0) {
    botAbilityTimer = cfg.abilityInterval;
    if (cooldowns.red.airstrike <= 0 && Math.random() < cfg.abilityChance) {
      const blueUnits = units.filter(u => u.team === 'blue' && u.hp > 0);
      let bestCenter = null, bestCount = 0;
      for (const b of blueUnits) {
        let c = 0;
        for (const o of blueUnits) if (dist(b, o) < 60) c++;
        if (c > bestCount) { bestCount = c; bestCenter = b; }
      }
      if (bestCenter && bestCount >= cfg.clusterThreshold) {
        fireAbility('airstrike', bestCenter.x, bestCenter.y, 'red');
      }
    }
    if (cfg.useReinforce && cooldowns.red.reinforce <= 0 && units.filter(u => u.team === 'red' && u.hp > 0).length < 4) {
      fireReinforce('red');
    }
  }

  if (botBuildTimer <= 0) {
    botBuildTimer = 8 + Math.random() * 5;
    if (cfg.build) {
      const wanted = Object.keys(BUILDINGS).filter(t => !hasBuilding('red', t));
      if (wanted.length > 0 && Math.random() < 0.65) {
        const pick = pickRandom(wanted);
        if (resources.red >= BUILDINGS[pick].cost) startConstruction('red', pick);
      }
    }
  }
}

// ===== Visibility =====
function isVisibleToMe(target) {
  for (const u of units) {
    if (u.team !== myTeam || u.hp <= 0) continue;
    if (dist(u, target) < u.vision) return true;
  }
  const myHq = (myTeam === 'blue') ? HQ_BLUE : HQ_RED;
  if (dist(myHq, target) < 160) return true;
  for (const p of STRAT_POINTS) {
    if (pointOwner[p.id] !== myTeam) continue;
    if (dist(p, target) < 130) return true;
  }
  for (const r of reconZones) {
    if (r.team === myTeam && dist(r, target) < r.radius) return true;
  }
  return false;
}

// ===== Floats =====
function pushFloat(x, y, text, color, ttl = 0.9) { floats.push({ x, y, text, color, life: ttl, max: ttl, vy: -22 }); }
function updateFloats(dt) {
  for (const f of floats) { f.y += f.vy * dt; f.life -= dt; }
  floats = floats.filter(f => f.life > 0);
}
function flash(msg) { pushFloat(MAP_W / 2, 80, msg, '#fcd34d', 1.0); }

// ===== Rendering =====
function render() {
  const canvas = document.getElementById('game');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, MAP_W, MAP_H);

  drawTerrain(ctx);
  drawStrategicPoints(ctx);

  for (const b of buildings) drawBuilding(ctx, b);

  for (const u of units) {
    if (u.hp <= 0) continue;
    if (u.team === myTeam) drawUnit(ctx, u);
  }
  for (const u of units) {
    if (u.hp <= 0) continue;
    if (u.team !== myTeam && isVisibleToMe(u)) drawUnit(ctx, u);
  }

  drawZones(ctx);
  drawStrikes(ctx);
  drawFloats(ctx);
  drawFogMask(ctx);

  for (const id of selectedIds) {
    const u = unitById(id);
    if (!u || u.hp <= 0) continue;
    drawSelection(ctx, u);
  }
  if (ability.active) drawAbilityCursor(ctx);

  if (paused) {
    ctx.fillStyle = 'rgba(5, 11, 19, 0.55)';
    ctx.fillRect(0, 0, MAP_W, MAP_H);
    ctx.fillStyle = '#fcd34d';
    ctx.font = 'bold 36px ui-sans-serif, system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('PAUSED', MAP_W / 2, MAP_H / 2);
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillStyle = '#cfe6ff';
    ctx.fillText('press space to resume', MAP_W / 2, MAP_H / 2 + 30);
    ctx.textAlign = 'start'; ctx.textBaseline = 'top';
  }
}

function drawTerrain(ctx) {
  // base water
  ctx.fillStyle = '#0a1f33';
  ctx.fillRect(0, 0, MAP_W, MAP_H);

  ctx.fillStyle = '#1f4d2b';

  // Blue land mass (bottom-left)
  ctx.beginPath();
  ctx.moveTo(0, 700);
  ctx.lineTo(0, 280);
  ctx.bezierCurveTo(60, 260, 200, 240, 340, 270);
  ctx.bezierCurveTo(440, 290, 520, 340, 540, 410);
  ctx.bezierCurveTo(540, 470, 470, 510, 360, 525);
  ctx.bezierCurveTo(260, 540, 160, 580, 80, 640);
  ctx.bezierCurveTo(40, 670, 20, 690, 0, 700);
  ctx.closePath();
  ctx.fill();

  // Small island for Forest
  ctx.beginPath();
  ctx.ellipse(290, 210, 100, 70, 0, 0, Math.PI * 2);
  ctx.fill();

  // Red land mass (top-right)
  ctx.beginPath();
  ctx.moveTo(1100, 0);
  ctx.lineTo(1100, 400);
  ctx.bezierCurveTo(1040, 380, 920, 360, 800, 330);
  ctx.bezierCurveTo(700, 305, 620, 270, 600, 210);
  ctx.bezierCurveTo(600, 150, 660, 100, 760, 80);
  ctx.bezierCurveTo(860, 60, 980, 30, 1100, 0);
  ctx.closePath();
  ctx.fill();

  // Air zone overlay (translucent cyan) — covers upper-right where air targets live
  ctx.save();
  ctx.fillStyle = 'rgba(56, 189, 248, 0.06)';
  ctx.beginPath();
  ctx.moveTo(420, 0);
  ctx.lineTo(1100, 0);
  ctx.lineTo(1100, 220);
  ctx.lineTo(620, 200);
  ctx.lineTo(460, 100);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(36, 70, 104, 0.18)';
  ctx.lineWidth = 1;
  for (let x = 80; x < MAP_W; x += 80) {
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, MAP_H); ctx.stroke();
  }
  for (let y = 80; y < MAP_H; y += 80) {
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(MAP_W, y + 0.5); ctx.stroke();
  }
}

function drawStrategicPoints(ctx) {
  drawHq(ctx, HQ_BLUE);
  drawHq(ctx, HQ_RED);
  for (const p of STRAT_POINTS) {
    const owner = pointOwner[p.id];
    const ringColor = owner ? (owner === myTeam ? SKINS[saveData.skin].primary : '#f87171') : '#6f8aa6';
    ctx.strokeStyle = 'rgba(111, 138, 166, 0.15)';
    ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, CAPTURE_RADIUS, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = owner === myTeam ? SKINS[saveData.skin].halo : owner ? 'rgba(248, 113, 113, 0.20)' : 'rgba(111, 138, 166, 0.18)';
    ctx.beginPath(); ctx.arc(p.x, p.y, 22, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = ringColor; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 22, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#cfe6ff';
    ctx.font = 'bold 16px ui-sans-serif, system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const glyph = p.type === 'land' ? '⛰' : p.type === 'sea' ? '≋' : '✈';
    ctx.fillText(glyph, p.x, p.y);
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(p.name, p.x, p.y + 36);
    ctx.font = '8px ui-monospace, monospace';
    ctx.fillStyle = '#6f8aa6';
    ctx.fillText(`[${p.type}]`, p.x, p.y + 48);
    const prog = pointProgress[p.id];
    if (prog) {
      const barW = 44, barH = 4;
      ctx.fillStyle = '#050b13';
      ctx.fillRect(p.x - barW/2, p.y - 36, barW, barH);
      ctx.fillStyle = prog.team === myTeam ? SKINS[saveData.skin].primary : '#f87171';
      ctx.fillRect(p.x - barW/2, p.y - 36, barW * prog.value, barH);
    }
    // Major-point gold star indicator
    if (p.major) {
      ctx.fillStyle = '#fcd34d';
      ctx.font = 'bold 18px ui-sans-serif, system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('★', p.x + 28, p.y - 24);
      ctx.font = 'bold 8px ui-monospace, monospace';
      ctx.fillStyle = '#fcd34d';
      ctx.fillText('MAJOR', p.x, p.y - 58);
    }
  }
  ctx.textAlign = 'start'; ctx.textBaseline = 'top';
}

function drawHq(ctx, hq) {
  const isMine = hq.team === myTeam;
  const trim = isMine ? SKINS[saveData.skin].primary : '#f87171';
  ctx.fillStyle = isMine ? SKINS[saveData.skin].halo : 'rgba(248, 113, 113, 0.18)';
  ctx.beginPath(); ctx.arc(hq.x, hq.y, 30, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = trim; ctx.lineWidth = 2.5;
  ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = trim;
  ctx.font = 'bold 18px ui-sans-serif, system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('★', hq.x, hq.y);
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(isMine ? 'YOUR HQ' : 'ENEMY HQ', hq.x, hq.y + 46);
  ctx.strokeStyle = isMine ? 'rgba(56, 189, 248, 0.30)' : 'rgba(248, 113, 113, 0.30)';
  ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
  ctx.beginPath(); ctx.arc(hq.naval.x, hq.naval.y, 18, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = 'start'; ctx.textBaseline = 'top';
}

function drawBuilding(ctx, b) {
  const isMine = b.team === myTeam;
  const fill = isMine ? SKINS[saveData.skin].primary : '#f87171';
  const halo = isMine ? SKINS[saveData.skin].halo : 'rgba(248, 113, 113, 0.20)';
  ctx.save();
  if (!b.completed) ctx.globalAlpha = 0.55;
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(b.x, b.y, 22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0a1828';
  ctx.fillRect(b.x - 15, b.y - 15, 30, 30);
  ctx.strokeStyle = fill;
  ctx.lineWidth = 2;
  if (!b.completed) ctx.setLineDash([4, 3]);
  ctx.strokeRect(b.x - 15, b.y - 15, 30, 30);
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px ui-sans-serif, system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(BUILDINGS[b.type].key, b.x, b.y);
  ctx.restore();
  if (!b.completed) {
    const barW = 30, barH = 3;
    ctx.fillStyle = '#050b13';
    ctx.fillRect(b.x - barW/2, b.y + 20, barW, barH);
    ctx.fillStyle = '#fcd34d';
    ctx.fillRect(b.x - barW/2, b.y + 20, barW * b.progress, barH);
  } else if (b.hp < b.maxHp) {
    // HP bar for damaged buildings
    const barW = 30, barH = 3;
    ctx.fillStyle = '#050b13';
    ctx.fillRect(b.x - barW/2, b.y + 20, barW, barH);
    ctx.fillStyle = b.hp / b.maxHp > 0.5 ? '#22c55e' : b.hp / b.maxHp > 0.25 ? '#eab308' : '#ef4444';
    ctx.fillRect(b.x - barW/2, b.y + 20, barW * (b.hp / b.maxHp), barH);
  }
  ctx.textAlign = 'start'; ctx.textBaseline = 'top';
}

function drawUnit(ctx, u) {
  const t = UNIT_TYPES[u.type];
  const isMine = u.team === myTeam;
  const fill = isMine ? SKINS[saveData.skin].primary : '#f87171';
  const halo = isMine ? SKINS[saveData.skin].halo : 'rgba(248, 113, 113, 0.22)';

  if (isMine && u.target) {
    let tx, ty;
    if (u.target.kind === 'unit') {
      const t2 = unitById(u.target.unitId); if (t2) { tx = t2.x; ty = t2.y; }
    } else if (u.target.kind === 'point') {
      const p = STRAT_POINTS.find(pp => pp.id === u.target.pointId); if (p) { tx = p.x; ty = p.y; }
    } else { tx = u.target.x; ty = u.target.y; }
    if (tx !== undefined) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(u.x, u.y, 17, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = fill;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  switch (u.type) {
    case 'infantry': ctx.arc(u.x, u.y, 11, 0, Math.PI * 2); break;
    case 'sniper':
      ctx.moveTo(u.x, u.y - 12); ctx.lineTo(u.x + 10, u.y);
      ctx.lineTo(u.x, u.y + 12); ctx.lineTo(u.x - 10, u.y);
      ctx.closePath(); break;
    case 'tank': ctx.rect(u.x - 12, u.y - 12, 24, 24); break;
    case 'gunboat':   roundRectPath(ctx, u.x - 13, u.y - 8, 26, 16, 4); break;
    case 'destroyer': roundRectPath(ctx, u.x - 16, u.y - 9, 32, 18, 4); break;
    case 'fighter':
      ctx.moveTo(u.x, u.y - 13); ctx.lineTo(u.x + 12, u.y + 10);
      ctx.lineTo(u.x - 12, u.y + 10); ctx.closePath(); break;
    case 'bomber':
      ctx.moveTo(u.x, u.y - 15); ctx.lineTo(u.x + 15, u.y + 12);
      ctx.lineTo(u.x - 15, u.y + 12); ctx.closePath(); break;
    case 'artillery':
      ctx.moveTo(u.x - 8, u.y - 10); ctx.lineTo(u.x + 8, u.y - 10);
      ctx.lineTo(u.x + 13, u.y); ctx.lineTo(u.x + 8, u.y + 10);
      ctx.lineTo(u.x - 8, u.y + 10); ctx.lineTo(u.x - 13, u.y);
      ctx.closePath(); break;
    case 'submarine':
      roundRectPath(ctx, u.x - 15, u.y - 6, 30, 12, 6); break;
  }
  ctx.fill(); ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px ui-sans-serif, system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(t.icon, u.x, u.y);
  ctx.textAlign = 'start'; ctx.textBaseline = 'top';

  if (u.hp < u.maxHp) {
    const barW = 26, barH = 3;
    const bx = u.x - barW / 2, by = u.y - 22;
    ctx.fillStyle = '#050b13';
    ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
    ctx.fillStyle = u.hp / u.maxHp > 0.5 ? '#22c55e' : u.hp / u.maxHp > 0.25 ? '#eab308' : '#ef4444';
    ctx.fillRect(bx, by, barW * (u.hp / u.maxHp), barH);
  }
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
}

function drawSelection(ctx, u) {
  ctx.strokeStyle = '#fcd34d';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(u.x, u.y, 16, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(252, 211, 77, 0.10)';
  ctx.beginPath(); ctx.arc(u.x, u.y, u.vision, 0, Math.PI * 2); ctx.stroke();
}

function drawZones(ctx) {
  for (const r of reconZones) {
    const alpha = (r.life / r.max) * 0.25;
    ctx.fillStyle = `rgba(167, 139, 250, ${alpha})`;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.6)';
    ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
  }
}
function drawStrikes(ctx) {
  for (const s of strikes) {
    const k = 1 - s.life / s.max;
    const radius = 85 * (0.3 + k * 1.0);
    const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, radius);
    grad.addColorStop(0, `rgba(252, 211, 77, ${(s.life / s.max) * 0.7})`);
    grad.addColorStop(1, 'rgba(252, 211, 77, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(s.x, s.y, radius, 0, Math.PI * 2); ctx.fill();
  }
}
function drawFloats(ctx) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of floats) {
    ctx.globalAlpha = Math.max(0, f.life / f.max);
    ctx.fillStyle = f.color;
    ctx.font = 'bold 12px ui-monospace, monospace';
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'start'; ctx.textBaseline = 'top';
}

function drawFogMask(ctx) {
  ensureFogCanvas();
  const fctx = fogCanvas.getContext('2d');
  fctx.save();
  fctx.globalCompositeOperation = 'source-over';
  fctx.clearRect(0, 0, MAP_W, MAP_H);
  fctx.fillStyle = 'rgba(5, 11, 19, 0.62)';
  fctx.fillRect(0, 0, MAP_W, MAP_H);
  fctx.globalCompositeOperation = 'destination-out';
  for (const u of units) {
    if (u.team !== myTeam || u.hp <= 0) continue;
    const v = u.vision;
    const g = fctx.createRadialGradient(u.x, u.y, 0, u.x, u.y, v);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.7)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.fillStyle = g;
    fctx.beginPath(); fctx.arc(u.x, u.y, v, 0, Math.PI * 2); fctx.fill();
  }
  const myHq = (myTeam === 'blue') ? HQ_BLUE : HQ_RED;
  for (const p of [myHq, ...STRAT_POINTS]) {
    if (p !== myHq && pointOwner[p.id] !== myTeam) continue;
    const r = 130;
    const g = fctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.fillStyle = g;
    fctx.beginPath(); fctx.arc(p.x, p.y, r, 0, Math.PI * 2); fctx.fill();
  }
  for (const b of buildings) {
    if (b.team !== myTeam) continue;
    const r = 70;
    const g = fctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.fillStyle = g;
    fctx.beginPath(); fctx.arc(b.x, b.y, r, 0, Math.PI * 2); fctx.fill();
  }
  for (const r of reconZones) {
    if (r.team !== myTeam) continue;
    const g = fctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, r.radius);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.fillStyle = g;
    fctx.beginPath(); fctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2); fctx.fill();
  }
  fctx.restore();
  ctx.drawImage(fogCanvas, 0, 0);
}

function drawAbilityCursor(ctx) {
  const a = ABILITIES[ability.active];
  const radius = a.radius || 30;
  const color = ability.active === 'airstrike' ? '#fcd34d' : '#a78bfa';
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
  ctx.beginPath(); ctx.arc(mouse.x, mouse.y, radius, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 3, 0, Math.PI * 2); ctx.fill();
}

// ===== HUD =====
function updateHUD() {
  if (scene !== 'match') return;
  let myOwned = 0, foeOwned = 0;
  for (const p of STRAT_POINTS) {
    if (pointOwner[p.id] === myTeam) myOwned++;
    else if (pointOwner[p.id]) foeOwned++;
  }
  document.getElementById('score-me').textContent  = `${myOwned} / ${STRAT_POINTS.length}`;
  document.getElementById('score-foe').textContent = `${foeOwned} / ${STRAT_POINTS.length}`;
  document.getElementById('hold-me').style.width  = (holdTimer[myTeam] / WIN_HOLD_TIME * 100) + '%';
  document.getElementById('hold-foe').style.width = (holdTimer[enemyTeam(myTeam)] / WIN_HOLD_TIME * 100) + '%';
  document.getElementById('resource-val').textContent = Math.floor(resources[myTeam]);
  document.getElementById('resource-rate').textContent = `+${getSupplyForTeam(myTeam).toFixed(1)} / sec`;

  for (const btn of document.querySelectorAll('.deploy-btn')) {
    const type = btn.dataset.type;
    const cost = getCost(myTeam, type);
    btn.disabled = resources[myTeam] < cost;
    const meta = btn.querySelector('.deploy-meta');
    if (meta) {
      const terrain = UNIT_TYPES[type].canCapture.length === 3 ? 'any' : UNIT_TYPES[type].canCapture.join('/');
      meta.textContent = `${cost} · ${terrain}`;
    }
  }
  for (const btn of document.querySelectorAll('.build-btn')) {
    const type = btn.dataset.type;
    const exists = hasBuilding(myTeam, type);
    btn.disabled = exists || resources[myTeam] < BUILDINGS[type].cost;
    btn.classList.toggle('built', exists);
  }
  setAbilityCd('ability-airstrike', cooldowns[myTeam].airstrike, ABILITIES.airstrike.cd, ability.active === 'airstrike');
  setAbilityCd('ability-reinforce', cooldowns[myTeam].reinforce, ABILITIES.reinforce.cd, false);
  setAbilityCd('ability-recon',     cooldowns[myTeam].recon,     ABILITIES.recon.cd,     ability.active === 'recon');

  const sel = Array.from(selectedIds).map(unitById).filter(u => u && u.hp > 0);
  const selInfo = document.getElementById('selection-info');
  if (selInfo) {
    if (sel.length === 0) selInfo.textContent = 'none';
    else if (sel.length === 1) selInfo.textContent = `${UNIT_TYPES[sel[0].type].label.toLowerCase()} · ${Math.round(sel[0].hp)} hp`;
    else {
      const byType = {};
      for (const u of sel) byType[u.type] = (byType[u.type] || 0) + 1;
      selInfo.textContent = Object.entries(byType).map(([t, n]) => `${n}× ${t}`).join(', ');
    }
  }
  const elapsed = Math.floor((performance.now() - matchStart) / 1000);
  document.getElementById('match-time').textContent = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2,'0')}`;
}

function setAbilityCd(id, cd, max, targeting) {
  const el = document.getElementById(id);
  if (!el) return;
  const fill = el.querySelector('.ability-cd-fill');
  const pct = cd > 0 ? (1 - cd / max) * 100 : 100;
  if (fill) fill.style.width = pct + '%';
  el.classList.toggle('cooling', cd > 0);
  el.classList.toggle('targeting', !!targeting);
}

function showTargeting(text) {
  const b = document.getElementById('targeting-banner');
  if (!b) return;
  b.classList.remove('hidden');
  document.getElementById('targeting-text').textContent = text;
}
function hideTargeting() {
  const b = document.getElementById('targeting-banner');
  if (b) b.classList.add('hidden');
}

// ===== Input =====
function canvasToWorld(e) {
  const canvas = document.getElementById('game');
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (MAP_W / rect.width),
    y: (e.clientY - rect.top)  * (MAP_H / rect.height),
  };
}
function hitUnit(pt) {
  for (const u of units) {
    if (u.hp <= 0 || u.team !== myTeam) continue;
    if (dist(u, pt) < 14) return u;
  }
  return null;
}
function hitEnemyUnit(pt) {
  for (const u of units) {
    if (u.hp <= 0 || u.team === myTeam) continue;
    if (!isVisibleToMe(u)) continue;
    if (dist(u, pt) < 14) return u;
  }
  return null;
}
function hitPoint(pt) {
  for (const p of STRAT_POINTS) if (dist(p, pt) < 26) return p;
  return null;
}
function handleLeftClick(pt, shift) {
  if (ability.active) {
    if (mp.enabled && !mp.isHost) {
      mp.conn && mp.conn.send({ type: 'ability', name: ability.active, x: pt.x, y: pt.y });
    } else {
      fireAbility(ability.active, pt.x, pt.y, myTeam);
      tutorialMark('ability');
    }
    ability.active = null; hideTargeting();
    return;
  }
  const u = hitUnit(pt);
  if (u) {
    if (shift) { if (selectedIds.has(u.id)) selectedIds.delete(u.id); else selectedIds.add(u.id); }
    else { selectedIds.clear(); selectedIds.add(u.id); }
    tutorialMark('select');
  } else if (!shift) selectedIds.clear();
}
function handleRightClick(pt) {
  if (ability.active) { ability.active = null; hideTargeting(); return; }
  if (selectedIds.size === 0) return;
  const enemy = hitEnemyUnit(pt);
  const point = hitPoint(pt);
  let target;
  if (enemy) target = { kind: 'unit', unitId: enemy.id };
  else if (point) target = { kind: 'point', pointId: point.id };
  else target = { kind: 'pos', x: pt.x, y: pt.y };
  if (mp.enabled && !mp.isHost) {
    mp.conn && mp.conn.send({ type: 'move', ids: Array.from(selectedIds), target });
    tutorialMark('move');
    return;
  }
  doMove(myTeam, Array.from(selectedIds), target);
  tutorialMark('move');
}
function selectAll() {
  selectedIds.clear();
  for (const u of units) if (u.team === myTeam && u.hp > 0) selectedIds.add(u.id);
}

// ===== Deploy / Build button generators =====
function buildDeployButtons() {
  const list = document.getElementById('deploy-list');
  if (!list) return;
  list.innerHTML = '';
  let i = 1;
  for (const [type, t] of Object.entries(UNIT_TYPES)) {
    if (!isUnitUnlocked(type)) continue;
    const terrain = t.canCapture.length === 3 ? 'any' : t.canCapture.join('/');
    const btn = document.createElement('button');
    btn.className = 'deploy-btn';
    btn.dataset.type = type;
    btn.title = `${t.label} — ${t.role}\nhp ${t.hp} · atk ${t.atk} · range ${t.range}`;
    btn.innerHTML = `
      <span class="deploy-key">${i}</span>
      <span class="deploy-name">${t.label}</span>
      <span class="deploy-meta">${t.cost} · ${terrain}</span>
    `;
    btn.addEventListener('click', () => deployFromHud(type));
    list.appendChild(btn);
    i++;
  }
}
function buildBuildButtons() {
  const list = document.getElementById('build-list');
  if (!list) return;
  list.innerHTML = '';
  for (const [type, b] of Object.entries(BUILDINGS)) {
    const btn = document.createElement('button');
    btn.className = 'build-btn';
    btn.dataset.type = type;
    btn.title = `${type.toUpperCase()} — ${b.desc}\ncost ${b.cost} supply · ${b.time}s to build`;
    btn.innerHTML = `
      <span class="build-key">${b.key}</span>
      <span class="build-name">${type.toUpperCase()}</span>
      <span class="build-cost">${b.cost} · ${b.time}s</span>
    `;
    btn.addEventListener('click', () => buildFromHud(type));
    list.appendChild(btn);
  }
}

// ===== Shop =====
function renderShop() {
  document.getElementById('shop-credits').textContent = saveData.credits;
  const skinGrid = document.getElementById('skin-grid');
  skinGrid.innerHTML = '';
  for (const [id, s] of Object.entries(SKINS)) {
    const owned = saveData.skins.includes(id);
    const equipped = saveData.skin === id;
    const card = document.createElement('div');
    card.className = 'shop-card-item skin-card' + (equipped ? ' equipped' : owned ? ' owned' : '');
    card.innerHTML = `
      <div class="skin-swatch" style="background: ${s.primary}"></div>
      <div class="item-name">${s.name}</div>
      <div class="item-desc">team color for all your units</div>
      <div class="item-action">${equipped ? 'EQUIPPED' : (owned ? 'EQUIP' : s.cost + ' CR')}</div>
    `;
    card.onclick = () => {
      if (equipped) return;
      if (owned) { saveData.skin = id; saveSaveData(); renderShop(); }
      else if (saveData.credits >= s.cost) { saveData.credits -= s.cost; saveData.skins.push(id); saveData.skin = id; saveSaveData(); renderShop(); }
      else flashShop();
    };
    skinGrid.appendChild(card);
  }
  const upList = document.getElementById('upgrade-list');
  upList.innerHTML = '';
  for (const [id, u] of Object.entries(UPGRADES)) {
    const owned = saveData.upgrades.includes(id);
    const card = document.createElement('div');
    card.className = 'shop-card-item upgrade-card' + (owned ? ' owned' : '');
    card.innerHTML = `
      <div class="item-name">${u.name}</div>
      <div class="item-desc">${u.desc}</div>
      <div class="item-action">${owned ? 'ACTIVE' : u.cost + ' CR'}</div>
    `;
    card.onclick = () => {
      if (owned) return;
      if (saveData.credits >= u.cost) { saveData.credits -= u.cost; saveData.upgrades.push(id); saveSaveData(); renderShop(); }
      else flashShop();
    };
    upList.appendChild(card);
  }
  const unlockList = document.getElementById('unlock-list');
  unlockList.innerHTML = '';
  for (const [type, t] of Object.entries(UNIT_TYPES)) {
    if (!t.locked) continue;
    const owned = saveData.unlocks.includes(type);
    const card = document.createElement('div');
    card.className = 'shop-card-item unlock-card' + (owned ? ' owned' : '');
    card.innerHTML = `
      <div class="item-name">${t.label}</div>
      <div class="item-desc">${t.role} · hp ${t.hp} · atk ${t.atk} · range ${t.range}</div>
      <div class="item-action">${owned ? 'UNLOCKED' : t.unlockCost + ' CR'}</div>
    `;
    card.onclick = () => {
      if (owned) return;
      if (saveData.credits >= t.unlockCost) { saveData.credits -= t.unlockCost; saveData.unlocks.push(type); saveSaveData(); renderShop(); }
      else flashShop();
    };
    unlockList.appendChild(card);
  }
}
function flashShop() {
  const el = document.getElementById('shop-credits');
  if (!el) return;
  el.style.color = '#ef4444';
  setTimeout(() => el.style.color = '', 500);
}

// ===== Multiplayer =====
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function showMpPanel(text, opts = {}) {
  const panel = document.getElementById('mp-panel');
  if (!panel) return;
  panel.classList.remove('hidden');
  const status = document.getElementById('mp-status');
  if (opts.code) {
    status.innerHTML = `${text}<div class="mp-code-display">${opts.code}</div>`;
  } else {
    status.textContent = text;
  }
  document.getElementById('mp-code-row').classList.toggle('hidden', !opts.codeInput);
}
function hideMpPanel() {
  const panel = document.getElementById('mp-panel');
  if (panel) panel.classList.add('hidden');
}

function hostMatchClick() {
  if (mp.enabled || mp.peer) return;
  if (typeof Peer === 'undefined') { showMpPanel('peerjs failed to load — check your network'); return; }
  const code = generateCode();
  mp.code = code;
  mp.isHost = true;
  showMpPanel('initializing...');
  try {
    mp.peer = new Peer('salvo-' + code.toLowerCase());
  } catch (e) {
    showMpPanel('error: ' + e.message); cleanupMp(); return;
  }
  mp.peer.on('open', () => {
    showMpPanel('share this code · waiting for opponent...', { code });
  });
  mp.peer.on('connection', conn => {
    mp.conn = conn;
    conn.on('open', () => {
      conn.send({ type: 'hello', user: currentUser });
      mp.enabled = true;
      myTeam = 'blue';
      hideMpPanel();
      startMpMatchHost();
    });
    conn.on('data', data => handleMpData(data));
    conn.on('close', () => onMpDisconnect());
    conn.on('error', () => onMpDisconnect());
  });
  mp.peer.on('error', err => {
    showMpPanel('peer error: ' + (err.type || err.message || 'unknown'));
    cleanupMp();
  });
}

function joinMatchClick() {
  if (mp.enabled || mp.peer) return;
  showMpPanel('enter the code your host shared:', { codeInput: true });
}
function joinMatchSubmit() {
  if (mp.enabled || mp.peer) return;
  const code = document.getElementById('mp-code-input').value.trim().toUpperCase();
  if (code.length !== 6) { showMpPanel('code must be 6 characters', { codeInput: true }); return; }
  if (typeof Peer === 'undefined') { showMpPanel('peerjs failed to load — check your network'); return; }
  mp.isHost = false;
  showMpPanel(`connecting to ${code}...`);
  try {
    mp.peer = new Peer();
  } catch (e) {
    showMpPanel('error: ' + e.message); cleanupMp(); return;
  }
  mp.peer.on('open', () => {
    const conn = mp.peer.connect('salvo-' + code.toLowerCase());
    mp.conn = conn;
    conn.on('open', () => {
      conn.send({ type: 'hello', user: currentUser });
      mp.enabled = true;
      myTeam = 'red';
      hideMpPanel();
      startMpMatchClient();
    });
    conn.on('data', data => handleMpData(data));
    conn.on('close', () => onMpDisconnect());
    conn.on('error', () => onMpDisconnect());
    setTimeout(() => {
      if (!mp.enabled) showMpPanel(`host ${code} not responding · cancel and try again`, { codeInput: true });
    }, 6000);
  });
  mp.peer.on('error', err => {
    showMpPanel('peer error: ' + (err.type || err.message || 'unknown'));
    cleanupMp();
  });
}

function cancelMp() {
  cleanupMp();
  hideMpPanel();
}
function cleanupMp() {
  try { mp.conn && mp.conn.close(); } catch (e) {}
  try { mp.peer && mp.peer.destroy(); } catch (e) {}
  mp = { enabled: false, isHost: false, peer: null, conn: null, code: null, syncTimer: 0 };
}

function startMpMatchHost() {
  resetMatchState();
  spawnUnit('blue', 'infantry', HQ_BLUE.x + 30, HQ_BLUE.y - 20);
  spawnUnit('blue', 'infantry', HQ_BLUE.x + 50, HQ_BLUE.y + 5);
  spawnUnit('blue', 'gunboat',  HQ_BLUE.naval.x, HQ_BLUE.naval.y);
  spawnUnit('red',  'infantry', HQ_RED.x - 30,  HQ_RED.y + 20);
  spawnUnit('red',  'infantry', HQ_RED.x - 50,  HQ_RED.y - 5);
  spawnUnit('red',  'gunboat',  HQ_RED.naval.x, HQ_RED.naval.y);
  removeOverlay(); hideTargeting();
  buildDeployButtons(); buildBuildButtons();
  showScene('match');
  pushFloat(MAP_W / 2, 90, 'multiplayer match · you are blue (host)', '#fcd34d', 2.0);
}
function startMpMatchClient() {
  resetMatchState();
  removeOverlay(); hideTargeting();
  buildDeployButtons(); buildBuildButtons();
  showScene('match');
  pushFloat(MAP_W / 2, 90, 'multiplayer match · you are red (client)', '#fcd34d', 2.0);
}

function onMpDisconnect() {
  if (!mp.peer) return;
  if (matchEnded) { cleanupMp(); return; }
  matchEnded = true;
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `
    <h1 class="lose">CONNECTION LOST</h1>
    <p>opponent disconnected · match abandoned</p>
    <div class="overlay-actions">
      <button id="btn-mp-back" class="primary">command room</button>
    </div>
  `;
  document.body.appendChild(ov);
  document.getElementById('btn-mp-back').onclick = () => {
    removeOverlay();
    cleanupMp();
    showScene('lobby');
  };
}

function updateMpSync(dt) {
  if (!mp.enabled || !mp.isHost || !mp.conn) return;
  mp.syncTimer += dt;
  if (mp.syncTimer < 0.1) return;
  mp.syncTimer = 0;
  const state = {
    u: units.map(u => ({ id: u.id, t: u.team, ty: u.type, x: Math.round(u.x), y: Math.round(u.y), hp: Math.round(u.hp), mhp: u.maxHp, ta: u.target })),
    b: buildings.map(b => ({ id: b.id, t: b.team, ty: b.type, x: b.x, y: b.y, p: +b.progress.toFixed(3), c: b.completed, hp: Math.round(b.hp), mhp: b.maxHp })),
    po: pointOwner,
    pp: pointProgress,
    r: { blue: Math.round(resources.blue), red: Math.round(resources.red) },
    cd: cooldowns,
    rz: reconZones.map(r => ({ x: r.x, y: r.y, ra: r.radius, l: +r.life.toFixed(2), m: r.max, t: r.team })),
    sk: strikes.map(s => ({ x: s.x, y: s.y, l: +s.life.toFixed(2), m: s.max })),
    ht: { blue: +holdTimer.blue.toFixed(2), red: +holdTimer.red.toFixed(2) },
    me: matchEnded,
    ts: matchStart,
  };
  try { mp.conn.send({ type: 'state', s: state }); } catch (e) {}
}

function applyMpState(s) {
  units = s.u.map(u => {
    const t = UNIT_TYPES[u.ty];
    return {
      id: u.id, team: u.t, type: u.ty,
      x: u.x, y: u.y, hp: u.hp, maxHp: u.mhp,
      atk: t.atk, range: t.range, speed: t.speed, vision: t.vision,
      target: u.ta, atkCd: 0,
    };
  });
  buildings = s.b.map(b => ({
    id: b.id, team: b.t, type: b.ty,
    x: b.x, y: b.y, progress: b.p, completed: b.c,
    hp: b.hp ?? BUILDINGS[b.ty].hp,
    maxHp: b.mhp ?? BUILDINGS[b.ty].hp,
    atkCd: 0, productionTimer: 0,
  }));
  pointOwner = s.po;
  pointProgress = s.pp;
  resources = s.r;
  cooldowns = s.cd;
  reconZones = s.rz.map(r => ({ x: r.x, y: r.y, radius: r.ra, life: r.l, max: r.m, team: r.t }));
  strikes = s.sk;
  holdTimer = s.ht;
  matchStart = s.ts;
  if (s.me && !matchEnded) {
    const myOwned = STRAT_POINTS.filter(p => pointOwner[p.id] === myTeam).length;
    showGameOver(myOwned >= WIN_HOLD_TARGET ? 'win' : 'lose');
  }
}

function handleMpData(data) {
  if (!data || !data.type) return;
  if (data.type === 'state' && !mp.isHost) { applyMpState(data.s); return; }
  if (data.type === 'hello') {
    if (mp.isHost) pushFloat(MAP_W / 2, 110, `opponent: ${data.user || 'guest'}`, '#fcd34d', 1.6);
    return;
  }
  if (!mp.isHost) return; // host-only: process inputs
  const rt = enemyTeam(myTeam);
  if (data.type === 'deploy') doDeploy(rt, data.t);
  else if (data.type === 'build') startConstruction(rt, data.t);
  else if (data.type === 'move')  doMove(rt, data.ids, data.target);
  else if (data.type === 'ability') {
    if (data.name === 'reinforce') fireReinforce(rt);
    else fireAbility(data.name, data.x, data.y, rt);
  }
}

// ===== Setup =====
function setupInputs() {
  const canvas = document.getElementById('game');
  canvas.addEventListener('mousemove', e => {
    const pt = canvasToWorld(e);
    mouse.x = pt.x; mouse.y = pt.y;
  });
  canvas.addEventListener('mousedown', e => {
    if (scene !== 'match' || matchEnded) return;
    const pt = canvasToWorld(e);
    if (e.button === 0) handleLeftClick(pt, e.shiftKey);
    else if (e.button === 2) handleRightClick(pt);
    e.preventDefault();
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  window.addEventListener('keydown', e => {
    if (scene !== 'match') return;
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (/^[1-9]$/.test(k)) {
      const idx = parseInt(k, 10) - 1;
      const visible = Object.keys(UNIT_TYPES).filter(isUnitUnlocked);
      if (visible[idx]) { deployFromHud(visible[idx]); e.preventDefault(); }
      return;
    }
    if      (k === 'q') tryAbility('airstrike');
    else if (k === 'e') tryAbility('reinforce');
    else if (k === 'r') tryAbility('recon');
    else if (k === 'b') buildFromHud('barracks');
    else if (k === 'y') buildFromHud('shipyard');
    else if (k === 'a') buildFromHud('airbase');
    else if (k === 's') buildFromHud('depot');
    else if (k === 'tab') { selectAll(); e.preventDefault(); }
    else if (k === ' ')   { paused = !paused; e.preventDefault(); }
    else if (k === 'escape') { ability.active = null; hideTargeting(); }
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

  // Auth
  document.getElementById('auth-submit').onclick = handleAuth;
  document.getElementById('auth-password').addEventListener('keydown', e => { if (e.key === 'Enter') handleAuth(); });
  document.getElementById('auth-username').addEventListener('keydown', e => { if (e.key === 'Enter') handleAuth(); });
  document.getElementById('btn-logout').onclick = logout;

  // Lobby actions
  document.getElementById('btn-start').onclick    = () => startMatch();
  document.getElementById('btn-tutorial').onclick = () => startTutorial();
  document.getElementById('btn-shop').onclick     = () => showScene('shop');
  document.getElementById('btn-shop-back').onclick = () => showScene('lobby');
  document.getElementById('btn-leave').onclick = () => {
    if (mp.enabled) cleanupMp();
    document.getElementById('tutorial-panel').classList.add('hidden');
    removeOverlay(); showScene('lobby');
  };

  // MP
  document.getElementById('btn-host').onclick = hostMatchClick;
  document.getElementById('btn-join').onclick = joinMatchClick;
  document.getElementById('mp-code-submit').onclick = joinMatchSubmit;
  document.getElementById('mp-code-input').addEventListener('keydown', e => { if (e.key === 'Enter') joinMatchSubmit(); });
  document.getElementById('mp-cancel').onclick = cancelMp;

  for (const btn of document.querySelectorAll('.seg-btn:not(:disabled)')) {
    if (btn.dataset.diff || btn.dataset.length || btn.dataset.rank || btn.dataset.team) {
      btn.onclick = () => {
        const group = btn.closest('.seg');
        for (const b of group.querySelectorAll('.seg-btn')) b.classList.remove('active');
        btn.classList.add('active');
        if (btn.dataset.diff) botDifficulty = btn.dataset.diff;
      };
    }
  }

  document.getElementById('ability-airstrike').onclick = () => tryAbility('airstrike');
  document.getElementById('ability-reinforce').onclick = () => tryAbility('reinforce');
  document.getElementById('ability-recon').onclick     = () => tryAbility('recon');
}

// ===== Main loop =====
function gameLoop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (scene === 'match' && !matchEnded && !paused) {
    if (mp.enabled && !mp.isHost) {
      // client: render only, no simulation
      updateFloats(dt);
    } else {
      updateUnits(dt);
      updateCombat(dt);
      updateBuildings(dt);
      updateBuildingCombat();
      updateCapture(dt);
      updateResources(dt);
      updateAbilityCooldowns(dt);
      updateZones(dt);
      updateBot(dt);
      updateRegen(dt);
      updateFloats(dt);
      updateWin(dt);
      updateMpSync(dt);
    }
  } else if (scene === 'match') {
    updateFloats(dt);
  }
  if (scene === 'match') { render(); updateHUD(); }
  requestAnimationFrame(gameLoop);
}

// ===== Init =====
window.addEventListener('DOMContentLoaded', () => {
  setupInputs();
  // Auto-login if a current user was saved
  const saved = localStorage.getItem(CURRENT_USER_KEY);
  let users = {};
  try { users = JSON.parse(localStorage.getItem(USERS_KEY) || '{}'); } catch (e) {}
  if (saved && users[saved]) {
    currentUser = saved;
    loadSaveData();
    showAccountWidget();
    buildDeployButtons();
    buildBuildButtons();
    showScene('lobby');
  } else {
    buildDeployButtons();
    buildBuildButtons();
    showScene('auth');
    setTimeout(() => document.getElementById('auth-username').focus(), 50);
  }
  lastTime = performance.now();
  requestAnimationFrame(gameLoop);
});
