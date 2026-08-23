import { useEffect, useMemo, useRef, useState } from 'react';
import { estimateTravelMinutes } from '../../mock';
import { fetchRoute, type RouteResult } from '../../geo';
import LiveMap, { type MapPos } from '../../components/LiveMap';
import { Icon, Screen, EmptyState } from '../../ui';
import type { ShareSnapshot } from '../../share';
import { buildDayStops, type DayStop } from '../../dayStops';

type SnapPlace = ShareSnapshot['places'][number];
type Stop = DayStop<SnapPlace>;

const ARRIVE_KM = 0.08;
const LEG_REFRESH_MS = 30_000;
const LEG_REFRESH_KM = 0.1;

function haversineKm(a: number, b: number, c: number, d: number) {
  const R = 6371, dLat = ((c - a) * Math.PI) / 180, dLng = ((d - b) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a * Math.PI) / 180) * Math.cos((c * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
function clockPlus(min: number) {
  const d = new Date(Date.now() + min * 60000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function NowTab({ schedule }: { schedule: ShareSnapshot }) {
  const [day, setDay] = useState(0);

  // Day 2 onward opens at the previous night's lodging — see buildDayStops.
  const stops: Stop[] = useMemo(
    () => buildDayStops(schedule.slots, new Map(schedule.places.map((p) => [p.id, p])), day),
    [schedule, day],
  );

  const coordStops = useMemo(() => stops.filter((s) => s.place.lat != null && s.place.lng != null), [stops]);
  const noCoordStops = useMemo(() => stops.filter((s) => s.place.lat == null || s.place.lng == null), [stops]);
  const coordsKey = coordStops.map((s) => `${s.place.lat},${s.place.lng}`).join(';');

  // 본인 GPS
  const [gps, setGps] = useState<MapPos | null>(null);
  const [gpsErr, setGpsErr] = useState(false);
  useEffect(() => {
    if (!('geolocation' in navigator)) { setGpsErr(true); return; }
    const wid = navigator.geolocation.watchPosition(
      (p) => { setGps({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); setGpsErr(false); },
      () => setGpsErr(true),
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(wid);
  }, []);
  const adminPos = useMemo(() => {
    return schedule.trip.adminLat != null && schedule.trip.adminLng != null
      ? { lat: schedule.trip.adminLat, lng: schedule.trip.adminLng }
      : null;
  }, [schedule.trip.adminLat, schedule.trip.adminLng]);
  const mainPos = adminPos || gps;

  // 하루 전체 경로(지도 표시용)
  const [dayRoute, setDayRoute] = useState<RouteResult | null>(null);
  useEffect(() => {
    let on = true;
    if (coordStops.length < 2) { setDayRoute(null); return; }
    fetchRoute(coordStops.map((s) => ({ lat: s.place.lat!, lng: s.place.lng! }))).then((r) => { if (on) setDayRoute(r); });
    return () => { on = false; };
  }, [coordsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 다음 목적지 + 내 위치→목적지 구간
  const [targetIdx, setTargetIdx] = useState(0);
  const [leg, setLeg] = useState<RouteResult | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const legFetchRef = useRef({ t: 0, lat: 0, lng: 0, idx: -1 });
  const legGenRef = useRef(0);
  const lastArriveRef = useRef<number | null>(null);
  const leftTargetRef = useRef(false);

  // 관리자 일차 & 목적지 동기화
  // 관리자가 일차를 옮기면 따라간다. `day`를 의존성에 넣으면 참가자가 다른 날을
  // 눌러도 효과가 곧바로 다시 돌며 되돌려버려 일차 선택 자체가 막힌다.
  const adminDay = schedule.trip.adminDayIndex;
  useEffect(() => {
    if (adminDay != null) setDay(adminDay);
  }, [adminDay]);

  // 관리자의 진행 상황은 참가자가 관리자와 같은 일차를 볼 때만 의미가 있다.
  // 다른 날을 둘러보는 동안에는 남의 날 인덱스를 덮어쓰지도, 도착 배너를 띄우지도 않는다.
  const followingAdmin = adminDay == null || adminDay === day;
  useEffect(() => {
    if (!followingAdmin) return;
    if (schedule.trip.adminTargetIdx != null && schedule.trip.adminTargetIdx !== targetIdx) {
      const prevTarget = coordStops[targetIdx];
      if (prevTarget && schedule.trip.adminTargetIdx > targetIdx) {
        setBanner(`📍 ${prevTarget.place.name} 도착! (${prevTarget.band} · ${prevTarget.time})`);
        if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
        setTimeout(() => setBanner((b) => (b && b.includes(prevTarget.place.name) ? null : b)), 6000);
      }
      setTargetIdx(schedule.trip.adminTargetIdx);
    }
  }, [schedule.trip.adminTargetIdx, targetIdx, coordStops, followingAdmin]);

  useEffect(() => {
    setLeg(null); lastArriveRef.current = null; leftTargetRef.current = false;
    legFetchRef.current = { t: 0, lat: 0, lng: 0, idx: -1 };
    legGenRef.current++;
    setTargetIdx(followingAdmin && schedule.trip.adminTargetIdx != null ? schedule.trip.adminTargetIdx : 0);
  }, [day, coordsKey, schedule.trip.adminTargetIdx, followingAdmin]);

  const target = coordStops[targetIdx];

  useEffect(() => {
    if (!mainPos || !target) { setLeg(null); return; }
    const now = Date.now();
    const moved = haversineKm(mainPos.lat, mainPos.lng, legFetchRef.current.lat, legFetchRef.current.lng);
    if (targetIdx === legFetchRef.current.idx && now - legFetchRef.current.t < LEG_REFRESH_MS && moved < LEG_REFRESH_KM) return;
    legFetchRef.current = { t: now, lat: mainPos.lat, lng: mainPos.lng, idx: targetIdx };
    // 정리 함수로 취소하지 않는다 — Live.tsx의 같은 자리 주석 참고.
    const gen = ++legGenRef.current;
    const from = { lat: mainPos.lat, lng: mainPos.lng };
    const dest = { lat: target.place.lat!, lng: target.place.lng! };
    fetchRoute([from, dest]).then((r) => {
      if (gen !== legGenRef.current) return;
      if (r) { setLeg(r); return; }
      const km = haversineKm(from.lat, from.lng, dest.lat, dest.lng);
      setLeg({
        coords: [[from.lat, from.lng], [dest.lat, dest.lng]],
        durationMin: estimateTravelMinutes({ name: '현재 위치', lat: from.lat, lng: from.lng }, target.place),
        distanceKm: km, estimated: true,
      });
    });
  }, [mainPos?.lat, mainPos?.lng, targetIdx, coordsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 학생 자체 GPS 도착 감지 (관리자 위치 비활성화 시 폴백 동작)
  useEffect(() => {
    if (adminPos || !gps || !target) return;
    const d = haversineKm(gps.lat, gps.lng, target.place.lat!, target.place.lng!);
    if (d >= ARRIVE_KM) { leftTargetRef.current = true; return; }
    if (lastArriveRef.current === target.place.id) return;
    lastArriveRef.current = target.place.id;
    if (leftTargetRef.current) {
      setBanner(`📍 ${target.place.name} 도착! (${target.band} · ${target.time})`);
      if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
      setTimeout(() => setBanner((b) => (b && b.includes(target.place.name) ? null : b)), 6000);
    }
    leftTargetRef.current = false;
    if (targetIdx < coordStops.length - 1) setTargetIdx(targetIdx + 1);
  }, [gps, target, targetIdx, coordStops.length, adminPos]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = coordStops.length > 0 && targetIdx >= coordStops.length - 1 && lastArriveRef.current === coordStops[coordStops.length - 1]?.place.id;
  const etaClock = leg ? clockPlus(leg.durationMin) : null;

  return (
    <>
      {banner && (
        <div className="sticky top-14 z-30 mx-4 mt-3 rounded-md bg-primary-container text-on-primary-container px-3 py-2.5 text-[14px] font-semibold shadow flex items-center gap-2">
          <Icon name="notifications_active" /> {banner}
        </div>
      )}
      <div className="flex gap-2 px-4 pt-3 overflow-x-auto no-scrollbar">
        {Array.from({ length: schedule.trip.dayCount }).map((_, i) => (
          <button key={i} onClick={() => setDay(i)}
            className={`shrink-0 px-4 py-2 rounded-full text-[14px] font-semibold ${day === i ? 'bg-primary-container text-on-primary-container' : 'bg-surface-variant text-on-surface-variant'}`}>
            {i + 1}일차
          </button>
        ))}
      </div>

      <Screen>
        {coordStops.length === 0 ? (
          <EmptyState icon="explore" title="지도에 표시할 장소가 없어요" hint="인솔자가 장소에 좌표를 추가하면 지도가 표시됩니다" />
        ) : (
          <>
            <div className="card overflow-hidden mb-3" style={{ height: '45vh', minHeight: 260 }}>
              <LiveMap
                stops={coordStops.map((s) => ({ name: s.place.name, lat: s.place.lat!, lng: s.place.lng!, food: s.place.kind === 'food' }))}
                route={dayRoute?.coords ?? null}
                leg={leg?.coords ?? null}
                pos={gps}
                targetIdx={targetIdx}
                adminPos={adminPos}
              />
            </div>

            <section className="card p-4 mb-3">
              {gpsErr ? (
                <p className="text-[13px] text-error font-semibold flex items-center gap-1"><Icon name="location_off" className="text-[16px]" /> 위치 권한을 허용하면 도착 시간이 표시돼요</p>
              ) : done ? (
                <div className="text-center py-3"><Icon name="celebration" className="text-[40px] text-primary-container" /><p className="font-head font-bold mt-1">오늘 일정 완료!</p></div>
              ) : !mainPos ? (
                <p className="text-[13px] text-on-surface-variant">위치를 가져오는 중… 권한을 허용해 주세요.</p>
              ) : target ? (
                <div>
                  <p className="text-[13px] text-primary-container font-semibold flex items-center gap-1"><Icon name="directions_car" className="text-[16px]" /> 다음 목적지</p>
                  <p className="font-head font-extrabold text-[20px] mt-0.5">
                    {target.place.kind === 'food' ? '🍜 ' : ''}{target.place.name}
                    <span className="text-[13px] font-semibold text-on-surface-variant ml-2">{target.band} · {target.time}</span>
                  </p>
                  {leg ? (
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="font-head font-extrabold text-[28px] text-primary-container tabular-nums">약 {leg.durationMin}분</span>
                      <span className="text-[13px] text-on-surface-variant">남음 · {leg.distanceKm.toFixed(1)}km · 도착 예정 {etaClock}{leg.estimated && <span className="ml-1 text-[11px] font-bold text-error">추정치</span>}</span>
                    </div>
                  ) : <p className="text-[13px] text-on-surface-variant mt-1">경로 계산 중…</p>}
                </div>
              ) : null}
            </section>

            {noCoordStops.length > 0 && (
              <section className="card p-3 mb-3 border-l-4 border-l-error">
                <p className="text-[12px] font-semibold text-error flex items-center gap-1"><Icon name="location_off" className="text-[15px]" /> 좌표가 없어 지도에서 빠진 일정</p>
                <p className="text-[13px] text-on-surface-variant mt-1">{noCoordStops.map((s) => s.place.name).join(', ')}</p>
              </section>
            )}

            {target?.place.learn && (
              <section className="card p-4 border-l-4 border-l-emerald mb-3">
                <p className="text-[12px] text-emerald font-semibold flex items-center gap-1"><Icon name="menu_book" className="text-[16px]" /> 장소 안내</p>
                <p className="font-head font-bold mt-0.5">{target.place.name}</p>
                <p className="text-[13px] leading-relaxed text-on-surface-variant mt-1 whitespace-pre-wrap">{target.place.learn}</p>
              </section>
            )}

            <h3 className="font-head font-bold text-[15px] mt-5 mb-2">오늘의 동선</h3>
            <ol className="relative pl-5">
              <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-primary-container/30" />
              {coordStops.map((s, i) => (
                <li key={i} className="relative mb-3">
                  <div className={`absolute -left-5 top-1.5 w-4 h-4 rounded-full ring-4 ring-surface ${i < targetIdx || done ? 'bg-primary-container' : i === targetIdx ? 'bg-emerald' : 'bg-surface-variant'}`} />
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-on-surface-variant w-12">{s.fromPrevDay ? '출발' : s.time}</span>
                    <span className={`font-medium ${i === targetIdx ? 'text-primary-container' : ''}`}>
                      {s.fromPrevDay ? '🏨 ' : s.place.kind === 'food' ? '🍜 ' : ''}{s.place.name}
                      {s.fromPrevDay && <span className="text-[12px] text-on-surface-variant font-normal"> · 어제 숙소</span>}
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
