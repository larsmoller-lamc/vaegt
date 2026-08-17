// ============================================================
// VÆGT — App-logik
// ============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
  getFirestore, doc, setDoc, collection, getDocs, query, orderBy
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

import { firebaseConfig, ALLOWED_EMAIL } from './config.js';

// ============ MÅLKURVE ============
// Start: 17-08-2026 @ 93.2 kg → -0.07 kg/dag → floor ved 76 kg
const START_DATE = "2026-08-17";
const START_WEIGHT = 93.2;
const DAILY_DELTA = 0.07;
const FLOOR_WEIGHT = 76.0;

// ============ SCORE-LOGIK ============
// 9 aktiviteter + 1 point for vægt ≤ mål = max 10
const MAX_SCORE = 10;

// ============ AKTIVITETER ============
const ACTIVITIES = {
  motion: [
    { id: 'run',    name: 'Løb',            detail: '' },
    { id: 'fit',    name: 'Fitness',        detail: '' },
    { id: 'swim',   name: 'Svømning',       detail: '>500 m' },
    { id: 'tennis', name: 'Tennis',         detail: '>1 time' },
    { id: 'walk',   name: 'Gåtur',          detail: '+4 km' }
  ],
  food: [
    { id: 'noCake',   name: 'Ingen kage og is',    detail: '' },
    { id: 'noChips',  name: 'Ingen slik og chips', detail: '' },
    { id: 'noPre11',  name: 'Ingen mad før 11',    detail: '' },
    { id: 'noPost20', name: 'Ingen mad efter 20',  detail: '' }
  ]
};

const ALL_ACTIVITY_IDS = [
  ...ACTIVITIES.motion.map(a => a.id),
  ...ACTIVITIES.food.map(a => a.id)
];

// ============ INIT FIREBASE ============
let app, auth, db, currentUser;
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  console.error('Firebase init failed:', e);
}

// ============ HELPERS ============
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const daysBetween = (a, b) => Math.round((b - a) / 86400000);

// Dansk tal-formatering: 93.2 → "93,2"
function formatNum(n, decimals = 1) {
  if (n == null || isNaN(n)) return '—';
  return n.toFixed(decimals).replace('.', ',');
}

// Dansk tal-parsning: "93,2" eller "93.2" → 93.2
function parseNum(str) {
  if (str == null) return NaN;
  const cleaned = String(str).trim().replace(',', '.').replace(/\s/g, '');
  if (cleaned === '') return NaN;
  return parseFloat(cleaned);
}

function formatDateDA(iso) {
  const d = parseISO(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()}`;
}
function formatDayDA(iso) {
  const d = parseISO(iso);
  const days = ['Søndag','Mandag','Tirsdag','Onsdag','Torsdag','Fredag','Lørdag'];
  return days[d.getDay()];
}

function targetForDate(iso) {
  const start = parseISO(START_DATE);
  const cur = parseISO(iso);
  const days = daysBetween(start, cur);
  if (days < 0) return START_WEIGHT;
  const target = START_WEIGHT - days * DAILY_DELTA;
  return Math.max(target, FLOOR_WEIGHT);
}

// Score inkl. vægt-bonus (max 10)
function computeScore(entry, iso) {
  const activityScore = ALL_ACTIVITY_IDS.reduce(
    (s, id) => s + (entry?.activities?.[id] ? 1 : 0), 0
  );
  const target = targetForDate(iso);
  const weightPoint = (entry?.weight != null && entry.weight <= target) ? 1 : 0;
  return activityScore + weightPoint;
}

// Score-zoner nu skaleret til /10
// ≥5 = vægttab, 4 = hold, ≤3 = tag på
function scoreZone(score) {
  if (score >= 5) return 'loss';
  if (score === 4) return 'hold';
  if (score >= 1) return 'gain';
  return 'none';
}

function scoreVerdict(score) {
  if (score >= 5) return 'Vægttab-zone';
  if (score === 4) return 'Hold vægten';
  if (score >= 1) return 'Risiko for at tage på';
  return 'Ingen aktiviteter';
}

function showToast(text = 'Gemt', ms = 1500) {
  $('toastText').textContent = text;
  $('toast').classList.add('show');
  setTimeout(() => $('toast').classList.remove('show'), ms);
}

// ============ APP STATE ============
let currentDate = toISO(new Date());
let currentEntry = null; // { weight, activities: {id: bool} }
let allEntries = {};     // { iso: entry }
let chartRange = 30;
let saveTimeout = null;

// ============ RENDER AKTIVITETER ============
function renderActivityGrid(groupId, activities) {
  const grid = $(groupId);
  grid.innerHTML = '';
  activities.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'activity-btn';
    btn.dataset.id = a.id;
    btn.innerHTML = `
      <div class="activity-check">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <div class="activity-text">
        <div class="activity-name">${a.name}</div>
        ${a.detail ? `<div class="activity-detail">${a.detail}</div>` : ''}
      </div>
    `;
    btn.addEventListener('click', () => toggleActivity(a.id));
    grid.appendChild(btn);
  });
}

function toggleActivity(id) {
  if (!currentEntry) currentEntry = { weight: null, activities: {} };
  currentEntry.activities[id] = !currentEntry.activities[id];
  renderEntryState();
  queueSave();
}

// ============ RENDER STATE ============
function renderEntryState() {
  // Aktiviteter
  document.querySelectorAll('.activity-btn').forEach(btn => {
    const on = currentEntry?.activities?.[btn.dataset.id] === true;
    btn.classList.toggle('checked', on);
  });

  // Score (inkl. vægt-bonus, /10)
  const score = computeScore(currentEntry, currentDate);
  $('scoreNumber').textContent = score;
  $('scoreVerdict').textContent = scoreVerdict(score);
  $('scoreLabel').textContent = currentDate === toISO(new Date()) ? 'Score i dag' : 'Score';

  const zone = scoreZone(score);
  $('scoreDisplay').className = 'score-display zone-' + zone;

  // Mål
  const target = targetForDate(currentDate);
  $('targetValue').textContent = formatNum(target, 1);

  // Vægt-input (kun opdater hvis feltet ikke er i fokus — så vi ikke afbryder skrivning)
  const w = currentEntry?.weight;
  const wInput = $('weightInput');
  if (document.activeElement !== wInput) {
    wInput.value = (w != null) ? formatNum(w, 1) : '';
  }

  // Diff + point-badge
  if (w != null) {
    const diff = w - target;
    const sign = diff > 0 ? '+' : '';
    $('targetDiff').textContent = `${sign}${formatNum(diff, 1)} kg`;
    $('targetDiff').style.color = diff > 0 ? 'var(--zone-gain)' : 'var(--zone-loss)';
    $('targetPointBadge').classList.toggle('visible', w <= target);
  } else {
    $('targetDiff').textContent = '\u00a0';
    $('targetPointBadge').classList.remove('visible');
  }
}

function renderDateHeader() {
  $('heroDate').textContent = formatDateDA(currentDate);
  $('heroDay').textContent = formatDayDA(currentDate);
  const today = toISO(new Date());
  $('nextDay').disabled = currentDate >= today;
}

// ============ VÆGT-INPUT ============
// Tillader både komma og punktum. Filtrerer ugyldige tegn.
const weightInput = $('weightInput');

weightInput.addEventListener('input', (e) => {
  // Behold kun cifre, komma, punktum og minus
  let val = e.target.value.replace(/[^0-9.,\-]/g, '');
  // Hvis både komma og punktum: behold kun første forekomst
  const firstSep = val.search(/[.,]/);
  if (firstSep !== -1) {
    const head = val.slice(0, firstSep + 1);
    const tail = val.slice(firstSep + 1).replace(/[.,]/g, '');
    val = head + tail;
  }
  if (val !== e.target.value) e.target.value = val;

  const num = parseNum(val);
  if (!currentEntry) currentEntry = { weight: null, activities: {} };
  currentEntry.weight = isNaN(num) ? null : num;

  // Rå re-render af score/badge uden at røre input-feltet
  const score = computeScore(currentEntry, currentDate);
  $('scoreNumber').textContent = score;
  $('scoreVerdict').textContent = scoreVerdict(score);
  $('scoreDisplay').className = 'score-display zone-' + scoreZone(score);

  const target = targetForDate(currentDate);
  if (currentEntry.weight != null) {
    const diff = currentEntry.weight - target;
    const sign = diff > 0 ? '+' : '';
    $('targetDiff').textContent = `${sign}${formatNum(diff, 1)} kg`;
    $('targetDiff').style.color = diff > 0 ? 'var(--zone-gain)' : 'var(--zone-loss)';
    $('targetPointBadge').classList.toggle('visible', currentEntry.weight <= target);
  } else {
    $('targetDiff').textContent = '\u00a0';
    $('targetPointBadge').classList.remove('visible');
  }

  queueSave();
});

// Ved blur — normaliser visning til "93,2"
weightInput.addEventListener('blur', () => {
  if (currentEntry?.weight != null) {
    weightInput.value = formatNum(currentEntry.weight, 1);
  }
});

// Ved focus — vis rå tal (uden trailing formatting)
weightInput.addEventListener('focus', (e) => {
  // Sæt caret bagest når man tapper ind
  setTimeout(() => e.target.select(), 0);
});

// ============ DATE NAV ============
$('prevDay').addEventListener('click', () => {
  const d = parseISO(currentDate); d.setDate(d.getDate()-1);
  currentDate = toISO(d); loadEntry();
});
$('nextDay').addEventListener('click', () => {
  const today = toISO(new Date());
  if (currentDate >= today) return;
  const d = parseISO(currentDate); d.setDate(d.getDate()+1);
  currentDate = toISO(d); loadEntry();
});
$('todayBtn').addEventListener('click', () => {
  currentDate = toISO(new Date()); loadEntry();
});

// ============ FIRESTORE ============
async function loadAllEntries() {
  if (!currentUser) return;
  const col = collection(db, 'users', currentUser.uid, 'entries');
  const q = query(col, orderBy('__name__'));
  const snap = await getDocs(q);
  allEntries = {};
  snap.forEach(doc => { allEntries[doc.id] = doc.data(); });
}

async function loadEntry() {
  renderDateHeader();
  currentEntry = allEntries[currentDate] || { weight: null, activities: {} };
  renderEntryState();
  renderStats();
  renderCharts();
}

function queueSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  $('savingBadge').classList.add('visible');
  saveTimeout = setTimeout(() => saveEntry(), 500);
}

async function saveEntry() {
  if (!currentUser || !currentEntry) return;
  try {
    const ref = doc(db, 'users', currentUser.uid, 'entries', currentDate);
    const data = {
      weight: currentEntry.weight ?? null,
      activities: currentEntry.activities || {},
      score: computeScore(currentEntry, currentDate),
      updatedAt: new Date().toISOString()
    };
    await setDoc(ref, data);
    allEntries[currentDate] = data;
    $('savingBadge').classList.remove('visible');
    renderStats();
    renderCharts();
  } catch (e) {
    console.error('Save failed:', e);
    showToast('Kunne ikke gemme', 2500);
  }
}

// ============ STATS ============
function renderStats() {
  const dates = Object.keys(allEntries).sort();
  const withWeight = dates.filter(d => allEntries[d].weight != null);
  const last7 = withWeight.slice(-7);
  if (last7.length > 0) {
    const avg = last7.reduce((s,d) => s + allEntries[d].weight, 0) / last7.length;
    $('stat7').textContent = formatNum(avg, 1);
  } else {
    $('stat7').textContent = '—';
  }

  // Streak — dage med score ≥5 i træk (bagfra)
  const scored = dates.filter(d => allEntries[d].score != null).sort();
  let streak = 0;
  for (let i = scored.length - 1; i >= 0; i--) {
    if (allEntries[scored[i]].score >= 5) streak++;
    else break;
  }
  $('statStreak').textContent = streak;

  // Afvigelse i dag
  const w = currentEntry?.weight;
  if (w != null) {
    const diff = w - targetForDate(currentDate);
    const el = $('statDiff');
    el.textContent = (diff > 0 ? '+' : '') + formatNum(diff, 1);
    el.className = 'stat-value ' + (diff > 0 ? 'neg' : 'pos');
  } else {
    $('statDiff').textContent = '—';
    $('statDiff').className = 'stat-value';
  }
}

// ============ CHART (canvas — ingen dependencies) ============
function renderCharts() {
  renderWeightChart();
  renderScoreChart();
}

function getRangeDates() {
  const dates = Object.keys(allEntries).sort();
  if (chartRange === 'all' || dates.length === 0) return dates;
  const n = parseInt(chartRange);
  const today = new Date();
  const start = new Date();
  start.setDate(today.getDate() - n + 1);
  const result = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    result.push(toISO(d));
  }
  return result;
}

function renderWeightChart() {
  const canvas = $('weightChart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);

  const dates = getRangeDates();
  if (dates.length === 0) { drawEmptyChart(ctx, w, h); return; }

  const weights = dates.map(d => allEntries[d]?.weight ?? null);
  const targets = dates.map(d => targetForDate(d));

  const rolling = weights.map((_, i) => {
    const slice = weights.slice(Math.max(0, i - 6), i + 1).filter(v => v != null);
    if (slice.length < 2) return null;
    return slice.reduce((s,v) => s+v, 0) / slice.length;
  });

  const allVals = [...weights.filter(v => v != null), ...targets, ...rolling.filter(v => v != null)];
  if (allVals.length === 0) { drawEmptyChart(ctx, w, h); return; }
  let yMin = Math.min(...allVals) - 0.5;
  let yMax = Math.max(...allVals) + 0.5;
  if (yMax - yMin < 3) { const c = (yMax+yMin)/2; yMin = c - 1.5; yMax = c + 1.5; }

  const padC = { l: 40, r: 12, t: 16, b: 24 };
  const cw = w - padC.l - padC.r;
  const ch = h - padC.t - padC.b;

  const xOf = i => padC.l + (dates.length <= 1 ? cw/2 : (i / (dates.length - 1)) * cw);
  const yOf = v => padC.t + ch - ((v - yMin) / (yMax - yMin)) * ch;

  // Grid + Y labels
  ctx.strokeStyle = '#E8EFEA';
  ctx.lineWidth = 1;
  ctx.font = '600 10px "JetBrains Mono", monospace';
  ctx.fillStyle = '#8A9A93';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  const yStep = (yMax - yMin) / 4;
  for (let i = 0; i <= 4; i++) {
    const v = yMin + i * yStep;
    const y = yOf(v);
    ctx.beginPath();
    ctx.moveTo(padC.l, y); ctx.lineTo(w - padC.r, y);
    ctx.stroke();
    ctx.fillText(formatNum(v, 1), padC.l - 6, y);
  }

  // X labels
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelIdx = dates.length <= 4 ? dates.map((_,i)=>i) : [0, Math.floor(dates.length/2), dates.length-1];
  labelIdx.forEach(i => {
    const d = parseISO(dates[i]);
    const label = `${pad(d.getDate())}/${pad(d.getMonth()+1)}`;
    ctx.fillText(label, xOf(i), h - padC.b + 6);
  });

  // Mål-linje (stiplet)
  ctx.strokeStyle = '#8A9A93';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  targets.forEach((v, i) => {
    if (i === 0) ctx.moveTo(xOf(i), yOf(v));
    else ctx.lineTo(xOf(i), yOf(v));
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // 7-dages snit
  ctx.strokeStyle = '#4A7C59';
  ctx.lineWidth = 2;
  ctx.beginPath();
  let started = false;
  rolling.forEach((v, i) => {
    if (v == null) { started = false; return; }
    if (!started) { ctx.moveTo(xOf(i), yOf(v)); started = true; }
    else ctx.lineTo(xOf(i), yOf(v));
  });
  ctx.stroke();

  // Faktisk vægt
  ctx.strokeStyle = '#0F3D2E';
  ctx.lineWidth = 2;
  ctx.beginPath();
  started = false;
  weights.forEach((v, i) => {
    if (v == null) { started = false; return; }
    if (!started) { ctx.moveTo(xOf(i), yOf(v)); started = true; }
    else ctx.lineTo(xOf(i), yOf(v));
  });
  ctx.stroke();

  ctx.fillStyle = '#0F3D2E';
  weights.forEach((v, i) => {
    if (v != null) {
      ctx.beginPath();
      ctx.arc(xOf(i), yOf(v), 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function renderScoreChart() {
  const canvas = $('scoreChart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);

  const dates = getRangeDates();
  if (dates.length === 0) { drawEmptyChart(ctx, w, h); return; }

  const scores = dates.map(d => allEntries[d]?.score ?? null);
  const padC = { l: 24, r: 12, t: 16, b: 24 };
  const cw = w - padC.l - padC.r;
  const ch = h - padC.t - padC.b;
  const yMax = MAX_SCORE;

  const barW = Math.max(2, (cw / dates.length) * 0.7);
  const step = cw / dates.length;

  // Baseline på 4 (hold-vægt)
  const yOf4 = padC.t + ch - (4 / yMax) * ch;
  ctx.strokeStyle = '#C89B2E';
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padC.l, yOf4);
  ctx.lineTo(w - padC.r, yOf4);
  ctx.stroke();
  ctx.setLineDash([]);

  // Baseline på 5 (vægttab-tærskel)
  const yOf5 = padC.t + ch - (5 / yMax) * ch;
  ctx.strokeStyle = '#2E7D5B';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(padC.l, yOf5);
  ctx.lineTo(w - padC.r, yOf5);
  ctx.stroke();
  ctx.setLineDash([]);

  // Bars
  scores.forEach((s, i) => {
    if (s == null) return;
    const x = padC.l + i * step + (step - barW) / 2;
    const barH = (s / yMax) * ch;
    const y = padC.t + ch - barH;
    if (s >= 5) ctx.fillStyle = '#2E7D5B';
    else if (s === 4) ctx.fillStyle = '#C89B2E';
    else if (s >= 1) ctx.fillStyle = '#B84A3E';
    else ctx.fillStyle = '#D8E2DC';
    const r = Math.min(barW / 2, 3);
    roundRect(ctx, x, y, barW, Math.max(barH, 2), r);
    ctx.fill();
  });

  // Y labels
  ctx.font = '600 10px "JetBrains Mono", monospace';
  ctx.fillStyle = '#8A9A93';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  [0, 4, 5, 10].forEach(v => {
    const y = padC.t + ch - (v / yMax) * ch;
    ctx.fillText(String(v), padC.l - 4, y);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawEmptyChart(ctx, w, h) {
  ctx.font = '600 12px Nunito, sans-serif';
  ctx.fillStyle = '#8A9A93';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Ingen data endnu', w/2, h/2);
}

// Chart-tabs
document.querySelectorAll('.chart-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    chartRange = tab.dataset.range === 'all' ? 'all' : parseInt(tab.dataset.range);
    renderCharts();
  });
});

window.addEventListener('resize', () => renderCharts());

// ============ MENU ============
$('menuBtn').addEventListener('click', () => $('menuModal').classList.add('open'));
$('menuModal').addEventListener('click', (e) => {
  if (e.target === $('menuModal')) $('menuModal').classList.remove('open');
});

$('exportBtn').addEventListener('click', () => {
  const dates = Object.keys(allEntries).sort();
  const headers = ['Dato','Vægt','Mål','Afvigelse','7dg snit','VægtPoint', ...ALL_ACTIVITY_IDS, 'Score'];
  const rows = [headers];

  dates.forEach((d, idx) => {
    const e = allEntries[d];
    const target = targetForDate(d);
    const diff = e.weight != null ? (e.weight - target).toFixed(2) : '';
    const window7 = dates.slice(Math.max(0, idx-6), idx+1)
      .map(dd => allEntries[dd].weight).filter(v => v != null);
    const avg = window7.length >= 2 ? (window7.reduce((s,v)=>s+v,0)/window7.length).toFixed(2) : '';
    const weightPoint = (e.weight != null && e.weight <= target) ? 1 : 0;
    const acts = ALL_ACTIVITY_IDS.map(id => e.activities?.[id] ? 1 : 0);
    // Brug dansk komma i eksport
    const fmtCsv = v => typeof v === 'number' ? String(v).replace('.', ',') : (typeof v === 'string' && /^-?\d+\.\d+$/.test(v) ? v.replace('.', ',') : v);
    rows.push([d, fmtCsv(e.weight ?? ''), fmtCsv(target.toFixed(2)), fmtCsv(diff), fmtCsv(avg), weightPoint, ...acts, e.score ?? 0]);
  });

  const csv = rows.map(r => r.map(c => {
    const s = String(c);
    return /[,";\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(';')).join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vaegt-${toISO(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  $('menuModal').classList.remove('open');
  showToast('CSV eksporteret');
});

$('signOutBtn').addEventListener('click', async () => {
  await signOut(auth);
  location.reload();
});

// ============ AUTH ============
$('googleSignIn').addEventListener('click', async () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error(e);
    $('loginError').textContent = 'Kunne ikke logge på. Prøv igen.';
    $('loginError').style.display = 'block';
  }
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    if (user.email !== ALLOWED_EMAIL) {
      await signOut(auth);
      $('loginError').textContent = `Adgang kun for ${ALLOWED_EMAIL}`;
      $('loginError').style.display = 'block';
      return;
    }
    currentUser = user;
    $('userName').textContent = user.displayName || 'Bruger';
    $('userEmail').textContent = user.email;
    $('loginScreen').style.display = 'none';
    $('loadingScreen').style.display = 'flex';

    renderActivityGrid('motionGrid', ACTIVITIES.motion);
    renderActivityGrid('foodGrid', ACTIVITIES.food);

    await loadAllEntries();
    $('loadingScreen').style.display = 'none';
    $('app').style.display = 'block';
    await loadEntry();
  } else {
    $('loginScreen').style.display = 'flex';
    $('app').style.display = 'none';
  }
});

// Warn if Firebase not configured
if (firebaseConfig.apiKey === 'REPLACE_WITH_YOUR_API_KEY') {
  console.warn('⚠️ Firebase er ikke konfigureret endnu. Udskift værdierne i assets/js/config.js.');
}
