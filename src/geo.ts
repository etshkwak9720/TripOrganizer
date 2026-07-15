// External geo services, isolated here so a later swap to Kakao APIs
// touches only this file.
export interface GeoCandidate {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export interface RouteResult {
  coords: [number, number][]; // [lat, lng] polyline
  durationMin: number;
  distanceKm: number;
  estimated?: boolean;        // true = straight-line fallback, not road data
}

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';

// Name/address -> up to 5 candidates (Korea-biased, Korean labels).
export async function geocodeSearch(query: string): Promise<GeoCandidate[]> {
  const url = `${NOMINATIM}?format=jsonv2&limit=5&accept-language=ko&countrycodes=kr&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`geocode failed: ${res.status}`);
  const rows = (await res.json()) as { display_name: string; name?: string; lat: string; lon: string }[];
  return rows.map((r) => ({
    name: r.name || r.display_name.split(',')[0].trim(),
    address: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
  }));
}

// Road route through the given waypoints. null = caller should fall back
// (offline, server error, or fewer than 2 points).
export async function fetchRoute(pts: { lat: number; lng: number }[]): Promise<RouteResult | null> {
  if (pts.length < 2) return null;
  const coords = pts.map((p) => `${p.lng},${p.lat}`).join(';');
  try {
    const res = await fetch(`${OSRM}/${coords}?overview=full&geometries=geojson`);
    if (!res.ok) return null;
    const json = await res.json();
    const route = json.routes?.[0];
    if (!route) return null;
    return {
      coords: route.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng] as [number, number]),
      durationMin: Math.max(1, Math.round(route.duration / 60)),
      distanceKm: route.distance / 1000,
    };
  } catch {
    return null;
  }
}
