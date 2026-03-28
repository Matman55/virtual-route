export function formatMeters(m) {
  if (!Number.isFinite(m)) return "—";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

export function formatKm(m) {
  if (!Number.isFinite(m) || m < 0) return "—";
  return (m / 1000).toFixed(2);
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function setPhaseVisibility(el, visible) {
  if (!el) return;
  el.classList.toggle("phaseHidden", !visible);
}

// ─────────────────────────────────────────────────────────────────────────────
// TREK PHASE
// ─────────────────────────────────────────────────────────────────────────────
export function updateTrekPhaseUI(state, refs) {
  setPhaseVisibility(refs.setupPhase, !state.isTrekActive);
  setPhaseVisibility(refs.activeDashboard, state.isTrekActive);

  if (!state.isTrekActive || !Number.isFinite(state.routeDistanceM) || state.routeDistanceM <= 0) {
    if (refs.routeNamesDisplayTop) refs.routeNamesDisplayTop.textContent = "—";
    return;
  }
  const label = state.worldChallengeLabel
    ? state.worldChallengeLabel.toUpperCase()
    : `${state.routeStartLabel || "Start"} → ${state.routeDestinationLabel || "Destination"}`;
  if (refs.routeNamesDisplayTop) refs.routeNamesDisplayTop.textContent = label;
}

// ─────────────────────────────────────────────────────────────────────────────
// VIRTUAL UI (Run screen stats)
// ─────────────────────────────────────────────────────────────────────────────
export function updateVirtualUI(state, refs, maybeCelebrateCompletion, overrideTotalM = null) {
  const effectiveTotalM = Number.isFinite(overrideTotalM) ? overrideTotalM : state.totalDistanceM;
  refs.caloriesEl.textContent = Math.max(0, Math.round((effectiveTotalM / 1000) * 60)).toString();

  if (!Number.isFinite(state.routeDistanceM) || state.routeDistanceM <= 0) {
    state.isTrekActive = false;
    refs.goalDistanceDisplay.textContent  = "Total Goal: —";
    refs.distanceRemainingEl.textContent  = "—";
    refs.totalDistanceEl.textContent      = "0.00";
    refs.progressBarFill.style.width      = "0%";
    refs.progressPctText.textContent      = "0%";
    refs.calculatedDistanceEl.textContent = "—";
    updateTrekPhaseUI(state, refs);
    return;
  }

  state.isTrekActive = true;
  refs.goalDistanceDisplay.textContent  = `Total Goal: ${formatKm(state.routeDistanceM)} km`;
  refs.calculatedDistanceEl.textContent = `${formatKm(state.routeDistanceM)} km`;

  const remaining   = Math.max(0, state.routeDistanceM - effectiveTotalM);
  refs.distanceRemainingEl.textContent = formatKm(remaining);
  refs.totalDistanceEl.textContent     = formatKm(effectiveTotalM);

  const pct        = state.routeDistanceM > 0 ? (effectiveTotalM / state.routeDistanceM) * 100 : 0;
  const pctClamped = clamp(pct, 0, 100);
  refs.progressBarFill.style.width = `${pctClamped.toFixed(1)}%`;
  refs.progressPctText.textContent = `${Math.round(pctClamped)}%`;

  if (remaining <= 0.5 && state.routeDistanceM > 0) maybeCelebrateCompletion();
  updateTrekPhaseUI(state, refs);
}

// ─────────────────────────────────────────────────────────────────────────────
// PREVIOUS RUNS (used by Run tab and Activity)
// ─────────────────────────────────────────────────────────────────────────────
export function renderPreviousRuns(state, refs) {
  if (!refs.previousRunsList) return;
  if (!Array.isArray(state.runHistory) || state.runHistory.length === 0) {
    refs.previousRunsList.textContent = "No runs yet.";
    return;
  }
  refs.previousRunsList.innerHTML = state.runHistory
    .slice(0, 10)
    .map((run) => {
      const date    = Number.isFinite(run.timestamp) ? new Date(run.timestamp) : new Date();
      const dateStr = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      const km      = Number.isFinite(run.distanceM) ? (run.distanceM / 1000).toFixed(2) : "0.00";
      const cal     = Number.isFinite(run.calories) ? run.calories : 0;
      const dur     = Number.isFinite(run.durationMs) ? formatDurationShort(run.durationMs) : "";
      const thumb   = run.thumbDataUrl
        ? `<div class="runHistoryThumb"><img src="${run.thumbDataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:8px;display:block;"></div>`
        : `<div class="runHistoryThumb" style="display:flex;align-items:center;justify-content:center;">
             <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.2)" stroke-width="2"><polyline points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>
           </div>`;
      return `
        <div class="runHistoryItem">
          ${thumb}
          <div style="flex:1;min-width:0;">
            <div class="runHistoryItemDate">${dateStr}${dur ? ` · ${dur}` : ""}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div class="runHistoryItemKm">${km} km</div>
            <div class="runHistoryItemCal">${cal} kcal</div>
          </div>
        </div>`;
    })
    .join("");
}

function formatDurationShort(ms) {
  const s  = Math.max(0, Math.round(ms / 1000));
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY TAB
// ─────────────────────────────────────────────────────────────────────────────
const RING_CIRCUMFERENCE = 2 * Math.PI * 52; // r=52 → 326.73

export function renderActivityTab(state, refs) {
  renderPreviousRuns(state, refs);

  const goal    = state.dailyGoalKm || 5;
  const today   = state.todayKm || 0;
  const pct     = clamp((today / goal) * 100, 0, 100);
  const offset  = RING_CIRCUMFERENCE * (1 - pct / 100);

  if (refs.dailyGoalRingFill) {
    refs.dailyGoalRingFill.style.strokeDashoffset = offset.toFixed(2);
  }
  if (refs.dailyGoalPct) refs.dailyGoalPct.textContent = `${Math.round(pct)}%`;
  if (refs.dailyGoalToday) refs.dailyGoalToday.textContent = `${today.toFixed(1)} km today`;
  if (refs.dailyGoalTarget) refs.dailyGoalTarget.textContent = `${goal.toFixed(1)} km`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLUB / LEADERBOARD
// ─────────────────────────────────────────────────────────────────────────────
const MOCK_RUNNERS = [
  { name: "Eliud K.",    km: 42.2, race: "NYC Marathon",  color: "#ffd700" },
  { name: "Brigid K.",   km: 38.6, race: "Grand Canyon",  color: "#e2ff22" },
  { name: "Mo F.",       km: 42.0, race: "Inca Trail",    color: "#3df4ff" },
  { name: "Sifan H.",    km: 21.1, race: "Great Wall",    color: "#ff8c42" },
  { name: "Kenenisa B.", km: 38.6, race: "Grand Canyon",  color: "#c084fc" },
  { name: "Tirunesh D.", km: 42.2, race: "NYC Marathon",  color: "#f87171" },
  { name: "Joshua C.",   km: 21.1, race: "Great Wall",    color: "#34d399" },
  { name: "Almaz A.",    km: 42.0, race: "Inca Trail",    color: "#60a5fa" },
  { name: "David R.",    km: 38.6, race: "Grand Canyon",  color: "#a3e635" },
  { name: "Beatrice C.", km: 21.1, race: "Great Wall",    color: "#fb923c" },
];

const RANK_CLASSES = ["gold", "silver", "bronze"];

export function renderLeaderboard(state, refs) {
  const listEl   = document.getElementById("leaderboardList");
  const youRowEl = document.getElementById("clubYouRow");
  if (!listEl) return;

  // Compute your cumulative km
  const yourKm   = parseFloat((state.totalDistanceM / 1000).toFixed(2));
  const yourName = "You";
  const yourColor = "#111111";

  // Merge mock + you, sort by km descending
  const all = [...MOCK_RUNNERS, { name: yourName, km: yourKm, race: state.worldChallengeLabel || "Custom Route", color: yourColor, isYou: true }]
    .sort((a, b) => b.km - a.km);

  const yourRank = all.findIndex((r) => r.isYou) + 1;

  listEl.innerHTML = all.slice(0, 10).map((runner, i) => {
    const rank    = i + 1;
    const rankCls = rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : "normal";
    const initials = runner.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
    const rowStyle = runner.isYou ? "background:#e2ff22;border-radius:12px;padding:4px 8px;" : "";
    return `
      <div class="lbRow" style="${rowStyle}">
        <div class="lbRank ${rankCls}">${rank}</div>
        <div class="lbAvatar" style="background:${runner.color}22;color:${runner.color}">${initials}</div>
        <div>
          <div class="lbName">${runner.isYou ? "YOU" : runner.name}${runner.isYou ? " 🫵" : ""}</div>
          <div class="lbSubrace">${runner.race}</div>
        </div>
        <div class="lbKm">${runner.km.toFixed(1)}</div>
      </div>`;
  }).join("");

  if (youRowEl) {
    youRowEl.innerHTML = yourKm > 0
      ? `<div class="statLabel" style="margin-bottom:4px;">YOUR RANK</div>
         <div style="display:flex;justify-content:space-between;align-items:center;">
           <div style="font-family:var(--font-num);font-size:1.6rem;font-weight:900;font-style:italic;color:var(--ink)">#${yourRank}</div>
           <div style="text-align:right">
             <div style="font-family:var(--font-num);font-size:1.1rem;font-weight:900;font-style:italic;color:var(--ink)">${yourKm.toFixed(2)} km</div>
             <div class="statMeta">${state.runHistory.length} run${state.runHistory.length !== 1 ? "s" : ""} logged</div>
           </div>
         </div>`
      : `<div class="statMeta" style="text-align:center">Complete your first run to appear on the leaderboard.</div>`;
  }
}
