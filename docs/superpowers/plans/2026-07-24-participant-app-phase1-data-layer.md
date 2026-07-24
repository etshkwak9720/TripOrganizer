# 참가자 앱 1단계 — 데이터 계층 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 참가자 4탭 앱의 토대가 되는 데이터 계층을 만든다 — 확장된 공유 스냅샷(미션·랭킹 데이터 포함), 공용 랭킹 계산, 인솔자 자동 재발행, 참가자용 스냅샷 조회 API.

**Architecture:** `ShareSnapshot`에 groups(id)·places.learn·missions·missionResults·adjustments·awards를 추가하고, 순수 `computeRanking`을 `src/share.ts`에 둔다. `buildShareSnapshot`이 이들을 채우고, 인솔자 앱은 공유된 여행의 데이터 변경을 감지해 디바운스 재발행한다. 참가자 새로고침을 위한 `GET /api/share/:id`를 추가한다.

**Tech Stack:** 기존 Vite/React/Dexie 클라이언트, Vercel Functions(ioredis KV), dexie-react-hooks.

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-07-24-participant-full-app-design.md`
- `src/share.ts`는 서버에서도 import되므로 Dexie 런타임 코드를 넣지 않는다(타입은 `import type`만).
- api 파일의 로컬 import는 런타임 해석을 위해 `.js` 확장자를 쓴다(Vercel 프로덕션 ESM 규약).
- 비밀번호는 쿼리스트링 금지 — `GET`은 헤더 `x-trip-password`로 검증(기존 photos GET과 동일).
- 자동 재발행은 공유된 여행(`shareId`·`sharePassword` 존재)에서만, 디바운스 3초.

---

### Task 1: 스냅샷 타입 확장 + `computeRanking` (순수)

**Files:**
- Modify: `src/share.ts`
- Test: `scripts/test-share.mjs`

**Interfaces:**
- Consumes: `Mission`, `MissionResult`, `Adjustment`, `Award`, `Group` 타입(`./db.ts`, import type)
- Produces: 확장된 `ShareSnapshot`, `computeRanking(groups, missions, missionResults, adjustments)`

- [ ] **Step 1: 실패하는 테스트 작성** (`scripts/test-share.mjs`의 `await vite.close();` 앞에 추가)

```js
// --- computeRanking ---
const groups = [{ id: 1, name: 'A조' }, { id: 2, name: 'B조' }, { id: 3, name: 'C조' }];
const missions = [{ id: 10, points: 5 }, { id: 11, points: 3 }];
const missionResults = [
  { missionId: 10, groupId: 1, done: true },   // A +5
  { missionId: 11, groupId: 1, done: true },   // A +3 => 8
  { missionId: 10, groupId: 2, done: true },   // B +5
  { missionId: 11, groupId: 2, done: false },  // (미완료, 무시)
];
const adjustments = [{ groupId: 2, delta: 10 }, { groupId: 3, delta: -2 }]; // B +10 => 15, C -2
const ranked = share.computeRanking(groups, missions, missionResults, adjustments);
check('computeRanking: 1위는 B조(15점)', ranked[0].group.id === 2 && ranked[0].score === 15);
check('computeRanking: 2위는 A조(8점)', ranked[1].group.id === 1 && ranked[1].score === 8);
check('computeRanking: 3위는 C조(-2점)', ranked[2].group.id === 3 && ranked[2].score === -2);
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node scripts/test-share.mjs`
Expected: `share.computeRanking is not a function` 류로 새 체크 3개 실패.

- [ ] **Step 3: `ShareSnapshot` 확장 + `computeRanking` 구현**

`src/share.ts` 상단 import에 타입 추가:

```ts
import type { Place, Slot, Member, Group, Trip, Mission, MissionResult, Adjustment, Award } from './db.ts';
```

`ShareSnapshot` 타입을 아래로 교체:

```ts
export type ShareSnapshot = {
  trip: Pick<Trip, 'title' | 'startDate' | 'dayCount' | 'mode'>;
  members: Pick<Member, 'name' | 'groupId'>[];
  // id를 보존해 랭킹/미션 결과가 어느 그룹을 가리키는지 참가자 화면에서 찾을 수 있게 한다.
  groups: (Pick<Group, 'name'> & { id: number })[];
  // id를 보존해야 slots[].placeId가 이 배열의 어느 장소를 가리키는지 찾을 수 있다.
  places: (Pick<Place, 'name' | 'region' | 'kind' | 'address' | 'lat' | 'lng' | 'learn'> & { id: number })[];
  slots: Pick<Slot, 'dayIndex' | 'band' | 'plannedTime' | 'order' | 'placeId' | 'activityText'>[];
  missions: (Pick<Mission, 'placeId' | 'title' | 'type' | 'points' | 'safe'> & { id: number })[];
  missionResults: Pick<MissionResult, 'missionId' | 'groupId' | 'done'>[];
  adjustments: Pick<Adjustment, 'groupId' | 'delta' | 'reason' | 'ts'>[];
  awards: Pick<Award, 'firstGroupReward' | 'lastGroupPenalty'> | null;
};
```

파일 끝(마지막 export 뒤)에 `computeRanking` 추가:

```ts
export function computeRanking(
  groups: { id: number; name: string }[],
  missions: { id: number; points: number }[],
  missionResults: { missionId: number; groupId: number; done: boolean }[],
  adjustments: { groupId: number; delta: number }[],
): { group: { id: number; name: string }; score: number }[] {
  const points = new Map(missions.map((m) => [m.id, m.points]));
  const scoreOf = (gid: number) => {
    let s = 0;
    for (const r of missionResults) if (r.groupId === gid && r.done) s += points.get(r.missionId) ?? 0;
    for (const a of adjustments) if (a.groupId === gid) s += a.delta;
    return s;
  };
  return groups
    .map((g) => ({ group: g, score: scoreOf(g.id) }))
    .sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node scripts/test-share.mjs`
Expected: 기존 + 새 3개 모두 PASS(`==== N/N PASS ====`, fail 0).

- [ ] **Step 5: Commit**

```bash
git add src/share.ts scripts/test-share.mjs
git commit -m "feat: expand ShareSnapshot with missions/groups/awards and add computeRanking"
```

---

### Task 2: `buildShareSnapshot` 확장 + `Missions` DRY 리팩터

**Files:**
- Modify: `src/shareClient.ts`
- Modify: `src/pages/Missions.tsx:29-40`

**Interfaces:**
- Consumes: 확장된 `ShareSnapshot`, `computeRanking`(Task 1)
- Produces: 미션/그룹/상벌점/awards/learn을 채우는 `buildShareSnapshot`

- [ ] **Step 1: `buildShareSnapshot` 확장**

`src/shareClient.ts`의 `buildShareSnapshot` 함수 전체를 아래로 교체:

```ts
export async function buildShareSnapshot(tripId: number): Promise<ShareSnapshot> {
  const trip = await db.trips.get(tripId);
  if (!trip) throw new Error(`trip ${tripId} not found`);

  const [members, groups, places, slots, missions, missionResults, adjustments, award] =
    await Promise.all([
      db.members.where('tripId').equals(tripId).toArray(),
      db.groups.where('tripId').equals(tripId).toArray(),
      db.places.where('tripId').equals(tripId).toArray(),
      db.slots.where('tripId').equals(tripId).toArray(),
      db.missions.where('tripId').equals(tripId).toArray(),
      db.missionResults.where('tripId').equals(tripId).toArray(),
      db.adjustments.where('tripId').equals(tripId).toArray(),
      db.awards.get(tripId),
    ]);

  return {
    trip: { title: trip.title, startDate: trip.startDate, dayCount: trip.dayCount, mode: trip.mode },
    members: members.map((m) => ({ name: m.name, groupId: m.groupId })),
    groups: groups.map((g) => ({ id: g.id!, name: g.name })),
    places: places.map((p) => ({
      id: p.id!, name: p.name, region: p.region, kind: p.kind,
      address: p.address, lat: p.lat, lng: p.lng, learn: p.learn,
    })),
    slots: slots.map((s) => ({
      dayIndex: s.dayIndex, band: s.band, plannedTime: s.plannedTime,
      order: s.order, placeId: s.placeId, activityText: s.activityText,
    })),
    missions: missions.map((m) => ({
      id: m.id!, placeId: m.placeId, title: m.title, type: m.type, points: m.points, safe: m.safe,
    })),
    missionResults: missionResults.map((r) => ({ missionId: r.missionId, groupId: r.groupId, done: r.done })),
    adjustments: adjustments.map((a) => ({ groupId: a.groupId, delta: a.delta, reason: a.reason, ts: a.ts })),
    awards: award ? { firstGroupReward: award.firstGroupReward, lastGroupPenalty: award.lastGroupPenalty } : null,
  };
}
```

- [ ] **Step 2: `Missions.tsx`가 `computeRanking` 사용**

`src/pages/Missions.tsx`의 import에 추가:

```tsx
import { computeRanking } from '../share';
```

`src/pages/Missions.tsx:29-42`의 인라인 점수 계산 블록:

```tsx
  const missionById = new Map((missions ?? []).map((m) => [m.id!, m]));
  const scoreOf = (groupId: number) => {
    let s = 0;
    for (const r of results ?? []) {
      if (r.groupId === groupId && r.done) s += missionById.get(r.missionId)?.points ?? 0;
    }
    for (const a of adjustments ?? []) if (a.groupId === groupId) s += a.delta;
    return s;
  };
  const ranked = [...(groups ?? [])]
    .map((g) => ({ group: g, score: scoreOf(g.id!) }))
    .sort((a, b) => b.score - a.score);
  const firstId = ranked[0]?.group.id;
  const lastId = ranked.length > 1 ? ranked[ranked.length - 1].group.id : undefined;
```

을 아래로 교체:

```tsx
  const ranked = computeRanking(
    (groups ?? []).map((g) => ({ id: g.id!, name: g.name })),
    (missions ?? []).map((m) => ({ id: m.id!, points: m.points })),
    (results ?? []).map((r) => ({ missionId: r.missionId, groupId: r.groupId, done: r.done })),
    (adjustments ?? []).map((a) => ({ groupId: a.groupId, delta: a.delta })),
  );
  const firstId = ranked[0]?.group.id;
  const lastId = ranked.length > 1 ? ranked[ranked.length - 1].group.id : undefined;
```

주의: 이후 `ranked`는 `{ group: { id, name }, score }` 형태로 동일하게 쓰이므로 렌더 코드(`r.group.name`, `r.score`, `r.group.id`)는 그대로 동작한다.

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 타입 에러 없이 통과. (기존 스모크 `scripts/smoke-share.mjs`의 하드코딩 schedule은
새 필드가 optional이 아니므로 Task 3에서 함께 갱신한다 — 지금은 빌드만.)

- [ ] **Step 4: Commit**

```bash
git add src/shareClient.ts src/pages/Missions.tsx
git commit -m "feat: fill missions/groups/awards in snapshot; Missions uses shared computeRanking"
```

---

### Task 3: `GET /api/share/:shareId` 스냅샷 조회 + 스모크 갱신

**Files:**
- Modify: `api/share/[shareId].ts`
- Modify: `scripts/smoke-share.mjs`

**Interfaces:**
- Consumes: `shareKey`, `ShareRecord`(`src/share.ts`), `verifyPassword`, `kvClient`
- Produces: `GET /api/share/:shareId`(헤더 `x-trip-password`) → `{ schedule }`

- [ ] **Step 1: GET 핸들러 추가**

`api/share/[shareId].ts`의 `handler` 함수에서, 기존 `if (req.method !== 'POST')` 가드를
GET 분기로 바꾼다. 파일 상단 import에 `verifyPassword`가 이미 있으므로 그대로 쓰고,
아래처럼 method 처리를 교체:

```ts
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const shareId = req.query.shareId as string;
  if (!shareId) {
    res.status(400).json({ error: 'invalid request' });
    return;
  }

  if (req.method === 'GET') {
    const header = req.headers['x-trip-password'];
    const password = Array.isArray(header) ? header[0] : header;
    const record = await kvClient.get<ShareRecord>(shareKey(shareId));
    if (!record || !password || !(await verifyPassword(password, record.passwordHash))) {
      res.status(401).json({ error: '비밀번호가 틀렸습니다' });
      return;
    }
    res.status(200).json({ schedule: record.schedule });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const { password, schedule } = (req.body ?? {}) as { password?: string; schedule?: ShareSnapshot };
  if (!password || !schedule) {
    res.status(400).json({ error: 'invalid request' });
    return;
  }
  // ...(기존 POST 본문: existing 조회, 해시, verify, set) 그대로 유지...
```

주의: 기존 POST 본문의 `const shareId = ...`와 초기 `!shareId` 체크는 위로 옮겨졌으므로
POST 분기에서 중복 선언/검사를 제거한다. `verifyPassword` import가 없으면 상단에 추가
(`import { hashPassword, verifyPassword } from '../_lib/hash.js';`).

- [ ] **Step 2: 스모크에 새 스냅샷 필드 + GET 검증 추가**

`scripts/smoke-share.mjs`의 `schedule` 객체에 새 필드를 추가(빈 값이라도 타입 충족):

```js
const schedule = {
  trip: { title: '스모크 테스트 여행', startDate: '2026-08-01', dayCount: 1, mode: 'relaxed' },
  members: [], groups: [],
  places: [{ id: 1, name: '테스트 장소', region: '제주', kind: 'sight', lat: 33.4, lng: 126.9 }],
  slots: [{ dayIndex: 0, band: '오전', plannedTime: '10:00', order: 0, placeId: 1, activityText: '' }],
  missions: [], missionResults: [], adjustments: [], awards: null,
};
```

그리고 "3. 참가자 비번 검증" 블록 다음에 GET 검증을 추가:

```js
// 3b. GET 스냅샷 조회 (헤더 비번)
res = await fetch(`${BASE}/api/share/${shareId}`, { headers: { 'x-trip-password': password } });
const getBody = await res.json();
check('GET 스냅샷 조회 성공', res.ok && getBody.schedule?.trip?.title === '스모크 테스트 여행');
res = await fetch(`${BASE}/api/share/${shareId}`, { headers: { 'x-trip-password': 'wrong' } });
check('GET 오답 비번 거부', res.status === 401);
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 타입 에러 없이 통과.

- [ ] **Step 4: E2E 실행** (Vercel KV/Blob 연결된 `vercel dev` 필요)

Run: (터미널1) `vercel dev`, (터미널2) `npm run test:share:e2e`
Expected: 기존 + 새 2개 모두 PASS.

- [ ] **Step 5: Commit**

```bash
git add "api/share/[shareId].ts" scripts/smoke-share.mjs
git commit -m "feat: add GET /api/share/:id snapshot endpoint for participant refresh"
```

---

### Task 4: 인솔자 자동 재발행 훅 + 마운트

**Files:**
- Modify: `src/shareClient.ts`
- Modify: `src/App.tsx`
- Test: `scripts/smoke-republish.mjs`

**Interfaces:**
- Consumes: `db`, `publishShare`, `useLiveQuery`
- Produces: `useAutoRepublish(tripId: number)` 훅; `TripLayout`에서 마운트

- [ ] **Step 1: 훅 구현**

`src/shareClient.ts` 상단 import에 추가:

```ts
import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
```

파일 끝에 추가:

```ts
// 공유된 여행을 인솔자가 여는 동안, 관련 데이터 변경을 감지해 3초 디바운스 후 스냅샷을 재발행한다.
// 참가자 화면이 GET으로 최신 스냅샷을 받아가 거의 실시간 반영된다.
export function useAutoRepublish(tripId: number) {
  const trip = useLiveQuery(() => db.trips.get(tripId), [tripId]);
  const sig = useLiveQuery(async () => {
    const [places, slots, groups, missions, results, adjustments, award] = await Promise.all([
      db.places.where('tripId').equals(tripId).count(),
      db.slots.where('tripId').equals(tripId).toArray(),
      db.groups.where('tripId').equals(tripId).count(),
      db.missions.where('tripId').equals(tripId).toArray(),
      db.missionResults.where('tripId').equals(tripId).toArray(),
      db.adjustments.where('tripId').equals(tripId).count(),
      db.awards.get(tripId),
    ]);
    const slotSig = slots.map((s) => `${s.dayIndex}:${s.band}:${s.plannedTime}:${s.placeId}:${s.activityText}`).join('|');
    const misSig = missions.map((m) => `${m.id}:${m.points}:${m.title}`).join('|');
    const resSig = results.map((r) => `${r.missionId}:${r.groupId}:${r.done ? 1 : 0}`).join('|');
    return `${places}|${groups}|${adjustments}|${slotSig}|${misSig}|${resSig}|${award?.firstGroupReward}|${award?.lastGroupPenalty}`;
  }, [tripId]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const firstRef = useRef(true);

  useEffect(() => {
    if (!trip?.shareId || !trip?.sharePassword || sig === undefined) return;
    // 최초 렌더는 건너뛴다(이미 발행된 상태). 이후 변경부터 재발행.
    if (firstRef.current) { firstRef.current = false; return; }
    clearTimeout(timerRef.current);
    const pw = trip.sharePassword;
    timerRef.current = setTimeout(() => { publishShare(tripId, pw).catch(() => {}); }, 3000);
    return () => clearTimeout(timerRef.current);
  }, [sig, trip?.shareId, trip?.sharePassword, tripId]);
}
```

- [ ] **Step 2: `TripLayout`에서 마운트**

`src/App.tsx` 상단 import에 추가:

```tsx
import { useAutoRepublish } from './shareClient';
```

`TripLayout` 컴포넌트를 아래로 교체:

```tsx
function AutoRepublish() {
  const { id } = useParams();
  useAutoRepublish(id ? Number(id) : 0);
  return null;
}

function TripLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AutoRepublish />
      {children}
      <BottomTabs />
    </>
  );
}
```

주의: `useAutoRepublish(0)`은 `db.trips.get(0)`가 `undefined`라 effect가 no-op이므로 안전
(id 없는 경우 방어). `useParams`는 Routes 안이라 정상 동작.

- [ ] **Step 3: 자동 재발행 스모크 작성**

Create `scripts/smoke-republish.mjs`:

```js
// 자동 재발행 스모크: 공유된 여행에서 미션을 추가하면 /api/share POST가 자동으로 다시 나가는지.
// window.fetch를 스텁해 POST 호출을 기록. npm run dev(5173)만으로 실행.
// 실행: npm run dev (다른 터미널) 후 node scripts/smoke-republish.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(() => {
  window.__shareposts = 0;
  const orig = window.fetch;
  window.fetch = (url, opts) => {
    if (typeof url === 'string' && url.includes('/api/share/') && opts?.method === 'POST') {
      window.__shareposts++;
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    }
    return orig(url, opts);
  };
});
await page.goto(BASE, { waitUntil: 'networkidle' });

// 공유된 상태의 여행 시드(shareId·sharePassword 미리 세팅).
const tripId = await page.evaluate(async () => {
  const { db } = await import('/src/db.ts');
  const id = await db.trips.add({
    title: '재발행 스모크', startDate: '2026-09-14', dayCount: 1, mode: 'game',
    createdAt: Date.now(), shareId: 'republish-smoke', sharePassword: '1234',
  });
  await db.groups.add({ tripId: id, name: 'A조', score: 0 });
  return id;
});

// 인솔자 미션 페이지 열기 → 자동 재발행 훅 마운트.
await page.goto(`${BASE}/trip/${tripId}/missions`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const before = await page.evaluate(() => window.__shareposts);

// 미션 추가(데이터 변경) → 3초 디바운스 후 재발행 POST 기대.
await page.evaluate(async (id) => {
  const { db } = await import('/src/db.ts');
  await db.missions.add({ tripId: id, placeId: null, title: '테스트 미션', type: 'photo', points: 5, safe: true });
}, tripId);
await page.waitForTimeout(4000);
const after = await page.evaluate(() => window.__shareposts);
check('데이터 변경 시 자동 재발행 POST 발생', after > before, `before=${before} after=${after}`);

await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
process.exit(pass === results.length ? 0 : 1);
```

`package.json`의 `scripts`에 `"test:share:ui"` 다음 줄에 추가:

```json
    "test:republish": "node scripts/smoke-republish.mjs",
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: (터미널1) `npm run dev`, (터미널2) `npm run test:republish`
Expected: `==== 1/1 PASS ====`

- [ ] **Step 5: Commit**

```bash
git add src/shareClient.ts src/App.tsx scripts/smoke-republish.mjs package.json
git commit -m "feat: auto-republish trip snapshot on data changes (debounced)"
```

---

## Self-Review Notes

- **스펙 커버리지(1단계)**: A-1 스냅샷 확장 = Task 1·2; A-2 computeRanking = Task 1(+Missions 재사용 Task 2);
  A-3 자동 재발행 = Task 4; A-4 GET API = Task 3. A-5(참가자 자동 새로고침)는 참가자 앱이 소비자라
  2단계(탭 셸)에서 구현 — 이 플랜의 GET API가 그 전제.
- **타입 일관성**: `computeRanking` 시그니처가 Task 1 정의와 Task 2 호출에서 일치.
  `ShareSnapshot.groups`가 `{id,name}`로 바뀌었고, 기존 참가자 `Join.tsx`는 groups를 쓰지 않아 안전.
- **플레이스홀더 없음**: 모든 스텝에 실제 코드/명령/기대값 포함.
- **범위**: 데이터 계층만. 참가자 UI(탭·뷰)·사진 소유권/삭제는 후속 단계 플랜.
