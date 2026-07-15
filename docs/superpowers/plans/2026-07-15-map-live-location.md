# 지도·실시간 위치 + 식당 통합 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 식당 추천(목업)을 제거하고, 식당을 좌표 있는 장소로 통합하며, Live 페이지에 실제 지도(목적지·내 위치·도로 경로·남은 시간)를 넣는다.

**Architecture:** 외부 지오 서비스(Nominatim 검색, OSRM 경로)는 `src/geo.ts` 한 모듈에 격리. 지도는 Leaflet+OSM(`src/components/LiveMap.tsx`, `src/components/PlacePicker.tsx`). 데이터는 Dexie v5로 마이그레이션(Place.kind 추가, meals/mealId 삭제).

**Tech Stack:** React 19 + TypeScript + Vite + Dexie + Tailwind. 신규: leaflet, react-leaflet, @types/leaflet.

**Spec:** `docs/superpowers/specs/2026-07-15-map-live-location-design.md`

## Global Constraints

- `npm run build`(tsc -b && vite build)가 매 태스크 끝에 통과해야 한다.
- 신규 의존성은 leaflet, react-leaflet, @types/leaflet 3개만.
- Nominatim/OSRM 호출은 `src/geo.ts` 밖에서 직접 fetch하지 않는다 (카카오 교체 지점).
- API 키·가입이 필요한 서비스 금지.
- UI 문구는 한국어, 기존 클래스(`card`, `chip`, `input`, `btn-primary`, `btn-ghost`) 재사용.
- 커밋 메시지 말미: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: 의존성 + geo 모듈 + Leaflet 셋업

**Files:**
- Modify: `package.json` (deps)
- Create: `src/geo.ts`
- Create: `src/leaflet.ts`
- Create: `scripts/test-geo.mjs`

**Interfaces:**
- Produces: `geocodeSearch(query: string): Promise<GeoCandidate[]>`, `fetchRoute(pts: {lat:number;lng:number}[]): Promise<RouteResult|null>`, `interface GeoCandidate { name; address; lat; lng }`, `interface RouteResult { coords: [number,number][]; durationMin: number; distanceKm: number; estimated?: boolean }`, `src/leaflet.ts`(부수효과 모듈: CSS+기본 아이콘 픽스)

- [ ] **Step 1: 의존성 설치**

```powershell
Set-Location C:\Users\tenda\yeojeong-app; npm install leaflet react-leaflet; npm install -D @types/leaflet
```
Expected: added N packages, 오류 없음.

- [ ] **Step 2: 실패하는 테스트 작성** — `scripts/test-geo.mjs`

```js
// geo.ts 단위 테스트: fetch를 목킹해 파싱·폴백 로직 검증.
// 실행: npm run build 후 node scripts/test-geo.mjs (dist가 아닌 tsx 소스를 직접 못 읽으므로
// vite-node 대신 esbuild 없는 간단한 방법: tsc 산출물이 없으니 동적 import는 불가.
// -> geo.ts는 브라우저 전용이 아니므로 Node에서 직접 읽을 수 있게 tsx 없이 순수 TS.
// Node 22는 TS를 직접 실행 못 하므로, 여기서는 dev 의존성 추가 없이
// fetch 목킹 + 로직 복제 대신 vite의 SSR 로더를 쓴다:
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true } });
const geo = await vite.ssrLoadModule('/src/geo.ts');

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name} ${extra}`);
  ok ? pass++ : fail++;
};

// --- geocodeSearch: 정상 응답 파싱 ---
globalThis.fetch = async () => new Response(JSON.stringify([
  { display_name: '성산일출봉, 성산읍, 서귀포시, 제주특별자치도, 대한민국', name: '성산일출봉', lat: '33.4581', lon: '126.9426' },
]), { status: 200 });
const cands = await geo.geocodeSearch('성산일출봉');
check('geocode: 후보 1개 파싱', cands.length === 1);
check('geocode: 좌표 숫자 변환', cands[0].lat === 33.4581 && cands[0].lng === 126.9426);
check('geocode: name 추출', cands[0].name === '성산일출봉');

// --- geocodeSearch: 실패 시 throw ---
globalThis.fetch = async () => new Response('', { status: 503 });
let threw = false;
try { await geo.geocodeSearch('x'); } catch { threw = true; }
check('geocode: HTTP 실패 시 throw', threw);

// --- fetchRoute: 정상 응답 → [lat,lng] 변환 + 분 단위 ---
globalThis.fetch = async () => new Response(JSON.stringify({
  routes: [{ geometry: { coordinates: [[126.9, 33.4], [126.95, 33.45]] }, duration: 720, distance: 12000 }],
}), { status: 200 });
const route = await geo.fetchRoute([{ lat: 33.4, lng: 126.9 }, { lat: 33.45, lng: 126.95 }]);
check('route: coords lat,lng 순서', route.coords[0][0] === 33.4 && route.coords[0][1] === 126.9);
check('route: duration 분 반올림', route.durationMin === 12);
check('route: distance km', route.distanceKm === 12);

// --- fetchRoute: 네트워크 실패 → null ---
globalThis.fetch = async () => { throw new Error('offline'); };
check('route: 실패 시 null', (await geo.fetchRoute([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }])) === null);

// --- fetchRoute: 좌표 1개 → null ---
check('route: 좌표 부족 시 null', (await geo.fetchRoute([{ lat: 1, lng: 1 }])) === null);

await vite.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: 실패 확인**

```powershell
Set-Location C:\Users\tenda\yeojeong-app; node scripts/test-geo.mjs
```
Expected: FAIL — `/src/geo.ts` 로드 실패 (파일 없음).

- [ ] **Step 4: `src/geo.ts` 구현**

```ts
// External geo services, isolated here so a later swap to Kakao APIs
// touches only this file.
export interface GeoCandidate {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export interface RouteResult {
  coords: [number, number][]; // [lat, lng] polyline
  durationMin: number;
  distanceKm: number;
  estimated?: boolean;        // true = straight-line fallback, not road data
}

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';

// Name/address -> up to 5 candidates (Korea-biased, Korean labels).
export async function geocodeSearch(query: string): Promise<GeoCandidate[]> {
  const url = `${NOMINATIM}?format=jsonv2&limit=5&accept-language=ko&countrycodes=kr&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`geocode failed: ${res.status}`);
  const rows = (await res.json()) as { display_name: string; name?: string; lat: string; lon: string }[];
  return rows.map((r) => ({
    name: r.name || r.display_name.split(',')[0].trim(),
    address: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
  }));
}

// Road route through the given waypoints. null = caller should fall back
// (offline, server error, or fewer than 2 points).
export async function fetchRoute(pts: { lat: number; lng: number }[]): Promise<RouteResult | null> {
  if (pts.length < 2) return null;
  const coords = pts.map((p) => `${p.lng},${p.lat}`).join(';');
  try {
    const res = await fetch(`${OSRM}/${coords}?overview=full&geometries=geojson`);
    if (!res.ok) return null;
    const json = await res.json();
    const route = json.routes?.[0];
    if (!route) return null;
    return {
      coords: route.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng] as [number, number]),
      durationMin: Math.max(1, Math.round(route.duration / 60)),
      distanceKm: route.distance / 1000,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: `src/leaflet.ts` 구현** (지도 컴포넌트 공용 부수효과 모듈)

```ts
// Shared Leaflet setup: CSS + default marker icons (bundlers break the
// default icon URL resolution, so wire the assets explicitly).
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });
```

`src/vite-env.d.ts`가 없으면 (png import 타입 오류 시) 생성:
```ts
/// <reference types="vite/client" />
```

- [ ] **Step 6: 테스트 통과 확인**

```powershell
Set-Location C:\Users\tenda\yeojeong-app; node scripts/test-geo.mjs
```
Expected: `8 passed, 0 failed`

- [ ] **Step 7: 빌드 확인**

```powershell
Set-Location C:\Users\tenda\yeojeong-app; npm run build
```
Expected: `✓ built` (leaflet.ts는 아직 참조가 없어도 tsc -b가 타입 검사함)

- [ ] **Step 8: Commit**

```powershell
git add package.json package-lock.json src/geo.ts src/leaflet.ts scripts/test-geo.mjs src/vite-env.d.ts
git commit -m "feat: add geo module (Nominatim/OSRM) and Leaflet setup"
```

---

### Task 2: 식당 추천 제거 + DB v5 마이그레이션

**Files:**
- Modify: `src/db.ts` (Place.kind/address 추가, Meal·meals·mealId 삭제, v5)
- Modify: `src/mock.ts` (MOCK_MEALS·seedMealsIfEmpty·PRICE_LABEL·getJejuCoords 삭제)
- Modify: `src/main.tsx` (seedMealsIfEmpty 호출 제거)
- Modify: `src/pages/Schedule.tsx` (MealPicker·MealRow·추천 UI 제거)
- Modify: `src/pages/Itinerary.tsx` (추천 표시 제거)
- Modify: `src/pages/Setup.tsx` (getJejuCoords 제거 — 임시로 좌표 없이 추가)
- Modify: `scripts/e2e-import.mjs:129` (mealId 참조 제거)
- Modify: `scripts/shots.mjs` (mealId 시드 → activityText)

**Interfaces:**
- Produces: `Place { kind: PlaceKind; address?: string }`, `type PlaceKind = 'sight' | 'food'`, `Slot`에서 `mealId` 제거, `hasContent`에서 mealId 검사 제거. `mock.ts`는 `estimateTravelMinutes`만 export.

- [ ] **Step 1: db.ts 수정**

`Place`/`Slot`/스키마 변경 (기존 코드 대비 diff):

```ts
export type PlaceKind = 'sight' | 'food';

export interface Place {
  id?: number;
  tripId: number;
  name: string;
  region: string;
  kind: PlaceKind;     // NEW: 방문지/식당 구분
  address?: string;    // NEW: 검색 결과 표시 주소
  lat?: number;
  lng?: number;
  learn?: string;
}
```

`Slot`에서 `mealId?: number | null;` 줄 삭제. `hasContent` 교체:
```ts
export const hasContent = (s: Slot) => !!s.placeId || !!s.activityText?.trim();
```

`Meal` 인터페이스 전체 삭제, 클래스에서 `meals!: Table<Meal, number>;` 삭제, 생성자에 추가:
```ts
    this.version(5).stores({
      meals: null, // drop mock recommendation table
    }).upgrade(async (tx) => {
      await tx.table('places').toCollection().modify((p) => { if (!p.kind) p.kind = 'sight'; });
      // mealId: 추천 선택 시 이름이 activityText로 복사돼 있으므로 필드만 버린다
      await tx.table('slots').toCollection().modify((s) => { delete s.mealId; });
    });
```

- [ ] **Step 2: mock.ts 정리** — 파일 전체를 아래로 교체

```ts
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
```

- [ ] **Step 3: main.tsx** — `import { seedMealsIfEmpty } from './mock';` 와 `seedMealsIfEmpty();` 두 줄 삭제.

- [ ] **Step 4: Schedule.tsx 추천 제거**

- import에서 `type Meal` 제거, `import { PRICE_LABEL } from '../mock';` 줄 삭제.
- `Entry`에서: `const [pickMeal, setPickMeal] = useState(false);`, `const chosenMeal = useLiveQuery(...)` 삭제. meal 분기의 `추천 보기` 버튼과 `{chosenMeal && (...)}` 블록, `{pickMeal && <MealPicker .../>}` 블록 삭제. meal 분기를 다음으로 교체(식당 선택은 Task 4에서 추가 — 지금은 메모+사진만):

```tsx
      {meal ? (
        <input
          className="input text-[14px]"
          placeholder="식사 장소/메뉴 입력 (예: 갈치조림)"
          value={slot.activityText ?? ''}
          onChange={(e) => db.slots.update(slot.id!, { activityText: e.target.value })}
        />
      ) : (
```

- 파일 하단의 `MealRow`, `type SortKey`, `MealPicker` 함수 전체 삭제.

- [ ] **Step 5: Itinerary.tsx 추천 제거**

- import에서 `type Meal` 제거. `const meals = useLiveQuery(...)`, `const mealById = ...` 삭제.
- `TimelineItem` 호출부에서 `meal={meal}` prop과 그 계산 삭제. `TimelineItem` 시그니처에서 `meal?: Meal` 제거.
- isMeal 분기를 다음으로 교체:

```tsx
        {isMeal ? (
          <p className="font-head font-bold">{activity || '식사 내용이 없습니다.'}</p>
        ) : place ? (
```

- [ ] **Step 6: Setup.tsx** — `import { getJejuCoords } from '../mock';` 삭제, Places의 AddRow onAdd를 다음으로 교체:

```tsx
      <AddRow placeholder="방문 장소 이름 (예: 성산일출봉)" onAdd={(name) => {
        db.places.add({ tripId, name, region: '', kind: 'sight' });
      }} />
```

- [ ] **Step 7: 스크립트 참조 정리**

- `scripts/e2e-import.mjs:129`: `const filled = slots3.filter((s) => s.placeId || s.activityText);`
- `scripts/shots.mjs`: 슬롯 시드에서 `mealId: 2` → `activityText: '성산 해녀의 집'`, `mealId: 1` → `activityText: '올레국수'`, `mealId: 3` → `activityText: '흑돼지 명가'` (57·59·61행). meals 테이블 시드 코드가 있으면 삭제.

- [ ] **Step 8: 빌드 + 수동 확인**

```powershell
Set-Location C:\Users\tenda\yeojeong-app; npm run build
```
Expected: `✓ built`. tsc가 남은 Meal/mealId/PRICE_LABEL 참조를 잡아내면 모두 제거.

dev 서버에서 일정 짜기 화면 열어 "추천 보기" 버튼이 사라지고 식사 입력·사진 버튼이 동작하는지 확인.

- [ ] **Step 9: Commit**

```powershell
git add -A
git commit -m "feat: remove mock meal recommendations, add Place.kind (db v5)"
```

---

### Task 3: PlacePicker 컴포넌트 + 구성(Setup) 연동

**Files:**
- Create: `src/components/PlacePicker.tsx`
- Modify: `src/pages/Setup.tsx` (Places 탭: 지도 검색 버튼, 수동 위경도 입력 제거, kind·주소·좌표없음 표시)

**Interfaces:**
- Consumes: `geocodeSearch`, `GeoCandidate` (`src/geo.ts`), `src/leaflet.ts`
- Produces: `PlacePicker({ title, initialName?, onSave, onClose })` — `onSave(p: PickedPlace)`, `interface PickedPlace { name: string; address: string; lat?: number; lng?: number }`. 좌표 없이 저장 가능(lat/lng undefined).

- [ ] **Step 1: PlacePicker.tsx 작성**

```tsx
import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
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
```

`L` 타입을 위해 상단에 `import type L from 'leaflet';` 추가 (dragend 캐스팅용).

- [ ] **Step 2: Setup.tsx Places 탭 연동**

- import 추가: `import PlacePicker from '../components/PlacePicker';` / `import { useState } from 'react';` (이미 있음)
- `Places` 컴포넌트를 다음으로 교체:

```tsx
function Places({ tripId }: { tripId: number }) {
  const places = useLiveQuery(() => db.places.where('tripId').equals(tripId).toArray(), [tripId]);
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null); // placeId being re-pinned
  const editTarget = places?.find((p) => p.id === editing);

  return (
    <div>
      <button className="btn-primary w-full mb-3 flex items-center justify-center gap-1" onClick={() => setAdding(true)}>
        <Icon name="add_location_alt" /> 장소 추가 (지도 검색)
      </button>
      {places?.length === 0 && <EmptyState icon="add_location_alt" title="장소를 추가하세요" hint="일정에 넣을 방문지를 등록해요" />}
      <ul className="space-y-2">
        {places?.map((p) => (
          <li key={p.id} className="card p-3">
            <div className="flex items-center gap-3">
              <Icon name={p.kind === 'food' ? 'restaurant' : 'place'} className={p.kind === 'food' ? 'text-emerald' : 'text-primary-container'} />
              <div className="flex-1 min-w-0">
                <span className="font-medium block truncate">
                  {p.name}
                  {p.kind === 'food' && <span className="ml-1 text-[10px] text-emerald font-bold">식당</span>}
                </span>
                {p.lat != null && p.lng != null ? (
                  <span className="text-[10px] text-emerald font-semibold">📍 {p.lat.toFixed(4)}, {p.lng.toFixed(4)}</span>
                ) : (
                  <button onClick={() => setEditing(p.id!)} className="text-[10px] text-error font-semibold">좌표 없음 — 지도에서 찾기</button>
                )}
              </div>
              <button onClick={() => setEditing(p.id!)} className="text-outline" aria-label="지도에서 찾기">
                <Icon name="edit_location_alt" className="text-[20px]" />
              </button>
              <button onClick={() => setOpen(open === p.id ? null : p.id!)} className="text-outline">
                <Icon name={open === p.id ? 'expand_less' : 'expand_more'} />
              </button>
              <button onClick={() => db.places.delete(p.id!)} className="text-outline"><Icon name="delete" className="text-[20px]" /></button>
            </div>
            {open === p.id && (
              <div className="mt-3 space-y-2 pl-8">
                {p.address && <p className="text-[11px] text-on-surface-variant">{p.address}</p>}
                <input className="input" placeholder="지역 (예: 서귀포시)" defaultValue={p.region}
                  onChange={(e) => db.places.update(p.id!, { region: e.target.value })} />
                <textarea className="input text-[13px]" rows={3} placeholder="장소 안내 — 의미·유래·문화유산 선정 이유·학습 콘텐츠"
                  defaultValue={p.learn ?? ''} onChange={(e) => db.places.update(p.id!, { learn: e.target.value })} />
              </div>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <PlacePicker
          title="장소 추가"
          onClose={() => setAdding(false)}
          onSave={async (v) => {
            await db.places.add({ tripId, name: v.name, region: '', kind: 'sight', address: v.address || undefined, lat: v.lat, lng: v.lng });
            setAdding(false);
          }}
        />
      )}
      {editing != null && editTarget && (
        <PlacePicker
          title="위치 찾기"
          initialName={editTarget.name}
          onClose={() => setEditing(null)}
          onSave={async (v) => {
            await db.places.update(editing, { name: v.name, address: v.address || undefined, lat: v.lat, lng: v.lng });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
```

(AddRow는 Members/Groups가 계속 사용 — 삭제하지 말 것.)

- [ ] **Step 3: 빌드 + 수동 확인**

```powershell
Set-Location C:\Users\tenda\yeojeong-app; npm run build
```
Expected: `✓ built`

dev 서버에서: 구성→장소→"장소 추가" → "성산일출봉" 검색 → 후보 선택 → 지도 핀 표시·드래그 → 저장 → 목록에 📍 좌표 표시.

- [ ] **Step 4: Commit**

```powershell
git add src/components/PlacePicker.tsx src/pages/Setup.tsx
git commit -m "feat: PlacePicker with Nominatim search and pin adjust; wire into Setup"
```

---

### Task 4: 식사 슬롯 ↔ 식당(장소) 연결

**Files:**
- Modify: `src/pages/Schedule.tsx` (식사 슬롯: 식당 선택 + 식당 등록 + 메뉴 메모)
- Modify: `src/pages/Itinerary.tsx` (식사 항목에 식당 이름·메뉴 표시)

**Interfaces:**
- Consumes: `PlacePicker`(Task 3), `Place.kind === 'food'`, `Slot.placeId`
- Produces: 식사 슬롯의 `placeId`가 식당 장소를 가리킴 — Live(Task 5)의 경로 계산이 이를 그대로 사용.

- [ ] **Step 1: Schedule.tsx 식사 분기 교체**

- import 추가: `import PlacePicker from '../components/PlacePicker';`
- `Entry`에 상태 추가: `const [pickerOpen, setPickerOpen] = useState(false);`
- Task 2에서 단순화한 meal 분기를 다음으로 교체:

```tsx
      {meal ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <select
              className="input text-[14px] flex-1"
              value={slot.placeId ?? ''}
              onChange={(e) => db.slots.update(slot.id!, { placeId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">식당 선택…</option>
              {places.filter((p) => p.kind === 'food').map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.region ? ` (${p.region})` : ''}</option>
              ))}
            </select>
            <button
              onClick={() => setPickerOpen(true)}
              className="chip bg-emerald/10 text-emerald shrink-0 flex items-center gap-1 text-[12px] px-2.5"
            >
              <Icon name="add_location_alt" className="text-[14px]" /> 식당 등록
            </button>
          </div>
          <input
            className="input text-[14px]"
            placeholder="메뉴 메모 (예: 꼬막비빔밥)"
            value={slot.activityText ?? ''}
            onChange={(e) => db.slots.update(slot.id!, { activityText: e.target.value })}
          />
        </div>
      ) : (
```

- `SlotPhotoManager` 아래에 추가:

```tsx
      {pickerOpen && (
        <PlacePicker
          title="식당 등록"
          onClose={() => setPickerOpen(false)}
          onSave={async (v) => {
            const pid = await db.places.add({
              tripId: slot.tripId, name: v.name, region: '', kind: 'food',
              address: v.address || undefined, lat: v.lat, lng: v.lng,
            });
            await db.slots.update(slot.id!, { placeId: pid });
            setPickerOpen(false);
          }}
        />
      )}
```

- [ ] **Step 2: Itinerary.tsx 식사 표시 교체**

isMeal 분기(Task 2에서 단순화한 것)를 다음으로 교체 — `place`는 기존 `placeById(slot.placeId)` 결과가 이미 prop으로 전달됨:

```tsx
        {isMeal ? (
          <div>
            <p className="font-head font-bold">{place ? place.name : (activity || '식사 내용이 없습니다.')}</p>
            {place && activity && <p className="text-[12px] text-on-surface-variant mt-0.5">메뉴: {activity}</p>}
            {place?.region && <p className="text-[12px] text-on-surface-variant">{place.region}</p>}
          </div>
        ) : place ? (
```

- [ ] **Step 3: 빌드 + 수동 확인**

```powershell
Set-Location C:\Users\tenda\yeojeong-app; npm run build
```
Expected: `✓ built`

dev 서버: 일정 짜기 → 중식 → "식당 등록" → 검색·핀·저장 → 셀렉트에 자동 선택됨 → 메뉴 메모 입력 → 일정 탭에서 식당 이름+메뉴 표시. 사진 버튼으로 음식 사진 첨부 확인.

- [ ] **Step 4: Commit**

```powershell
git add src/pages/Schedule.tsx src/pages/Itinerary.tsx
git commit -m "feat: link meal slots to food places via PlacePicker"
```

---

### Task 5: LiveMap + Live 페이지 실시간 내비게이션

**Files:**
- Create: `src/components/LiveMap.tsx`
- Modify: `src/pages/Live.tsx` (전면 재작성)

**Interfaces:**
- Consumes: `fetchRoute`, `RouteResult`(Task 1), `estimateTravelMinutes`(mock.ts), `Place.kind`
- Produces: `LiveMap({ stops, route, leg, pos, targetIdx })` — `stops: { name; lat; lng; food?: boolean }[]`, `route`/`leg`: `[lat,lng][] | null`, `pos: { lat; lng; acc? } | null`

- [ ] **Step 1: LiveMap.tsx 작성**

```tsx
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
```

- [ ] **Step 2: Live.tsx 전면 재작성**

```tsx
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
        return Math.min(p + deltaMin / segMin, coordStops.length - 1);
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

  useEffect(() => {
    setTargetIdx(0); setProgress(0); setPlaying(false); setLeg(null);
    lastArriveRef.current = null; legFetchRef.current = { t: 0, lat: 0, lng: 0, idx: -1 };
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

  // arrival: within radius of target -> banner + vibrate + advance
  useEffect(() => {
    if (!pos || !target) return;
    const d = haversineKm(pos.lat, pos.lng, target.place.lat!, target.place.lng!);
    if (d >= ARRIVE_KM || lastArriveRef.current === target.place.id) return;
    lastArriveRef.current = target.place.id!;
    fireAlert(`📍 ${target.place.name} 도착! (${target.band} · ${target.time})`);
    if (targetIdx < coordStops.length - 1) setTargetIdx(targetIdx + 1);
  }, [pos, target, targetIdx, coordStops.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
                <button onClick={() => { setProgress(0); setPlaying(false); setTargetIdx(0); lastArriveRef.current = null; }}
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
```

- [ ] **Step 3: 빌드 + 수동 확인**

```powershell
Set-Location C:\Users\tenda\yeojeong-app; npm run build
```
Expected: `✓ built`

dev 서버에서: 좌표 있는 장소 2곳 이상 일정에 넣고 "지금" 탭 →
1) 지도에 번호 마커 + 점선(하루 경로) 표시,
2) 시뮬 전환 → 이동 시작 → 파란 점이 움직이고 주황 실선(다음 구간)·남은 분 갱신,
3) 목적지 근접 시 도착 배너, 다음 목적지로 전환,
4) GPS 모드에서 권한 거부 시 안내+시뮬 전환 버튼.

- [ ] **Step 4: Commit**

```powershell
git add src/components/LiveMap.tsx src/pages/Live.tsx
git commit -m "feat: live map with real-time position, OSRM routes, ETA and arrival alerts"
```

---

### Task 6: SW 타일 캐시 + e2e 정비 + 전체 검증

**Files:**
- Modify: `src/sw.js` (OSM 타일 런타임 캐시)
- Modify: `scripts/e2e.mjs` (식당 추천 단계 → 식당 등록 흐름)
- Create: `scripts/e2e-map.mjs`
- Modify: `package.json` (scripts에 `"test:map": "node scripts/e2e-map.mjs"` 추가)

**Interfaces:**
- Consumes: Task 1~5 전부. e2e는 Nominatim/OSRM을 `page.route`로 목킹 — 실서버 호출 없음.

- [ ] **Step 1: sw.js 타일 캐시**

`fetch` 핸들러의 `if (req.method !== 'GET' || ...origin...) return;` 앞에 삽입:

```js
  // OSM tiles: cache-first with a size cap, so previously-seen map areas
  // keep working offline.
  if (req.method === 'GET' && /tile\.openstreetmap\.org/.test(req.url)) {
    event.respondWith(tileCacheFirst(req));
    return;
  }
```

파일 하단에 추가:

```js
const TILE_CACHE = 'osm-tiles-v1';
const TILE_MAX = 300;

async function tileCacheFirst(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(req, res.clone());
      const keys = await cache.keys();
      if (keys.length > TILE_MAX) {
        await Promise.all(keys.slice(0, keys.length - TILE_MAX).map((k) => cache.delete(k)));
      }
    }
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}
```

activate 핸들러의 캐시 정리 필터를 `keys.filter((k) => k !== CACHE && k !== TILE_CACHE)` 로 수정 (타일 캐시가 activate마다 지워지지 않게).

- [ ] **Step 2: e2e.mjs 식당 단계 교체**

기존 6번 섹션(식당 추천: 80~101행 부근)을 다음으로 교체. 파일 상단 page 생성 직후에 목킹 추가:

```js
// mock external geo services — e2e must not hit public servers
await page.route('**nominatim.openstreetmap.org/**', (route) =>
  route.fulfill({ json: [{ display_name: '올레국수, 제주시, 제주특별자치도', name: '올레국수', lat: '33.4996', lon: '126.5312' }] }));
await page.route('**router.project-osrm.org/**', (route) =>
  route.fulfill({ json: { routes: [{ geometry: { coordinates: [[126.53, 33.49], [126.94, 33.45]] }, duration: 1800, distance: 45000 }] } }));
```

6번 섹션:

```js
// ---------- 6. schedule: meal slot -> register restaurant ----------
await page.getByRole('button', { name: /식당 등록/ }).first().click();
await page.getByPlaceholder('이름/주소로 검색 (예: 성산일출봉)').fill('올레국수');
await page.getByText('올레국수', { exact: false }).first().click();
await page.getByRole('button', { name: '저장' }).click();
const slotData = await page.evaluate(() => new Promise((r) => {
  const q = indexedDB.open('yeojeong');
  q.onsuccess = () => { q.result.transaction('slots').objectStore('slots').getAll().onsuccess = (e) =>
    r(e.target.result.map((s) => ({ b: s.band, p: s.placeId }))); };
}));
check('일정: 식당 장소 연결 저장', slotData.some((s) => s.b === '조식' && s.p));
const foodPlace = await page.evaluate(() => new Promise((r) => {
  const q = indexedDB.open('yeojeong');
  q.onsuccess = () => { q.result.transaction('places').objectStore('places').getAll().onsuccess = (e) =>
    r(e.target.result.find((p) => p.kind === 'food')); };
}));
check('식당 장소 kind=food + 좌표', !!foodPlace && foodPlace.lat != null);
```

(조식 밴드가 첫 식당 등록 버튼이 되도록 기존 시나리오 흐름에 맞춰 조정. 셀렉터가 실제 DOM과 다르면 placeholder/텍스트를 앱 그대로 맞출 것.)

- [ ] **Step 3: e2e-map.mjs 작성**

```js
// Live map e2e: seeds a trip via IndexedDB, mocks OSRM, checks map render,
// sim playback and arrival banner. Run: npm run test:map (dev server must be up)
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${name} ${extra}`); ok ? pass++ : fail++; };

const browser = await chromium.launch();
const page = await browser.newPage();

await page.route('**router.project-osrm.org/**', (route) =>
  route.fulfill({ json: { routes: [{ geometry: { coordinates: [[126.4914, 33.5104], [126.9426, 33.4581]] }, duration: 3600, distance: 60000 }] } }));
// map tiles: empty png so no OSM traffic
await page.route('**tile.openstreetmap.org/**', (route) =>
  route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') }));

await page.goto(BASE);
await page.evaluate(() => new Promise((resolve, reject) => {
  const q = indexedDB.open('yeojeong');
  q.onerror = () => reject(q.error);
  q.onsuccess = () => {
    const dbi = q.result;
    const tx = dbi.transaction(['trips', 'places', 'slots'], 'readwrite');
    tx.objectStore('trips').put({ id: 1, title: '맵테스트', startDate: '2026-07-20', dayCount: 1, mode: 'relaxed', createdAt: Date.now() });
    tx.objectStore('places').put({ id: 1, tripId: 1, name: '제주공항', region: '', kind: 'sight', lat: 33.5104, lng: 126.4914 });
    tx.objectStore('places').put({ id: 2, tripId: 1, name: '성산일출봉', region: '', kind: 'sight', lat: 33.4581, lng: 126.9426 });
    tx.objectStore('slots').put({ id: 1, tripId: 1, dayIndex: 0, band: '오전', plannedTime: '10:00', order: 0, placeId: 1, activityText: '' });
    tx.objectStore('slots').put({ id: 2, tripId: 1, dayIndex: 0, band: '오후', plannedTime: '14:30', order: 0, placeId: 2, activityText: '' });
    tx.oncomplete = () => resolve();
  };
}));

await page.goto(`${BASE}/trip/1/live`);
await page.waitForSelector('.leaflet-container', { timeout: 10000 }).catch(() => {});
check('지도 렌더', await page.locator('.leaflet-container').count() === 1);
check('목적지 마커 2개', await page.locator('.leaflet-marker-icon').count() === 2);

// switch to simulation and play at max speed
await page.getByRole('button', { name: /실 GPS|시뮬/ }).click();
await page.getByRole('button', { name: '12x' }).click();
await page.getByRole('button', { name: /이동 시작/ }).click();
check('경로선 표시', await page.locator('.leaflet-overlay-pane path').count() >= 1);
const arrived = await page.getByText(/도착!/).waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
check('시뮬 주행 → 도착 배너', arrived);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

package.json scripts에 추가: `"test:map": "node scripts/e2e-map.mjs"`

- [ ] **Step 4: 전체 검증**

```powershell
Set-Location C:\Users\tenda\yeojeong-app; npm run build; node scripts/test-geo.mjs
```
Expected: `✓ built`, `8 passed`

dev 서버 켜고:
```powershell
npm run test:map; npm run test:e2e
```
Expected: 두 스크립트 모두 `0 failed`. e2e.mjs의 다른 단계(가져오기·미션 등)가 UI 변경으로 깨지면 셀렉터를 현 DOM에 맞게 수정.

- [ ] **Step 5: Commit + push**

```powershell
git add -A
git commit -m "feat: OSM tile runtime cache; update e2e for map and restaurant flow"
git push
```

---

## Self-Review 결과

- **스펙 커버리지:** §1 데이터모델→Task 2, §2 추천 제거→Task 2, §3 PlacePicker→Task 3·4, §4 Live 지도→Task 5, §5 에러 처리→Task 3(검색 실패)·5(권한/OSRM 폴백/좌표 없음)·6(타일 캐시), §6 테스트→Task 1·6. 누락 없음.
- **플레이스홀더:** 없음 (모든 단계에 실제 코드/커맨드 포함).
- **타입 일관성:** `RouteResult.coords: [lat,lng][]` — geo.ts 생산, LiveMap `route`/`leg` 소비 일치. `PickedPlace.lat?: number` — Setup·Schedule 저장부 일치. `MapPos` re-export 사용 일치.
