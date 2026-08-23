import { useEffect, useRef } from 'react';
import { Icon } from '../ui';

export interface MapStop { name: string; lat: number; lng: number; food?: boolean }
export interface MapPos { lat: number; lng: number; acc?: number }

// Kakao zoom runs the opposite way to Leaflet's: level 1 is closest, higher is
// further out. These are the three levels this map actually asks for.
const LEVEL_COUNTRY = 12; // whole of Korea, the initial view
const LEVEL_SINGLE_STOP = 4;
const LEVEL_MY_POSITION = 3;

// data-* hooks: Kakao renders overlays into markup it controls, with no stable
// class names, so the smoke tests key off these instead.
function numberMarkup(n: number, active: boolean, food: boolean) {
  const bg = active ? '#ff8c00' : food ? '#0d9488' : '#64748b';
  return `<div data-map-pin="stop" style="width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);background:${bg}">${food ? '🍜' : n}</div>`;
}

const ADMIN_MARKUP = `<div data-map-pin="admin" style="width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;background:#ff3b30;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">🚌</div>`;

const MY_POS_MARKUP = `<div data-map-pin="me" style="width:16px;height:16px;border-radius:50%;background:#3b82f6;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`;

function bounds(points: { lat: number; lng: number }[]) {
  const b = new window.kakao.maps.LatLngBounds();
  for (const p of points) b.extend(new window.kakao.maps.LatLng(p.lat, p.lng));
  return b;
}

export default function LiveMap({ stops, route, leg, pos, targetIdx, adminPos }: {
  stops: MapStop[];
  route: [number, number][] | null; // full-day road route (dashed)
  leg: [number, number][] | null;   // my position -> next stop (solid)
  pos: MapPos | null;
  targetIdx: number;
  adminPos?: MapPos | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  // Every overlay Kakao draws is imperative and must be removed by hand, so
  // each group is kept in a ref and cleared before the group is redrawn.
  const stopOverlaysRef = useRef<any[]>([]);
  const routeRef = useRef<any>(null);
  const legRef = useRef<any>(null);
  const posOverlayRef = useRef<any>(null);
  const accCircleRef = useRef<any>(null);
  const adminOverlayRef = useRef<any>(null);

  const target = stops[targetIdx];
  const primaryPos = adminPos || pos; // 초점 맞추기용 주 위치 (관리자 우선)

  useEffect(() => {
    if (!containerRef.current || !window.kakao?.maps?.Map) return;
    mapRef.current = new window.kakao.maps.Map(containerRef.current, {
      center: new window.kakao.maps.LatLng(36.5, 127.8),
      level: LEVEL_COUNTRY,
    });
    return () => { mapRef.current = null; };
  }, []);

  // Numbered stop pins. Redrawn when the list or the active target changes,
  // since the target pin is coloured differently.
  const stopsKey = stops.map((s) => `${s.lat},${s.lng},${s.food ? 'f' : ''}`).join(';');
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const o of stopOverlaysRef.current) o.setMap(null);
    stopOverlaysRef.current = stops.map((s, i) => new window.kakao.maps.CustomOverlay({
      position: new window.kakao.maps.LatLng(s.lat, s.lng),
      content: numberMarkup(i + 1, i === targetIdx, !!s.food),
      map,
    }));
  }, [stopsKey, targetIdx]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (routeRef.current) routeRef.current.setMap(null);
    routeRef.current = route && new window.kakao.maps.Polyline({
      path: route.map(([lat, lng]) => new window.kakao.maps.LatLng(lat, lng)),
      strokeWeight: 3,
      strokeColor: '#64748b',
      strokeOpacity: 0.55,
      strokeStyle: 'dashed',
      map,
    });
  }, [route]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (legRef.current) legRef.current.setMap(null);
    legRef.current = leg && new window.kakao.maps.Polyline({
      path: leg.map(([lat, lng]) => new window.kakao.maps.LatLng(lat, lng)),
      strokeWeight: 5,
      strokeColor: '#ff8c00',
      strokeOpacity: 0.9,
      strokeStyle: 'solid',
      map,
    });
  }, [leg]);

  // My position dot + GPS accuracy halo, moved on every tick.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (posOverlayRef.current) posOverlayRef.current.setMap(null);
    if (accCircleRef.current) accCircleRef.current.setMap(null);
    posOverlayRef.current = null;
    accCircleRef.current = null;
    if (!pos) return;

    const at = new window.kakao.maps.LatLng(pos.lat, pos.lng);
    if (pos.acc != null && pos.acc < 300) {
      accCircleRef.current = new window.kakao.maps.Circle({
        center: at,
        radius: pos.acc,
        strokeWeight: 1,
        strokeColor: '#3b82f6',
        strokeOpacity: 0.25,
        fillColor: '#3b82f6',
        fillOpacity: 0.08,
        map,
      });
    }
    posOverlayRef.current = new window.kakao.maps.CustomOverlay({ position: at, content: MY_POS_MARKUP, map });
  }, [pos?.lat, pos?.lng, pos?.acc]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (adminOverlayRef.current) adminOverlayRef.current.setMap(null);
    adminOverlayRef.current = adminPos && new window.kakao.maps.CustomOverlay({
      position: new window.kakao.maps.LatLng(adminPos.lat, adminPos.lng),
      content: ADMIN_MARKUP,
      map,
    });
  }, [adminPos?.lat, adminPos?.lng]);

  // Fit to the day's stops once per stop-list change (not every GPS tick).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || stops.length === 0) return;
    if (stops.length === 1) {
      map.setCenter(new window.kakao.maps.LatLng(stops[0].lat, stops[0].lng));
      map.setLevel(LEVEL_SINGLE_STOP);
      return;
    }
    map.setBounds(bounds(stops), 30, 30, 30, 30);
  }, [stopsKey]);

  // Spec §4 second half: while moving, refit to my position + the current
  // target. Refitting on every GPS tick would make the view lurch once a
  // second and fight the user's panning, so it only refits when the target
  // changes or when my position has actually left the visible area — which is
  // exactly when a moving map has to catch up.
  const fittedIdxRef = useRef(-1);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !primaryPos || !target) return;
    const at = new window.kakao.maps.LatLng(primaryPos.lat, primaryPos.lng);
    if (fittedIdxRef.current === targetIdx && map.getBounds().contain(at)) return;
    fittedIdxRef.current = targetIdx;
    map.setBounds(bounds([primaryPos, target]), 40, 40, 40, 40);
  }, [primaryPos?.lat, primaryPos?.lng, targetIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Manual recenter (spec §4): fits my position + next destination on demand,
  // so a user who has panned away can always get back.
  function recenter() {
    const map = mapRef.current;
    if (!map || !primaryPos) return;
    if (target) {
      map.setBounds(bounds([primaryPos, target]), 40, 40, 40, 40);
    } else {
      map.setCenter(new window.kakao.maps.LatLng(primaryPos.lat, primaryPos.lng));
      map.setLevel(Math.min(map.getLevel(), LEVEL_MY_POSITION));
    }
  }

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} data-kakao-map className="w-full h-full" />
      {primaryPos && (
        <button
          type="button"
          aria-label="내 위치로"
          onClick={recenter}
          className="absolute bottom-3 right-3 z-[1000] w-10 h-10 rounded-full bg-surface shadow-md border border-outline-variant/40 grid place-items-center text-primary-container active:scale-95 transition"
        >
          <Icon name="my_location" className="text-[20px]" />
        </button>
      )}
    </div>
  );
}
