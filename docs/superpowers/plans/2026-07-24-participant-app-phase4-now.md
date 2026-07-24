# 참가자 앱 4단계 — 지금 탭 (지도·본인 GPS 도착시간) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 참가자 "지금" 자리표시자를 실제 탭으로 대체한다 — 지도 + 오늘의 동선 + "다음 목적지까지 약 N분"(학생 본인 GPS 기준).

**Architecture:** 인솔자 `Live.tsx`를 건드리지 않고, 스냅샷(slots·places)에서 좌표 있는 정류장을 뽑아 `LiveMap`·`fetchRoute`·`estimateTravelMinutes`(모두 독립 유틸)를 재사용하는 자립형 `NowTab`을 만든다. 위치는 `navigator.geolocation`(본인). GPS→다음 목적지 경로/ETA를 계산하고 80m 이내 도착 시 다음 정류장으로 진행한다.

**Tech Stack:** 기존 Vite/React, `LiveMap`(react-leaflet), `geo.fetchRoute`, `mock.estimateTravelMinutes`.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-24-participant-full-app-design.md`
- 위치는 **학생 본인 GPS**(인솔자/그룹 위치 스트리밍 아님 — 결정됨).
- `Live.tsx`는 수정하지 않는다(회귀 위험 차단). 재사용은 독립 유틸(`LiveMap`/`fetchRoute`/`estimateTravelMinutes`)만.
- 데이터는 스냅샷에서만.

---

### Task 1: `NowTab` 컴포넌트 + 연결

**Files:**
- Create: `src/pages/join/NowTab.tsx`
- Modify: `src/pages/Join.tsx`
- Modify: `scripts/smoke-join.mjs`

**Interfaces:**
- Consumes: `LiveMap`/`MapPos`, `fetchRoute`/`RouteResult`, `estimateTravelMinutes`, `BANDS`, `ShareSnapshot`
- Produces: `NowTab({ schedule })`

- [ ] **Step 1: `NowTab` 작성**

Create `src/pages/join/NowTab.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { BANDS, type Band } from '../../db';
import { estimateTravelMinutes } from '../../mock';
import { fetchRoute, type RouteResult } from '../../geo';
import LiveMap, { type MapPos } from '../../components/LiveMap';
import { Icon, Screen, EmptyState } from '../../ui';
import type { ShareSnapshot } from '../../share';

type SnapPlace = ShareSnapshot['places'][number];
interface Stop { place: SnapPlace; time: string; band: Band }

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

  const stops: Stop[] = useMemo(() => {
    const byId = new Map(schedule.places.map((p) => [p.id, p]));
    return schedule.slots
      .filter((s) => s.dayIndex === day && s.placeId != null && byId.has(s.placeId))
      .sort((a, b) => BANDS.indexOf(a.band) - BANDS.indexOf(b.band) || (a.order ?? 0) - (b.order ?? 0))
      .map((s) => ({ place: byId.get(s.placeId!)!, time: s.plannedTime, band: s.band }));
  }, [schedule, day]);

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
  const pos = gps;

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
  const lastArriveRef = useRef<number | null>(null);
  const leftTargetRef = useRef(false);

  useEffect(() => {
    setTargetIdx(0); setLeg(null); lastArriveRef.current = null; leftTargetRef.current = false;
    legFetchRef.current = { t: 0, lat: 0, lng: 0, idx: -1 };
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
      const km = haversineKm(pos.lat, pos.lng, dest.lat, dest.lng);
      setLeg({
        coords: [[pos.lat, pos.lng], [dest.lat, dest.lng]],
        durationMin: estimateTravelMinutes({ name: '현재 위치', lat: pos.lat, lng: pos.lng }, target.place),
        distanceKm: km, estimated: true,
      });
    });
    return () => { on = false; };
  }, [pos?.lat, pos?.lng, targetIdx, coordsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pos || !target) return;
    const d = haversineKm(pos.lat, pos.lng, target.place.lat!, target.place.lng!);
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
  }, [pos, target, targetIdx, coordStops.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
                pos={pos}
                targetIdx={targetIdx}
              />
            </div>

            <section className="card p-4 mb-3">
              {gpsErr ? (
                <p className="text-[13px] text-error font-semibold flex items-center gap-1"><Icon name="location_off" className="text-[16px]" /> 위치 권한을 허용하면 도착 시간이 표시돼요</p>
              ) : done ? (
                <div className="text-center py-3"><Icon name="celebration" className="text-[40px] text-primary-container" /><p className="font-head font-bold mt-1">오늘 일정 완료!</p></div>
              ) : !pos ? (
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
                    <span className="text-[13px] font-semibold text-on-surface-variant w-12">{s.time}</span>
                    <span className={`font-medium ${i === targetIdx ? 'text-primary-container' : ''}`}>{s.place.kind === 'food' ? '🍜 ' : ''}{s.place.name}</span>
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
```

주의: `estimateTravelMinutes`가 받는 인자 형태는 `Live.tsx`와 동일하게 `{ name, lat, lng }` 구조.
`schedule.places[]`는 `id/name/lat/lng/kind/learn`을 포함(1단계에서 `learn` 추가).

- [ ] **Step 2: `Join.tsx`에서 자리표시자 대체**

`src/pages/Join.tsx` 상단 import에 추가:

```tsx
import NowTab from './join/NowTab';
```

`{tab === 'now' && <ComingSoon label="지금(위치·도착시간)은 곧 제공됩니다" icon="near_me" />}` 를 교체:

```tsx
        {tab === 'now' && <NowTab schedule={schedule} />}
```

(이제 `ComingSoon`은 더 이상 사용처가 없다 — `src/pages/Join.tsx`에서 `ComingSoon` 함수 정의를 삭제한다.)

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 타입 에러 없이 통과. (`directions_car`·`celebration`·`explore`·`location_off`·`menu_book`·
`notifications_active`는 인솔자 `Live.tsx`에서 이미 서브셋에 포함 — 아이콘 재생성 불필요.)

- [ ] **Step 4: 스모크에 지금 탭 검증 추가**

`scripts/smoke-join.mjs`에서 지오로케이션을 부여하고(정류장 근처지만 80m 밖), OSRM 경로 요청은
실패시켜 직선 추정치 폴백이 나오게 한 뒤, 지금 탭 렌더를 확인한다.

`browser.newPage()`를 지오로케이션 컨텍스트로 교체:

```js
const context = await browser.newContext({
  geolocation: { latitude: 33.41, longitude: 126.91 }, // 성산일출봉(33.4,126.9) 근처, 80m 밖
  permissions: ['geolocation'],
});
const page = await context.newPage();
```

`addInitScript`의 fetch 스텁에 OSRM 실패를 추가(직선 폴백 유도) — 스텁 함수 안 첫 분기로:

```js
    if (s.includes('router.project-osrm.org')) return Promise.resolve(new Response('{}', { status: 500 }));
```

그리고 "지금 탭 자리표시자" 체크를 실제 렌더 확인으로 교체:

```js
await page.getByRole('button', { name: '지금' }).click();
await page.waitForTimeout(1500);
const nowText = await page.locator('body').innerText();
check('지금 탭: 오늘의 동선 표시', nowText.includes('오늘의 동선') && nowText.includes('성산일출봉'));
check('지금 탭: 지도 렌더', (await page.locator('.leaflet-container').count()) > 0);
```

- [ ] **Step 5: 실행해서 통과 확인**

Run: (터미널1) `npm run dev`, (터미널2) `npm run test:join`
Expected: 지금 탭 2개 포함 전부 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/join/NowTab.tsx src/pages/Join.tsx scripts/smoke-join.mjs
git commit -m "feat: participant now tab (map + route + own-GPS ETA to next stop)"
```

---

### Task 2: 배포 검증 + PR 마무리 준비

- [ ] **Step 1: 빌드 + 회귀 스모크**

Run: `npm run build`
Run: (터미널1) `npm run dev`, (터미널2) `npm run test:join`, `npm run test:share:ui`, `npm run test:map` → 전부 PASS (`test:map`으로 인솔자 Live 회귀 없음 확인).

- [ ] **Step 2: 배포 + 별칭**

```bash
npx vercel --prod --yes
```
배포 후 최신 배포를 `triporganizer-app.vercel.app`로 alias.

- [ ] **Step 3: 실기기 확인**

`https://triporganizer-app.vercel.app/join/<shareId>` 지금 탭에서 지도·동선·"다음 목적지 약 N분"이
본인 위치 기준으로 뜨는지 확인(실기기 GPS 권장). 서비스워커 캐시 주의(새로고침).

- [ ] **Step 4: (선택) PR 본문 갱신**

참가자 4탭(지금·일정·미션·갤러리) 완성을 PR #2 설명에 반영.

---

## Self-Review Notes

- **스펙 커버리지(4단계)**: C-지금(지도 + 동선 + 본인 GPS 도착시간) = Task 1. `Live.tsx` 미수정(회귀 차단),
  독립 유틸(`LiveMap`/`fetchRoute`/`estimateTravelMinutes`)만 재사용.
- **중복 인정(YAGNI/DRY 트레이드오프)**: GPS/타깃팅 글루 ~80줄이 Live와 겹치나, 검증된 인솔자 화면을
  재작성하는 위험보다 자립형 NowTab이 안전. `test:map`으로 Live 회귀도 확인.
- **타입 일관성**: `SnapPlace`(스냅샷 place)는 `estimateTravelMinutes`/`LiveMap`이 요구하는 name/lat/lng/kind를 만족.
- **플레이스홀더 없음**: 실제 코드/명령 포함. 지오로케이션·OSRM 폴백은 스모크에 명시.
