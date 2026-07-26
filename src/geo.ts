// External geo services, Kakao Map API
// https://developers.kakao.com/docs/latest/ko/local/dev-guide
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

const OSRM = 'https://router.project-osrm.org/route/v1/driving';

// Name/address -> up to 5 candidates (via Kakao Local Search API via Vercel API proxy)
export async function geocodeSearch(query: string): Promise<GeoCandidate[]> {
  try {
    const url = `/api/geocode?query=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`geocode failed: ${res.status}`);
    return (await res.json()) as GeoCandidate[];
  } catch (e) {
    console.error('Geocode error:', e);
    throw e;
  }
}

// Road route through the given waypoints (fallback to OSRM; null = caller should fall back)
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
