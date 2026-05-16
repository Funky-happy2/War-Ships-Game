// SALVO — v0.3.1 (Mini War)
// Real-time tactical capture-point combat with auto-rally, 7 unit types,
// difficulty levels, and a tutorial mode.

// ===== Config =====
const MAP_W = 1100, MAP_H = 700;
const CAPTURE_RADIUS = 50;
const CAPTURE_TIME = 10;
const CAPTURE_DECAY = 20;
const RESOURCE_START = 100;
const RESOURCE_BASE = 1.0;
const RESOURCE_PER_POINT = 0.6;
const WIN_HOLD_TARGET = 4;
const WIN_HOLD_TIME = 20;

// Ordered insertion = display + hotkey order (1-7)
const UNIT_TYPES = {
  infantry:  { cost: 50,  hp: 60,  atk: 10, speed: 55, vision: 170, range: 32, atkCd: 1.1, canCapture: ['land'],             icon: 'I', label: 'INFANTRY',  role: 'cheap line trooper' },
  sniper:    { cost: 75,  hp: 40,  atk: 18, speed: 50, vision: 250, range: 90, atkCd: 2.5, canCapture: ['land'],             icon: 'S', label: 'SNIPER',    role: 'long-range, fragile' },
  tank:      { cost: 110, hp: 170, atk: 22, speed: 35, vision: 160, range: 40, atkCd: 1.6, canCapture: ['land'],             icon: 'T', label: 'TANK',      role: 'tough land bruiser' },
  gunboat:   { cost: 80,  hp: 100, atk: 16, speed: 42, vision: 200, range: 50, atkCd: 1.6, canCapture: ['sea'],              icon: 'G', label: 'GUNBOAT',   role: 'basic sea fighter' },
  destroyer: { cost: 140, hp: 160, atk: 26, speed: 38, vision: 220, range: 65, atkCd: 1.8, canCapture: ['sea'],              icon: 'D', label: 'DESTROYER', role: 'heavy long-range sea' },
  fighter:   { cost: 120, hp: 50,  atk: 24, speed: 92, vision: 240, range: 38, atkCd: 1.0, canCapture: ['land','sea','air'], icon: 'F', label: 'FIGHTER',   role: 'fast, captures any terrain' },
  bomber:    { cost: 180, hp: 70,  atk: 40, speed: 72, vision: 220, range: 55, atkCd: 2.5, canCapture: ['land','sea','air'], icon: 'B', label: 'BOMBER',    role: 'huge alpha damage' },
};

const ABILITIES = {
  airstrike: { cd: 30, radius: 85,  damage: 35, needsTarget: true,  name: 'AIRSTRIKE' },
  reinforce: { cd: 25,                          needsTarget: false, name: 'REINFORCE' },
  recon:     { cd: 20, radius: 220, duration: 8, needsTarget: true, name: 'RECON' },
};

const STRAT_POINTS = [
  { id: 'west-town', x: 220, y: 460, type: 'land', name: 'West Town' },
  { id: 'forest',    x: 280, y: 200, type: 'land', name: 'Forest' },
  { id: 'bridge',    x: 550, y: 380, type: 'land', name: 'Bridge' },
  { id: 'air-base',  x: 720, y: 140, type: 'air',  name: 'Air Base' },
  { id: 'port',      x: 880, y: 380, type: 'sea',  name: 'Port' },
  { id: 'coast',     x: 670, y: 560, type: 'sea',  name: 'Coast' },
];
const HQ_BLUE = { id: 'hq-blue', x: 80,   y: 620, team: 'blue', name: 'Blue HQ' };
const HQ_RED  = { id: 'hq-red',  x: 1020, y: 80,  team: 'red',  name: 'Red HQ' };

// Bot difficulty profiles
const DIFFICULTY = {
  easy:   { decisionInterval: 1.6, abilityInterval: 14, maxUnits: 6,  deployChance: 0.55, abilityChance: 0.35, clusterThreshold: 4, useReinforce: false },
  normal: { decisionInterval: 0.8, abilityInterval: 4,  maxUnits: 10, deployChance: 0.95, abilityChance: 0.9,  clusterThreshold: 3, useReinforce: true },
  hard:   { decisionInterval: 0.5, abilityInterval: 3,  maxUnits: 14, deployChance: 1.0,  abilityChance: 1.0,  clusterThreshold: 2, useReinforce: true },
};
const BOT_DEPLOY_WEIGHTS = {
  easy:   { infantry: 70, gunboat: 25, sniper: 5 },
  normal: { infantry: 22, sniper: 13, tank: 12, gunboat: 16, destroyer: 10, fighter: 16, bomber: 11 },
  hard:   { infantry: 14, sniper: 18, tank: 16, gunboat: 12, destroyer: 14, fighter: 14, bomber: 12 },
};
let botDifficulty = 'normal';

// Tutorial
const TUTORIAL_STEPS = [
  { id: 'deploy',  text: 'Deploy any unit (press 1–7 or click a deploy button)' },
  { id: 'select',  text: 'Select one of your units (left-click on it)' },
  { id: 'move',    text: 'Order a unit to move (right-click on the map)' },
  { id: 'capture', text: 'Capture a strategic point (move a unit onto one)' },
  { id: 'ability', text: 'Use a commander ability (Q, E, or R)' },
];
let tutorial = { active: false, doneSet: new Set(), currentIdx: 0 };

// ===== State =====
let scene = 'lobby';
let units = [];
let nextUnitId = 1;
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

// Offscreen canvas used to composite the fog mask without erasing units
let fogCanvas = null;
function ensureFogCanvas() {
  if (!fogCanvas) {
    fogCanvas = document.createElement('canvas');
    fogCanvas.width = MAP_W;
    fogCanvas.height = MAP_H;
  }
}

// ===== Util =====
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickWeighted(weights) {
  const types = Object.keys(weights);
  const total = types.reduce((a, t) => a + weights[t], 0);
  let r = Math.random() * total;
  for (const t of types) { r -= weights[t]; if (r <= 0) return t; }
  return types[0];
}
const UNIT_TYPE_KEYS = Object.keys(UNIT_TYPES);

// ===== Scene =====
function showScene(s) {
  scene = s;
  document.getElementById('lobby').classList.toggle('hidden', s !== 'lobby');
  document.getElementById('match').classList.toggle('hidden', s === 'lobby');
  document.getElementById('scene-label').textContent = s === 'lobby' ? 'command room' : (tutorial.active ? 'tutorial' : 'in battle');
}

function resetMatchState() {
  units = [];
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
  botDecisionTimer = 1; botAbilityTimer = 8;
}

function startMatch() {
  tutorial.active = false;
  document.getElementById('tutorial-panel').classList.add('hidden');
  resetMatchState();
  // Starting forces both sides
  spawnUnit('blue', 'infantry', HQ_BLUE.x + 30, HQ_BLUE.y - 20);
  spawnUnit('blue', 'infantry', HQ_BLUE.x + 50, HQ_BLUE.y + 5);
  spawnUnit('blue', 'gunboat',  HQ_BLUE.x + 10, HQ_BLUE.y + 40);
  spawnUnit('red',  'infantry', HQ_RED.x - 30,  HQ_RED.y + 20);
  spawnUnit('red',  'infantry', HQ_RED.x - 50,  HQ_RED.y - 5);
  spawnUnit('red',  'gunboat',  HQ_RED.x - 10,  HQ_RED.y + 40);
  removeOverlay(); hideTargeting();
  showScene('match');
}

function startTutorial() {
  resetMatchState();
  // No red HQ ownership matters but enemy lives in null state — bot is gated off
  resources.blue = 220;             // extra supply for experimenting
  tutorial = { active: true, doneSet: new Set(), currentIdx: 0 };
  // Single starter unit, NOT auto-rallied so the player explores manually
  const starter = spawnUnit('blue', 'infantry', HQ_BLUE.x + 40, HQ_BLUE.y - 20, { silent: true });
  if (starter) starter.target = null;
  document.getElementById('tutorial-panel').classList.remove('hidden');
  renderTutorial();
  removeOverlay(); hideTargeting();
  showScene('match');
  pushFloat(MAP_W / 2, 90, 'training grounds — no enemy', '#fcd34d', 2.0);
}

function showGameOver(result) {
  matchEnded = true;
  const ov = document.createElement('div');
  ov.className = 'overlay';
  const elapsed = Math.floor((performance.now() - matchStart) / 1000);
  const mm = Math.floor(elapsed / 60), ss = String(elapsed % 60).padStart(2,'0');
  ov.innerHTML = `
    <h1 class="${result}">${result === 'win' ? 'VICTORY' : 'DEFEAT'}</h1>
    <p>${result === 'win' ? `enemy command broken in ${mm}:${ss}` : `red command holds the field after ${mm}:${ss}`}</p>
    <div class="overlay-actions">
      <button id="btn-rematch" class="primary">rematch</button>
      <button id="btn-tolobby">command room</button>
    </div>
  `;
  document.body.appendChild(ov);
  document.getElementById('btn-rematch').onclick = () => startMatch();
  document.getElementById('btn-tolobby').onclick = () => { removeOverlay(); showScene('lobby'); };
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
  while (tutorial.currentIdx < TUTORIAL_STEPS.length && tutorial.doneSet.has(TUTORIAL_STEPS[tutorial.currentIdx].id)) {
    tutorial.currentIdx++;
  }
  pushFloat(MAP_W / 2, 110, `✓ ${TUTORIAL_STEPS.find(s => s.id === id).text.split('(')[0].trim()}`, '#22c55e', 1.4);
  renderTutorial();
  if (tutorial.doneSet.size >= TUTORIAL_STEPS.length) {
    setTimeout(() => { if (tutorial.active) showTutorialComplete(); }, 900);
  }
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
  const u = {
    id: nextUnitId++,
    team, type, x, y,
    hp: t.hp, maxHp: t.hp,
    target: null, atkCd: 0,
  };
  units.push(u);
  if (!opts.silent) pushFloat(x, y - 14, `+${type}`, team === 'blue' ? '#38bdf8' : '#f87171', 0.8);
  // auto-rally toward the closest capturable enemy/neutral point
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
  // if no capturable point available (rare), march toward the bridge area
  if (!best) best = STRAT_POINTS.find(p => p.id === 'bridge');
  if (best) u.target = { kind: 'point', pointId: best.id };
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
      stopDist = UNIT_TYPES[u.type].range * 0.75;
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
    if (d <= stopDist) {
      if (u.target.kind === 'pos') u.target = null;
      continue;
    }
    const speed = UNIT_TYPES[u.type].speed;
    const step = Math.min(speed * dt, d);
    u.x += dx / d * step;
    u.y += dy / d * step;
  }
}

function updateCombat(dt) {
  for (const u of units) {
    if (u.hp <= 0) continue;
    const t = UNIT_TYPES[u.type];
    if (u.atkCd > 0) continue;
    let nearest = null, nd = Infinity;
    for (const o of units) {
      if (o.team === u.team || o.hp <= 0) continue;
      const d = dist(u, o);
      if (d < t.range && d < nd) { nearest = o; nd = d; }
    }
    if (nearest) {
      nearest.hp -= t.atk;
      u.atkCd = t.atkCd;
      pushFloat(nearest.x, nearest.y - 12, `-${t.atk}`, u.team === 'blue' ? '#fcd34d' : '#f87171', 0.55);
      if (nearest.hp <= 0) pushFloat(nearest.x, nearest.y, 'KIA', '#94a3b8', 1.1);
    }
  }
  units = units.filter(u => u.hp > 0);
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
    if (blueCap >= 1 && redAny === 0) {
      if (owner === 'blue') continue;
      let prog = pointProgress[p.id];
      if (!prog || prog.team !== 'blue') prog = { team: 'blue', value: 0 };
      prog.value += dt / CAPTURE_TIME;
      if (prog.value >= 1) {
        pointOwner[p.id] = 'blue';
        delete pointProgress[p.id];
        pushFloat(p.x, p.y - 10, `${p.name.toUpperCase()} CAPTURED`, '#38bdf8', 1.6);
        tutorialMark('capture');
      } else { pointProgress[p.id] = prog; }
    } else if (redCap >= 1 && blueAny === 0) {
      if (owner === 'red') continue;
      let prog = pointProgress[p.id];
      if (!prog || prog.team !== 'red') prog = { team: 'red', value: 0 };
      prog.value += dt / CAPTURE_TIME;
      if (prog.value >= 1) {
        pointOwner[p.id] = 'red';
        delete pointProgress[p.id];
        pushFloat(p.x, p.y - 10, `${p.name.toUpperCase()} LOST`, '#f87171', 1.6);
      } else { pointProgress[p.id] = prog; }
    } else {
      const prog = pointProgress[p.id];
      if (prog) {
        prog.value = Math.max(0, prog.value - dt / CAPTURE_DECAY);
        if (prog.value === 0) delete pointProgress[p.id];
      }
    }
  }
}

// ===== Resources =====
function updateResources(dt) {
  for (const team of ['blue', 'red']) {
    let owned = 0;
    for (const p of STRAT_POINTS) if (pointOwner[p.id] === team) owned++;
    resources[team] += (RESOURCE_BASE + RESOURCE_PER_POINT * owned) * dt;
  }
}

// ===== Win =====
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
  if (holdTimer.blue >= WIN_HOLD_TIME) showGameOver('win');
  else if (holdTimer.red >= WIN_HOLD_TIME) showGameOver('lose');
}

// ===== Abilities =====
function deployFromHud(type) {
  const t = UNIT_TYPES[type];
  if (!t) return;
  if (resources.blue < t.cost) { flash(`need ${t.cost} supply`); return; }
  resources.blue -= t.cost;
  const offX = (Math.random() - 0.5) * 50;
  const offY = (Math.random() - 0.5) * 50;
  spawnUnit('blue', type, HQ_BLUE.x + offX, HQ_BLUE.y + offY);
  tutorialMark('deploy');
}

function tryAbility(name) {
  if (matchEnded || paused) return;
  if (cooldowns.blue[name] > 0) return;
  const a = ABILITIES[name];
  if (a.needsTarget) {
    ability.active = name;
    showTargeting(`click target — ${a.name.toLowerCase()}`);
  } else {
    fireReinforce('blue');
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
  if (team === 'blue') tutorialMark('ability');
}

function fireReinforce(team) {
  cooldowns[team].reinforce = ABILITIES.reinforce.cd;
  const hq = team === 'blue' ? HQ_BLUE : HQ_RED;
  spawnUnit(team, 'infantry', hq.x + (Math.random() - 0.5) * 40, hq.y + (Math.random() - 0.5) * 40);
  spawnUnit(team, 'infantry', hq.x + (Math.random() - 0.5) * 40, hq.y + (Math.random() - 0.5) * 40);
  pushFloat(hq.x, hq.y - 30, 'REINFORCED', '#22c55e', 1.2);
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
  if (matchEnded || tutorial.active) return;
  const cfg = DIFFICULTY[botDifficulty];
  botDecisionTimer -= dt;
  botAbilityTimer -= dt;
  if (botDecisionTimer <= 0) {
    botDecisionTimer = cfg.decisionInterval;
    const myUnits = units.filter(u => u.team === 'red' && u.hp > 0);
    const blueUnits = units.filter(u => u.team === 'blue' && u.hp > 0);

    for (const u of myUnits) {
      const cap = UNIT_TYPES[u.type].canCapture;
      // defense priority
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
      // pick capturable target nearest us
      let best = null, bd = Infinity;
      for (const p of STRAT_POINTS) {
        if (pointOwner[p.id] === 'red') continue;
        if (!cap.includes(p.type)) continue;
        const d = dist(u, p) - (pointOwner[p.id] === 'blue' ? 60 : 0);
        if (d < bd) { bd = d; best = p; }
      }
      const reassign = !u.target || (u.target.kind === 'point' && pointOwner[u.target.pointId] === 'red');
      if (best && (reassign || Math.random() < cfg.targetReassignChance)) {
        u.target = { kind: 'point', pointId: best.id };
      } else if (!u.target && blueUnits.length) {
        let bn = null, bnd = Infinity;
        for (const b of blueUnits) {
          const d = dist(u, b);
          if (d < bnd) { bnd = d; bn = b; }
        }
        if (bn) u.target = { kind: 'unit', unitId: bn.id };
      }
    }

    // deploy if we can afford and want to
    if (myUnits.length < cfg.maxUnits && Math.random() < cfg.deployChance) {
      const weights = BOT_DEPLOY_WEIGHTS[botDifficulty];
      const pick = pickWeighted(weights);
      const cost = UNIT_TYPES[pick].cost;
      if (resources.red >= cost) {
        resources.red -= cost;
        spawnUnit('red', pick, HQ_RED.x + (Math.random() - 0.5) * 40, HQ_RED.y + (Math.random() - 0.5) * 40);
      }
    }
  }

  if (botAbilityTimer <= 0) {
    botAbilityTimer = cfg.abilityInterval;
    if (cooldowns.red.airstrike <= 0 && Math.random() < cfg.abilityChance) {
      const blueUnits = units.filter(u => u.team === 'blue' && u.hp > 0);
      let bestCenter = null, bestCount = 0;
      for (const b of blueUnits) {
        let count = 0;
        for (const o of blueUnits) if (dist(b, o) < 60) count++;
        if (count > bestCount) { bestCount = count; bestCenter = b; }
      }
      if (bestCenter && bestCount >= cfg.clusterThreshold) {
        fireAbility('airstrike', bestCenter.x, bestCenter.y, 'red');
      }
    }
    if (cfg.useReinforce && cooldowns.red.reinforce <= 0 && units.filter(u => u.team === 'red' && u.hp > 0).length < 4) {
      fireReinforce('red');
    }
  }
}

// ===== Visibility =====
function isVisibleToBlue(target) {
  for (const u of units) {
    if (u.team !== 'blue' || u.hp <= 0) continue;
    if (dist(u, target) < UNIT_TYPES[u.type].vision) return true;
  }
  for (const p of [HQ_BLUE, ...STRAT_POINTS]) {
    if (pointOwner[p.id] !== 'blue') continue;
    if (dist(p, target) < 130) return true;
  }
  for (const r of reconZones) {
    if (r.team === 'blue' && dist(r, target) < r.radius) return true;
  }
  return false;
}

// ===== Floats =====
function pushFloat(x, y, text, color, ttl = 0.9) {
  floats.push({ x, y, text, color, life: ttl, max: ttl, vy: -22 });
}
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

  for (const u of units) {
    if (u.hp <= 0) continue;
    if (u.team === 'blue') drawUnit(ctx, u);
  }
  for (const u of units) {
    if (u.hp <= 0) continue;
    if (u.team === 'red' && isVisibleToBlue(u)) drawUnit(ctx, u);
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
  ctx.fillStyle = '#0a1f33';
  ctx.fillRect(0, 0, MAP_W, MAP_H);
  ctx.fillStyle = '#1f4d2b';
  ctx.beginPath();
  ctx.moveTo(0, 700);
  ctx.lineTo(0, 320);
  ctx.bezierCurveTo(120, 280, 260, 320, 360, 290);
  ctx.bezierCurveTo(440, 270, 540, 330, 600, 360);
  ctx.bezierCurveTo(660, 390, 620, 460, 580, 480);
  ctx.bezierCurveTo(540, 500, 460, 510, 380, 530);
  ctx.bezierCurveTo(300, 550, 240, 590, 180, 620);
  ctx.bezierCurveTo(120, 650, 60, 680, 0, 700);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(280, 200, 90, 60, 0, 0, Math.PI * 2);
  ctx.fill();
  // air overlay
  ctx.save();
  ctx.fillStyle = 'rgba(56, 189, 248, 0.07)';
  ctx.beginPath();
  ctx.moveTo(1100, 0);
  ctx.lineTo(540, 0);
  ctx.lineTo(620, 240);
  ctx.lineTo(1100, 280);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // grid texture
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
  drawHq(ctx, HQ_BLUE, 'blue');
  drawHq(ctx, HQ_RED,  'red');
  for (const p of STRAT_POINTS) {
    const owner = pointOwner[p.id];
    const ringColor = owner === 'blue' ? '#38bdf8' : owner === 'red' ? '#f87171' : '#6f8aa6';
    ctx.strokeStyle = 'rgba(111, 138, 166, 0.15)';
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, CAPTURE_RADIUS, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = owner === 'blue' ? 'rgba(56, 189, 248, 0.20)' : owner === 'red' ? 'rgba(248, 113, 113, 0.20)' : 'rgba(111, 138, 166, 0.18)';
    ctx.beginPath(); ctx.arc(p.x, p.y, 22, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 2;
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
      ctx.fillRect(p.x - barW / 2, p.y - 36, barW, barH);
      ctx.fillStyle = prog.team === 'blue' ? '#38bdf8' : '#f87171';
      ctx.fillRect(p.x - barW / 2, p.y - 36, barW * prog.value, barH);
    }
  }
  ctx.textAlign = 'start'; ctx.textBaseline = 'top';
}

function drawHq(ctx, hq, team) {
  const trim = team === 'blue' ? '#38bdf8' : '#f87171';
  ctx.fillStyle = team === 'blue' ? 'rgba(56, 189, 248, 0.18)' : 'rgba(248, 113, 113, 0.18)';
  ctx.beginPath();
  ctx.arc(hq.x, hq.y, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = trim;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = trim;
  ctx.font = 'bold 18px ui-sans-serif, system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('★', hq.x, hq.y);
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(hq.name, hq.x, hq.y + 46);
  ctx.textAlign = 'start'; ctx.textBaseline = 'top';
}

function drawUnit(ctx, u) {
  const t = UNIT_TYPES[u.type];
  const isBlue = u.team === 'blue';
  const fill = isBlue ? '#38bdf8' : '#f87171';
  const halo = isBlue ? 'rgba(56, 189, 248, 0.22)' : 'rgba(248, 113, 113, 0.22)';

  // target indicator line for friendlies
  if (isBlue && u.target) {
    let tx, ty;
    if (u.target.kind === 'unit') {
      const t2 = unitById(u.target.unitId); if (t2) { tx = t2.x; ty = t2.y; }
    } else if (u.target.kind === 'point') {
      const p = STRAT_POINTS.find(pp => pp.id === u.target.pointId); if (p) { tx = p.x; ty = p.y; }
    } else { tx = u.target.x; ty = u.target.y; }
    if (tx !== undefined) {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.30)';
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // team-colored halo so units pop against terrain
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(u.x, u.y, 17, 0, Math.PI * 2);
  ctx.fill();

  // body shape
  ctx.fillStyle = fill;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  switch (u.type) {
    case 'infantry':                                  // circle
      ctx.arc(u.x, u.y, 11, 0, Math.PI * 2);
      break;
    case 'sniper':                                    // diamond
      ctx.moveTo(u.x, u.y - 12);
      ctx.lineTo(u.x + 10, u.y);
      ctx.lineTo(u.x, u.y + 12);
      ctx.lineTo(u.x - 10, u.y);
      ctx.closePath();
      break;
    case 'tank':                                      // square
      ctx.rect(u.x - 12, u.y - 12, 24, 24);
      break;
    case 'gunboat':                                   // wide rounded rect
      roundRectPath(ctx, u.x - 13, u.y - 8, 26, 16, 4);
      break;
    case 'destroyer':                                 // long rounded rect
      roundRectPath(ctx, u.x - 16, u.y - 9, 32, 18, 4);
      break;
    case 'fighter':                                   // triangle (point up)
      ctx.moveTo(u.x, u.y - 13);
      ctx.lineTo(u.x + 12, u.y + 10);
      ctx.lineTo(u.x - 12, u.y + 10);
      ctx.closePath();
      break;
    case 'bomber':                                    // bigger triangle
      ctx.moveTo(u.x, u.y - 15);
      ctx.lineTo(u.x + 15, u.y + 12);
      ctx.lineTo(u.x - 15, u.y + 12);
      ctx.closePath();
      break;
  }
  ctx.fill();
  ctx.stroke();

  // bold white letter glyph
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
  ctx.beginPath();
  ctx.arc(u.x, u.y, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(252, 211, 77, 0.10)';
  ctx.beginPath();
  ctx.arc(u.x, u.y, UNIT_TYPES[u.type].vision, 0, Math.PI * 2);
  ctx.stroke();
}

function drawZones(ctx) {
  for (const r of reconZones) {
    const alpha = (r.life / r.max) * 0.25;
    ctx.fillStyle = `rgba(167, 139, 250, ${alpha})`;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
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
  // Build the fog on an offscreen canvas so destination-out can't erase
  // the main canvas's units/terrain.
  ensureFogCanvas();
  const fctx = fogCanvas.getContext('2d');
  fctx.save();
  fctx.globalCompositeOperation = 'source-over';
  fctx.clearRect(0, 0, MAP_W, MAP_H);
  fctx.fillStyle = 'rgba(5, 11, 19, 0.62)';
  fctx.fillRect(0, 0, MAP_W, MAP_H);
  fctx.globalCompositeOperation = 'destination-out';
  for (const u of units) {
    if (u.team !== 'blue' || u.hp <= 0) continue;
    const v = UNIT_TYPES[u.type].vision;
    const g = fctx.createRadialGradient(u.x, u.y, 0, u.x, u.y, v);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.7)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.fillStyle = g;
    fctx.beginPath(); fctx.arc(u.x, u.y, v, 0, Math.PI * 2); fctx.fill();
  }
  for (const p of [HQ_BLUE, ...STRAT_POINTS]) {
    if (pointOwner[p.id] !== 'blue') continue;
    const r = 130;
    const g = fctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.fillStyle = g;
    fctx.beginPath(); fctx.arc(p.x, p.y, r, 0, Math.PI * 2); fctx.fill();
  }
  for (const r of reconZones) {
    if (r.team !== 'blue') continue;
    const g = fctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, r.radius);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.fillStyle = g;
    fctx.beginPath(); fctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2); fctx.fill();
  }
  fctx.restore();
  // Composite onto main canvas (transparent areas leave units untouched)
  ctx.drawImage(fogCanvas, 0, 0);
}

function drawAbilityCursor(ctx) {
  const a = ABILITIES[ability.active];
  const radius = a.radius || 30;
  const color = ability.active === 'airstrike' ? '#fcd34d' : '#a78bfa';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.arc(mouse.x, mouse.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(mouse.x, mouse.y, 3, 0, Math.PI * 2);
  ctx.fill();
}

// ===== HUD =====
function updateHUD() {
  if (scene !== 'match') return;
  let blueOwned = 0, redOwned = 0;
  for (const p of STRAT_POINTS) {
    if (pointOwner[p.id] === 'blue') blueOwned++;
    if (pointOwner[p.id] === 'red')  redOwned++;
  }
  document.getElementById('score-blue').textContent = `${blueOwned} / ${STRAT_POINTS.length}`;
  document.getElementById('score-red').textContent  = `${redOwned} / ${STRAT_POINTS.length}`;
  document.getElementById('hold-blue').style.width = (holdTimer.blue / WIN_HOLD_TIME * 100) + '%';
  document.getElementById('hold-red').style.width  = (holdTimer.red  / WIN_HOLD_TIME * 100) + '%';
  document.getElementById('resource-val').textContent = Math.floor(resources.blue);
  document.getElementById('resource-rate').textContent = `+${(RESOURCE_BASE + RESOURCE_PER_POINT * blueOwned).toFixed(1)} / sec`;
  for (const btn of document.querySelectorAll('.deploy-btn')) {
    const type = btn.dataset.type;
    btn.disabled = resources.blue < UNIT_TYPES[type].cost;
  }
  setAbilityCd('ability-airstrike', cooldowns.blue.airstrike, ABILITIES.airstrike.cd, ability.active === 'airstrike');
  setAbilityCd('ability-reinforce', cooldowns.blue.reinforce, ABILITIES.reinforce.cd, false);
  setAbilityCd('ability-recon',     cooldowns.blue.recon,     ABILITIES.recon.cd,     ability.active === 'recon');
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

function hitUnit(pt, team = 'blue') {
  for (const u of units) {
    if (u.hp <= 0) continue;
    if (team && u.team !== team) continue;
    if (dist(u, pt) < 14) return u;
  }
  return null;
}
function hitEnemyUnit(pt) {
  for (const u of units) {
    if (u.hp <= 0 || u.team === 'blue') continue;
    if (!isVisibleToBlue(u)) continue;
    if (dist(u, pt) < 14) return u;
  }
  return null;
}
function hitPoint(pt) {
  for (const p of STRAT_POINTS) {
    if (dist(p, pt) < 26) return p;
  }
  return null;
}

function handleLeftClick(pt, shift) {
  if (ability.active) {
    fireAbility(ability.active, pt.x, pt.y, 'blue');
    ability.active = null;
    hideTargeting();
    return;
  }
  const u = hitUnit(pt, 'blue');
  if (u) {
    if (shift) { if (selectedIds.has(u.id)) selectedIds.delete(u.id); else selectedIds.add(u.id); }
    else { selectedIds.clear(); selectedIds.add(u.id); }
    tutorialMark('select');
  } else if (!shift) {
    selectedIds.clear();
  }
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
  for (const id of selectedIds) {
    const u = unitById(id);
    if (u && u.hp > 0) u.target = target;
  }
  tutorialMark('move');
}

function selectAll() {
  selectedIds.clear();
  for (const u of units) if (u.team === 'blue' && u.hp > 0) selectedIds.add(u.id);
}

// ===== Deploy buttons (built dynamically from UNIT_TYPES) =====
function buildDeployButtons() {
  const list = document.getElementById('deploy-list');
  if (!list) return;
  list.innerHTML = '';
  let i = 1;
  for (const [type, t] of Object.entries(UNIT_TYPES)) {
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
    // unit hotkeys 1-7
    if (/^[1-7]$/.test(k)) {
      const idx = parseInt(k, 10) - 1;
      const type = UNIT_TYPE_KEYS[idx];
      if (type) { deployFromHud(type); e.preventDefault(); }
      return;
    }
    if      (k === 'q') tryAbility('airstrike');
    else if (k === 'e') tryAbility('reinforce');
    else if (k === 'r') tryAbility('recon');
    else if (k === 'tab') { selectAll(); e.preventDefault(); }
    else if (k === ' ')   { paused = !paused; e.preventDefault(); }
    else if (k === 'escape') { ability.active = null; hideTargeting(); }
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

  document.getElementById('btn-start').onclick = () => startMatch();
  document.getElementById('btn-tutorial').onclick = () => startTutorial();
  document.getElementById('btn-leave').onclick = () => {
    document.getElementById('tutorial-panel').classList.add('hidden');
    removeOverlay(); showScene('lobby');
  };

  // Lobby toggle buttons — single-select within each group
  for (const btn of document.querySelectorAll('.seg-btn:not(:disabled)')) {
    btn.onclick = () => {
      const group = btn.closest('.seg');
      for (const b of group.querySelectorAll('.seg-btn')) b.classList.remove('active');
      btn.classList.add('active');
      if (btn.dataset.diff) botDifficulty = btn.dataset.diff;
    };
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
    updateUnits(dt);
    updateCombat(dt);
    updateCapture(dt);
    updateResources(dt);
    updateAbilityCooldowns(dt);
    updateZones(dt);
    updateBot(dt);
    updateFloats(dt);
    updateWin(dt);
  } else if (scene === 'match') {
    updateFloats(dt);
  }
  if (scene === 'match') {
    render();
    updateHUD();
  }
  requestAnimationFrame(gameLoop);
}

// ===== Init =====
window.addEventListener('DOMContentLoaded', () => {
  buildDeployButtons();
  setupInputs();
  showScene('lobby');
  lastTime = performance.now();
  requestAnimationFrame(gameLoop);
});
