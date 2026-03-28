import {
  ensureMap,
  requestCompassPermission,
  haversineMeters,
  updateConeRotation,
  smoothPosition,
  bearingBetween,
  shouldCountMovement,
  createKalmanFilter,
  kalmanUpdate,
  isVelocityPlausible,
} from "./location.js";
import { formatKm, renderPreviousRuns, updateTrekPhaseUI, updateVirtualUI, renderActivityTab, renderLeaderboard } from "./ui.js";

// ─────────────────────────────────────────────────────────────────────────────
const TREK_STORAGE_KEY = "virtualTrekStateV5";

// ── World Tour Data ───────────────────────────────────────────────────────────
// Each race has:
//   waypoints: [[lat, lon], ...] approximate lat/lng coords along the actual route
//   postcards:  array of { km, location, img, voice } triggers sorted ascending by km
//     img  — an Unsplash URL showing that location
//     voice — text for the Speech Synthesis announcement
const WORLD_TOUR = {
  "NYC Marathon": {
    km: 42.2,
    waypoints: [
      [40.6019, -74.0552], // Staten Island — Start
      [40.6782, -73.9442], // Brooklyn — Bedford-Stuyvesant
      [40.7282, -73.9442], // Williamsburg Bridge
      [40.7614, -73.9776], // Midtown Manhattan
      [40.7741, -73.9693], // Central Park South
      [40.7829, -73.9654], // Central Park Finish
    ],
    postcards: [
      { km: 0,  location: "Verrazzano-Narrows Bridge, Staten Island", img: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80", voice: "The race begins! You are crossing the iconic Verrazzano-Narrows Bridge. The skyline of New York City awaits you. Let's go!" },
      { km: 2,  location: "Bay Ridge, Brooklyn", img: "https://images.unsplash.com/photo-1534430480872-3498386e7856?w=800&q=80", voice: "Two kilometers done! You are running through Bay Ridge, Brooklyn. The crowd is roaring. Keep the pace!" },
      { km: 6,  location: "Bedford-Stuyvesant, Brooklyn", img: "https://images.unsplash.com/photo-1498855926480-d0592e8c150e?w=800&q=80", voice: "Six kilometers! You are deep in Brooklyn. The energy of this neighborhood is electric. Stay strong!" },
      { km: 12, location: "Pulaski Bridge, Brooklyn–Queens", img: "https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=800&q=80", voice: "Twelve kilometers! Crossing into Queens over the Pulaski Bridge. Halfway through the boroughs. Excellent work!" },
      { km: 16, location: "Queensboro Bridge", img: "https://images.unsplash.com/photo-1548266652-99cf27701ced?w=800&q=80", voice: "Sixteen kilometers! You are on the Queensboro Bridge, about to enter Manhattan. The crowd noise on First Avenue will lift you up!" },
      { km: 20, location: "First Avenue, Manhattan", img: "https://images.unsplash.com/photo-1534430480872-3498386e7856?w=800&q=80", voice: "Twenty kilometers! First Avenue is electric! This is the most famous stretch of the NYC Marathon. You are halfway there. Incredible!" },
      { km: 25, location: "The Bronx", img: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80", voice: "Twenty-five kilometers! A quick tour through the Bronx before heading back to Manhattan. Only 17 kilometers left. You are doing amazing!" },
      { km: 30, location: "Fifth Avenue, Harlem", img: "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=800&q=80", voice: "Thirty kilometers! You are on Fifth Avenue in Harlem. The final stretch into Central Park is within sight. Dig deep!" },
      { km: 36, location: "Central Park South", img: "https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=800&q=80", voice: "Thirty-six kilometers! You have entered Central Park. Six kilometers to go. This is where legends are made. Keep pushing!" },
      { km: 42, location: "Finish Line — Central Park", img: "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800&q=80", voice: "You are almost there! The finish line is in sight on Central Park's Tavern on the Green. Give it everything you have!" },
    ],
  },
  "Great Wall": {
    km: 21.1,
    waypoints: [
      [40.3589, 116.0199], // Juyongguan
      [40.4319, 116.5704], // Mutianyu
      [40.6769, 117.2318], // Jinshanling
      [40.6726, 117.4842], // Simatai
    ],
    postcards: [
      { km: 0,  location: "Juyongguan Pass — Start", img: "https://images.unsplash.com/photo-1508804185872-d7badad00f7d?w=800&q=80", voice: "The Great Wall race begins at Juyongguan Pass. Ahead lie ancient stone steps and towers built 2000 years ago. Begin your climb!" },
      { km: 2,  location: "Ancient Watchtower", img: "https://images.unsplash.com/photo-1508804052814-cd3ba865a116?w=800&q=80", voice: "Two kilometers! You have reached your first ancient watchtower. Soldiers once guarded these very walls. Honour their legacy with every step!" },
      { km: 6,  location: "Mutianyu Section — Dragon's Back", img: "https://images.unsplash.com/photo-1508804052814-cd3ba865a116?w=800&q=80", voice: "Six kilometers! Welcome to the Dragon's Back, the most beautiful section of the wall. The mountains stretch endlessly. Breathtaking!" },
      { km: 10, location: "Jinshanling Section", img: "https://images.unsplash.com/photo-1508804185872-d7badad00f7d?w=800&q=80", voice: "Ten kilometers! Halfway! You are at Jinshanling, a perfectly preserved section of the Ming Dynasty wall. Keep climbing!" },
      { km: 16, location: "Simatai — Steep Section", img: "https://images.unsplash.com/photo-1501854140801-50d01698950b?w=800&q=80", voice: "Sixteen kilometers! The Simatai section is the steepest and wildest. The wall clings to vertical cliffs. Incredible effort! Five to go!" },
      { km: 21, location: "Gubeikou — Finish", img: "https://images.unsplash.com/photo-1513002749550-c59d786b8e6c?w=800&q=80", voice: "You have conquered the Great Wall! Twenty-one kilometers of ancient history under your feet. You are a legend!" },
    ],
  },
  "Grand Canyon": {
    km: 38.6,
    waypoints: [
      [36.0572, -112.1401], // South Rim Trailhead
      [36.1019, -112.0936], // Plateau Point
      [36.1074, -112.0953], // Colorado River
      [36.2097, -112.0547], // North Rim
    ],
    postcards: [
      { km: 0,  location: "South Rim — Bright Angel Trailhead", img: "https://images.unsplash.com/photo-1426604966848-d7adac402bff?w=800&q=80", voice: "Welcome to the Grand Canyon Rim-to-Rim! You begin at the South Rim, 2100 metres above the canyon floor. The descent begins. Watch your step!" },
      { km: 4,  location: "Three Mile Resthouse", img: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80", voice: "Four kilometers! You have descended through geological time — these walls are 2 billion years old. The canyon opens up below you. Amazing!" },
      { km: 10, location: "Indian Garden Oasis", img: "https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=800&q=80", voice: "Ten kilometers! You have reached Indian Garden, a lush oasis at the canyon floor. Refuel here. The Colorado River is close!" },
      { km: 14, location: "Colorado River — Silver Bridge", img: "https://images.unsplash.com/photo-1485470733090-0aae1788d5af?w=800&q=80", voice: "Fourteen kilometers! You are crossing the Silver Bridge over the mighty Colorado River. You are at the very bottom of the Grand Canyon. Incredible!" },
      { km: 20, location: "Phantom Ranch", img: "https://images.unsplash.com/photo-1485470733090-0aae1788d5af?w=800&q=80", voice: "Twenty kilometers! Phantom Ranch, halfway point. The climb to the North Rim begins now. This is the toughest part. You have this!" },
      { km: 30, location: "Cottonwood Camp", img: "https://images.unsplash.com/photo-1426604966848-d7adac402bff?w=800&q=80", voice: "Thirty kilometers! Cottonwood Camp. Eight kilometers to the North Rim. The canyon walls tower above you. Dig deep!" },
      { km: 38, location: "North Rim — Finish", img: "https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=800&q=80", voice: "You have crossed the Grand Canyon! Rim to Rim, 38.6 kilometers. One of the greatest achievements in trail running. You are extraordinary!" },
    ],
  },
  "Inca Trail": {
    km: 42,
    waypoints: [
      [-13.5194, -71.9784], // KM 82 — Start
      [-13.4328, -72.0619], // Llactapata
      [-13.3869, -72.1136], // Dead Woman's Pass
      [-13.1631, -72.5450], // Machu Picchu
    ],
    postcards: [
      { km: 0,  location: "KM 82 — Inca Trail Start", img: "https://images.unsplash.com/photo-1587595431973-160d0d94add1?w=800&q=80", voice: "The Inca Trail begins! You set off from KM 82 along the sacred Urubamba River. The Andes rise above you. An ancient path awaits!" },
      { km: 4,  location: "Llactapata Ruins", img: "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=800&q=80", voice: "Four kilometers! You have reached Llactapata, ancient Incan agricultural terraces with views of the snow-capped Salcantay peak. Breathtaking!" },
      { km: 10, location: "Dead Woman's Pass — 4215m", img: "https://images.unsplash.com/photo-1501554728187-ce583db33af7?w=800&q=80", voice: "Ten kilometers! You have summited Dead Woman's Pass at 4215 metres above sea level, the highest point of the Inca Trail. You are above the clouds!" },
      { km: 16, location: "Runkuraqay Pass", img: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80", voice: "Sixteen kilometers! The second high pass at Runkuraqay. The cloud forest begins to appear below. Ancient Incan runners carried messages along this very path!" },
      { km: 24, location: "Phuyupatamarca — Cloud Level Ruins", img: "https://images.unsplash.com/photo-1587595431973-160d0d94add1?w=800&q=80", voice: "Twenty-four kilometers! Phuyupatamarca, the town above the clouds. Below you lies the Sacred Valley. The final Incan city is near!" },
      { km: 36, location: "Intipata — Sun Gate in sight", img: "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=800&q=80", voice: "Thirty-six kilometers! The Sun Gate, Intipunku, is only six kilometers away. At sunrise, the first rays will illuminate Machu Picchu below you. Keep going!" },
      { km: 42, location: "Machu Picchu — Finish", img: "https://images.unsplash.com/photo-1526392060635-9d6019884377?w=800&q=80", voice: "You have completed the Inca Trail! The ancient citadel of Machu Picchu spreads before you. The Incas would be proud. You are a World Tour legend!" },
    ],
  },
  "Tokyo Marathon": {
    km: 42.2,
    waypoints: [
      [35.6895, 139.6917], // Tokyo Metropolitan Government
      [35.7089, 139.7319], // Asakusa
      [35.6762, 139.6503], // Shinagawa
      [35.6595, 139.7976], // Tokyo Big Sight
    ],
    postcards: [
      { km: 0,  location: "Tokyo Metropolitan Government — Start", img: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800&q=80", voice: "The Tokyo Marathon! You start at the iconic twin towers of the Metropolitan Government Building in Shinjuku. Konnichiwa, Tokyo!" },
      { km: 6,  location: "Asakusa — Senso-ji Temple", img: "https://images.unsplash.com/photo-1480796927426-f609979314bd?w=800&q=80", voice: "Six kilometers! You are passing the ancient Senso-ji Temple in Asakusa, Tokyo's oldest temple. The cherry blossoms are spectacular. Keep running!" },
      { km: 14, location: "Imperial Palace", img: "https://images.unsplash.com/photo-1513407030348-c983a97b98d8?w=800&q=80", voice: "Fourteen kilometers! The Imperial Palace Gardens. The Emperor's residence lies behind these ancient walls. One of the most beautiful running routes in the world!" },
      { km: 22, location: "Shinagawa Waterfront", img: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800&q=80", voice: "Twenty-two kilometers! Halfway! You are at the Shinagawa waterfront. Tokyo Bay shimmers to your left. The city energy is incredible. Push on!" },
      { km: 32, location: "Ginza — Heart of Tokyo", img: "https://images.unsplash.com/photo-1503899036084-c55cdd92da26?w=800&q=80", voice: "Thirty-two kilometers! Ginza, the most luxurious shopping district on Earth. Thousands of spectators line the streets. Feed off their energy!" },
      { km: 42, location: "Tokyo Big Sight — Finish", img: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800&q=80", voice: "Kanpai! You have finished the Tokyo Marathon! Forty-two kilometres through the world's most dynamic city. Incredible achievement!" },
    ],
  },
  "Sahara Ultra": {
    km: 250,
    waypoints: [
      [30.9350, -5.8650], // Ouarzazate
      [30.5350, -5.2650], // Jebel Sahro
      [30.1350, -4.8650], // Draa Valley
      [29.3850, -5.5650], // Zagora
    ],
    postcards: [
      { km: 0,   location: "Ouarzazate — Desert Gateway", img: "https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=800&q=80", voice: "The Marathon des Sables. The toughest footrace on Earth begins. 250 kilometers, six stages. Only the strongest survive. Go!" },
      { km: 20,  location: "Jebel Sahro Foothills", img: "https://images.unsplash.com/photo-1501854140801-50d01698950b?w=800&q=80", voice: "Twenty kilometers into the Sahara! The Jebel Sahro mountains shimmer in the heat. Temperature is climbing toward 50 degrees. Hydrate!" },
      { km: 50,  location: "The Great Erg — Sand Dunes", img: "https://images.unsplash.com/photo-1542401886-65d6c61db217?w=800&q=80", voice: "Fifty kilometers! You have entered the Great Erg of the Sahara. Sand dunes as tall as buildings stretch to the horizon. This is true adventure!" },
      { km: 100, location: "Draa Valley Oasis", img: "https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=800&q=80", voice: "One hundred kilometers! An oasis in the Draa Valley. Palm trees and water. You have run 100 kilometers across the Sahara. Legendary!" },
      { km: 150, location: "Erg Chebbi Dunes", img: "https://images.unsplash.com/photo-1541108564883-7c98ad5c3b97?w=800&q=80", voice: "150 kilometers! The famous Erg Chebbi dunes, over 150 metres tall. Running in sand is three times harder. You are superhuman!" },
      { km: 200, location: "Zagora — Ancient Caravan Town", img: "https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=800&q=80", voice: "200 kilometers! Zagora, where ancient caravan routes crossed. Only 50 kilometers remain. You are going to finish this. Extraordinary!" },
      { km: 250, location: "Finish Line — Sahara", img: "https://images.unsplash.com/photo-1488085061387-422e29b40080?w=800&q=80", voice: "You have completed the Marathon des Sables! 250 kilometers across the Sahara Desert. You are among the most elite athletes on the planet. Welcome to legend!" },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// DOM REFS
// ─────────────────────────────────────────────────────────────────────────────
const refs = {
  // run
  startBtn:               document.getElementById("startBtn"),
  stopBtn:                document.getElementById("stopBtn"),
  cancelTrekBtn:          document.getElementById("cancelTrekBtn"),
  liveTimer:              document.getElementById("liveTimer"),
  setupPhase:             document.getElementById("setupPhase"),
  activeDashboard:        document.getElementById("activeDashboard"),
  routeNamesDisplayTop:   document.getElementById("routeNamesDisplayTop"),
  statusEl:               document.getElementById("status"),
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
  goToPlansBtn:           document.getElementById("goToPlansBtn"),
  // postcard
  postcardWrap:           document.getElementById("postcardWrap"),
  postcardImg:            document.getElementById("postcardImg"),
  postcardLocation:       document.getElementById("postcardLocation"),
  postcardKm:             document.getElementById("postcardKm"),
  // audio
  muteBtn:                document.getElementById("muteBtn"),
  muteIcon:               document.getElementById("muteIcon"),
  // activity
  previousRunsList:       document.getElementById("previousRunsList"),
  dailyGoalRingFill:      document.getElementById("dailyGoalRingFill"),
  dailyGoalPct:           document.getElementById("dailyGoalPct"),
  dailyGoalToday:         document.getElementById("dailyGoalToday"),
  dailyGoalTarget:        document.getElementById("dailyGoalTarget"),
  goalDecBtn:             document.getElementById("goalDecBtn"),
  goalIncBtn:             document.getElementById("goalIncBtn"),
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
  // post-run summary
  postRunOverlay:         document.getElementById("postRunOverlay"),
  prCloseBtn:             document.getElementById("prCloseBtn"),
  prDiscardBtn:           document.getElementById("prDiscardBtn"),
  prSaveBtn:              document.getElementById("prSaveBtn"),
  prHeaderTitle:          document.getElementById("prHeaderTitle"),
  prDistanceVal:          document.getElementById("prDistanceVal"),
  prTimeVal:              document.getElementById("prTimeVal"),
  prPaceVal:              document.getElementById("prPaceVal"),
  prCalVal:               document.getElementById("prCalVal"),
  postRunMapEl:           document.getElementById("postRunMap"),
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

  // GPS calibration
  kalmanFilter: null,
  lastRawTimestamp: null,

  // Paced breadcrumbs: array of { latlng, paceSecPerKm, timestamp }
  // recorded during the run for heatmap rendering
  pacedBreadcrumbs: [],

  // Post-run summary overlay Leaflet instance
  postRunMap: null,
  postRunPolylines: [],

  // Virtual postcard: last milestone km shown
  lastPostcardKm: -1,

  // Audio: muted state, last voice km announced
  audioMuted: false,
  lastVoiceKm: -1,
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
// PLANS TAB — World Tour Race Selector
// ─────────────────────────────────────────────────────────────────────────────
function applyFamousRace(raceName, km) {
  const tour = WORLD_TOUR[raceName];
  state.worldChallengeGoalM   = km * 1000;
  state.worldChallengeLabel   = raceName;
  state.routeDistanceM        = state.worldChallengeGoalM;
  state.routeStartLabel       = raceName;
  state.routeDestinationLabel = `${raceName} Finish`;
  state.hasCompletedTrek      = state.totalDistanceM >= state.routeDistanceM;
  state.isTrekActive          = true;
  // Use real race waypoints as the "geometry" so the progress map can draw a real route
  state.routeGeometryLatLngs  = tour ? tour.waypoints : [];
  state.routeStartCoord       = tour ? tour.waypoints[0] : null;
  state.routeDestinationCoord = tour ? tour.waypoints[tour.waypoints.length - 1] : null;
  // Reset postcard/audio progress
  state.lastPostcardKm = -1;
  state.lastVoiceKm = -1;

  if (refs.runTitleEl) refs.runTitleEl.textContent = raceName.toUpperCase();

  // Show the opening postcard
  const firstCard = tour?.postcards?.[0];
  if (firstCard) showPostcard(firstCard, 0);

  scheduleSave();
  updateVirtualUI(state, refs, maybeCelebrateCompletion);
  updateTrekPhaseUI(state, refs);
}

function initPlansTab() {
  document.querySelectorAll("#plansRaceCardGrid .raceCard").forEach((card) => {
    card.querySelector(".raceStartBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      selectRaceFromPlans(card);
    });
    card.addEventListener("click", () => selectRaceFromPlans(card));
  });
}

function selectRaceFromPlans(card) {
  document.querySelectorAll(".raceCard").forEach((c) => c.classList.remove("selected"));
  card.classList.add("selected");
  applyFamousRace(card.dataset.race, parseFloat(card.dataset.km));
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
// VIRTUAL POSTCARD
// ─────────────────────────────────────────────────────────────────────────────
function showPostcard(card, kmValue) {
  if (!refs.postcardImg) return;
  // Fade out → swap → fade in
  refs.postcardWrap?.classList.add("postcardFading");
  setTimeout(() => {
    refs.postcardImg.style.backgroundImage = `url("${card.img}")`;
    if (refs.postcardLocation) refs.postcardLocation.textContent = card.location;
    if (refs.postcardKm && kmValue > 0) refs.postcardKm.textContent = `${kmValue.toFixed(0)} km`;
    else if (refs.postcardKm) refs.postcardKm.textContent = "";
    refs.postcardWrap?.classList.remove("postcardFading");
  }, 280);
}

function checkPostcardMilestone(totalKm) {
  if (!state.worldChallengeLabel) return;
  const tour = WORLD_TOUR[state.worldChallengeLabel];
  if (!tour) return;
  for (const card of tour.postcards) {
    if (card.km <= totalKm && card.km > state.lastPostcardKm) {
      state.lastPostcardKm = card.km;
      showPostcard(card, card.km);
      break;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SPEECH SYNTHESIS (Web Speech API)
// ─────────────────────────────────────────────────────────────────────────────
const MUTE_SVG = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
  <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>`;
const UNMUTE_SVG = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>`;

function initAudio() {
  refs.muteBtn?.addEventListener("click", () => {
    state.audioMuted = !state.audioMuted;
    if (refs.muteIcon) {
      refs.muteIcon.innerHTML = state.audioMuted ? MUTE_SVG : UNMUTE_SVG;
    }
    refs.muteBtn?.classList.toggle("muteBtnMuted", state.audioMuted);
    if (state.audioMuted) window.speechSynthesis?.cancel();
  });
}

function speak(text) {
  if (state.audioMuted) return;
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate  = 1.0;
  utt.pitch = 1.0;
  utt.lang  = "en-US";
  // Prefer a female voice when available
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find((v) => v.lang.startsWith("en") && v.name.toLowerCase().includes("female"))
    || voices.find((v) => v.lang.startsWith("en"));
  if (preferred) utt.voice = preferred;
  window.speechSynthesis.speak(utt);
}

function checkVoiceMilestone(totalKm) {
  if (!state.worldChallengeLabel) return;
  const tour = WORLD_TOUR[state.worldChallengeLabel];
  if (!tour) return;
  // Trigger every 2 km (or at a postcard milestone that is a multiple of 2)
  const voiceEvery = 2;
  const milestone = Math.floor(totalKm / voiceEvery) * voiceEvery;
  if (milestone > 0 && milestone > state.lastVoiceKm) {
    state.lastVoiceKm = milestone;
    // Find nearest postcard voice line
    const sorted = [...tour.postcards].sort((a, b) => b.km - a.km);
    const match = sorted.find((c) => c.km <= milestone);
    if (match) {
      speak(match.voice);
    } else {
      speak(`You have reached ${milestone} kilometers. Keep up the great pace!`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST-RUN SUMMARY (Nike-style full-screen + pace heatmap)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a pace (sec/km) to a heatmap colour.
 * Fast < 360 s/km (6 min/km) → green
 * Moderate 360–480 → volt yellow
 * Slow > 480 s/km (8 min/km) → orange
 */
function paceToColor(secPerKm) {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return "#111111";
  if (secPerKm < 360)  return "#16a34a"; // fast — deep green (reads on light map)
  if (secPerKm < 480)  return "#ca8a04"; // moderate — amber
  return "#dc2626";                       // slow — red
}

function ensurePostRunMap() {
  if (state.postRunMap) return;
  state.postRunMap = L.map(refs.postRunMapEl, {
    zoomControl: true,
    worldCopyJump: true,
    scrollWheelZoom: true,
    tap: true,
  }).setView([20, 0], 2);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 19,
  }).addTo(state.postRunMap);
}

function renderHeatmapPolylines(breadcrumbs) {
  // Clear old segments
  state.postRunPolylines.forEach((pl) => pl.remove());
  state.postRunPolylines = [];

  if (!breadcrumbs || breadcrumbs.length < 2) return;

  // Build colour-segmented polylines: each consecutive pair of points
  // gets a polyline coloured by the pace at that point
  for (let i = 0; i < breadcrumbs.length - 1; i++) {
    const a = breadcrumbs[i];
    const b = breadcrumbs[i + 1];
    const color = paceToColor(b.paceSecPerKm);
    const pl = L.polyline([a.latlng, b.latlng], {
      color,
      weight: 6,
      opacity: 0.92,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(state.postRunMap);
    state.postRunPolylines.push(pl);
  }

  // Fit bounds
  const allLatLngs = breadcrumbs.map((b) => b.latlng);
  if (allLatLngs.length > 1) {
    state.postRunMap.fitBounds(L.latLngBounds(allLatLngs), {
      padding: [28, 28],
      maxZoom: 17,
      animate: false,
    });
  }
}

function openPostRunSummary(summary) {
  state.pendingRunSummary = summary;

  // Populate header
  if (refs.prHeaderTitle) refs.prHeaderTitle.textContent = "RUN COMPLETE";

  // Hero distance
  if (refs.prDistanceVal) refs.prDistanceVal.textContent = formatKm(summary.distanceM);

  // Secondary stats
  if (refs.prTimeVal)  refs.prTimeVal.textContent  = formatDuration(summary.durationMs);
  if (refs.prPaceVal)  refs.prPaceVal.textContent  = formatPaceShort(summary.durationMs, summary.distanceM);
  if (refs.prCalVal)   refs.prCalVal.textContent   = Math.round(summary.calories).toString();

  // Show overlay
  refs.postRunOverlay.classList.add("prVisible");
  refs.postRunOverlay.setAttribute("aria-hidden", "false");

  // Defer map so container is visible
  requestAnimationFrame(() => {
    ensurePostRunMap();
    state.postRunMap.invalidateSize();
    renderHeatmapPolylines(summary.pacedBreadcrumbs || []);
    // Fallback: if no paced breadcrumbs, draw a simple volt line
    if (!summary.pacedBreadcrumbs?.length && summary.pathLatLngs?.length > 1) {
      const fallback = L.polyline(summary.pathLatLngs, {
        color: "#111111", weight: 5, opacity: 0.9, lineCap: "round",
      }).addTo(state.postRunMap);
      state.postRunPolylines.push(fallback);
      state.postRunMap.fitBounds(summary.pathLatLngs, { padding: [28, 28], maxZoom: 17, animate: false });
    }
  });
}

function closePostRunSummary() {
  refs.postRunOverlay.classList.remove("prVisible");
  refs.postRunOverlay.setAttribute("aria-hidden", "true");
}

/** Pace formatted as MM:SS without the /km suffix (shown separately) */
function formatPaceShort(ms, distanceM) {
  if (!Number.isFinite(ms) || !Number.isFinite(distanceM) || distanceM <= 0) return "--:--";
  const s = (ms / 1000) / (distanceM / 1000);
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${Math.round(s % 60).toString().padStart(2, "0")}`;
}

function initPostRunOverlay() {
  refs.prCloseBtn?.addEventListener("click", () => {
    closePostRunSummary();
    state.pendingRunSummary = null;
  });

  refs.prDiscardBtn?.addEventListener("click", () => {
    closePostRunSummary();
    state.pendingRunSummary = null;
  });

  refs.prSaveBtn?.addEventListener("click", () => {
    commitRunSummaryToJourney();
    closePostRunSummary();
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
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 19,
  }).addTo(state.progressMap);

  // Planned route — soft dark dashed line
  state.pmPlannedPolyline = L.polyline([], {
    color: "rgba(0, 0, 0, 0.22)",
    weight: 4,
    dashArray: "1 8",
    lineCap: "round",
    lineJoin: "round",
  }).addTo(state.progressMap);

  // Actual path — deep ink solid
  state.pmActualPolyline = L.polyline([], {
    color: "#111111",
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

  // White background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Volt accent bar top with thin dark border look
  ctx.fillStyle = "#e2ff22";
  ctx.fillRect(0, 0, W, 6);

  // Subtle light grid pattern
  ctx.strokeStyle = "rgba(0,0,0,0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // App label
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.font = "bold 13px Arial Black, sans-serif";
  ctx.fillText("NRC · WORLD CHALLENGE", 30, 44);

  // Race / route label
  const raceLabel = state.worldChallengeLabel
    ? state.worldChallengeLabel.toUpperCase()
    : (state.routeStartLabel && state.routeDestinationLabel
        ? `${state.routeStartLabel} → ${state.routeDestinationLabel}`
        : "CUSTOM ROUTE");

  ctx.fillStyle = "#111111";
  ctx.font = "italic 900 30px Arial Black, sans-serif";
  ctx.fillText(raceLabel, 30, 88);

  // Big distance number
  const kmCompleted = formatKm(state.totalDistanceM);
  ctx.fillStyle = "#111111";
  ctx.font = "italic 900 88px Arial Black, sans-serif";
  ctx.fillText(kmCompleted, 30, 196);

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.font = "italic 900 24px Arial Black, sans-serif";
  ctx.fillText("KM COMPLETED", 30, 228);

  // Goal line
  if (Number.isFinite(state.routeDistanceM)) {
    const goalKm = formatKm(state.routeDistanceM);
    const pct = Math.min(100, (state.totalDistanceM / state.routeDistanceM) * 100);

    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.font = "normal 400 13px Arial, sans-serif";
    ctx.fillText(`Goal: ${goalKm} km · ${Math.round(pct)}% complete`, 30, 258);

    // Mini progress bar
    const barX = 30, barY = 272, barW = W - 60, barH = 6;
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    roundRect(ctx, barX, barY, barW, barH, 3);
    ctx.fill();
    ctx.fillStyle = "#e2ff22";
    roundRect(ctx, barX, barY, barW * (pct / 100), barH, 3);
    ctx.fill();
  }

  // Recent runs on right side
  const runs = state.runHistory.slice(0, 4);
  if (runs.length > 0) {
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.font = "bold 11px Arial Black, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("RECENT RUNS", W - 30, 44);

    runs.forEach((run, i) => {
      const y = 80 + i * 52;
      const d = new Date(run.timestamp);
      const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const kmStr = (run.distanceM / 1000).toFixed(1);

      ctx.fillStyle = "#111111";
      ctx.font = "italic 900 20px Arial Black, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`${kmStr} km`, W - 30, y);

      ctx.fillStyle = "rgba(0,0,0,0.38)";
      ctx.font = "normal 400 11px Arial, sans-serif";
      ctx.fillText(dateStr, W - 30, y + 16);
    });
    ctx.textAlign = "left";
  }

  // Bottom tag
  ctx.fillStyle = "rgba(0,0,0,0.25)";
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


/**
 * Render a tiny 104×72 canvas thumbnail of the route path with pace colours.
 * Returns a PNG data-URL string, or null if there are no points.
 */
function generateRouteThumbnail(latLngs, pacedBreadcrumbs) {
  if (!latLngs || latLngs.length < 2) return null;
  const W = 104, H = 72, PAD = 6;

  const lats = latLngs.map((p) => p[0]);
  const lons = latLngs.map((p) => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const spanLat = maxLat - minLat || 0.001;
  const spanLon = maxLon - minLon || 0.001;

  const toX = (lon) => PAD + ((lon - minLon) / spanLon) * (W - PAD * 2);
  // lat increases upward, canvas y increases downward
  const toY = (lat) => PAD + ((maxLat - lat) / spanLat) * (H - PAD * 2);

  const canvas = document.createElement("canvas");
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Light background matching the new theme
  ctx.fillStyle = "#f5f5f5";
  ctx.fillRect(0, 0, W, H);

  // Draw segments
  for (let i = 0; i < latLngs.length - 1; i++) {
    const a = latLngs[i];
    const b = latLngs[i + 1];
    const crumb = pacedBreadcrumbs?.[i + 1];
    ctx.strokeStyle = crumb ? paceToColor(crumb.paceSecPerKm) : "#111111";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(toX(a[1]), toY(a[0]));
    ctx.lineTo(toX(b[1]), toY(b[0]));
    ctx.stroke();
  }

  return canvas.toDataURL("image/png");
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
    // Generate a tiny route thumbnail as a data-URL for the activity card
    const thumbDataUrl = generateRouteThumbnail(
      summary.pacedBreadcrumbs?.length ? summary.pacedBreadcrumbs.map((b) => b.latlng) : summary.pathLatLngs,
      summary.pacedBreadcrumbs
    );
    state.runHistory.unshift({
      timestamp:  summary.timestamp,
      distanceM:  summary.distanceM,
      durationMs: summary.durationMs,
      calories:   Math.round(summary.calories),
      thumbDataUrl,
    });
    state.runHistory = state.runHistory.slice(0, 30);
  }
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

// (Custom route calculation removed — World Tour only)

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
  state.pacedBreadcrumbs        = [];
  state.runStartMs              = Date.now();
  state.lastRawTimestamp        = null;
  state._prevBreadcrumbMs       = null;
  state.kalmanFilter            = createKalmanFilter();
  startLiveTimer();
  updateTrekPhaseUI(state, refs);
  setTracking();
  state.isTracking = true;
  setUserMarkerVisible(true);

  state.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy, speed } = pos.coords;
      const nowMs = Date.now();
      state.lastAccuracy = Number.isFinite(accuracy) ? accuracy : null;

      // ── Velocity gate: reject physically-impossible GPS teleports ──
      if (
        state.lastCoords &&
        !isVelocityPlausible(
          { ...state.lastCoords, timestamp: state.lastRawTimestamp ?? nowMs },
          latitude, longitude, nowMs
        )
      ) {
        return; // skip this fix entirely
      }
      state.lastRawTimestamp = nowMs;

      // ── Kalman filter smoothing ──
      const smoothed = kalmanUpdate(
        state.kalmanFilter,
        latitude, longitude,
        state.lastAccuracy ?? 20,
        nowMs
      );
      const useLat = smoothed.latitude;
      const useLon = smoothed.longitude;
      const latlng = [useLat, useLon];

      // ── Distance accounting ──
      let addedM = 0;
      if (state.lastCoords) {
        const deltaM  = haversineMeters(state.lastCoords.latitude, state.lastCoords.longitude, useLat, useLon);
        const bearing = bearingBetween(state.lastCoords.latitude, state.lastCoords.longitude, useLat, useLon);
        if (shouldCountMovement(state, deltaM, state.lastAccuracy ?? 99, bearing)) {
          state.currentSessionDistanceM += deltaM;
          addedM = deltaM;
        }
        state.lastBearing = bearing;
      }
      state.lastCoords = { latitude: useLat, longitude: useLon };

      // ── Record paced breadcrumb for heatmap ──
      // Derive instantaneous pace from device speed or time-delta
      let paceSecPerKm = null;
      if (typeof speed === "number" && Number.isFinite(speed) && speed > 0.5) {
        paceSecPerKm = 1000 / speed; // speed is m/s
      } else if (addedM > 0 && state.lastRawTimestamp) {
        const dtSec = Math.max(0.1, (nowMs - (state._prevBreadcrumbMs ?? nowMs)) / 1000);
        paceSecPerKm = dtSec / (addedM / 1000);
      }
      state._prevBreadcrumbMs = nowMs;
      state.pacedBreadcrumbs.push({ latlng, paceSecPerKm, timestamp: nowMs });

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
      // Virtual postcard & voice milestones
      const totalKmNow = (state.totalDistanceM + state.currentSessionDistanceM) / 1000;
      checkPostcardMilestone(totalKmNow);
      checkVoiceMilestone(totalKmNow);
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
  state.watchId         = null;
  state.isTracking      = false;
  state.hasCenteredOnce = false;
  const durationMs = state.runStartMs ? Date.now() - state.runStartMs : 0;
  const distanceM  = state.currentSessionDistanceM;
  const calories   = state.userWeightKg * (distanceM / 1000) * 1.036;
  const summary = {
    timestamp:       Date.now(),
    distanceM,
    durationMs,
    calories,
    pathLatLngs:     state.currentRunPathLatLngs.slice(),
    pacedBreadcrumbs: state.pacedBreadcrumbs.slice(),
  };
  state.currentSessionDistanceM = 0;
  state.runStartMs              = null;
  state.pacedBreadcrumbs        = [];
  stopLiveTimer();
  openPostRunSummary(summary);
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
    lastPostcardKm: -1, lastVoiceKm: -1,
  });
  window.speechSynthesis?.cancel();
  localStorage.removeItem(TREK_STORAGE_KEY);
  if (refs.distanceSmallEl) refs.distanceSmallEl.textContent = "Today starts now.";
  if (refs.runTitleEl) refs.runTitleEl.textContent = "WORLD TOUR";
  if (state.userPathPolyline) state.userPathPolyline.setLatLngs([]);
  if (state.virtualRoutePolyline) state.virtualRoutePolyline.setLatLngs([]);
  state.virtualStartMarker?.remove();
  state.virtualEndMarker?.remove();
  document.querySelectorAll(".raceCard").forEach((c) => c.classList.remove("selected"));
  // Reset postcard
  if (refs.postcardImg) refs.postcardImg.style.backgroundImage = "";
  if (refs.postcardLocation) refs.postcardLocation.textContent = "Choose a race from Plans";
  if (refs.postcardKm) refs.postcardKm.textContent = "";
  renderPreviousRuns(state, refs);
  state.pendingRunSummary = null;
  stopLiveTimer();
  updateVirtualUI(state, refs, maybeCelebrateCompletion);
  updateTrekPhaseUI(state, refs);
  setIdle();
}


// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────
async function init() {
  loadState();

  if (state.worldChallengeLabel && refs.runTitleEl) refs.runTitleEl.textContent = state.worldChallengeLabel.toUpperCase();

  // Restore opening postcard if a race is selected
  if (state.worldChallengeLabel) {
    const tour = WORLD_TOUR[state.worldChallengeLabel];
    if (tour?.postcards?.[0]) showPostcard(tour.postcards[0], 0);
  }

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
  initPlansTab();
  initDailyGoal();
  initPostRunOverlay();
  initProgressMap();
  initShare();
  initAudio();

  // Restore selected race card highlight
  if (state.worldChallengeLabel) {
    document.querySelectorAll(".raceCard").forEach((c) => {
      if (c.dataset.race === state.worldChallengeLabel) c.classList.add("selected");
    });
  }

  refs.goToPlansBtn?.addEventListener("click", () => switchTab("Plans"));
  refs.startBtn.addEventListener("click", startTracking);
  refs.stopBtn.addEventListener("click", stopTracking);
  refs.cancelTrekBtn.addEventListener("click", resetTrek);
  refs.liveTimer.textContent = "00:00";
}

init();
