import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence,
  updateProfile
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
   Illustrated icons (inline SVG, currentColor) — used in place of
   emoji glyphs so icons look the same on every platform/theme.
   ============================================================ */
const ICON_CHECK = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12.5 9.5 18 20 5"></polyline></svg>`;
const ICON_SPARKLE = `<svg class="icon icon-sparkle" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l1.7 4.9 4.9 1.7-4.9 1.7L12 15.7l-1.7-4.9-4.9-1.7 4.9-1.7L12 2.5z"></path><path d="M18.7 14l.8 2.3 2.3.8-2.3.8-.8 2.3-.8-2.3-2.3-.8 2.3-.8.8-2.3z"></path></svg>`;

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
   Today habit-list layout — grid / list / table, switchable and
   synced across devices the same way the theme is.
   ============================================================ */
function setViewMode(mode, { persist = true, sync = true } = {}) {
  if (!VIEW_MODES.includes(mode)) mode = "table";
  todayViewMode = mode;
  if (persist) { try { localStorage.setItem("habitViewMode", mode); } catch (e) {} }
  if (sync && currentUser) {
    setDoc(doc(db, "users", currentUser.uid), { viewMode: mode }, { merge: true }).catch(() => {});
  }
  viewSwitchBtns.forEach((b) => b.classList.toggle("active", b.dataset.view === mode));
  if (currentTab === "today") renderToday();
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
const fmtDayMonth = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase();
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
const VIEW_MODES = ["grid", "list", "table"];
let todayViewMode = "table"; // default per user preference — refined further down once localStorage is checked

/* ============================================================
   DOM refs
   ============================================================ */
const $ = (sel) => document.querySelector(sel);
const authScreen = $("#auth-screen");
const appRoot = $("#app-root");
const authForm = $("#auth-form");
const authNameField = $("#auth-name-field");
const authNameInput = $("#auth-name");
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
const viewSwitchBtns = document.querySelectorAll(".view-switch-btn");

const statsOverview = $("#stats-overview");
const statsHabitList = $("#stats-habit-list");

const detailContent = $("#detail-content");

const themeGridEl = $("#theme-grid");
const settingsEmail = $("#settings-email");
const settingsNameInput = $("#settings-name");

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

const countSheet = $("#count-sheet");
const countSheetClose = $("#count-sheet-close");
const countSheetStats = $("#count-sheet-stats");
const countSheetName = $("#count-sheet-name");
const countSheetGoal = $("#count-sheet-goal");
const countSheetValue = $("#count-sheet-value");
const countRingFill = $("#count-ring-fill");
const countSheetDec = $("#count-sheet-dec");
const countSheetInc = $("#count-sheet-inc");
const countSheetReset = $("#count-sheet-reset");
const countSheetComplete = $("#count-sheet-complete");

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
  authNameField.hidden = authMode !== "signup";
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
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const displayName = authNameInput.value.trim();
      if (displayName) {
        await updateProfile(cred.user, { displayName }).catch(() => {});
      }
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
  const name = currentUser?.displayName?.trim() || (currentUser?.email || "").split("@")[0];
  greeting.textContent = name ? `${g}, ${name}` : g;
}

async function syncThemeFromCloud(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const data = snap.exists() ? snap.data() : null;
    const remoteTheme = data?.theme;
    const remoteViewMode = data?.viewMode;
    if (remoteTheme && remoteTheme !== currentTheme) applyTheme(remoteTheme, { sync: false });
    if (remoteViewMode && remoteViewMode !== todayViewMode) setViewMode(remoteViewMode, { sync: false });
    if (!remoteTheme || !remoteViewMode) {
      await setDoc(doc(db, "users", uid), { theme: currentTheme, viewMode: todayViewMode }, { merge: true });
    }
  } catch (e) {
    // offline or first run — local settings still apply, will sync once online
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
    if (!countSheet.hidden) renderCountSheet();
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
viewSwitchBtns.forEach((btn) => {
  btn.addEventListener("click", () => setViewMode(btn.dataset.view));
});

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});
function switchTab(tab) {
  if (currentTab === "settings" && tab !== "settings") flushDisplayNameSave();
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
function miniGridHTML(h, weeks = 6) {
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
    return `<button class="check-btn${val ? " done" : ""}" data-action="toggle">${ICON_CHECK}</button>`;
  }
  const count = typeof val === "number" ? val : 0;
  const full = count >= target;
  const unit = h.unit ? ` ${escapeHtml(h.unit)}` : "";
  return `
    <button type="button" class="count-pill${full ? " full" : ""}" data-action="open-count" style="--c:${h.color}">
      <span class="count-pill-num">${count}</span><span class="count-pill-target">/${target}${unit}</span>
    </button>`;
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
   Grid view — compact 2-column card, name + control up top,
   a shorter 4-week heatmap below.
   ============================================================ */
function gridCardHTML(h) {
  return `
    <div class="habit-card habit-card--grid" style="--c:${h.color}" data-id="${h.id}">
      <div class="habit-card-top" style="margin-bottom:10px;">
        <div class="habit-card-name"><span class="dot"></span><span class="label">${escapeHtml(h.name)}</span></div>
        ${controlHTML(h)}
      </div>
      <div class="mini-grid mini-grid--sm">${miniGridHTML(h, 4)}</div>
    </div>`;
}

/* ============================================================
   Table view — habits as rows, the current Sun–Sat week as
   columns. Read-only: tapping a row opens that habit's detail.
   ============================================================ */
function weekTableHTML(list) {
  const weekStart = startOfWeek(new Date());
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const todayDs = todayStr();
  const now = new Date();
  const rangeLabel = `${fmtDayMonth(days[0])} – ${fmtDayMonth(days[6])}`;

  const headerCells = days.map((d) => {
    const isToday = fmtDate(d) === todayDs;
    return `<div class="week-table-daylabel${isToday ? " today" : ""}"><span>${dayLetters[d.getDay()]}</span><span>${d.getDate()}</span></div>`;
  }).join("");

  const rows = list.map((h) => {
    const target = h.targetCount || 1;
    const completions = h.completions || {};
    const cells = days.map((d) => {
      const ds = fmtDate(d);
      const val = completions[ds];
      const future = d > now;
      const cls = [
        isFull(val, target) ? "done" : "",
        isPartial(val, target) ? "done partial" : "",
        future ? "future" : "",
      ].filter(Boolean).join(" ");
      return `<div class="week-table-cell${cls ? " " + cls : ""}" style="--c:${h.color}"></div>`;
    }).join("");
    return `
      <div class="week-table-row" data-id="${h.id}">
        <div class="week-table-habit"><span class="dot" style="--c:${h.color}"></span><span>${escapeHtml(h.name)}</span></div>
        ${cells}
      </div>`;
  }).join("");

  return `
    <div class="week-table-meta">
      <span>${list.length} habit${list.length === 1 ? "" : "s"}</span>
      <span>${rangeLabel}</span>
    </div>
    <div class="week-table">
      <div class="week-table-header">
        <div></div>
        ${headerCells}
      </div>
      <div class="week-table-body">${rows || `<div class="empty-state"><p>No habits yet.</p><p class="muted">Tap the + button to add your first habit.</p></div>`}</div>
    </div>`;
}

/* ============================================================
   Today view — grid / list / table, switchable via todayViewMode.
   Grid and list still split into "To do" and "Done today".
   ============================================================ */
function renderToday() {
  setGreeting();
  const list = sortedHabits();
  const todo = [], done = [];
  list.forEach((h) => ((h.completions?.[todayStr()]) ? done : todo).push(h));

  todaySubline.innerHTML = list.length === 0
    ? ""
    : todo.length === 0
      ? `All habits done for today ${ICON_SPARKLE}`
      : `You have ${todo.length} habit${todo.length === 1 ? "" : "s"} left today`;

  todayEmpty.hidden = list.length !== 0 || todayViewMode === "table";

  if (todayViewMode === "table") {
    todayList.innerHTML = weekTableHTML(list);
    return;
  }

  const cardFn = todayViewMode === "grid" ? gridCardHTML : cardHTML;
  const listClass = todayViewMode === "grid" ? "habit-list habit-list--grid" : "habit-list";
  let html = "";
  if (todo.length) html += `<h2 class="list-heading">To do</h2><div class="${listClass}">${todo.map(cardFn).join("")}</div>`;
  if (done.length) html += `<h2 class="list-heading">Done today</h2><div class="${listClass}">${done.map(cardFn).join("")}</div>`;
  todayList.innerHTML = html;
}

todayList.addEventListener("click", (e) => {
  const row = e.target.closest(".week-table-row");
  if (row) { openDetail(row.dataset.id); return; }

  const card = e.target.closest(".habit-card");
  if (!card) return;
  const id = card.dataset.id;
  const h = habits[id];
  if (!h) return;
  const action = e.target.closest("[data-action]")?.dataset.action;

  if (action === "toggle") {
    const done = !!h.completions?.[todayStr()];
    toggleCompletion(id, todayStr(), !done).catch(() => showToast("Couldn't save — try again"));
  } else if (action === "open-count") {
    openCountSheet(id);
  } else {
    openDetail(id);
  }
});

/* ============================================================
   Count control sheet — big circular dial for count-based habits,
   opened by tapping the count pill on a habit's Today card.
   ============================================================ */
let countSheetHabitId = null;
const COUNT_RING_R = 60;
const COUNT_RING_CIRC = 2 * Math.PI * COUNT_RING_R;

function renderCountSheet() {
  const h = habits[countSheetHabitId];
  if (!h) { closeCountSheet(); return; }
  const target = h.targetCount || 1;
  const val = h.completions?.[todayStr()];
  const count = typeof val === "number" ? val : 0;
  const pct = Math.max(0, Math.min(1, count / target));

  countSheetName.textContent = h.name;
  countSheetGoal.textContent = `Daily goal: ${target}${h.unit ? " " + h.unit : ""}`;
  countSheetValue.textContent = count;
  countSheet.querySelector(".count-sheet").style.setProperty("--c", h.color);
  countRingFill.style.strokeDashoffset = COUNT_RING_CIRC * (1 - pct);
  countSheetDec.disabled = count <= 0;
}

function openCountSheet(id) {
  countSheetHabitId = id;
  renderCountSheet();
  countSheet.hidden = false;
}
function closeCountSheet() {
  countSheet.hidden = true;
  countSheetHabitId = null;
}
countSheetClose.addEventListener("click", closeCountSheet);
countSheet.addEventListener("click", (e) => { if (e.target === countSheet) closeCountSheet(); });
countSheetStats.addEventListener("click", () => {
  const id = countSheetHabitId;
  closeCountSheet();
  if (id) openDetail(id);
});

async function adjustSheetCount(delta) {
  const h = habits[countSheetHabitId];
  if (!h) return;
  const val = h.completions?.[todayStr()];
  const current = typeof val === "number" ? val : 0;
  const next = Math.max(0, Math.min(99, current + delta));
  try {
    await setCompletionCount(countSheetHabitId, todayStr(), next);
  } catch {
    showToast("Couldn't save — try again");
  }
}
countSheetDec.addEventListener("click", () => adjustSheetCount(-1));
countSheetInc.addEventListener("click", () => adjustSheetCount(1));
countSheetReset.addEventListener("click", async () => {
  if (!countSheetHabitId) return;
  try {
    await setCompletionCount(countSheetHabitId, todayStr(), 0);
  } catch {
    showToast("Couldn't save — try again");
  }
});
countSheetComplete.addEventListener("click", async () => {
  const h = habits[countSheetHabitId];
  if (!h) return;
  try {
    await setCompletionCount(countSheetHabitId, todayStr(), h.targetCount || 1);
    showToast("Marked complete");
  } catch {
    showToast("Couldn't save — try again");
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
      <div class="dot">${ICON_CHECK}</div>
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
  if (currentUser) {
    settingsEmail.textContent = `Logged in as ${currentUser.email}`;
    if (document.activeElement !== settingsNameInput) {
      settingsNameInput.value = currentUser.displayName || "";
    }
  }
}
// Saving on `change` alone isn't reliable on iOS: swiping the keyboard away
// (instead of tapping elsewhere) hides it without ever blurring the input,
// so `change`/`blur` never fire and the name silently never saves. Instead
// we save automatically shortly after typing stops, and also flush
// immediately on blur and on leaving the Settings tab, so it's covered
// no matter how the user dismisses the keyboard.
let nameSaveTimer = null;
async function flushDisplayNameSave() {
  clearTimeout(nameSaveTimer);
  if (!currentUser) return;
  const name = settingsNameInput.value.trim();
  if (name === (currentUser.displayName || "")) return;
  try {
    await updateProfile(auth.currentUser, { displayName: name });
    currentUser = auth.currentUser;
    setGreeting();
    showToast("Name updated");
  } catch (e) {
    showToast("Couldn't save — try again");
  }
}
settingsNameInput.addEventListener("input", () => {
  clearTimeout(nameSaveTimer);
  nameSaveTimer = setTimeout(flushDisplayNameSave, 700);
});
settingsNameInput.addEventListener("blur", flushDisplayNameSave);

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
(function initViewMode() {
  let saved = "table";
  try { saved = localStorage.getItem("habitViewMode") || "table"; } catch (e) {}
  setViewMode(saved, { sync: false });
})();

/* ============================================================
   Service worker registration
   ============================================================ */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").then((reg) => {
      // iOS home-screen apps don't reliably check for a new version on their
      // own — force a check whenever the app is brought to the foreground.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    }).catch((err) => console.warn("SW registration failed", err));

    // Installing a new service worker in the background doesn't change what
    // this already-loaded page is running. Once the new one takes control,
    // reload once so you actually land on the new code instead of staying
    // stuck on the old version until the next cold launch.
    let reloadedForUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadedForUpdate) return;
      reloadedForUpdate = true;
      window.location.reload();
    });
  });
}
