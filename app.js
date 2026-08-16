import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  collection, doc, setDoc, updateDoc, deleteDoc, getDoc, onSnapshot, deleteField
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ============================================================
   Firebase setup
   ============================================================ */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
  });
} catch (e) {
  // Fallback (e.g. private browsing where IndexedDB persistence can't init)
  const { getFirestore } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
  db = getFirestore(app);
}
setPersistence(auth, browserLocalPersistence).catch(() => {});

/* ============================================================
   Habit color palette (validated categorical set — see dataviz skill).
   Stays constant across every theme so a habit's color always reads
   the same regardless of which appearance is active.
   ============================================================ */
const COLORS = [
  "#3987e5", // blue
  "#d95926", // orange
  "#199e70", // aqua
  "#c98500", // yellow
  "#d55181", // magenta
  "#2fae2f", // green
  "#9085e9", // violet
  "#e66767", // red
];

/* ============================================================
   Themes
   ============================================================ */
const THEMES = [
  { id: "midnight", label: "Midnight", chip: ["#0d0d0d", "#3987e5"] },
  { id: "graphite", label: "Soft Graphite", chip: ["#1d2027", "#5b9bd9"] },
  { id: "light", label: "Light & Airy", chip: ["#fcfcfb", "#2a78d6"] },
  { id: "mono", label: "Minimal Mono", chip: ["#141414", "#c98858"] },
  { id: "ocean", label: "Ocean", chip: ["#0f2027", "#2dd4bf"] },
  { id: "sunset", label: "Sunset Warm", chip: ["#241720", "#f2795c"] },
  { id: "pastel", label: "Pastel Light", chip: ["#ffffff", "#c48fc9"] },
  { id: "neon", label: "Bold Neon", chip: ["#0f0f0f", "#00e5ff"] },
];
const DEFAULT_THEME = "midnight";
let currentTheme = DEFAULT_THEME;

function applyTheme(id, { persist = true, sync = true } = {}) {
  if (!THEMES.some((t) => t.id === id)) id = DEFAULT_THEME;
  currentTheme = id;
  document.documentElement.setAttribute("data-app-theme", id);
  if (persist) { try { localStorage.setItem("habitTheme", id); } catch (e) {} }
  if (sync && currentUser) {
    setDoc(doc(db, "users", currentUser.uid), { theme: id }, { merge: true }).catch(() => {});
  }
  if (document.getElementById("theme-grid").children.length) renderThemeGrid();
}

/* ============================================================
   Date helpers — Sunday-start weeks
   ============================================================ */
const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const startOfWeek = (d) => addDays(d, -d.getDay()); // Sunday = 0
const todayStr = () => fmtDate(new Date());
const monthLabel = (d) => d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
const dayLetters = ["S", "M", "T", "W", "T", "F", "S"];

/* ============================================================
   Completion values
   completions[date] is either:
     - boolean `true`            → simple habit, done
     - a number > 0              → count-based habit, that many done
   Both are truthy, so "was anything logged that day" is always
   `!!completions[date]` regardless of habit type.
   ============================================================ */
function isFull(value, target) {
  if (!value) return false;
  if (typeof value === "number") return value >= (target || 1);
  return true;
}
function isPartial(value, target) {
  return typeof value === "number" && value > 0 && value < (target || 1);
}

/* ============================================================
   Stats helpers
   ============================================================ */
function currentStreak(completions) {
  let count = 0;
  let d = new Date();
  if (!completions[fmtDate(d)]) d = addDays(d, -1);
  while (completions[fmtDate(d)]) { count++; d = addDays(d, -1); }
  return count;
}
function longestStreak(completions) {
  const dates = Object.keys(completions).filter((k) => completions[k]).sort();
  let longest = 0, run = 0, prev = null;
  for (const ds of dates) {
    if (prev && fmtDate(addDays(parseDate(prev), 1)) === ds) run++; else run = 1;
    longest = Math.max(longest, run);
    prev = ds;
  }
  return longest;
}
function totalCompleted(completions) {
  return Object.values(completions).filter(Boolean).length;
}
function countInRange(completions, startDate, days) {
  let n = 0;
  for (let i = 0; i < days; i++) {
    if (completions[fmtDate(addDays(startDate, i))]) n++;
  }
  return n;
}
function thisWeekCount(completions) {
  return countInRange(completions, startOfWeek(new Date()), 7);
}

/* ============================================================
   App state
   ============================================================ */
let currentUser = null;
let habits = {};           // id -> habit object
let habitsUnsub = null;
let currentTab = "today";
let detailHabitId = null;
let editingHabitId = null; // null = creating new habit
let modalSelectedColor = COLORS[0];
let modalGoal = 7;
let modalCountOn = false;
let modalTarget = 3;
let authMode = "login";    // "login" | "signup"

/* ============================================================
   DOM refs
   ============================================================ */
const $ = (sel) => document.querySelector(sel);
const authScreen = $("#auth-screen");
const appRoot = $("#app-root");
const authForm = $("#auth-form");
const authEmail = $("#auth-email");
const authPassword = $("#auth-password");
const authError = $("#auth-error");
const authSubmit = $("#auth-submit");
const authToggle = $("#auth-toggle-mode");

const viewToday = $("#view-today");
const viewStats = $("#view-stats");
const viewDetail = $("#view-detail");
const viewSettings = $("#view-settings");
const todayList = $("#today-list");
const todayEmpty = $("#today-empty");
const greeting = $("#greeting");
const todaySubline = $("#today-subline");

const statsOverview = $("#stats-overview");
const statsHabitList = $("#stats-habit-list");

const detailContent = $("#detail-content");

const themeGridEl = $("#theme-grid");
const settingsEmail = $("#settings-email");

const habitModal = $("#habit-modal");
const habitForm = $("#habit-form");
const habitModalTitle = $("#habit-modal-title");
const habitNameInput = $("#habit-name");
const habitDescInput = $("#habit-description");
const habitUnitInput = $("#habit-unit");
const colorPickerEl = $("#color-picker");
const goalValueEl = $("#goal-value");
const targetValueEl = $("#target-value");
const countToggle = $("#count-toggle");
const countFields = $("#count-fields");
const habitFormError = $("#habit-form-error");

const toastEl = $("#toast");

/* ============================================================
   Toast
   ============================================================ */
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

/* ============================================================
   Auth
   ============================================================ */
function friendlyAuthError(err) {
  const code = err?.code || "";
  const map = {
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/email-already-in-use": "An account already exists with that email — try logging in instead.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/network-request-failed": "Network error — check your connection.",
    "auth/invalid-api-key": "The app isn't connected to Firebase yet — see SETUP_GUIDE.md.",
  };
  return map[code] || "Something went wrong. Please try again.";
}

authToggle.addEventListener("click", () => {
  authMode = authMode === "login" ? "signup" : "login";
  authSubmit.textContent = authMode === "login" ? "Log in" : "Sign up";
  authToggle.textContent = authMode === "login" ? "Don't have an account? Sign up" : "Already have an account? Log in";
  authError.hidden = true;
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.hidden = true;
  authSubmit.disabled = true;
  const email = authEmail.value.trim();
  const password = authPassword.value;
  try {
    if (authMode === "login") {
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      await createUserWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    authError.textContent = friendlyAuthError(err);
    authError.hidden = false;
  } finally {
    authSubmit.disabled = false;
  }
});

$("#logout-btn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (habitsUnsub) { habitsUnsub(); habitsUnsub = null; }

  if (user) {
    authScreen.hidden = true;
    appRoot.hidden = false;
    settingsEmail.textContent = `Logged in as ${user.email}`;
    subscribeHabits(user.uid);
    syncThemeFromCloud(user.uid);
    setGreeting();
  } else {
    appRoot.hidden = true;
    authScreen.hidden = false;
    habits = {};
  }
});

function setGreeting() {
  const h = new Date().getHours();
  const g = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const name = (currentUser?.email || "").split("@")[0];
  greeting.textContent = name ? `${g}, ${name}` : g;
}

async function syncThemeFromCloud(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const remoteTheme = snap.exists() ? snap.data().theme : null;
    if (remoteTheme && remoteTheme !== currentTheme) {
      applyTheme(remoteTheme, { sync: false });
    } else if (!remoteTheme) {
      await setDoc(doc(db, "users", uid), { theme: currentTheme }, { merge: true });
    }
  } catch (e) {
    // offline or first run — local theme still applies, will sync once online
  }
}

/* ============================================================
   Firestore subscription
   ============================================================ */
function habitsCol() { return collection(db, "users", currentUser.uid, "habits"); }
function habitRef(id) { return doc(db, "users", currentUser.uid, "habits", id); }

function subscribeHabits(uid) {
  habitsUnsub = onSnapshot(collection(db, "users", uid, "habits"), (snap) => {
    habits = {};
    snap.forEach((d) => { habits[d.id] = { id: d.id, ...d.data() }; });
    renderActiveView();
  }, (err) => {
    console.error("habits snapshot error", err);
    showToast("Sync error — check your connection");
  });
}

function sortedHabits() {
  return Object.values(habits)
    .filter((h) => !h.archived)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/* ============================================================
   CRUD
   ============================================================ */
async function createHabit(data) {
  const ref = doc(habitsCol());
  await setDoc(ref, {
    name: data.name,
    description: data.description || "",
    color: data.color,
    weeklyGoal: data.weeklyGoal,
    targetCount: data.targetCount || 1,
    unit: data.unit || "",
    archived: false,
    createdAt: Date.now(),
    completions: {},
  });
}
async function updateHabitMeta(id, data) {
  await updateDoc(habitRef(id), {
    name: data.name,
    description: data.description || "",
    color: data.color,
    weeklyGoal: data.weeklyGoal,
    targetCount: data.targetCount || 1,
    unit: data.unit || "",
  });
}
async function toggleCompletion(id, dateStr, done) {
  await updateDoc(habitRef(id), { [`completions.${dateStr}`]: done ? true : deleteField() });
}
async function setCompletionCount(id, dateStr, count) {
  await updateDoc(habitRef(id), { [`completions.${dateStr}`]: count > 0 ? count : deleteField() });
}
async function removeHabit(id) {
  await deleteDoc(habitRef(id));
}

/* ============================================================
   Tab / view navigation
   ============================================================ */
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  viewToday.hidden = tab !== "today";
  viewStats.hidden = tab !== "stats";
  viewSettings.hidden = tab !== "settings";
  viewDetail.hidden = true;
  renderActiveView();
}
function openDetail(id) {
  detailHabitId = id;
  viewToday.hidden = true;
  viewStats.hidden = true;
  viewSettings.hidden = true;
  viewDetail.hidden = false;
  renderDetail();
}
$("#detail-back").addEventListener("click", () => {
  viewDetail.hidden = true;
  viewToday.hidden = currentTab !== "today";
  viewStats.hidden = currentTab !== "stats";
  viewSettings.hidden = currentTab !== "settings";
});

function renderActiveView() {
  if (!viewDetail.hidden) { renderDetail(); return; }
  if (currentTab === "today") renderToday();
  else if (currentTab === "stats") renderStats();
  else if (currentTab === "settings") renderSettings();
}

/* ============================================================
   Mini heatmap (habit card) — last 6 calendar weeks, Sun–Sat rows
   ============================================================ */
function miniGridHTML(h) {
  const weeks = 6;
  const target = h.targetCount || 1;
  const completions = h.completions || {};
  const gridStart = addDays(startOfWeek(new Date()), -7 * (weeks - 1));
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
  let cells = "";
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(gridStart, i);
    const ds = fmtDate(d);
    const val = completions[ds];
    const future = d > endOfToday;
    const cls = [
      isFull(val, target) ? "done" : "",
      isPartial(val, target) ? "done partial" : "",
      future ? "future" : "",
    ].filter(Boolean).join(" ");
    cells += `<div class="cell${cls ? " " + cls : ""}"></div>`;
  }
  return cells;
}

/* ============================================================
   Shared habit card template
   ============================================================ */
function controlHTML(h) {
  const target = h.targetCount || 1;
  const val = h.completions?.[todayStr()];
  if (target <= 1) {
    return `<button class="check-btn${val ? " done" : ""}" data-action="toggle">✓</button>`;
  }
  const count = typeof val === "number" ? val : 0;
  const full = count >= target;
  const unit = h.unit ? ` ${escapeHtml(h.unit)}` : "";
  return `
    <div class="count-control">
      <button type="button" class="icon-btn count-btn" data-action="dec" ${count <= 0 ? "disabled" : ""}>−</button>
      <span class="count-display${full ? " full" : ""}">${count}<span class="count-target">/${target}${unit}</span></span>
      <button type="button" class="icon-btn count-btn${full ? " done" : ""}" data-action="inc">+</button>
    </div>`;
}

function cardHTML(h) {
  const wk = thisWeekCount(h.completions || {});
  return `
    <div class="habit-card" style="--c:${h.color}" data-id="${h.id}">
      <div class="habit-card-top" data-action="open">
        <div class="habit-card-name"><span class="dot"></span><span class="label">${escapeHtml(h.name)}</span></div>
        <span class="habit-card-goal">${wk}/${h.weeklyGoal} this wk</span>
      </div>
      <div class="mini-grid">${miniGridHTML(h)}</div>
      <div class="habit-card-top" style="margin-bottom:0;">
        <div class="habit-card-stats">
          <span class="stat"><b>${totalCompleted(h.completions || {})}</b> done</span>
          <span class="stat"><b>${currentStreak(h.completions || {})}</b> streak</span>
        </div>
        ${controlHTML(h)}
      </div>
    </div>`;
}

/* ============================================================
   Today view — split into "To do" and "Done today"
   ============================================================ */
function renderToday() {
  setGreeting();
  const list = sortedHabits();
  const todo = [], done = [];
  list.forEach((h) => ((h.completions?.[todayStr()]) ? done : todo).push(h));

  todaySubline.textContent = list.length === 0
    ? ""
    : todo.length === 0
      ? "All habits done for today 🎉"
      : `You have ${todo.length} habit${todo.length === 1 ? "" : "s"} left today`;

  todayEmpty.hidden = list.length !== 0;

  let html = "";
  if (todo.length) html += `<h2 class="list-heading">To do</h2><div class="habit-list">${todo.map(cardHTML).join("")}</div>`;
  if (done.length) html += `<h2 class="list-heading">Done today</h2><div class="habit-list">${done.map(cardHTML).join("")}</div>`;
  todayList.innerHTML = html;
}

todayList.addEventListener("click", (e) => {
  const card = e.target.closest(".habit-card");
  if (!card) return;
  const id = card.dataset.id;
  const h = habits[id];
  if (!h) return;
  const action = e.target.closest("[data-action]")?.dataset.action;

  if (action === "toggle") {
    const done = !!h.completions?.[todayStr()];
    toggleCompletion(id, todayStr(), !done).catch(() => showToast("Couldn't save — try again"));
  } else if (action === "inc" || action === "dec") {
    const target = h.targetCount || 1;
    const current = typeof h.completions?.[todayStr()] === "number" ? h.completions[todayStr()] : 0;
    const next = Math.max(0, Math.min(99, current + (action === "inc" ? 1 : -1)));
    setCompletionCount(id, todayStr(), next).catch(() => showToast("Couldn't save — try again"));
  } else {
    openDetail(id);
  }
});

/* ============================================================
   Stats (overview) view
   ============================================================ */
function renderStats() {
  const list = sortedHabits();

  // Overview: total completions per day, this week (Sun–Sat)
  const weekStart = startOfWeek(new Date());
  const perDay = [];
  for (let i = 0; i < 7; i++) {
    const ds = fmtDate(addDays(weekStart, i));
    const n = list.filter((h) => h.completions?.[ds]).length;
    perDay.push(n);
  }
  const maxN = Math.max(1, ...perDay, list.length);
  const bars = perDay.map((n, i) => {
    const h = Math.round((n / maxN) * 100);
    const isToday = fmtDate(addDays(weekStart, i)) === todayStr();
    return `<div class="overview-bar-wrap">
      <div class="overview-bar" style="height:${Math.max(h, 3)}%; opacity:${isToday ? 1 : 0.7}"></div>
      <div class="overview-bar-label">${dayLetters[i]}</div>
    </div>`;
  }).join("");

  statsOverview.innerHTML = list.length === 0 ? "" : `
    <div class="overview-card">
      <h3>This week</h3>
      <p class="muted">Habits completed per day, across all ${list.length} habit${list.length === 1 ? "" : "s"}</p>
      <div class="overview-chart">${bars}</div>
    </div>`;

  statsHabitList.innerHTML = list.map((h) => {
    const total = totalCompleted(h.completions || {});
    const streak = currentStreak(h.completions || {});
    const longest = longestStreak(h.completions || {});
    const wk = thisWeekCount(h.completions || {});
    const pct = Math.min(100, Math.round((wk / h.weeklyGoal) * 100));
    return `
      <div class="habit-card" style="--c:${h.color}" data-id="${h.id}">
        <div class="habit-card-top" data-action="open" style="margin-bottom:10px; cursor:pointer;">
          <div class="habit-card-name"><span class="dot"></span><span class="label">${escapeHtml(h.name)}</span></div>
          <span class="habit-card-goal">${wk}/${h.weeklyGoal} this wk</span>
        </div>
        <div class="goal-progress-track"><div class="goal-progress-fill" style="width:${pct}%"></div></div>
        <div class="habit-card-stats" style="margin-top:12px;">
          <span class="stat"><b>${total}</b> total</span>
          <span class="stat"><b>${streak}</b> streak</span>
          <span class="stat"><b>${longest}</b> longest</span>
        </div>
      </div>`;
  }).join("");

  if (list.length === 0) {
    statsHabitList.innerHTML = `<div class="empty-state"><p>No habits yet.</p><p class="muted">Add a habit to see stats here.</p></div>`;
  }
}

statsHabitList.addEventListener("click", (e) => {
  const card = e.target.closest(".habit-card");
  if (card) openDetail(card.dataset.id);
});

/* ============================================================
   Habit detail view
   ============================================================ */
function renderDetail() {
  const h = habits[detailHabitId];
  if (!h) { viewDetail.hidden = true; return; }
  const completions = h.completions || {};
  const total = totalCompleted(completions);
  const streak = currentStreak(completions);
  const longest = longestStreak(completions);
  const wk = thisWeekCount(completions);
  const pct = Math.min(100, Math.round((wk / h.weeklyGoal) * 100));

  detailContent.innerHTML = `
    <div class="detail-hero" style="--c:${h.color}">
      <div class="dot">✓</div>
      <h2>${escapeHtml(h.name)}</h2>
      ${h.description ? `<p class="muted">${escapeHtml(h.description)}</p>` : ""}
      ${h.targetCount > 1 ? `<p class="muted">Goal: ${h.targetCount}${h.unit ? " " + escapeHtml(h.unit) : ""} / day</p>` : ""}
    </div>

    <div class="stat-row">
      <div class="stat-box"><div class="num">${total}</div><div class="lbl">Total done</div></div>
      <div class="stat-box"><div class="num">${streak}</div><div class="lbl">Current streak</div></div>
      <div class="stat-box"><div class="num">${longest}</div><div class="lbl">Longest streak</div></div>
    </div>

    <div class="section-card" style="--c:${h.color}">
      <h3>This week's goal</h3>
      <div class="goal-progress-track"><div class="goal-progress-fill" style="width:${pct}%"></div></div>
      <div class="goal-progress-text"><span>${wk} of ${h.weeklyGoal} days</span><span>${pct}%</span></div>
    </div>

    <div class="section-card">
      <h3>Last 8 weeks</h3>
      <div class="weekbar-chart">${weekBarsHTML(completions, h.color, h.weeklyGoal)}</div>
    </div>

    <div class="section-card" style="--c:${h.color}">
      <h3>History</h3>
      <div class="week-day-labels">${dayLetters.map((d) => `<span>${d}</span>`).join("")}</div>
      <div class="heatmap-months">${monthsHTML(h)}</div>
    </div>
  `;
}

function weekBarsHTML(completions, color, goal) {
  const weeks = 8;
  const thisWeekStart = startOfWeek(new Date());
  let html = "";
  for (let w = weeks - 1; w >= 0; w--) {
    const ws = addDays(thisWeekStart, -7 * w);
    const n = countInRange(completions, ws, 7);
    const pct = Math.max(4, Math.round((n / 7) * 100));
    const label = w === 0 ? "This" : `${w}w`;
    html += `<div class="weekbar-wrap">
      <div class="weekbar" style="height:${pct}%; background:${color}; opacity:${n >= goal ? 1 : 0.55}"></div>
      <div class="weekbar-label">${label}</div>
    </div>`;
  }
  return html;
}

function monthsHTML(h) {
  const target = h.targetCount || 1;
  const completions = h.completions || {};
  const monthsBack = 5;
  const now = new Date();
  let html = "";
  for (let m = monthsBack; m >= 0; m--) {
    const first = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const label = monthLabel(first);
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const leadEmpty = first.getDay(); // Sunday-first offset
    let grid = "";
    for (let i = 0; i < leadEmpty; i++) grid += `<div class="cell empty"></div>`;
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(first.getFullYear(), first.getMonth(), day);
      const ds = fmtDate(d);
      const val = completions[ds];
      const isFuture = d > now;
      const isToday = ds === todayStr();
      const cls = [
        isFull(val, target) ? "done" : "",
        isPartial(val, target) ? "done partial" : "",
        isFuture ? "empty" : "",
        isToday ? "today" : "",
      ].filter(Boolean).join(" ");
      grid += `<div class="cell${cls ? " " + cls : ""}"></div>`;
    }
    html += `<div class="heatmap-month"><div class="heatmap-month-label">${label}</div><div class="heatmap-month-grid">${grid}</div></div>`;
  }
  return html;
}

$("#detail-delete").addEventListener("click", async () => {
  const h = habits[detailHabitId];
  if (!h) return;
  if (!confirm(`Delete "${h.name}"? This can't be undone.`)) return;
  try {
    await removeHabit(detailHabitId);
    showToast("Habit deleted");
    viewDetail.hidden = true;
    viewToday.hidden = currentTab !== "today";
    viewStats.hidden = currentTab !== "stats";
    viewSettings.hidden = currentTab !== "settings";
  } catch {
    showToast("Couldn't delete — try again");
  }
});
$("#detail-edit").addEventListener("click", () => openHabitModal(detailHabitId));

/* ============================================================
   Settings view
   ============================================================ */
function renderThemeGrid() {
  themeGridEl.innerHTML = THEMES.map((t) => `
    <button type="button" class="theme-option${t.id === currentTheme ? " selected" : ""}" data-theme-id="${t.id}">
      <span class="theme-swatch"><span style="background:${t.chip[0]}"></span><span style="background:${t.chip[1]}"></span></span>
      <span class="theme-option-label">${t.label}</span>
    </button>`).join("");
}
themeGridEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".theme-option");
  if (!btn) return;
  applyTheme(btn.dataset.themeId);
  showToast("Theme updated");
});
function renderSettings() {
  renderThemeGrid();
  if (currentUser) settingsEmail.textContent = `Logged in as ${currentUser.email}`;
}

/* ============================================================
   Add / edit habit modal
   ============================================================ */
function renderColorPicker() {
  colorPickerEl.innerHTML = COLORS.map((c) =>
    `<button type="button" class="color-swatch${c === modalSelectedColor ? " selected" : ""}" style="--c:${c}" data-color="${c}"></button>`
  ).join("");
}
colorPickerEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".color-swatch");
  if (!btn) return;
  modalSelectedColor = btn.dataset.color;
  renderColorPicker();
});

$("#goal-minus").addEventListener("click", () => { modalGoal = Math.max(1, modalGoal - 1); goalValueEl.textContent = modalGoal; });
$("#goal-plus").addEventListener("click", () => { modalGoal = Math.min(7, modalGoal + 1); goalValueEl.textContent = modalGoal; });
$("#target-minus").addEventListener("click", () => { modalTarget = Math.max(2, modalTarget - 1); targetValueEl.textContent = modalTarget; });
$("#target-plus").addEventListener("click", () => { modalTarget = Math.min(20, modalTarget + 1); targetValueEl.textContent = modalTarget; });
countToggle.addEventListener("change", () => {
  modalCountOn = countToggle.checked;
  countFields.hidden = !modalCountOn;
});

function openHabitModal(editId = null) {
  editingHabitId = editId;
  habitFormError.hidden = true;
  if (editId && habits[editId]) {
    const h = habits[editId];
    habitModalTitle.textContent = "Edit habit";
    habitNameInput.value = h.name;
    habitDescInput.value = h.description || "";
    habitUnitInput.value = h.unit || "";
    modalSelectedColor = h.color;
    modalGoal = h.weeklyGoal;
    modalCountOn = (h.targetCount || 1) > 1;
    modalTarget = h.targetCount > 1 ? h.targetCount : 3;
  } else {
    habitModalTitle.textContent = "New habit";
    habitForm.reset();
    modalSelectedColor = COLORS[Object.keys(habits).length % COLORS.length];
    modalGoal = 7;
    modalCountOn = false;
    modalTarget = 3;
  }
  goalValueEl.textContent = modalGoal;
  targetValueEl.textContent = modalTarget;
  countToggle.checked = modalCountOn;
  countFields.hidden = !modalCountOn;
  renderColorPicker();
  habitModal.hidden = false;
}
function closeHabitModal() { habitModal.hidden = true; }

$("#fab").addEventListener("click", () => openHabitModal(null));
$("#habit-modal-close").addEventListener("click", closeHabitModal);
habitModal.addEventListener("click", (e) => { if (e.target === habitModal) closeHabitModal(); });

habitForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = habitNameInput.value.trim();
  if (!name) { habitFormError.textContent = "Give your habit a name."; habitFormError.hidden = false; return; }
  const data = {
    name,
    description: habitDescInput.value.trim(),
    color: modalSelectedColor,
    weeklyGoal: modalGoal,
    targetCount: modalCountOn ? modalTarget : 1,
    unit: modalCountOn ? habitUnitInput.value.trim() : "",
  };
  const submitBtn = habitForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  try {
    if (editingHabitId) {
      await updateHabitMeta(editingHabitId, data);
      showToast("Habit updated");
    } else {
      await createHabit(data);
      showToast("Habit added");
    }
    closeHabitModal();
  } catch (err) {
    habitFormError.textContent = "Couldn't save — check your connection and try again.";
    habitFormError.hidden = false;
  } finally {
    submitBtn.disabled = false;
  }
});

/* ============================================================
   Utilities
   ============================================================ */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============================================================
   Init
   ============================================================ */
(function initTheme() {
  let saved = DEFAULT_THEME;
  try { saved = localStorage.getItem("habitTheme") || DEFAULT_THEME; } catch (e) {}
  applyTheme(saved, { sync: false });
})();

/* ============================================================
   Service worker registration
   ============================================================ */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((err) => console.warn("SW registration failed", err));
  });
}
