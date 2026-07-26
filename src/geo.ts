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

const KAKAO_API_KEY = '7a8c981b5d45696b57977aa91e0f7087';
const KAKAO_LOCAL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';

// Name/address -> up to 5 candidates (Kakao Local Search API - Korea-optimized)
export async function geocodeSearch(query: string): Promise<GeoCandidate[]> {
  const url = `${KAKAO_LOCAL}?query=${encodeURIComponent(query)}&size=5`;
  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `KakaoAK ${KAKAO_API_KEY}`,
        'Accept': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`geocode failed: ${res.status}`);
    const json = (await res.json()) as {
      documents: Array<{
        place_name: string;
        address_name: string;
        road_address_name?: string;
        x: string;
        y: string;
      }>;
    };
    return json.documents.slice(0, 5).map((d) => ({
      name: d.place_name,
      address: d.road_address_name || d.address_name,
      lat: Number(d.y),
      lng: Number(d.x),
    }));
  } catch (e) {
    console.error('Kakao geocode error:', e);
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
