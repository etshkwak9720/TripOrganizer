import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, orderSlots, type Place } from '../db';
import { estimateTravelMinutes } from '../mock';
import { fetchRoute, type RouteResult } from '../geo';
import LiveMap, { type MapPos } from '../components/LiveMap';
import { Icon, TopBar, Screen, EmptyState } from '../ui';

interface Stop { place: Place; time: string; band: string }

const SIM_MIN_PER_SEC = 12;     // simulated minutes per real second at 1x
const ARRIVE_KM = 0.08;         // arrival radius ~80m
const LEG_REFRESH_MS = 30_000;  // refetch my->next route every 30s...
const LEG_REFRESH_KM = 0.1;     // ...or after moving 100m

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

  // ordered stops with a place (meal slots included since they carry placeId now)
  const stops: Stop[] = useMemo(() => {
    if (!slots || !places) return [];
    const byId = new Map(places.map((p) => [p.id!, p]));
    return orderSlots(slots)
      .filter((s) => !!s.placeId && byId.has(s.placeId!))
      .map((s) => ({ place: byId.get(s.placeId!)!, time: s.plannedTime, band: s.band }));
  }, [slots, places]);

  const coordStops = useMemo(() => stops.filter((s) => s.place.lat != null && s.place.lng != null), [stops]);
  const noCoordStops = useMemo(() => stops.filter((s) => s.place.lat == null || s.place.lng == null), [stops]);
  const coordsKey = coordStops.map((s) => `${s.place.lat},${s.place.lng}`).join(';');

  // --- position: real GPS or simulation ---
  const [useGps, setUseGps] = useState(true);
  const [gps, setGps] = useState<MapPos | null>(null);
  const [gpsErr, setGpsErr] = useState(false);
  const [progress, setProgress] = useState(0); // sim: float 0..coordStops.length-1
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (!useGps) return;
    if (!('geolocation' in navigator)) { setGpsErr(true); return; }
    const wid = navigator.geolocation.watchPosition(
      (p) => { setGps({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); setGpsErr(false); },
      () => setGpsErr(true),
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(wid);
  }, [useGps]);

  // sim segment durations (straight-line estimates are fine for the demo)
  const segMins = useMemo(
    () => coordStops.slice(1).map((s, i) => estimateTravelMinutes(coordStops[i].place, s.place)),
    [coordStops],
  );

  useEffect(() => {
    if (!playing || useGps || coordStops.length < 2) return;
    const TICK = 250;
    const t = setInterval(() => {
      setProgress((p) => {
        const seg = Math.floor(p);
        if (seg >= coordStops.length - 1) { setPlaying(false); return coordStops.length - 1; }
        const segMin = segMins[seg] || 10;
        const deltaMin = (SIM_MIN_PER_SEC * speed * TICK) / 1000;
        // Clamp to the next waypoint boundary so a large per-tick jump (fast
        // speed + long leg) can't skip clean over an intermediate stop's
        // exact coordinates — each stop must be landed on before continuing.
        return Math.min(p + deltaMin / segMin, seg + 1, coordStops.length - 1);
      });
    }, TICK);
    return () => clearInterval(t);
  }, [playing, useGps, speed, coordStops.length, segMins]);

  const simPos: MapPos | null = useMemo(() => {
    if (useGps || coordStops.length === 0) return null;
    const seg = Math.min(Math.floor(progress), coordStops.length - 1);
    const frac = progress - seg;
    const a = coordStops[seg].place;
    const b = coordStops[Math.min(seg + 1, coordStops.length - 1)].place;
    return { lat: a.lat! + (b.lat! - a.lat!) * frac, lng: a.lng! + (b.lng! - a.lng!) * frac };
  }, [useGps, progress, coordStops]);

  const pos = useGps ? gps : simPos;

  // --- routes ---
  const [dayRoute, setDayRoute] = useState<RouteResult | null>(null);
  useEffect(() => {
    let on = true;
    if (coordStops.length < 2) { setDayRoute(null); return; }
    fetchRoute(coordStops.map((s) => ({ lat: s.place.lat!, lng: s.place.lng! }))).then((r) => { if (on) setDayRoute(r); });
    return () => { on = false; };
  }, [coordsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- navigation target + my->next leg ---
  const [targetIdx, setTargetIdx] = useState(0);
  const [leg, setLeg] = useState<RouteResult | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const legFetchRef = useRef({ t: 0, lat: 0, lng: 0, idx: -1 });
  const lastArriveRef = useRef<number | null>(null);
  const leftTargetRef = useRef(false); // seen outside the radius since targeting this stop

  useEffect(() => {
    setTargetIdx(0); setProgress(0); setPlaying(false); setLeg(null);
    lastArriveRef.current = null; leftTargetRef.current = false; legFetchRef.current = { t: 0, lat: 0, lng: 0, idx: -1 };
  }, [day, coordsKey]);

  const target = coordStops[targetIdx];

  useEffect(() => {
    if (!pos || !target) { setLeg(null); return; }
    const now = Date.now();
    const moved = haversineKm(pos.lat, pos.lng, legFetchRef.current.lat, legFetchRef.current.lng);
    if (targetIdx === legFetchRef.current.idx && now - legFetchRef.current.t < LEG_REFRESH_MS && moved < LEG_REFRESH_KM) return;
    legFetchRef.current = { t: now, lat: pos.lat, lng: pos.lng, idx: targetIdx };
    let on = true;
    const dest = { lat: target.place.lat!, lng: target.place.lng! };
    fetchRoute([{ lat: pos.lat, lng: pos.lng }, dest]).then((r) => {
      if (!on) return;
      if (r) { setLeg(r); return; }
      // offline / OSRM down -> straight line + rough estimate
      const km = haversineKm(pos.lat, pos.lng, dest.lat, dest.lng);
      setLeg({
        coords: [[pos.lat, pos.lng], [dest.lat, dest.lng]],
        durationMin: estimateTravelMinutes({ ...pos, name: '현재 위치' }, target.place),
        distanceKm: km,
        estimated: true,
      });
    });
    return () => { on = false; };
  }, [pos?.lat, pos?.lng, targetIdx, coordsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arrival: advance whenever we're inside the target's radius, but only
  // announce it if we actually travelled in from outside — entering sim mode
  // (or opening the page) while parked on a stop is not an arrival.
  useEffect(() => {
    if (!pos || !target) return;
    const d = haversineKm(pos.lat, pos.lng, target.place.lat!, target.place.lng!);
    if (d >= ARRIVE_KM) { leftTargetRef.current = true; return; }
    if (lastArriveRef.current === target.place.id) return;
    lastArriveRef.current = target.place.id!;
    if (leftTargetRef.current) fireAlert(`📍 ${target.place.name} 도착! (${target.band} · ${target.time})`);
    leftTargetRef.current = false;
    if (targetIdx < coordStops.length - 1) setTargetIdx(targetIdx + 1);
  }, [pos, target, targetIdx, coordStops.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // 인솔자(관리자)의 실시간 위치 & 상태 정보를 DB에 저장 (학생 모드 동기화용)
  useEffect(() => {
    if (!tripId || !pos) return;
    const updateAdminStatus = async () => {
      const currentTrip = await db.trips.get(tripId);
      if (!currentTrip) return;
      
      const prevLat = currentTrip.adminLat;
      const prevLng = currentTrip.adminLng;
      const prevTargetIdx = currentTrip.adminTargetIdx;
      const prevDayIndex = currentTrip.adminDayIndex;

      let distanceChanged = true;
      if (prevLat != null && prevLng != null) {
        const dist = haversineKm(pos.lat, pos.lng, prevLat, prevLng);
        // 5m 미만 미세 이동은 무시
        if (dist < 0.005) distanceChanged = false;
      }

      if (
        distanceChanged ||
        prevTargetIdx !== targetIdx ||
        prevDayIndex !== day
      ) {
        await db.trips.update(tripId, {
          adminLat: pos.lat,
          adminLng: pos.lng,
          adminTargetIdx: targetIdx,
          adminDayIndex: day,
        });
      }
    };
    
    // 2초 디바운스로 잦은 DB 쓰기 방지
    const timer = setTimeout(updateAdminStatus, 2000);
    return () => clearTimeout(timer);
  }, [pos?.lat, pos?.lng, targetIdx, day, tripId]);

  function fireAlert(msg: string) {
    setBanner(msg);
    if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
    setTimeout(() => setBanner((b) => (b === msg ? null : b)), 6000);
  }

  if (!trip) return null;

  const done = coordStops.length > 0 && targetIdx >= coordStops.length - 1 && lastArriveRef.current === coordStops[coordStops.length - 1]?.place.id;
  const etaClock = leg ? clockPlus(leg.durationMin) : null;

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
          <button key={i} onClick={() => setDay(i)}
            className={`shrink-0 px-4 py-2 rounded-full text-[14px] font-semibold ${day === i ? 'bg-primary-container text-on-primary-container' : 'bg-surface-variant text-on-surface-variant'}`}>
            {i + 1}일차
          </button>
        ))}
      </div>

      <Screen>
        {coordStops.length === 0 ? (
          <EmptyState icon="explore" title="지도에 표시할 장소가 없어요" hint="'구성 → 장소'에서 지도 검색으로 좌표를 추가해 주세요" />
        ) : (
          <>
            {/* map */}
            <div className="card overflow-hidden mb-3" style={{ height: '45vh', minHeight: 260 }}>
              <LiveMap
                stops={coordStops.map((s) => ({ name: s.place.name, lat: s.place.lat!, lng: s.place.lng!, food: s.place.kind === 'food' }))}
                route={dayRoute?.coords ?? null}
                leg={leg?.coords ?? null}
                pos={pos}
                targetIdx={targetIdx}
              />
            </div>

            {/* status card */}
            <section className="card p-4 mb-3">
              {useGps && gpsErr ? (
                <div>
                  <p className="text-[13px] text-error font-semibold flex items-center gap-1"><Icon name="location_off" className="text-[16px]" /> 위치 권한이 필요해요</p>
                  <p className="text-[13px] text-on-surface-variant mt-1">브라우저에서 위치 권한을 허용하거나, 시뮬레이션으로 확인해 보세요.</p>
                  <button onClick={() => setUseGps(false)} className="btn-primary mt-2 text-[13px] py-2">시뮬레이션으로 전환</button>
                </div>
              ) : done ? (
                <div className="text-center py-3">
                  <Icon name="celebration" className="text-[40px] text-primary-container" />
                  <p className="font-head font-bold mt-1">오늘 일정 완료!</p>
                </div>
              ) : !pos ? (
                <p className="text-[13px] text-on-surface-variant">위치를 가져오는 중… 권한을 허용해 주세요.</p>
              ) : target ? (
                <div>
                  <p className="text-[13px] text-primary-container font-semibold flex items-center gap-1">
                    <Icon name="directions_car" className="text-[16px]" /> 다음 목적지
                  </p>
                  <p className="font-head font-extrabold text-[20px] mt-0.5">
                    {target.place.kind === 'food' ? '🍜 ' : ''}{target.place.name}
                    <span className="text-[13px] font-semibold text-on-surface-variant ml-2">{target.band} · {target.time}</span>
                  </p>
                  {leg ? (
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="font-head font-extrabold text-[28px] text-primary-container tabular-nums">약 {leg.durationMin}분</span>
                      <span className="text-[13px] text-on-surface-variant">
                        남음 · {leg.distanceKm.toFixed(1)}km · 도착 예정 {etaClock}
                        {leg.estimated && <span className="ml-1 text-[11px] font-bold text-error">추정치</span>}
                      </span>
                    </div>
                  ) : (
                    <p className="text-[13px] text-on-surface-variant mt-1">경로 계산 중…</p>
                  )}
                </div>
              ) : null}
            </section>

            {/* sim controls */}
            {!useGps && (
              <div className="flex items-center gap-2 mb-4">
                <button onClick={() => setPlaying((v) => !v)} disabled={coordStops.length < 2}
                  className="btn-primary flex-1 flex items-center justify-center gap-1">
                  <Icon name={playing ? 'pause' : 'play_arrow'} /> {playing ? '일시정지' : '이동 시작'}
                </button>
                {[1, 4, 12].map((s) => (
                  <button key={s} onClick={() => setSpeed(s)}
                    className={`chip ${speed === s ? 'bg-primary-container text-on-primary-container' : 'bg-surface-variant text-on-surface-variant'}`}>
                    {s}x
                  </button>
                ))}
                <button onClick={() => { setProgress(0); setPlaying(false); setTargetIdx(0); lastArriveRef.current = null; leftTargetRef.current = false; }}
                  className="chip bg-surface-variant text-on-surface-variant">
                  <Icon name="restart_alt" className="text-[16px]" />
                </button>
              </div>
            )}

            {/* places without coordinates */}
            {noCoordStops.length > 0 && (
              <section className="card p-3 mb-3 border-l-4 border-l-error">
                <p className="text-[12px] font-semibold text-error flex items-center gap-1">
                  <Icon name="location_off" className="text-[15px]" /> 좌표가 없어 지도에서 빠진 일정
                </p>
                <p className="text-[13px] text-on-surface-variant mt-1">
                  {noCoordStops.map((s) => s.place.name).join(', ')}
                </p>
                <Link to={`/trip/${tripId}/setup`} className="text-[12px] font-semibold text-primary-container mt-1 inline-block">
                  구성에서 지도 검색으로 추가하기 →
                </Link>
              </section>
            )}

            {/* learning content for target */}
            {target && <LearnCard place={target.place} />}

            {/* route overview */}
            <h3 className="font-head font-bold text-[15px] mt-5 mb-2">오늘의 동선</h3>
            <ol className="relative pl-5">
              <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-primary-container/30" />
              {coordStops.map((s, i) => (
                <li key={i} className="relative mb-3">
                  <div className={`absolute -left-5 top-1.5 w-4 h-4 rounded-full ring-4 ring-surface ${i < targetIdx || done ? 'bg-primary-container' : i === targetIdx ? 'bg-emerald' : 'bg-surface-variant'}`} />
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-on-surface-variant w-12">{s.time}</span>
                    <span className={`font-medium ${i === targetIdx ? 'text-primary-container' : ''}`}>
                      {s.place.kind === 'food' ? '🍜 ' : ''}{s.place.name}
                    </span>
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

function LearnCard({ place }: { place: Place }) {
  if (!place.learn) return null;
  return (
    <section className="card p-4 border-l-4 border-l-emerald">
      <p className="text-[12px] text-emerald font-semibold flex items-center gap-1">
        <Icon name="menu_book" className="text-[16px]" /> 장소 안내
      </p>
      <p className="font-head font-bold mt-0.5">{place.name}</p>
      <p className="text-[13px] leading-relaxed text-on-surface-variant mt-1 whitespace-pre-wrap">{place.learn}</p>
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
