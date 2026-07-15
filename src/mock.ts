// Offline fallback: straight-line travel-time estimate. Real road routes
// come from src/geo.ts (OSRM); this is used when that fails.
export function estimateTravelMinutes(
  a: { lat?: number; lng?: number; name: string },
  b: { lat?: number; lng?: number; name: string },
): number {
  if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    const km = R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
    return Math.max(5, Math.round((km / 40) * 60)); // ~40km/h avg
  }
  // deterministic fallback from name hash -> 10..55 min
  let h = 0;
  const key = a.name + '→' + b.name;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return 10 + (h % 46);
}
