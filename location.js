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
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function getCurrentPositionPromise() {
  return await new Promise((resolve, reject) => {
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
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 19,
    }
  ).addTo(state.map);

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
    color: "rgba(61, 214, 255, 0.95)",
    weight: 5,
    opacity: 0.95,
    lineJoin: "round",
    lineCap: "round",
  }).addTo(state.map);

  state.virtualRoutePolyline = L.polyline(state.routeGeometryLatLngs || [], {
    color: "rgba(132, 110, 255, 0.9)",
    weight: 4,
    opacity: 0.9,
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

export function smoothPosition(prevSmooth, raw) {
  if (!raw) return prevSmooth;
  if (!prevSmooth) return { ...raw };
  const acc = Number.isFinite(raw.accuracy) ? Math.max(1, raw.accuracy) : 20;
  const alpha = acc <= 5 ? 0.78 : acc <= 15 ? 0.62 : 0.45;
  return {
    latitude: prevSmooth.latitude + (raw.latitude - prevSmooth.latitude) * alpha,
    longitude: prevSmooth.longitude + (raw.longitude - prevSmooth.longitude) * alpha,
    accuracy: acc,
    timestamp: raw.timestamp,
  };
}

export function bearingBetween(lat1, lon1, lat2, lon2) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  let brng = (Math.atan2(y, x) * 180) / Math.PI;
  brng = (brng + 360) % 360;
  return brng;
}

export function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function shouldCountMovement(state, deltaM, accuracy, bearing) {
  if (!Number.isFinite(deltaM) || deltaM <= 0) return false;
  if (accuracy <= 15) {
    state.consistentDirectionCount = Math.min(8, (state.consistentDirectionCount || 0) + 1);
    return deltaM >= 0.35;
  }

  if (!Number.isFinite(state.lastBearing)) {
    state.lastBearing = bearing;
    state.consistentDirectionCount = 0;
    return false;
  }
  const diff = angleDiff(state.lastBearing, bearing);
  if (diff < 25 && deltaM >= 0.7) {
    state.consistentDirectionCount = (state.consistentDirectionCount || 0) + 1;
    return state.consistentDirectionCount >= 2;
  }
  state.consistentDirectionCount = 0;
  return false;
}

