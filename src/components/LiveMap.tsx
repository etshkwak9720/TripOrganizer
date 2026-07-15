import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Icon } from '../ui';
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

// Spec §4 second half: while moving, refit to my position + the current
// target whenever the target changes (arrival advances targetIdx). Keyed on
// targetIdx only — NOT on pos, which ticks every GPS update and would fight
// the user's own panning/zooming.
function FitLeg({ pos, target, targetIdx }: { pos: MapPos | null; target: MapStop | undefined; targetIdx: number }) {
  const map = useMap();
  useEffect(() => {
    if (!pos || !target) return;
    map.fitBounds(L.latLngBounds([[pos.lat, pos.lng], [target.lat, target.lng]]), { padding: [40, 40] });
  }, [targetIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// Manual recenter button (spec §4): fits my position + next destination on
// demand, so a user who has panned away can always get back.
function RecenterControl({ pos, target }: { pos: MapPos | null; target: MapStop | undefined }) {
  const map = useMap();
  if (!pos) return null;
  return (
    <button
      type="button"
      aria-label="내 위치로"
      onClick={() => {
        if (target) map.fitBounds(L.latLngBounds([[pos.lat, pos.lng], [target.lat, target.lng]]), { padding: [40, 40] });
        else map.setView([pos.lat, pos.lng], Math.max(map.getZoom(), 15));
      }}
      className="absolute bottom-3 right-3 z-[1000] w-10 h-10 rounded-full bg-surface shadow-md border border-outline-variant/40 grid place-items-center text-primary-container active:scale-95 transition"
    >
      <Icon name="my_location" className="text-[20px]" />
    </button>
  );
}

export default function LiveMap({ stops, route, leg, pos, targetIdx }: {
  stops: MapStop[];
  route: [number, number][] | null; // full-day road route (dashed)
  leg: [number, number][] | null;   // my position -> next stop (solid)
  pos: MapPos | null;
  targetIdx: number;
}) {
  const target = stops[targetIdx];
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
      <FitLeg pos={pos} target={target} targetIdx={targetIdx} />
      <RecenterControl pos={pos} target={target} />
    </MapContainer>
  );
}
