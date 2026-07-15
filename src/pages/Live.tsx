import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, orderSlots, type Place } from '../db';
import { estimateTravelMinutes } from '../mock';
import { Icon, TopBar, Screen, EmptyState } from '../ui';

interface Stop { place: Place; time: string; band: string; }

// how many simulated minutes pass per real second at 1x
const SIM_MIN_PER_SEC = 12;

export default function Live() {
  const { id } = useParams();
  const tripId = Number(id);
  const trip = useLiveQuery(() => db.trips.get(tripId), [tripId]);
  const [day, setDay] = useState(0);
  const slots = useLiveQuery(
    () => db.slots.where('[tripId+dayIndex]').equals([tripId, day]).toArray(),
    [tripId, day],
  );
  const places = useLiveQuery(() => db.places.where('tripId').equals(tripId).toArray(), [tripId]);

  // ordered stops (slots with a real place) for the day
  const stops: Stop[] = useMemo(() => {
    if (!slots || !places) return [];
    const byId = new Map(places.map((p) => [p.id!, p]));
    return orderSlots(slots)
      .filter((s) => !!s.placeId && byId.has(s.placeId!))
      .map((s) => ({ place: byId.get(s.placeId!)!, time: s.plannedTime, band: s.band }));
  }, [slots, places]);

  // segment travel minutes between consecutive stops
  const segMins = useMemo(
    () => stops.slice(1).map((s, i) => estimateTravelMinutes(stops[i].place, s.place)),
    [stops],
  );

  const [progress, setProgress] = useState(0); // float: 0..stops.length-1
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [useGps, setUseGps] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const lastArrival = useRef<number>(-1);

  // clamp progress if route changes
  useEffect(() => {
    setProgress((p) => Math.min(p, Math.max(0, stops.length - 1)));
  }, [stops.length]);

  // simulation tick
  useEffect(() => {
    if (!playing || useGps || stops.length < 2) return;
    const TICK = 250;
    const t = setInterval(() => {
      setProgress((p) => {
        const seg = Math.floor(p);
        if (seg >= stops.length - 1) { setPlaying(false); return stops.length - 1; }
        const segMin = segMins[seg] || 10;
        const deltaMin = (SIM_MIN_PER_SEC * speed * TICK) / 1000;
        return Math.min(p + deltaMin / segMin, stops.length - 1);
      });
    }, TICK);
    return () => clearInterval(t);
  }, [playing, useGps, speed, stops.length, segMins]);

  // arrival detection -> banner + vibrate
  useEffect(() => {
    const idx = Math.round(progress);
    const atStop = Math.abs(progress - idx) < 0.02;
    if (atStop && idx !== lastArrival.current && stops[idx]) {
      lastArrival.current = idx;
      fireAlert(`📍 ${stops[idx].place.name} 도착! (${stops[idx].band} · ${stops[idx].time})`);
    }
  }, [progress, stops]);

  // real GPS
  useEffect(() => {
    if (!useGps || !('geolocation' in navigator)) return;
    const wid = navigator.geolocation.watchPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }),
      () => setBanner('위치 권한이 필요합니다. 브라우저에서 허용해 주세요.'),
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(wid);
  }, [useGps]);

  function fireAlert(msg: string) {
    setBanner(msg);
    if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
    setTimeout(() => setBanner((b) => (b === msg ? null : b)), 6000);
  }

  if (!trip) return null;

  const seg = Math.floor(progress);
  const frac = progress - seg;
  const arrived = frac < 0.02;
  const current = stops[seg];
  const next = stops[seg + 1];
  const remainMin = next ? Math.max(0, Math.round((1 - frac) * (segMins[seg] || 10))) : 0;
  const etaClock = next ? clockPlus(remainMin) : null;
  const done = stops.length > 0 && seg >= stops.length - 1 && arrived;

  return (
    <>
      <TopBar
        title="지금"
        backTo="/"
        right={
          <button onClick={() => setUseGps((v) => !v)} className={`chip ${useGps ? 'bg-emerald text-white' : 'bg-surface-variant text-on-surface-variant'}`}>
            <Icon name="my_location" className="text-[15px]" /> {useGps ? '실 GPS' : '시뮬'}
          </button>
        }
      />

      {banner && (
        <div className="sticky top-14 z-30 mx-4 mt-3 rounded-md bg-primary-container text-on-primary-container px-3 py-2.5 text-[14px] font-semibold shadow flex items-center gap-2 animate-pulse">
          <Icon name="notifications_active" /> {banner}
        </div>
      )}

      <div className="flex gap-2 px-4 pt-3 overflow-x-auto no-scrollbar">
        {Array.from({ length: trip.dayCount }).map((_, i) => (
          <button key={i} onClick={() => { setDay(i); setProgress(0); lastArrival.current = -1; }}
            className={`shrink-0 px-4 py-2 rounded-full text-[14px] font-semibold ${day === i ? 'bg-primary-container text-on-primary-container' : 'bg-surface-variant text-on-surface-variant'}`}>
            {i + 1}일차
          </button>
        ))}
      </div>

      <Screen>
        {stops.length < 2 ? (
          <EmptyState icon="explore" title="이동 경로가 부족해요" hint="'계획'에서 이 날의 방문 장소를 2곳 이상 넣어주세요" />
        ) : useGps ? (
          <GpsPanel gps={gps} next={next} />
        ) : (
          <>
            {/* status card */}
            <section className="card p-4 mb-3">
              {done ? (
                <div className="text-center py-3">
                  <Icon name="celebration" className="text-[40px] text-primary-container" />
                  <p className="font-head font-bold mt-1">오늘 일정 완료!</p>
                </div>
              ) : arrived ? (
                <div>
                  <p className="text-[13px] text-emerald font-semibold flex items-center gap-1"><Icon name="location_on" className="text-[16px]" /> 현재 위치</p>
                  <p className="font-head font-extrabold text-[22px] mt-0.5">{current.place.name}</p>
                  <p className="text-[13px] text-on-surface-variant">{current.band} · {current.time} 도착</p>
                </div>
              ) : (
                <div>
                  <p className="text-[13px] text-primary-container font-semibold flex items-center gap-1"><Icon name="directions_car" className="text-[16px]" /> 이동 중</p>
                  <p className="font-head font-extrabold text-[20px] mt-0.5">{current.place.name} → {next.place.name}</p>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="font-head font-extrabold text-[28px] text-primary-container tabular-nums">약 {remainMin}분</span>
                    <span className="text-[13px] text-on-surface-variant">남음 · 도착 예정 {etaClock}</span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-variant mt-3 overflow-hidden">
                    <div className="h-full bg-primary-container transition-all" style={{ width: `${Math.round(frac * 100)}%` }} />
                  </div>
                </div>
              )}
            </section>

            {/* controls */}
            <div className="flex items-center gap-2 mb-4">
              <button onClick={() => setPlaying((v) => !v)} disabled={done}
                className="btn-primary flex-1 flex items-center justify-center gap-1">
                <Icon name={playing ? 'pause' : 'play_arrow'} /> {playing ? '일시정지' : done ? '완료' : '이동 시작'}
              </button>
              {[1, 4, 12].map((s) => (
                <button key={s} onClick={() => setSpeed(s)}
                  className={`chip ${speed === s ? 'bg-primary-container text-on-primary-container' : 'bg-surface-variant text-on-surface-variant'}`}>
                  {s}x
                </button>
              ))}
              <button onClick={() => { setProgress(0); setPlaying(false); lastArrival.current = -1; }} className="chip bg-surface-variant text-on-surface-variant">
                <Icon name="restart_alt" className="text-[16px]" />
              </button>
            </div>

            {/* learning content for the place being approached / arrived */}
            <LearnCard place={arrived ? current.place : next.place} approaching={!arrived} />

            {/* route overview */}
            <h3 className="font-head font-bold text-[15px] mt-5 mb-2">오늘의 동선</h3>
            <ol className="relative pl-5">
              <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-primary-container/30" />
              {stops.map((s, i) => (
                <li key={i} className="relative mb-3">
                  <div className={`absolute -left-5 top-1.5 w-4 h-4 rounded-full ring-4 ring-surface ${i <= progress ? 'bg-primary-container' : 'bg-surface-variant'}`} />
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-on-surface-variant w-12">{s.time}</span>
                    <span className={`font-medium ${i === Math.round(progress) && arrived ? 'text-primary-container' : ''}`}>{s.place.name}</span>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </Screen>
    </>
  );
}

function LearnCard({ place, approaching }: { place: Place; approaching: boolean }) {
  return (
    <section className="card p-4 border-l-4 border-l-emerald">
      <p className="text-[12px] text-emerald font-semibold flex items-center gap-1">
        <Icon name="menu_book" className="text-[16px]" /> {approaching ? '곧 도착 · 장소 안내' : '장소 안내'}
      </p>
      <p className="font-head font-bold mt-0.5">{place.name}</p>
      {place.learn ? (
        <p className="text-[13px] leading-relaxed text-on-surface-variant mt-1 whitespace-pre-wrap">{place.learn}</p>
      ) : (
        <p className="text-[13px] text-on-surface-variant mt-1">아직 안내 콘텐츠가 없어요. '구성 → 장소'에서 유래·의미·문화유산 설명을 추가하면 여기에 표시됩니다.</p>
      )}
    </section>
  );
}

function GpsPanel({ gps, next }: { gps: { lat: number; lng: number; acc: number } | null; next?: Stop }) {
  const dist = gps && next?.place.lat != null && next.place.lng != null
    ? haversineKm(gps.lat, gps.lng, next.place.lat, next.place.lng)
    : null;
  return (
    <section className="card p-4">
      <p className="text-[13px] text-emerald font-semibold flex items-center gap-1"><Icon name="my_location" className="text-[16px]" /> 실제 위치 사용 중</p>
      {gps ? (
        <>
          <p className="font-head font-extrabold text-[18px] mt-1 tabular-nums">{gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}</p>
          <p className="text-[12px] text-on-surface-variant">정확도 약 {Math.round(gps.acc)}m</p>
          {next && (
            <p className="text-[13px] mt-3">
              다음: <b>{next.place.name}</b>{' '}
              {dist != null ? `· 약 ${dist.toFixed(1)}km · ETA ${Math.max(1, Math.round((dist / 40) * 60))}분`
                : '· 좌표가 없어 거리 계산 불가(장소에 좌표 추가 시 지원)'}
            </p>
          )}
        </>
      ) : (
        <p className="text-[13px] text-on-surface-variant mt-2">위치를 가져오는 중… 권한을 허용해 주세요.</p>
      )}
    </section>
  );
}

function clockPlus(min: number) {
  const d = new Date(Date.now() + min * 60000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function haversineKm(a: number, b: number, c: number, d: number) {
  const R = 6371, dLat = ((c - a) * Math.PI) / 180, dLng = ((d - b) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a * Math.PI) / 180) * Math.cos((c * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
