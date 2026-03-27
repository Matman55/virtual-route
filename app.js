import { geocodeWithNominatim, calculateRouteWithOsrm } from "./routing.js";
import {
  ensureMap,
  getCurrentPositionPromise,
  requestCompassPermission,
  haversineMeters,
  updateConeRotation,
  smoothPosition,
  bearingBetween,
  shouldCountMovement,
} from "./location.js";
import { formatKm, renderPreviousRuns, updateTrekPhaseUI, updateVirtualUI, renderActivityTab, renderLeaderboard } from "./ui.js";

// ─────────────────────────────────────────────────────────────────────────────
const TREK_STORAGE_KEY = "virtualTrekStateV4";

const FAMOUS_RACES = [
  { label: "NYC Marathon",  km: 42.2 },
  { label: "Great Wall",    km: 21.1 },
  { label: "Grand Canyon",  km: 38.6 },
  { label: "Inca Trail",    km: 42   },
];

// ─────────────────────────────────────────────────────────────────────────────
// DOM REFS
// ─────────────────────────────────────────────────────────────────────────────
const refs = {
  // run
  startBtn:               document.getElementById("startBtn"),
  stopBtn:                document.getElementById("stopBtn"),
  useCurrentLocationBtn:  document.getElementById("useCurrentLocationBtn"),
  calculateRouteBtn:      document.getElementById("calculateRouteBtn"),
  resetTrekBtn:           document.getElementById("resetTrekBtn"),
  cancelTrekBtn:          document.getElementById("cancelTrekBtn"),
  liveTimer:              document.getElementById("liveTimer"),
  setupPhase:             document.getElementById("setupPhase"),
  activeDashboard:        document.getElementById("activeDashboard"),
  runSummaryMapCard:      document.getElementById("runSummaryMapCard"),
  routeNamesDisplayTop:   document.getElementById("routeNamesDisplayTop"),
  statusEl:               document.getElementById("status"),
  startPointInput:        document.getElementById("startPointInput"),
  destinationPointInput:  document.getElementById("destinationPointInput"),
  goalDistanceDisplay:    document.getElementById("goalDistanceDisplay"),
  totalDistanceEl:        document.getElementById("totalDistance"),
  distanceSmallEl:        document.getElementById("distanceSmall"),
  distanceRemainingEl:    document.getElementById("distanceRemaining"),
  remainingSmallEl:       document.getElementById("remainingSmall"),
  progressBarFill:        document.getElementById("progressBarFill"),
  progressPctText:        document.getElementById("progressPctText"),
  calculatedDistanceEl:   document.getElementById("calculatedDistanceEl"),
  caloriesEl:             document.getElementById("caloriesEl"),
  runTitleEl:             document.getElementById("runTitleEl"),
  // activity
  previousRunsList:       document.getElementById("previousRunsList"),
  dailyGoalRingFill:      document.getElementById("dailyGoalRingFill"),
  dailyGoalPct:           document.getElementById("dailyGoalPct"),
  dailyGoalToday:         document.getElementById("dailyGoalToday"),
  dailyGoalTarget:        document.getElementById("dailyGoalTarget"),
  goalDecBtn:             document.getElementById("goalDecBtn"),
  goalIncBtn:             document.getElementById("goalIncBtn"),
  // summary modal
  summaryDistance:        document.getElementById("summaryDistance"),
  summaryDuration:        document.getElementById("summaryDuration"),
  summaryPace:            document.getElementById("summaryPace"),
  summaryCalories:        document.getElementById("summaryCalories"),
  runSummaryModal:        document.getElementById("runSummaryModal"),
  modalSummaryDistance:   document.getElementById("modalSummaryDistance"),
  modalSummaryDuration:   document.getElementById("modalSummaryDuration"),
  modalSummaryPace:       document.getElementById("modalSummaryPace"),
  modalSummaryCalories:   document.getElementById("modalSummaryCalories"),
  modalRunMap:            document.getElementById("modalRunMap"),
  saveRunSummaryBtn:      document.getElementById("saveRunSummaryBtn"),
  closeRunSummaryBtn:     document.getElementById("closeRunSummaryBtn"),
  // share
  shareBtn:               document.getElementById("shareBtn"),
  shareOverlay:           document.getElementById("shareOverlay"),
  shareCanvas:            document.getElementById("shareCanvas"),
  downloadShareBtn:       document.getElementById("downloadShareBtn"),
  closeShareBtn:          document.getElementById("closeShareBtn"),
  // progress map
  progressMapBtn:         document.getElementById("progressMapBtn"),
  progressMapOverlay:     document.getElementById("progressMapOverlay"),
  progressMapBackBtn:     document.getElementById("progressMapBackBtn"),
  progressMapContainer:   document.getElementById("progressMap"),
  pmCompletedVal:         document.getElementById("pmCompletedVal"),
  pmRemainingVal:         document.getElementById("pmRemainingVal"),
  pmPctVal:               document.getElementById("pmPctVal"),
};

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  watchId: null,
  isTracking: false,
  isTrekActive: false,
  compassEnabled: false,
  compassBearingDeg: null,
  map: null,
  userMarker: null,
  userPathPolyline: null,
  virtualRoutePolyline: null,
  virtualStartMarker: null,
  virtualEndMarker: null,
  hasCenteredOnce: false,
  showRunSummaryMap: false,

  routeStartLabel: "",
  routeDestinationLabel: "",
  routeStartCoord: null,
  routeDestinationCoord: null,
  routeDistanceM: null,
  routeGeometryLatLngs: [],
  useCurrentAsStart: false,

  totalDistanceM: 0,
  currentSessionDistanceM: 0,
  lastSessionDistanceM: 0,
  runHistory: [],
  hasCompletedTrek: false,
  lastCoords: null,
  pathLatLngs: [],
  currentRunPathLatLngs: [],
  lastRunPathLatLngs: [],
  runStartMs: null,
  userWeightKg: 70,
  lastAccuracy: null,
  smoothCoords: null,
  lastBearing: null,
  consistentDirectionCount: 0,
  pendingRunSummary: null,
  summaryMap: null,
  summaryPolyline: null,

  worldChallengeGoalM: null,
  worldChallengeLabel: null,

  dailyGoalKm: 5.0,
  todayKm: 0,

  // progress map (dedicated Leaflet instance)
  progressMap: null,
  pmPlannedPolyline: null,
  pmActualPolyline: null,
  pmLiveMarker: null,
  pmStartMarker: null,
  pmEndMarker: null,
};

let saveTimer = null;
let saveRequested = false;
let liveTimerInterval = null;

// ─────────────────────────────────────────────────────────────────────────────
// PERSIST
// ─────────────────────────────────────────────────────────────────────────────
function scheduleSave() {
  saveRequested = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (saveRequested) { saveRequested = false; saveNow(); }
  }, 800);
}

function saveNow() {
  try {
    localStorage.setItem(TREK_STORAGE_KEY, JSON.stringify({
      routeStartLabel:       state.routeStartLabel,
      routeDestinationLabel: state.routeDestinationLabel,
      routeStartCoord:       state.routeStartCoord,
      routeDestinationCoord: state.routeDestinationCoord,
      routeDistanceM:        state.routeDistanceM,
      routeGeometryLatLngs:  state.routeGeometryLatLngs,
      useCurrentAsStart:     state.useCurrentAsStart,
      totalDistanceM:        state.totalDistanceM,
      lastSessionDistanceM:  state.lastSessionDistanceM,
      runHistory:            state.runHistory,
      hasCompletedTrek:      state.hasCompletedTrek,
      pathLatLngs:           state.pathLatLngs,
      lastRunPathLatLngs:    state.lastRunPathLatLngs,
      lastCoords:            state.lastCoords,
      worldChallengeGoalM:   state.worldChallengeGoalM,
      worldChallengeLabel:   state.worldChallengeLabel,
      dailyGoalKm:           state.dailyGoalKm,
      todayKm:               state.todayKm,
    }));
  } catch {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(TREK_STORAGE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    Object.assign(state, {
      routeStartLabel:       typeof p.routeStartLabel === "string"       ? p.routeStartLabel       : "",
      routeDestinationLabel: typeof p.routeDestinationLabel === "string" ? p.routeDestinationLabel : "",
      routeStartCoord:       Array.isArray(p.routeStartCoord)            ? p.routeStartCoord       : null,
      routeDestinationCoord: Array.isArray(p.routeDestinationCoord)      ? p.routeDestinationCoord : null,
      routeDistanceM:        Number.isFinite(p.routeDistanceM)           ? p.routeDistanceM        : null,
      routeGeometryLatLngs:  Array.isArray(p.routeGeometryLatLngs)       ? p.routeGeometryLatLngs  : [],
      useCurrentAsStart:     Boolean(p.useCurrentAsStart),
      totalDistanceM:        Number.isFinite(p.totalDistanceM)           ? p.totalDistanceM        : 0,
      lastSessionDistanceM:  Number.isFinite(p.lastSessionDistanceM)     ? p.lastSessionDistanceM  : 0,
      runHistory:            Array.isArray(p.runHistory)                  ? p.runHistory            : [],
      hasCompletedTrek:      Boolean(p.hasCompletedTrek),
      pathLatLngs:           Array.isArray(p.pathLatLngs)                 ? p.pathLatLngs           : [],
      lastRunPathLatLngs:    Array.isArray(p.lastRunPathLatLngs)          ? p.lastRunPathLatLngs    : [],
      lastCoords:            p.lastCoords || null,
      worldChallengeGoalM:   Number.isFinite(p.worldChallengeGoalM)      ? p.worldChallengeGoalM   : null,
      worldChallengeLabel:   typeof p.worldChallengeLabel === "string"   ? p.worldChallengeLabel   : null,
      dailyGoalKm:           Number.isFinite(p.dailyGoalKm)              ? p.dailyGoalKm           : 5.0,
      todayKm:               Number.isFinite(p.todayKm)                  ? p.todayKm               : 0,
    });
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// TIMER / FORMAT
// ─────────────────────────────────────────────────────────────────────────────
function setIdle() {
  refs.statusEl.textContent = "Not tracking.";
  refs.startBtn.classList.remove("actionHidden");
  refs.stopBtn.classList.add("actionHidden");
}
function setTracking() {
  refs.statusEl.textContent = "Tracking…";
  refs.startBtn.classList.add("actionHidden");
  refs.stopBtn.classList.remove("actionHidden");
}
function updateLiveTimerDisplay() {
  refs.liveTimer.textContent = Number.isFinite(state.runStartMs)
    ? formatDuration(Date.now() - state.runStartMs)
    : "00:00";
}
function startLiveTimer() {
  if (liveTimerInterval) clearInterval(liveTimerInterval);
  updateLiveTimerDisplay();
  liveTimerInterval = setInterval(updateLiveTimerDisplay, 1000);
}
function stopLiveTimer() {
  if (liveTimerInterval) clearInterval(liveTimerInterval);
  liveTimerInterval = null;
  refs.liveTimer.textContent = "00:00";
}
function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}
function formatPace(ms, distanceM) {
  if (!Number.isFinite(ms) || !Number.isFinite(distanceM) || distanceM <= 0) return "--:-- /km";
  const s = (ms / 1000) / (distanceM / 1000);
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${Math.round(s % 60).toString().padStart(2, "0")} /km`;
}

// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────
const TAB_MAP = {
  Run:      "tabRun",
  Plans:    "tabPlans",
  Activity: "tabActivity",
  Club:     "tabClub",
};
let activeTab = "Run";

function switchTab(name) {
  if (name === activeTab && document.getElementById(TAB_MAP[name])?.classList.contains("tabHidden") === false) return;
  activeTab = name;
  Object.entries(TAB_MAP).forEach(([n, id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("tabHidden", n !== name);
  });
  document.querySelectorAll(".nrcNavItem").forEach((item) => {
    item.classList.toggle("active", item.dataset.tab === name);
  });
  if (name === "Run" && state.map) state.map.invalidateSize();
  if (name === "Activity") renderActivityTab(state, refs);
  if (name === "Club") renderLeaderboard(state, refs);
}

function initNav() {
  document.querySelectorAll(".nrcNavItem").forEach((item) => {
    item.addEventListener("click", () => switchTab(item.dataset.tab));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE SWITCHER (Run tab: Custom ↔ Famous Race)
// ─────────────────────────────────────────────────────────────────────────────
let currentRunMode = "custom"; // "custom" | "famous"

function initModeSwitcher() {
  const customBtn  = document.getElementById("modeCustomBtn");
  const famousBtn  = document.getElementById("modeFamousBtn");
  const customPanel = document.getElementById("customModePanel");
  const famousPanel = document.getElementById("famousModePanel");

  customBtn.addEventListener("click", () => {
    currentRunMode = "custom";
    customBtn.classList.add("active");
    famousBtn.classList.remove("active");
    customPanel.classList.remove("modePanelHidden");
    famousPanel.classList.add("modePanelHidden");
  });

  famousBtn.addEventListener("click", () => {
    currentRunMode = "famous";
    famousBtn.classList.add("active");
    customBtn.classList.remove("active");
    famousPanel.classList.remove("modePanelHidden");
    customPanel.classList.add("modePanelHidden");
  });

  // Famous race dropdown preview
  const select  = document.getElementById("famousRaceSelect");
  const preview = document.getElementById("famousRacePreviewInner");
  const previewName = document.getElementById("famousRacePreviewName");
  const previewDist = document.getElementById("famousRacePreviewDist");

  select.addEventListener("change", () => {
    const val = select.value;
    if (!val) { preview.style.display = "none"; return; }
    const [label, km] = val.split("|");
    previewName.textContent = label.toUpperCase();
    previewDist.textContent = `${km} KM`;
    preview.style.display = "flex";
  });

  document.getElementById("famousRaceStartBtn").addEventListener("click", () => {
    const val = select.value;
    if (!val) return;
    const [label, km] = val.split("|");
    applyFamousRace(label, parseFloat(km));
  });
}

function applyFamousRace(label, km) {
  state.worldChallengeGoalM  = km * 1000;
  state.worldChallengeLabel  = label;
  state.routeDistanceM       = state.worldChallengeGoalM;
  state.routeGeometryLatLngs = [];
  state.routeStartLabel      = label;
  state.routeDestinationLabel = `${label} Finish`;
  state.hasCompletedTrek     = state.totalDistanceM >= state.routeDistanceM;
  state.isTrekActive         = true;
  if (refs.runTitleEl) refs.runTitleEl.textContent = label.toUpperCase();
  scheduleSave();
  updateVirtualUI(state, refs, maybeCelebrateCompletion);
  updateTrekPhaseUI(state, refs);
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANS TAB LOGIC
// ─────────────────────────────────────────────────────────────────────────────
function initPlansTab() {
  // Cards in Plans tab
  document.querySelectorAll("#plansRaceCardGrid .raceCard").forEach((card) => {
    card.querySelector(".raceSelectBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      selectRaceFromPlans(card);
    });
    card.addEventListener("click", () => selectRaceFromPlans(card));
  });

  // Mode buttons in Plans tab
  document.getElementById("planGoCustomBtn")?.addEventListener("click", () => {
    switchTab("Run");
    activateRunMode("custom");
  });
  document.getElementById("planGoFamousBtn")?.addEventListener("click", () => {
    switchTab("Run");
    activateRunMode("famous");
  });
}

function activateRunMode(mode) {
  currentRunMode = mode;
  const customBtn  = document.getElementById("modeCustomBtn");
  const famousBtn  = document.getElementById("modeFamousBtn");
  const customPanel = document.getElementById("customModePanel");
  const famousPanel = document.getElementById("famousModePanel");
  if (mode === "famous") {
    famousBtn.classList.add("active");
    customBtn.classList.remove("active");
    famousPanel.classList.remove("modePanelHidden");
    customPanel.classList.add("modePanelHidden");
  } else {
    customBtn.classList.add("active");
    famousBtn.classList.remove("active");
    customPanel.classList.remove("modePanelHidden");
    famousPanel.classList.add("modePanelHidden");
  }
}

function selectRaceFromPlans(card) {
  document.querySelectorAll(".raceCard").forEach((c) => c.classList.remove("selected"));
  card.classList.add("selected");
  applyFamousRace(card.dataset.label, parseFloat(card.dataset.km));
  switchTab("Run");
}

// ─────────────────────────────────────────────────────────────────────────────
// DAILY GOAL
// ─────────────────────────────────────────────────────────────────────────────
function initDailyGoal() {
  refs.goalDecBtn?.addEventListener("click", () => {
    state.dailyGoalKm = Math.max(1, parseFloat((state.dailyGoalKm - 1).toFixed(1)));
    renderActivityTab(state, refs);
    scheduleSave();
  });
  refs.goalIncBtn?.addEventListener("click", () => {
    state.dailyGoalKm = Math.min(100, parseFloat((state.dailyGoalKm + 1).toFixed(1)));
    renderActivityTab(state, refs);
    scheduleSave();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PROGRESS MAP
// ─────────────────────────────────────────────────────────────────────────────
function initProgressMap() {
  refs.progressMapBtn?.addEventListener("click", openProgressMap);
  refs.progressMapBackBtn?.addEventListener("click", closeProgressMap);

  // Allow swipe-down to dismiss on mobile
  let touchStartY = 0;
  refs.progressMapOverlay?.addEventListener("touchstart", (e) => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  refs.progressMapOverlay?.addEventListener("touchmove", (e) => {
    const dy = e.touches[0].clientY - touchStartY;
    if (dy > 80) closeProgressMap();
  }, { passive: true });
}

function ensureProgressMap() {
  if (state.progressMap) return;

  state.progressMap = L.map(refs.progressMapContainer, {
    zoomControl: true,
    worldCopyJump: true,
    scrollWheelZoom: true,
    tap: true,
  }).setView([20, 0], 2);

  // Dark Matter tiles
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 19,
  }).addTo(state.progressMap);

  // Planned route — soft white dashed line
  state.pmPlannedPolyline = L.polyline([], {
    color: "rgba(255, 255, 255, 0.35)",
    weight: 4,
    dashArray: "1 8",
    lineCap: "round",
    lineJoin: "round",
  }).addTo(state.progressMap);

  // Actual path — volt yellow solid
  state.pmActualPolyline = L.polyline([], {
    color: "#e2ff22",
    weight: 5,
    opacity: 0.95,
    lineCap: "round",
    lineJoin: "round",
  }).addTo(state.progressMap);
}

function updateProgressMapLayers() {
  ensureProgressMap();

  // ── Planned route ──
  const planned = state.routeGeometryLatLngs || [];
  state.pmPlannedPolyline.setLatLngs(planned);

  // ── Actual breadcrumb path ──
  const actual = state.pathLatLngs || [];
  state.pmActualPolyline.setLatLngs(actual);

  // ── Start pin ──
  if (state.pmStartMarker) { state.pmStartMarker.remove(); state.pmStartMarker = null; }
  if (Array.isArray(state.routeStartCoord)) {
    state.pmStartMarker = L.marker(state.routeStartCoord, {
      icon: L.divIcon({
        className: "",
        html: '<div class="pm-pin pm-pin-start"></div>',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      }),
      interactive: false,
      title: "Start",
    }).addTo(state.progressMap);
  }

  // ── End pin ──
  if (state.pmEndMarker) { state.pmEndMarker.remove(); state.pmEndMarker = null; }
  if (Array.isArray(state.routeDestinationCoord)) {
    state.pmEndMarker = L.marker(state.routeDestinationCoord, {
      icon: L.divIcon({
        className: "",
        html: '<div class="pm-pin pm-pin-end"></div>',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      }),
      interactive: false,
      title: "Destination",
    }).addTo(state.progressMap);
  }

  // ── Live position marker (pulsing) ──
  if (state.pmLiveMarker) { state.pmLiveMarker.remove(); state.pmLiveMarker = null; }
  const livePos = state.lastCoords
    ? [state.lastCoords.latitude, state.lastCoords.longitude]
    : (actual.length > 0 ? actual[actual.length - 1] : null);

  if (livePos) {
    state.pmLiveMarker = L.marker(livePos, {
      icon: L.divIcon({
        className: "",
        html: `<div class="pm-pulse-root">
                 <div class="pm-pulse-ring"></div>
                 <div class="pm-pulse-ring"></div>
                 <div class="pm-pulse-ring"></div>
                 <div class="pm-pulse-dot"></div>
               </div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
      interactive: false,
      zIndexOffset: 1000,
    }).addTo(state.progressMap);
  }

  // ── Auto-fit bounds ──
  const fitPoints = [
    ...planned,
    ...actual,
    ...(state.routeStartCoord ? [state.routeStartCoord] : []),
    ...(state.routeDestinationCoord ? [state.routeDestinationCoord] : []),
  ];

  if (fitPoints.length > 0) {
    state.progressMap.fitBounds(L.latLngBounds(fitPoints), { padding: [32, 32], maxZoom: 16, animate: false });
  }
}

function updateProgressMapStats() {
  const effective = state.totalDistanceM;
  const goal      = state.routeDistanceM;
  const remaining = Number.isFinite(goal) ? Math.max(0, goal - effective) : null;
  const pct       = Number.isFinite(goal) && goal > 0 ? Math.min(100, (effective / goal) * 100) : null;

  if (refs.pmCompletedVal) refs.pmCompletedVal.textContent = `${formatKm(effective)} km`;
  if (refs.pmRemainingVal) refs.pmRemainingVal.textContent = remaining !== null ? `${formatKm(remaining)} km` : "—";
  if (refs.pmPctVal)       refs.pmPctVal.textContent       = pct !== null ? `${Math.round(pct)}%` : "—";
}

function openProgressMap() {
  refs.progressMapOverlay.classList.add("pmVisible");
  refs.progressMapOverlay.setAttribute("aria-hidden", "false");
  updateProgressMapStats();
  // Defer map init until overlay is visible so Leaflet can measure the container
  requestAnimationFrame(() => {
    updateProgressMapLayers();
    state.progressMap.invalidateSize();
  });
}

function closeProgressMap() {
  refs.progressMapOverlay.classList.remove("pmVisible");
  refs.progressMapOverlay.setAttribute("aria-hidden", "true");
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARE / SOCIAL IMAGE
// ─────────────────────────────────────────────────────────────────────────────
function initShare() {
  refs.shareBtn?.addEventListener("click", openShareOverlay);
  refs.closeShareBtn?.addEventListener("click", () => {
    refs.shareOverlay.classList.remove("visible");
    refs.shareOverlay.setAttribute("aria-hidden", "true");
  });
  refs.shareOverlay?.addEventListener("click", (e) => {
    if (e.target === refs.shareOverlay) {
      refs.shareOverlay.classList.remove("visible");
      refs.shareOverlay.setAttribute("aria-hidden", "true");
    }
  });
  refs.downloadShareBtn?.addEventListener("click", () => {
    const a = document.createElement("a");
    a.download = "world-challenge-run.png";
    a.href = refs.shareCanvas.toDataURL("image/png");
    a.click();
  });
}

function openShareOverlay() {
  drawShareCanvas();
  refs.shareOverlay.classList.add("visible");
  refs.shareOverlay.setAttribute("aria-hidden", "false");
}

function drawShareCanvas() {
  const canvas = refs.shareCanvas;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  // Background
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);

  // Volt accent bar top
  ctx.fillStyle = "#e2ff22";
  ctx.fillRect(0, 0, W, 6);

  // Subtle grid pattern
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // App label
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.font = "bold 13px Arial Black, sans-serif";
  ctx.fillText("NRC · WORLD CHALLENGE", 30, 44);

  // Race / route label
  const raceLabel = state.worldChallengeLabel
    ? state.worldChallengeLabel.toUpperCase()
    : (state.routeStartLabel && state.routeDestinationLabel
        ? `${state.routeStartLabel} → ${state.routeDestinationLabel}`
        : "CUSTOM ROUTE");

  ctx.fillStyle = "#ffffff";
  ctx.font = "italic 900 30px Arial Black, sans-serif";
  ctx.fillText(raceLabel, 30, 88);

  // Big distance number
  const kmCompleted = formatKm(state.totalDistanceM);
  ctx.fillStyle = "#e2ff22";
  ctx.font = "italic 900 88px Arial Black, sans-serif";
  ctx.fillText(kmCompleted, 30, 196);

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "italic 900 24px Arial Black, sans-serif";
  ctx.fillText("KM COMPLETED", 30, 228);

  // Goal line
  if (Number.isFinite(state.routeDistanceM)) {
    const goalKm = formatKm(state.routeDistanceM);
    const pct = Math.min(100, (state.totalDistanceM / state.routeDistanceM) * 100);

    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.font = "normal 400 13px Arial, sans-serif";
    ctx.fillText(`Goal: ${goalKm} km · ${Math.round(pct)}% complete`, 30, 258);

    // Mini progress bar
    const barX = 30, barY = 272, barW = W - 60, barH = 6;
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    roundRect(ctx, barX, barY, barW, barH, 3);
    ctx.fill();
    ctx.fillStyle = "#e2ff22";
    roundRect(ctx, barX, barY, barW * (pct / 100), barH, 3);
    ctx.fill();
  }

  // Recent runs on right side
  const runs = state.runHistory.slice(0, 4);
  if (runs.length > 0) {
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.font = "bold 11px Arial Black, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("RECENT RUNS", W - 30, 44);

    runs.forEach((run, i) => {
      const y = 80 + i * 52;
      const d = new Date(run.timestamp);
      const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const kmStr = (run.distanceM / 1000).toFixed(1);

      ctx.fillStyle = "#e2ff22";
      ctx.font = "italic 900 20px Arial Black, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`${kmStr} km`, W - 30, y);

      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "normal 400 11px Arial, sans-serif";
      ctx.fillText(dateStr, W - 30, y + 16);
    });
    ctx.textAlign = "left";
  }

  // Bottom tag
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.font = "normal 400 11px Arial, sans-serif";
  ctx.fillText("Generated with World Challenge Runner", 30, H - 14);

  // Volt bar bottom
  ctx.fillStyle = "#e2ff22";
  ctx.fillRect(0, H - 5, W, 5);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN SUMMARY MODAL
// ─────────────────────────────────────────────────────────────────────────────
function applyRunSummaryToDrawer(summary) {
  refs.summaryDistance.textContent     = `${formatKm(summary.distanceM)} km`;
  refs.summaryDuration.textContent     = formatDuration(summary.durationMs);
  refs.summaryPace.textContent         = formatPace(summary.durationMs, summary.distanceM);
  refs.summaryCalories.textContent     = `${Math.round(summary.calories)} kcal`;
  refs.modalSummaryDistance.textContent = `${formatKm(summary.distanceM)} km`;
  refs.modalSummaryDuration.textContent = formatDuration(summary.durationMs);
  refs.modalSummaryPace.textContent     = formatPace(summary.durationMs, summary.distanceM);
  refs.modalSummaryCalories.textContent = `${Math.round(summary.calories)} kcal`;
}

function ensureRunSummaryMap() {
  if (state.summaryMap) return;
  state.summaryMap = L.map(refs.modalRunMap, {
    zoomControl: false, worldCopyJump: true, scrollWheelZoom: false,
  }).setView([0, 0], 2);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>', maxZoom: 19,
  }).addTo(state.summaryMap);
  state.summaryPolyline = L.polyline([], {
    color: "#e2ff22", weight: 4, opacity: 0.95, lineJoin: "round", lineCap: "round",
  }).addTo(state.summaryMap);
}

function openRunSummaryModal(summary) {
  state.pendingRunSummary = summary;
  applyRunSummaryToDrawer(summary);
  ensureRunSummaryMap();
  state.summaryPolyline.setLatLngs(summary.pathLatLngs || []);
  refs.runSummaryModal.classList.add("visible");
  refs.runSummaryModal.setAttribute("aria-hidden", "false");
  state.summaryMap.invalidateSize();
  if (summary.pathLatLngs?.length > 1) {
    state.summaryMap.fitBounds(summary.pathLatLngs, { padding: [18, 18] });
  }
}

function closeRunSummaryModal() {
  refs.runSummaryModal.classList.remove("visible");
  refs.runSummaryModal.setAttribute("aria-hidden", "true");
}

function commitRunSummaryToJourney() {
  const summary = state.pendingRunSummary;
  if (!summary) return;

  state.totalDistanceM      += summary.distanceM;
  state.lastSessionDistanceM = summary.distanceM;
  state.lastRunPathLatLngs   = summary.pathLatLngs.slice();
  state.pathLatLngs.push(...summary.pathLatLngs);

  // Add to today's km
  state.todayKm = parseFloat((state.todayKm + summary.distanceM / 1000).toFixed(3));

  if (summary.distanceM > 0) {
    state.runHistory.unshift({
      timestamp: summary.timestamp,
      distanceM: summary.distanceM,
      durationMs: summary.durationMs,
      calories: Math.round(summary.calories),
    });
    state.runHistory = state.runHistory.slice(0, 30);
  }
  state.showRunSummaryMap = true;

  if (state.userPathPolyline) state.userPathPolyline.setLatLngs(state.lastRunPathLatLngs);
  if (state.map) {
    state.map.invalidateSize();
    if (state.lastRunPathLatLngs.length > 1) state.map.fitBounds(state.lastRunPathLatLngs, { padding: [24, 24] });
  }
  if (!state.hasCompletedTrek && Number.isFinite(state.routeDistanceM) && state.totalDistanceM >= state.routeDistanceM) {
    state.hasCompletedTrek = true;
    if (typeof confetti === "function") confetti({ particleCount: 160, spread: 90, startVelocity: 50, origin: { y: 0.66 } });
  }
  renderPreviousRuns(state, refs);
  updateVirtualUI(state, refs, maybeCelebrateCompletion, state.totalDistanceM);
  updateTrekPhaseUI(state, refs);
  saveNow();
  state.pendingRunSummary = null;
}

function maybeCelebrateCompletion() {
  if (state.hasCompletedTrek) return;
  if (!Number.isFinite(state.routeDistanceM) || state.routeDistanceM <= 0) return;
  if (state.totalDistanceM < state.routeDistanceM) return;
  state.hasCompletedTrek = true;
  if (typeof confetti === "function") confetti({ particleCount: 130, spread: 78, startVelocity: 45, origin: { y: 0.65 } });
  scheduleSave();
}

// ─────────────────────────────────────────────────────────────────────────────
// VIRTUAL ROUTE
// ─────────────────────────────────────────────────────────────────────────────
function renderVirtualRoute() {
  if (!state.map || !state.virtualRoutePolyline) return;
  state.virtualRoutePolyline.setLatLngs(state.routeGeometryLatLngs || []);
  state.virtualStartMarker?.remove();
  state.virtualEndMarker?.remove();
  state.virtualStartMarker = null;
  state.virtualEndMarker = null;
  if (Array.isArray(state.routeStartCoord))
    state.virtualStartMarker = L.marker(state.routeStartCoord, { title: "Start" }).addTo(state.map);
  if (Array.isArray(state.routeDestinationCoord))
    state.virtualEndMarker = L.marker(state.routeDestinationCoord, { title: "Destination" }).addTo(state.map);
}

function setUserMarkerVisible(v) {
  state.userMarker?.setOpacity(v ? 1 : 0);
}

function onDeviceOrientation(event) {
  let h = null;
  if (typeof event.webkitCompassHeading === "number" && Number.isFinite(event.webkitCompassHeading)) h = event.webkitCompassHeading;
  else if (typeof event.alpha === "number" && Number.isFinite(event.alpha)) h = (360 - event.alpha) % 360;
  if (h === null) return;
  state.compassBearingDeg = h;
  if (state.isTracking) updateConeRotation(state, h);
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE CALCULATION
// ─────────────────────────────────────────────────────────────────────────────
async function calculateRoute() {
  const startText = refs.startPointInput.value.trim();
  const endText   = refs.destinationPointInput.value.trim();
  if (!startText || !endText) {
    refs.statusEl.innerHTML = '<span style="color:#ff5c7a">Enter both start and destination.</span>';
    return;
  }
  try {
    refs.calculateRouteBtn.disabled = true;
    refs.statusEl.textContent = "Calculating route…";
    const start = state.useCurrentAsStart && Array.isArray(state.routeStartCoord)
      ? { lat: state.routeStartCoord[0], lon: state.routeStartCoord[1], displayName: startText }
      : await geocodeWithNominatim(startText);
    if (!start) throw new Error("Starting point not found.");
    const end = await geocodeWithNominatim(endText);
    if (!end) throw new Error("Destination not found.");
    const route = await calculateRouteWithOsrm(start, end);
    if (!route) throw new Error("Route not found.");

    Object.assign(state, {
      routeDistanceM:        route.distanceM,
      routeStartLabel:       startText,
      routeDestinationLabel: endText,
      routeStartCoord:       [start.lat, start.lon],
      routeDestinationCoord: [end.lat, end.lon],
      routeGeometryLatLngs:  route.geometryLatLngs,
      useCurrentAsStart:     false,
      showRunSummaryMap:     false,
      hasCompletedTrek:      state.totalDistanceM >= route.distanceM,
      worldChallengeGoalM:   null,
      worldChallengeLabel:   null,
    });
    if (refs.runTitleEl) refs.runTitleEl.textContent = "WORLD CHALLENGE";
    await ensureMap(state, refs);
    renderVirtualRoute();
    if (state.routeGeometryLatLngs.length > 1) state.map.fitBounds(state.routeGeometryLatLngs, { padding: [24, 24] });
    updateVirtualUI(state, refs, maybeCelebrateCompletion);
    refs.statusEl.textContent = `Route: ${formatKm(state.routeDistanceM)} km`;
    scheduleSave();
  } catch (err) {
    refs.statusEl.innerHTML = `<span style="color:#ff5c7a">${err?.message || "Route calculation failed."}</span>`;
  } finally {
    refs.calculateRouteBtn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRACKING
// ─────────────────────────────────────────────────────────────────────────────
async function startTracking() {
  if (state.watchId !== null) return;
  if (!state.isTrekActive) {
    refs.statusEl.innerHTML = '<span style="color:#ff5c7a">Set a route or select a race first.</span>';
    return;
  }
  try { await requestCompassPermission(state, refs, onDeviceOrientation); } catch {}
  await ensureMap(state, refs);
  state.currentSessionDistanceM = 0;
  state.currentRunPathLatLngs   = [];
  state.runStartMs              = Date.now();
  startLiveTimer();
  state.showRunSummaryMap = false;
  updateTrekPhaseUI(state, refs);
  setTracking();
  state.isTracking = true;
  setUserMarkerVisible(true);

  state.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      state.lastAccuracy = Number.isFinite(accuracy) ? accuracy : null;
      const raw = { latitude, longitude, accuracy: state.lastAccuracy, timestamp: Date.now() };
      state.smoothCoords = smoothPosition(state.smoothCoords, raw);
      const useLat = state.smoothCoords?.latitude ?? latitude;
      const useLon = state.smoothCoords?.longitude ?? longitude;
      const latlng = [useLat, useLon];
      if (state.lastCoords) {
        const deltaM  = haversineMeters(state.lastCoords.latitude, state.lastCoords.longitude, useLat, useLon);
        const bearing = bearingBetween(state.lastCoords.latitude, state.lastCoords.longitude, useLat, useLon);
        if (shouldCountMovement(state, deltaM, state.lastAccuracy ?? 99, bearing)) state.currentSessionDistanceM += deltaM;
        state.lastBearing = bearing;
      }
      state.lastCoords = { latitude: useLat, longitude: useLon };
      state.pathLatLngs.push(latlng);
      state.currentRunPathLatLngs.push(latlng);
      refs.distanceSmallEl.textContent = `Session: ${formatKm(state.currentSessionDistanceM)} km`;
      if (state.userMarker) state.userMarker.setLatLng(latlng);
      // Keep progress map live marker in sync if it's open
      if (state.pmLiveMarker) state.pmLiveMarker.setLatLng(latlng);
      if (state.pmActualPolyline) state.pmActualPolyline.setLatLngs(state.pathLatLngs);
      if (!state.hasCenteredOnce) {
        state.map.setView(latlng, 18, { animate: false });
        state.hasCenteredOnce = true;
      } else {
        state.map.panTo(latlng, { animate: true, duration: 250 });
      }
      updateVirtualUI(state, refs, () => {}, state.totalDistanceM + state.currentSessionDistanceM);
      scheduleSave();
    },
    (err) => {
      refs.statusEl.innerHTML = `<span style="color:#ff5c7a">${err?.message || "Geolocation error."}</span>`;
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
  );
}

async function stopTracking() {
  if (state.watchId === null) return;
  navigator.geolocation.clearWatch(state.watchId);
  state.watchId           = null;
  state.isTracking        = false;
  state.hasCenteredOnce   = false;
  const durationMs = state.runStartMs ? Date.now() - state.runStartMs : 0;
  const distanceM  = state.currentSessionDistanceM;
  const calories   = state.userWeightKg * (distanceM / 1000) * 1.036;
  const summary    = { timestamp: Date.now(), distanceM, durationMs, calories, pathLatLngs: state.currentRunPathLatLngs.slice() };
  state.currentSessionDistanceM = 0;
  state.runStartMs              = null;
  stopLiveTimer();
  openRunSummaryModal(summary);
  setIdle();
  setUserMarkerVisible(false);
  updateVirtualUI(state, refs, () => {}, state.totalDistanceM);
}

async function resetTrek() {
  Object.assign(state, {
    routeStartLabel: "", routeDestinationLabel: "",
    routeStartCoord: null, routeDestinationCoord: null,
    routeDistanceM: null, routeGeometryLatLngs: [],
    useCurrentAsStart: false,
    totalDistanceM: 0, currentSessionDistanceM: 0, lastSessionDistanceM: 0,
    hasCompletedTrek: false, lastCoords: null,
    pathLatLngs: [], currentRunPathLatLngs: [], lastRunPathLatLngs: [],
    showRunSummaryMap: false, smoothCoords: null,
    lastBearing: null, consistentDirectionCount: 0,
    worldChallengeGoalM: null, worldChallengeLabel: null,
  });
  localStorage.removeItem(TREK_STORAGE_KEY);
  refs.startPointInput.value = "";
  refs.destinationPointInput.value = "";
  refs.distanceSmallEl.textContent = "Today starts now.";
  if (refs.runTitleEl) refs.runTitleEl.textContent = "WORLD CHALLENGE";
  if (state.userPathPolyline) state.userPathPolyline.setLatLngs([]);
  if (state.virtualRoutePolyline) state.virtualRoutePolyline.setLatLngs([]);
  state.virtualStartMarker?.remove();
  state.virtualEndMarker?.remove();
  document.querySelectorAll(".raceCard").forEach((c) => c.classList.remove("selected"));
  renderPreviousRuns(state, refs);
  refs.summaryDistance.textContent  = "0.00 km";
  refs.summaryDuration.textContent  = "00:00";
  refs.summaryPace.textContent      = "--:-- /km";
  refs.summaryCalories.textContent  = "0 kcal";
  refs.modalSummaryDistance.textContent = "0.00 km";
  refs.modalSummaryDuration.textContent = "00:00";
  refs.modalSummaryPace.textContent     = "--:-- /km";
  refs.modalSummaryCalories.textContent = "0 kcal";
  closeRunSummaryModal();
  state.pendingRunSummary = null;
  stopLiveTimer();
  updateVirtualUI(state, refs, maybeCelebrateCompletion);
  updateTrekPhaseUI(state, refs);
  setIdle();
}

async function useCurrentLocationAsStart() {
  try {
    refs.statusEl.textContent = "Getting current location…";
    const pos = await getCurrentPositionPromise();
    const { latitude, longitude } = pos.coords;
    state.routeStartCoord = [latitude, longitude];
    state.routeStartLabel = "My Current Location";
    refs.startPointInput.value = state.routeStartLabel;
    state.useCurrentAsStart = true;
    refs.statusEl.textContent = "Start point set.";
    scheduleSave();
  } catch {
    refs.statusEl.innerHTML = '<span style="color:#ff5c7a">Unable to get your location.</span>';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────
async function init() {
  loadState();
  refs.startPointInput.value = state.routeStartLabel || "";
  refs.destinationPointInput.value = state.routeDestinationLabel || "";
  if (state.worldChallengeLabel && refs.runTitleEl) refs.runTitleEl.textContent = state.worldChallengeLabel.toUpperCase();

  renderPreviousRuns(state, refs);
  updateVirtualUI(state, refs, maybeCelebrateCompletion);
  setIdle();

  if (typeof confetti === "undefined") {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js";
    s.async = true;
    document.head.appendChild(s);
  }

  await ensureMap(state, refs);
  renderVirtualRoute();
  updateTrekPhaseUI(state, refs);

  initNav();
  initModeSwitcher();
  initPlansTab();
  initDailyGoal();
  initProgressMap();
  initShare();

  // Restore selected race card
  if (state.worldChallengeLabel) {
    document.querySelectorAll(".raceCard").forEach((c) => {
      if (c.dataset.label === state.worldChallengeLabel) c.classList.add("selected");
    });
  }

  refs.useCurrentLocationBtn.addEventListener("click", useCurrentLocationAsStart);
  refs.calculateRouteBtn.addEventListener("click", calculateRoute);
  refs.startBtn.addEventListener("click", startTracking);
  refs.stopBtn.addEventListener("click", stopTracking);
  refs.resetTrekBtn.addEventListener("click", resetTrek);
  refs.cancelTrekBtn.addEventListener("click", resetTrek);
  refs.startPointInput.addEventListener("input", () => {
    state.routeStartLabel = refs.startPointInput.value;
    state.useCurrentAsStart = false;
    scheduleSave();
  });
  refs.destinationPointInput.addEventListener("input", () => {
    state.routeDestinationLabel = refs.destinationPointInput.value;
    scheduleSave();
  });
  refs.saveRunSummaryBtn.addEventListener("click", () => { commitRunSummaryToJourney(); closeRunSummaryModal(); });
  refs.closeRunSummaryBtn.addEventListener("click", () => { closeRunSummaryModal(); state.pendingRunSummary = null; });
  refs.runSummaryModal.addEventListener("click", (e) => {
    if (e.target === refs.runSummaryModal) { closeRunSummaryModal(); state.pendingRunSummary = null; }
  });
  refs.liveTimer.textContent = "00:00";
}

init();
