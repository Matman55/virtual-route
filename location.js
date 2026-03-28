export function toRad(deg) {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function getCurrentPositionPromise() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 25000,
    });
  });
}

export async function requestCompassPermission(state, refs, onOrientation) {
  if (state.compassEnabled) return;
  if (
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function"
  ) {
    const result = await DeviceOrientationEvent.requestPermission();
    if (result !== "granted") throw new Error("Compass permission denied.");
  }
  state.compassEnabled = true;
  window.addEventListener("deviceorientation", onOrientation, { frequency: 200 });
}

export async function ensureMap(state, refs) {
  if (state.map) return;
  if (typeof L === "undefined") {
    await new Promise((resolve) => {
      const check = () => (typeof L !== "undefined" ? resolve() : setTimeout(check, 50));
      check();
    });
  }

  state.map = L.map("map", { zoomControl: false, worldCopyJump: true, scrollWheelZoom: false }).setView([0, 0], 2);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 19,
  }).addTo(state.map);

  state.userMarker = L.marker([0, 0], {
    icon: L.divIcon({
      className: "user-marker-icon",
      html: '<div class="user-marker-root"><div class="user-cone"></div><div class="user-dot"></div></div>',
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    }),
    interactive: false,
    opacity: 0,
  }).addTo(state.map);

  state.userPathPolyline = L.polyline(state.lastRunPathLatLngs || [], {
    color: "rgba(17, 17, 17, 0.85)",
    weight: 5,
    opacity: 0.9,
    lineJoin: "round",
    lineCap: "round",
  }).addTo(state.map);

  state.virtualRoutePolyline = L.polyline(state.routeGeometryLatLngs || [], {
    color: "rgba(80, 80, 200, 0.55)",
    weight: 4,
    opacity: 0.75,
    dashArray: "8,6",
  }).addTo(state.map);
}

export function updateConeRotation(state, deg) {
  const el = state.userMarker?.getElement?.();
  const cone = el?.querySelector?.(".user-cone");
  if (!cone) return;
  cone.style.setProperty("--rot", `${deg}deg`);
  cone.style.opacity = state.compassEnabled ? "0.75" : "0";
}

// ─────────────────────────────────────────────────────────────────────────────
// KALMAN FILTER
// A lightweight 1-D Kalman filter applied independently to lat and lon.
// It tracks position uncertainty and weights raw GPS readings against the
// predicted position based on that uncertainty — dramatically reducing jitter.
// ─────────────────────────────────────────────────────────────────────────────
export function createKalmanFilter() {
  return {
    lat: null, lon: null,
    // Variance of the estimated position (starts very uncertain)
    pLat: Infinity, pLon: Infinity,
    // Process noise — how much we expect position to change per second (metres²)
    Q: 3,
    // Last timestamp used to compute elapsed time
    lastTimestamp: null,
  };
}

/**
 * Feed a raw GPS fix into the Kalman filter and return the smoothed position.
 * @param {Object} kf  - Kalman filter state (mutated in place)
 * @param {number} lat - Raw latitude
 * @param {number} lon - Raw longitude
 * @param {number} accuracy - GPS accuracy in metres (horizontal 68% CI)
 * @param {number} timestamp - Unix ms
 * @returns {{ latitude: number, longitude: number }}
 */
export function kalmanUpdate(kf, lat, lon, accuracy, timestamp) {
  // Measurement noise variance — scale with reported accuracy²
  const R = Math.max(1, accuracy * accuracy);

  if (kf.lat === null) {
    // First fix — initialise directly
    kf.lat = lat;
    kf.lon = lon;
    kf.pLat = R;
    kf.pLon = R;
    kf.lastTimestamp = timestamp;
    return { latitude: lat, longitude: lon };
  }

  // Predict step: increase uncertainty by Q per elapsed second
  const dtSec = Math.max(0, (timestamp - kf.lastTimestamp) / 1000);
  kf.lastTimestamp = timestamp;
  kf.pLat += kf.Q * dtSec;
  kf.pLon += kf.Q * dtSec;

  // Update step (Kalman gain)
  const kLat = kf.pLat / (kf.pLat + R);
  const kLon = kf.pLon / (kf.pLon + R);
  kf.lat  = kf.lat  + kLat * (lat - kf.lat);
  kf.lon  = kf.lon  + kLon * (lon - kf.lon);
  kf.pLat = (1 - kLat) * kf.pLat;
  kf.pLon = (1 - kLon) * kf.pLon;

  return { latitude: kf.lat, longitude: kf.lon };
}

// ─────────────────────────────────────────────────────────────────────────────
// VELOCITY GATE
// Rejects any GPS delta that implies an impossible speed (> MAX_SPEED_MS m/s).
// Human running max ~10 m/s; 15 m/s gives comfortable headroom.
// ─────────────────────────────────────────────────────────────────────────────
const MAX_SPEED_MS = 15; // metres per second

/**
 * Returns true if the jump from prevCoords to newCoords is physically plausible
 * given the elapsed time.
 */
export function isVelocityPlausible(prevCoords, newLat, newLon, newTimestamp) {
  if (!prevCoords) return true;
  const dtSec = Math.max(0.1, (newTimestamp - prevCoords.timestamp) / 1000);
  const distM = haversineMeters(prevCoords.latitude, prevCoords.longitude, newLat, newLon);
  return (distM / dtSec) <= MAX_SPEED_MS;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY smooth-position (kept for compat, now superseded by Kalman)
// ─────────────────────────────────────────────────────────────────────────────
export function smoothPosition(prevSmooth, raw) {
  if (!raw) return prevSmooth;
  if (!prevSmooth) return { ...raw };
  const acc   = Number.isFinite(raw.accuracy) ? Math.max(1, raw.accuracy) : 20;
  const alpha = acc <= 5 ? 0.82 : acc <= 15 ? 0.65 : 0.45;
  return {
    latitude:  prevSmooth.latitude  + (raw.latitude  - prevSmooth.latitude)  * alpha,
    longitude: prevSmooth.longitude + (raw.longitude - prevSmooth.longitude) * alpha,
    accuracy:  acc,
    timestamp: raw.timestamp,
  };
}

export function bearingBetween(lat1, lon1, lat2, lon2) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOVEMENT GATE
// Decides whether a GPS delta should count toward distance.
// Key changes vs old version:
//  - Minimum delta raised to 1.5 m (was 0.35 m) to ignore stationary jitter
//  - High-accuracy threshold tightened: only trust if accuracy ≤ 10 m (was 15)
//  - Low-accuracy path requires 3 consistent direction samples (was 2)
// ─────────────────────────────────────────────────────────────────────────────
export function shouldCountMovement(state, deltaM, accuracy, bearing) {
  if (!Number.isFinite(deltaM) || deltaM < 1.5) return false;

  if (accuracy <= 10) {
    state.consistentDirectionCount = Math.min(6, (state.consistentDirectionCount || 0) + 1);
    return true;
  }

  if (accuracy <= 25) {
    if (!Number.isFinite(state.lastBearing)) {
      state.lastBearing = bearing;
      state.consistentDirectionCount = 0;
      return false;
    }
    const diff = angleDiff(state.lastBearing, bearing);
    if (diff < 30 && deltaM >= 2.0) {
      state.consistentDirectionCount = (state.consistentDirectionCount || 0) + 1;
      return state.consistentDirectionCount >= 3;
    }
    state.consistentDirectionCount = 0;
    return false;
  }

  // accuracy > 25 m — discard
  state.consistentDirectionCount = 0;
  return false;
}
