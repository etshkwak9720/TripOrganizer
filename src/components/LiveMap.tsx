import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import '../leaflet';

export interface MapStop { name: string; lat: number; lng: number; food?: boolean }
export interface MapPos { lat: number; lng: number; acc?: number }

function numberIcon(n: number, active: boolean, food: boolean) {
  const bg = active ? '#ff8c00' : food ? '#0d9488' : '#64748b';
  return L.divIcon({
    className: '',
    html: `<div style="width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);background:${bg}">${food ? '🍜' : n}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

// Fit map to the day's stops once per stop-list change (not every GPS tick).
function FitBounds({ stops }: { stops: MapStop[] }) {
  const map = useMap();
  const key = stops.map((s) => `${s.lat},${s.lng}`).join(';');
  useEffect(() => {
    if (stops.length === 0) return;
    if (stops.length === 1) { map.setView([stops[0].lat, stops[0].lng], 14); return; }
    map.fitBounds(L.latLngBounds(stops.map((s) => [s.lat, s.lng] as [number, number])), { padding: [30, 30] });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function LiveMap({ stops, route, leg, pos, targetIdx }: {
  stops: MapStop[];
  route: [number, number][] | null; // full-day road route (dashed)
  leg: [number, number][] | null;   // my position -> next stop (solid)
  pos: MapPos | null;
  targetIdx: number;
}) {
  return (
    <MapContainer center={[36.5, 127.8]} zoom={7} className="w-full h-full">
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
      {route && <Polyline positions={route} pathOptions={{ color: '#64748b', weight: 3, opacity: 0.55, dashArray: '6 6' }} />}
      {leg && <Polyline positions={leg} pathOptions={{ color: '#ff8c00', weight: 5, opacity: 0.9 }} />}
      {stops.map((s, i) => (
        <Marker key={`${s.lat},${s.lng},${i}`} position={[s.lat, s.lng]} icon={numberIcon(i + 1, i === targetIdx, !!s.food)} />
      ))}
      {pos && (
        <>
          {pos.acc != null && pos.acc < 300 && (
            <Circle center={[pos.lat, pos.lng]} radius={pos.acc} pathOptions={{ color: '#3b82f6', opacity: 0.25, fillOpacity: 0.08, weight: 1 }} />
          )}
          <CircleMarker center={[pos.lat, pos.lng]} radius={8} pathOptions={{ color: '#fff', weight: 2, fillColor: '#3b82f6', fillOpacity: 1 }} />
        </>
      )}
      <FitBounds stops={stops} />
    </MapContainer>
  );
}
