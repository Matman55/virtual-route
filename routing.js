export async function geocodeWithNominatim(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Failed to query geocoding service.");
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  const lat = Number.parseFloat(first.lat);
  const lon = Number.parseFloat(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, displayName: first.display_name || query };
}

export async function calculateRouteWithOsrm(start, end) {
  const osrmUrl =
    `https://router.project-osrm.org/route/v1/foot/` +
    `${start.lon},${start.lat};${end.lon},${end.lat}` +
    `?overview=full&geometries=geojson`;
  const routeRes = await fetch(osrmUrl);
  if (!routeRes.ok) throw new Error("Routing service unavailable.");
  const routeJson = await routeRes.json();
  const route = Array.isArray(routeJson.routes) ? routeJson.routes[0] : null;
  if (!route || !Number.isFinite(route.distance)) return null;

  const coords = route.geometry?.coordinates;
  const geometry = Array.isArray(coords)
    ? coords
        .filter((pair) => Array.isArray(pair) && pair.length >= 2)
        .map((pair) => [pair[1], pair[0]])
    : [];

  return {
    distanceM: route.distance,
    geometryLatLngs: geometry,
  };
}
