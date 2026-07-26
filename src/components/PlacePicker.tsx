import { useEffect, useRef, useState } from 'react';
import { geocodeSearch, type GeoCandidate } from '../geo';
import { Icon } from '../ui';

export interface PickedPlace { name: string; address: string; lat?: number; lng?: number }

declare global {
  interface Window {
    kakao: {
      maps: {
        Map: any;
        LatLng: any;
        Marker: any;
        event: any;
        services: {
          Places: any;
        };
      };
    };
  }
}

export default function PlacePicker({ title, initialName, initialLat, initialLng, initialAddress, onSave, onClose }: {
  title: string;
  initialName?: string;
  initialLat?: number;
  initialLng?: number;
  initialAddress?: string;
  onSave: (p: PickedPlace) => void;
  onClose: () => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  const [name, setName] = useState(initialName ?? '');
  const [q, setQ] = useState(initialName ?? '');
  const [cands, setCands] = useState<GeoCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState(false);
  const [sel, setSel] = useState<{ lat: number; lng: number; address: string } | null>(
    initialLat != null && initialLng != null ? { lat: initialLat, lng: initialLng, address: initialAddress ?? '' } : null,
  );

  // Initialize Kakao Map
  useEffect(() => {
    if (!mapRef.current || !window.kakao) return;

    const defaultLat = sel?.lat ?? 37.5;
    const defaultLng = sel?.lng ?? 127.0;

    const container = mapRef.current;
    const options = {
      center: new window.kakao.maps.LatLng(defaultLat, defaultLng),
      level: 5,
    };
    const map = new window.kakao.maps.Map(container, options);
    mapInstanceRef.current = map;

    // Add marker if location selected
    if (sel) {
      const marker = new window.kakao.maps.Marker({
        position: new window.kakao.maps.LatLng(sel.lat, sel.lng),
        draggable: true,
        map: map,
      });
      markerRef.current = marker;

      // Allow dragging to update location
      window.kakao.maps.event.addListener(marker, 'dragend', () => {
        const pos = marker.getPosition();
        setSel((prev) => (prev ? { ...prev, lat: pos.getLat(), lng: pos.getLng() } : null));
      });
    }

    // Click to place marker
    window.kakao.maps.event.addListener(map, 'click', (mouseEvent: any) => {
      const latlng = mouseEvent.latLng;
      if (markerRef.current) markerRef.current.setMap(null);

      const marker = new window.kakao.maps.Marker({
        position: latlng,
        draggable: true,
        map: map,
      });
      markerRef.current = marker;

      window.kakao.maps.event.addListener(marker, 'dragend', () => {
        const pos = marker.getPosition();
        setSel((prev) => (prev ? { ...prev, lat: pos.getLat(), lng: pos.getLng() } : null));
      });

      setSel((prev) => ({
        lat: latlng.getLat(),
        lng: latlng.getLng(),
        address: prev?.address ?? '',
      }));
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current = null;
      }
    };
  }, [sel?.lat, sel?.lng]);

  // Debounced search using Kakao API via proxy
  useEffect(() => {
    if (q.trim().length < 2) {
      setCands([]);
      return;
    }
    setSearching(true);
    setErr(false);
    let stale = false;
    const t = window.setTimeout(async () => {
      try {
        const r = await geocodeSearch(q.trim());
        if (!stale) setCands(r);
      } catch {
        if (!stale) {
          setErr(true);
          setCands([]);
        }
      } finally {
        if (!stale) setSearching(false);
      }
    }, 500);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [q]);

  function pick(c: GeoCandidate) {
    setSel({ lat: c.lat, lng: c.lng, address: c.address });
    if (!name.trim()) setName(c.name);
    setCands([]);

    // Update map center and marker
    if (mapInstanceRef.current && markerRef.current) {
      mapInstanceRef.current.setCenter(new window.kakao.maps.LatLng(c.lat, c.lng));
      markerRef.current.setPosition(new window.kakao.maps.LatLng(c.lat, c.lng));
    }
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

        <label className="text-[11px] font-bold text-on-surface-variant">카카오맵 검색</label>
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
            <div className="h-52 rounded-md overflow-hidden border border-outline-variant/30">
              <div ref={mapRef} className="w-full h-full" />
            </div>
            <p className="text-[11px] text-on-surface-variant mt-1">
              <Icon name="pan_tool_alt" className="text-[13px] align-middle" /> 핀을 끌거나 지도를 탭해 위치를 조정하세요 · {sel.lat.toFixed(5)}, {sel.lng.toFixed(5)}
            </p>
          </div>
        )}

        {!sel && (
          <button
            className="btn-ghost w-full mt-2 text-[13px] flex items-center justify-center gap-1"
            onClick={() => setSel({ lat: 36.5, lng: 127.8, address: '' })}
          >
            <Icon name="pin_drop" className="text-[16px]" /> 지도에서 직접 찍기
          </button>
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
