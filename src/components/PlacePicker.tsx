import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import type L from 'leaflet';
import { geocodeSearch, type GeoCandidate } from '../geo';
import { Icon } from '../ui';
import '../leaflet';

export interface PickedPlace { name: string; address: string; lat?: number; lng?: number }

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => { map.setView([lat, lng], Math.max(map.getZoom(), 15)); }, [lat, lng, map]);
  return null;
}

export default function PlacePicker({ title, initialName, onSave, onClose }: {
  title: string;
  initialName?: string;
  onSave: (p: PickedPlace) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName ?? '');
  const [q, setQ] = useState(initialName ?? '');
  const [cands, setCands] = useState<GeoCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState(false);
  const [sel, setSel] = useState<{ lat: number; lng: number; address: string } | null>(null);

  // debounced Nominatim search
  useEffect(() => {
    if (q.trim().length < 2) { setCands([]); return; }
    setSearching(true); setErr(false);
    const t = window.setTimeout(async () => {
      try { setCands(await geocodeSearch(q.trim())); }
      catch { setErr(true); setCands([]); }
      finally { setSearching(false); }
    }, 500);
    return () => window.clearTimeout(t);
  }, [q]);

  function pick(c: GeoCandidate) {
    setSel({ lat: c.lat, lng: c.lng, address: c.address });
    if (!name.trim()) setName(c.name);
    setCands([]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-[520px] bg-surface rounded-t-2xl p-4 pb-8 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-head font-bold text-[18px]">{title}</h2>
          <button onClick={onClose} className="text-outline" aria-label="닫기"><Icon name="close" /></button>
        </div>

        <label className="text-[11px] font-bold text-on-surface-variant">이름</label>
        <input className="input mb-2" placeholder="장소 이름" value={name} onChange={(e) => setName(e.target.value)} />

        <label className="text-[11px] font-bold text-on-surface-variant">지도 검색</label>
        <input className="input" placeholder="이름/주소로 검색 (예: 성산일출봉)" value={q} onChange={(e) => setQ(e.target.value)} />
        {searching && <p className="text-[12px] text-on-surface-variant mt-1">검색 중…</p>}
        {err && <p className="text-[12px] text-error mt-1">검색에 실패했어요. 잠시 후 다시 시도해 주세요.</p>}
        {cands.length > 0 && (
          <ul className="mt-1 divide-y divide-outline-variant/20 border border-outline-variant/30 rounded-md overflow-hidden">
            {cands.map((c, i) => (
              <li key={i}>
                <button className="w-full text-left p-2.5 hover:bg-surface-variant/30" onClick={() => pick(c)}>
                  <p className="font-semibold text-[14px] truncate">{c.name}</p>
                  <p className="text-[12px] text-on-surface-variant truncate">{c.address}</p>
                </button>
              </li>
            ))}
          </ul>
        )}

        {sel && (
          <div className="mt-3">
            <div className="h-52 rounded-md overflow-hidden">
              <MapContainer center={[sel.lat, sel.lng]} zoom={15} className="w-full h-full">
                <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
                <Marker
                  position={[sel.lat, sel.lng]}
                  draggable
                  eventHandlers={{
                    dragend: (e) => {
                      const ll = (e.target as L.Marker).getLatLng();
                      setSel((s) => (s ? { ...s, lat: ll.lat, lng: ll.lng } : s));
                    },
                  }}
                />
                <Recenter lat={sel.lat} lng={sel.lng} />
              </MapContainer>
            </div>
            <p className="text-[11px] text-on-surface-variant mt-1">
              <Icon name="pan_tool_alt" className="text-[13px] align-middle" /> 핀을 끌어 위치를 조정하세요 · {sel.lat.toFixed(5)}, {sel.lng.toFixed(5)}
            </p>
          </div>
        )}

        <button
          className="btn-primary w-full mt-4 disabled:opacity-40"
          disabled={!name.trim()}
          onClick={() => onSave({ name: name.trim(), address: sel?.address ?? '', lat: sel?.lat, lng: sel?.lng })}
        >
          {sel ? '저장' : '좌표 없이 저장'}
        </button>
      </div>
    </div>
  );
}
