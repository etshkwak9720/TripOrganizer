# 참가자 앱 2단계 — 탭 셸 + 일정 + 갤러리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 참가자 화면을 하단 탭(지금·일정·미션·갤러리) 앱으로 만들고, 일정 탭과 갤러리 탭(사진 올리기 + 내 사진 삭제·교체)을 구현한다. 지금·미션 탭은 이후 단계용 자리표시자.

**Architecture:** 사진에 소유자 토큰(`owner`)을 붙여 본인 사진만 삭제 가능하게 하고, `Join.tsx`를 탭 셸로 재작성한다. 참가자는 입장 후 스냅샷을 주기적으로 `GET`으로 새로고침한다.

**Tech Stack:** 기존 Vite/React 클라이언트, Vercel Functions(`@vercel/blob` del), 1단계의 `GET /api/share/:id`.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-24-participant-full-app-design.md`
- api 파일 로컬 import는 `.js` 확장자(Vercel 프로덕션 ESM 규약).
- 참여 링크·QR에 비번 미포함(게이트 유지). 비번은 `localStorage`(`share-password:<shareId>`)에 저장(기존 규약).
- 사진 소유권: 기기 토큰(`localStorage` `photo-owner`, `crypto.randomUUID()`). 업로드/삭제 body의 `owner`로 검증. **본인 사진만** 삭제.
- 장소당 4장 상한 유지(삭제로 자리 회복).
- 읽기 전용(갤러리 업로드/삭제/교체 예외).

---

### Task 1: 사진 소유권 — `PhotoMeta.owner` + 삭제 API

**Files:**
- Modify: `src/share.ts`
- Modify: `api/_lib/blob.ts`
- Modify: `api/share/[shareId]/photos.ts`
- Modify: `scripts/smoke-share.mjs`

**Interfaces:**
- Produces: `PhotoMeta.owner?`, `delPhoto(url)`, `DELETE /api/share/:id/photos` (body `{ password, id, owner }`)

- [ ] **Step 1: `PhotoMeta`에 owner 추가**

`src/share.ts`의 `PhotoMeta` 인터페이스에 필드 추가:

```ts
export interface PhotoMeta {
  id: string;
  placeId: number | null;
  slotId: number | null;
  caption: string;
  ts: number;
  blobUrl: string;
  owner?: string; // 업로더 기기 토큰 — 본인 사진만 삭제 가능
}
```

- [ ] **Step 2: Blob 삭제 헬퍼**

`api/_lib/blob.ts`에 추가(기존 `put` import 옆):

```ts
import { del, put } from '@vercel/blob';

export async function delPhoto(url: string): Promise<void> {
  await del(url);
}
```

주의: 기존 `import { put } from '@vercel/blob';` 줄을 위의 `import { del, put }`로 교체(중복 import 금지).

- [ ] **Step 3: POST에 owner 저장 + DELETE 핸들러**

`api/share/[shareId]/photos.ts` 상단 import에 `delPhoto` 추가:

```ts
import { putPhoto, delPhoto } from '../../_lib/blob.js';
```

POST body 타입에 `owner?: string`를 추가하고, `meta` 생성 시 owner를 넣는다:

```ts
    const body = (req.body ?? {}) as {
      password?: string;
      placeId?: number | null;
      slotId?: number | null;
      caption?: string;
      fileBase64?: string;
      contentType?: string;
      owner?: string;
    };
```

```ts
    const meta: PhotoMeta = {
      id, placeId, slotId: body.slotId ?? null,
      caption: body.caption ?? '', ts: Date.now(), blobUrl: url, owner: body.owner,
    };
```

그리고 마지막 `res.status(405)` 앞에 DELETE 분기 추가:

```ts
  if (req.method === 'DELETE') {
    const body = (req.body ?? {}) as { password?: string; id?: string; owner?: string };
    const record = await authenticate(shareId, body.password);
    if (!record) {
      res.status(401).json({ error: '비밀번호가 틀렸습니다' });
      return;
    }
    const photos = (await kvClient.get<PhotoMeta[]>(photosKey(shareId))) ?? [];
    const target = photos.find((p) => p.id === body.id);
    if (!target) {
      res.status(404).json({ error: '사진을 찾을 수 없습니다' });
      return;
    }
    if (!target.owner || target.owner !== body.owner) {
      res.status(403).json({ error: '본인이 올린 사진만 삭제할 수 있습니다' });
      return;
    }
    await delPhoto(target.blobUrl).catch(() => {});
    await kvClient.set(photosKey(shareId), photos.filter((p) => p.id !== body.id));
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
```

- [ ] **Step 4: 스모크에 소유권 삭제 검증 추가**

`scripts/smoke-share.mjs`의 "5. 사진 업로드" 블록에서 업로드 body에 `owner`를 추가:

```js
res = await fetch(`${BASE}/api/share/${shareId}/photos`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password, placeId: 1, caption: '', fileBase64: tinyPngBase64, contentType: 'image/png', owner: 'owner-A' }),
});
check('사진 업로드 성공', res.ok, `status=${res.status}`);
const uploaded = (await res.json()).photo;
```

그리고 "6. 사진 목록 조회" 블록 다음에 삭제 소유권 검증을 추가:

```js
// 6b. 타인 소유 토큰으로 삭제 시도 → 403
res = await fetch(`${BASE}/api/share/${shareId}/photos`, {
  method: 'DELETE', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password, id: uploaded.id, owner: 'owner-B' }),
});
check('타인 사진 삭제 거부(403)', res.status === 403);
// 6c. 본인 토큰으로 삭제 → 성공
res = await fetch(`${BASE}/api/share/${shareId}/photos`, {
  method: 'DELETE', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password, id: uploaded.id, owner: 'owner-A' }),
});
check('본인 사진 삭제 성공', res.ok);
```

주의: 이 삭제로 placeId 1의 사진 수가 0이 되므로, 이어지는 "7. 장소당 4장 상한" 블록은
placeId 1에 다시 4장을 채워 5번째가 거부되는지 확인한다 — 기존 루프가 4장(1+3)만 올리던 것을
**4장 추가 업로드**로 맞춘다. 기존 `for (let i = 0; i < 3; i++)`를 `for (let i = 0; i < 4; i++)`로 바꾸고,
각 업로드 body에 `owner: 'owner-A'`를 추가한다(4장 채운 뒤 5번째가 400).

- [ ] **Step 5: 빌드 + E2E**

Run: `npm run build` → 에러 없음.
Run: (터미널1) `vercel dev`, (터미널2) `npm run test:share:e2e`
Expected: 신규 소유권 체크 포함 전부 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/share.ts api/_lib/blob.ts "api/share/[shareId]/photos.ts" scripts/smoke-share.mjs
git commit -m "feat: photo ownership tokens + owner-checked DELETE endpoint"
```

---

### Task 2: 참가자 탭 셸 + 일정 탭 (Join 재작성)

**Files:**
- Rewrite: `src/pages/Join.tsx`
- Test: `scripts/smoke-join.mjs`

**Interfaces:**
- Consumes: `GET /api/share/:id`(1단계), `POST /verify`, `ShareSnapshot`
- Produces: 하단 탭 셸(지금·일정·미션·갤러리), 일정 탭, 자동 새로고침, `ownerToken()`

- [ ] **Step 1: `Join.tsx` 전체 재작성**

`src/pages/Join.tsx`를 아래로 교체:

```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BANDS, isMealBand, type Band } from '../db';
import { Icon, Screen, TopBar } from '../ui';
import type { ShareSnapshot } from '../share';
import GalleryTab from './join/GalleryTab';

export function storageKey(shareId: string) {
  return `share-password:${shareId}`;
}

// 사진 소유자 식별용 기기 토큰(계정 없이 '내 사진'을 구분).
export function ownerToken(): string {
  let t = localStorage.getItem('photo-owner');
  if (!t) { t = crypto.randomUUID(); localStorage.setItem('photo-owner', t); }
  return t;
}

const TABS = [
  { key: 'now', label: '지금', icon: 'near_me' },
  { key: 'plan', label: '일정', icon: 'event_note' },
  { key: 'mission', label: '미션', icon: 'flag', gameOnly: true },
  { key: 'gallery', label: '갤러리', icon: 'photo_library' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default function Join() {
  const { shareId } = useParams<{ shareId: string }>();
  const [password, setPassword] = useState('');
  const [schedule, setSchedule] = useState<ShareSnapshot | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<TabKey>('plan');

  async function verify(pw: string) {
    setError('');
    const res = await fetch(`/api/share/${shareId}/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? '비밀번호가 틀렸습니다');
      return;
    }
    const body = await res.json();
    setSchedule(body.schedule);
    localStorage.setItem(storageKey(shareId!), pw);
  }

  async function refresh() {
    const pw = localStorage.getItem(storageKey(shareId!));
    if (!pw) return;
    const res = await fetch(`/api/share/${shareId}`, { headers: { 'x-trip-password': pw } });
    if (res.ok) setSchedule((await res.json()).schedule);
  }

  useEffect(() => {
    const saved = localStorage.getItem(storageKey(shareId!));
    if (saved) verify(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareId]);

  // 거의 실시간: 20초마다 + 창 포커스 시 최신 스냅샷 재조회.
  useEffect(() => {
    if (!schedule) return;
    const iv = setInterval(refresh, 20000);
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule === null, shareId]);

  if (!schedule) {
    return (
      <Screen>
        <TopBar title="여행 참여" />
        <div className="p-4 space-y-3">
          <input
            type="password"
            className="input"
            placeholder="여행 비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="btn-primary w-full" onClick={() => verify(password)}>입장</button>
          {error && <p className="text-[13px] text-red-600">{error}</p>}
        </div>
      </Screen>
    );
  }

  const tabs = TABS.filter((t) => !('gameOnly' in t && t.gameOnly) || schedule.trip.mode === 'game');

  return (
    <>
      <TopBar title={schedule.trip.title} />
      <main className="pb-20">
        {tab === 'plan' && <PlanTab schedule={schedule} />}
        {tab === 'gallery' && <GalleryTab shareId={shareId!} places={schedule.places} />}
        {tab === 'mission' && <ComingSoon label="미션·랭킹은 곧 제공됩니다" icon="flag" />}
        {tab === 'now' && <ComingSoon label="지금(위치·도착시간)은 곧 제공됩니다" icon="near_me" />}
      </main>

      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[520px] bg-surface border-t border-outline-variant/30 z-40"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex justify-around items-center h-16">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex flex-col items-center justify-center gap-0.5 w-full h-full ${tab === t.key ? 'text-primary-container' : 'text-tertiary'}`}>
              <Icon name={t.icon} fill={tab === t.key} />
              <span className="text-[11px] font-medium">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}

function PlanTab({ schedule }: { schedule: ShareSnapshot }) {
  const [day, setDay] = useState(0);
  const daySlots = schedule.slots.filter((s) => s.dayIndex === day);
  return (
    <>
      <div className="flex gap-2 px-4 pt-3 overflow-x-auto no-scrollbar">
        {Array.from({ length: schedule.trip.dayCount }).map((_, i) => (
          <button key={i} onClick={() => setDay(i)}
            className={`shrink-0 px-4 py-2 rounded-full text-[14px] font-semibold ${day === i ? 'bg-primary-container text-on-primary-container' : 'bg-surface-variant text-on-surface-variant'}`}>
            {i + 1}일차
          </button>
        ))}
      </div>
      <Screen>
        <div className="space-y-3">
          {(BANDS as Band[]).map((band) => {
            const entries = daySlots.filter((s) => s.band === band);
            if (entries.length === 0) return null;
            return (
              <div key={band} className="card p-3">
                <span className={`chip ${isMealBand(band) ? 'bg-emerald/10 text-emerald' : 'bg-primary-container/15 text-primary-container'}`}>{band}</span>
                {entries.map((s, i) => {
                  const place = s.placeId != null ? schedule.places.find((p) => p.id === s.placeId) : undefined;
                  return (
                    <p key={i} className="text-[14px] mt-1">
                      {s.plannedTime} — {place?.name ?? s.activityText ?? '미정'}
                    </p>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Screen>
    </>
  );
}

function ComingSoon({ label, icon }: { label: string; icon: string }) {
  return (
    <Screen>
      <div className="flex flex-col items-center justify-center text-center py-16 text-on-surface-variant">
        <Icon name={icon} className="text-[44px] text-outline mb-2" />
        <p className="text-[14px]">{label}</p>
      </div>
    </Screen>
  );
}
```

- [ ] **Step 2: 갤러리 자리표시자 생성** (Task 3에서 실제 구현)

Create `src/pages/join/GalleryTab.tsx`:

```tsx
import { Screen } from '../../ui';
import type { ShareSnapshot } from '../../share';

export default function GalleryTab(_props: { shareId: string; places: ShareSnapshot['places'] }) {
  return <Screen><p className="text-[14px] text-on-surface-variant py-8 text-center">갤러리 준비 중…</p></Screen>;
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 타입 에러 없이 통과.

- [ ] **Step 4: 참가자 셸 스모크 작성**

Create `scripts/smoke-join.mjs`:

```js
// 참가자 탭 셸 스모크: 입장 후 하단 탭(일정·갤러리) 전환이 되는지. /api는 스텁.
// 실행: npm run dev (다른 터미널) 후 node scripts/smoke-join.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const snapshot = {
  trip: { title: '스모크 참여여행', startDate: '2026-09-14', dayCount: 2, mode: 'game' },
  members: [], groups: [],
  places: [{ id: 1, name: '성산일출봉', region: '제주', kind: 'sight', lat: 33.4, lng: 126.9 }],
  slots: [{ dayIndex: 0, band: '오전', plannedTime: '09:00', order: 0, placeId: 1, activityText: '' }],
  missions: [], missionResults: [], adjustments: [], awards: null,
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript((snap) => {
  window.fetch = (url) => {
    if (typeof url === 'string' && url.includes('/verify')) return Promise.resolve(new Response(JSON.stringify({ schedule: snap }), { status: 200, headers: { 'content-type': 'application/json' } }));
    if (typeof url === 'string' && url.includes('/api/share/') && url.endsWith('/photos')) return Promise.resolve(new Response(JSON.stringify({ photos: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    if (typeof url === 'string' && url.includes('/api/share/')) return Promise.resolve(new Response(JSON.stringify({ schedule: snap }), { status: 200, headers: { 'content-type': 'application/json' } }));
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
}, snapshot);

await page.goto(`${BASE}/join/smoke-join`, { waitUntil: 'networkidle' });
await page.getByPlaceholder('여행 비밀번호').fill('1234');
await page.getByRole('button', { name: '입장' }).click();

await page.getByText('성산일출봉').first().waitFor({ timeout: 4000 }).catch(() => {});
check('입장 후 일정 탭에 장소 표시', await page.getByText('성산일출봉').first().isVisible());

check('하단 탭 4개(게임모드) 노출', (await page.getByRole('button', { name: '갤러리' }).count()) > 0);
await page.getByRole('button', { name: '갤러리' }).click();
await page.waitForTimeout(300);
check('갤러리 탭 전환됨', (await page.locator('body').innerText()).includes('갤러리 준비 중'));
await page.getByRole('button', { name: '지금' }).click();
check('지금 탭 자리표시자', (await page.locator('body').innerText()).includes('곧 제공'));

await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
process.exit(pass === results.length ? 0 : 1);
```

`package.json` scripts에 `"test:republish"` 다음 줄 추가:

```json
    "test:join": "node scripts/smoke-join.mjs",
```

- [ ] **Step 5: 실행해서 통과 확인**

Run: (터미널1) `npm run dev`, (터미널2) `npm run test:join`
Expected: `==== 4/4 PASS ====`

- [ ] **Step 6: Commit**

```bash
git add src/pages/Join.tsx src/pages/join/GalleryTab.tsx scripts/smoke-join.mjs package.json
git commit -m "feat: participant tab shell with 일정 tab + auto-refresh (지금/미션 placeholder)"
```

---

### Task 3: 갤러리 탭 (보기·올리기·내 사진 삭제/교체)

**Files:**
- Rewrite: `src/pages/join/GalleryTab.tsx`

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/share/:id/photos`, `compressPhoto`, `ownerToken`, `storageKey`
- Produces: 갤러리 탭 UI

- [ ] **Step 1: `GalleryTab` 구현**

`src/pages/join/GalleryTab.tsx`를 아래로 교체:

```tsx
import { useEffect, useRef, useState } from 'react';
import { compressPhoto } from '../../image';
import { Icon, Screen } from '../../ui';
import type { ShareSnapshot, PhotoMeta } from '../../share';
import { ownerToken, storageKey } from '../Join';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).slice((reader.result as string).indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export default function GalleryTab({ shareId, places }: { shareId: string; places: ShareSnapshot['places'] }) {
  const [photos, setPhotos] = useState<PhotoMeta[]>([]);
  const [filter, setFilter] = useState<number | 'all'>('all');
  const [error, setError] = useState('');
  const me = ownerToken();
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<{ placeId: number | null } | null>(null);
  const pw = () => localStorage.getItem(storageKey(shareId)) ?? '';

  async function load() {
    const res = await fetch(`/api/share/${shareId}/photos`, { headers: { 'x-trip-password': pw() } });
    if (res.ok) setPhotos((await res.json()).photos);
  }
  useEffect(() => { load(); const iv = setInterval(load, 20000); return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareId]);

  async function upload(file: File, placeId: number | null) {
    setError('');
    const compressed = await compressPhoto(file);
    const fileBase64 = await blobToBase64(compressed);
    const res = await fetch(`/api/share/${shareId}/photos`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw(), placeId, caption: '', fileBase64, contentType: compressed.type, owner: me }),
    });
    if (res.ok) load();
    else setError((await res.json().catch(() => ({}))).error ?? '업로드 실패');
  }

  async function remove(photo: PhotoMeta) {
    const res = await fetch(`/api/share/${shareId}/photos`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw(), id: photo.id, owner: me }),
    });
    if (res.ok) load();
    else setError((await res.json().catch(() => ({}))).error ?? '삭제 실패');
  }

  // 교체 = 기존 삭제(자리 확보) 후 같은 장소로 새 사진 선택 업로드
  async function replace(photo: PhotoMeta) {
    await remove(photo);
    replaceRef.current = { placeId: photo.placeId };
    fileRef.current?.click();
  }

  function onPick(file: File | undefined) {
    if (!file) return;
    const target = replaceRef.current;
    replaceRef.current = null;
    upload(file, target ? target.placeId : (filter === 'all' ? null : filter));
  }

  const shown = photos.filter((p) => filter === 'all' || p.placeId === filter);
  const placeName = (pid: number | null) => places.find((p) => p.id === pid)?.name ?? '장소 미지정';

  return (
    <>
      <div className="flex gap-2 px-4 pt-3 overflow-x-auto no-scrollbar">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>전체</FilterChip>
        {places.map((p) => (
          <FilterChip key={p.id} active={filter === p.id} onClick={() => setFilter(p.id)}>{p.name}</FilterChip>
        ))}
      </div>
      <Screen>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-[15px]">사진 ({shown.length})</h3>
          <button className="chip bg-primary-container text-on-primary-container" onClick={() => { replaceRef.current = null; fileRef.current?.click(); }}>
            <Icon name="add_a_photo" className="text-[16px]" /> 올리기
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onPick(e.target.files?.[0])} />
        </div>
        {error && <p className="text-[13px] text-red-600 mb-2">{error}</p>}
        {shown.length === 0 ? (
          <p className="text-[13px] text-on-surface-variant py-8 text-center">아직 사진이 없어요. 첫 사진을 올려보세요.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {shown.map((ph) => (
              <div key={ph.id} className="relative aspect-square rounded-lg overflow-hidden bg-surface-variant">
                <a href={ph.blobUrl} target="_blank" rel="noreferrer" download>
                  <img src={ph.blobUrl} alt={placeName(ph.placeId)} className="w-full h-full object-cover" />
                </a>
                <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/45 text-white text-[10px] font-medium max-w-[85%] truncate">{placeName(ph.placeId)}</span>
                {ph.owner === me && (
                  <div className="absolute bottom-1.5 right-1.5 flex gap-1">
                    <button onClick={() => replace(ph)} aria-label="교체" className="w-7 h-7 rounded-full bg-black/55 grid place-items-center text-white"><Icon name="swap_horiz" className="text-[16px]" /></button>
                    <button onClick={() => remove(ph)} aria-label="삭제" className="w-7 h-7 rounded-full bg-black/55 grid place-items-center text-white"><Icon name="delete" className="text-[16px]" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Screen>
    </>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-[13px] font-semibold ${active ? 'bg-primary-container text-on-primary-container' : 'bg-surface-variant text-on-surface-variant'}`}>
      {children}
    </button>
  );
}
```

- [ ] **Step 2: 아이콘 서브셋 재생성** (`swap_horiz` 신규)

Run: `npm run icons:subset`
Expected: "missing" 에러 없이 종료. `swap_horiz`·`add_a_photo`·`delete` 포함.

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 타입 에러 없이 통과.

- [ ] **Step 4: 갤러리 스모크 (소유 사진만 삭제 버튼)**

`scripts/smoke-join.mjs`에 갤러리 검증을 추가한다. `addInitScript`의 fetch 스텁을
사진 목록이 있는 버전으로 바꾸고(내 토큰 소유 1장 + 타인 소유 1장), 갤러리 탭에서
삭제 버튼이 **내 사진에만** 뜨는지 확인:

```js
// (addInitScript 안에서) photos 목록 스텁 — 내 소유 판별을 위해 localStorage photo-owner를 먼저 세팅
```

구체적으로, `page.goto` 전에 owner 토큰을 고정하고, `/photos` 스텁이 `[{id:'mine',owner:<고정토큰>,placeId:1,...},{id:'other',owner:'someone',placeId:1,...}]`를 반환하게 한 뒤:

```js
await page.getByRole('button', { name: '갤러리' }).click();
await page.waitForTimeout(400);
check('내 사진에만 삭제 버튼', (await page.getByRole('button', { name: '삭제' }).count()) === 1);
```

(구현 시 owner 고정: `addInitScript`에서 `localStorage.setItem('photo-owner','test-owner')` 후
`/photos` 스텁의 mine 사진 `owner:'test-owner'`로 맞춘다.)

- [ ] **Step 5: 실행해서 통과 확인**

Run: (터미널1) `npm run dev`, (터미널2) `npm run test:join`
Expected: 갤러리 체크 포함 전부 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/join/GalleryTab.tsx scripts/smoke-join.mjs public/assets/fonts/material-symbols-subset.woff2
git commit -m "feat: participant gallery tab (upload, my-photo delete/replace, place filter)"
```

---

### Task 4: 배포 검증

- [ ] **Step 1: 빌드 + 전체 스모크 회귀**

Run: `npm run build`
Run: (터미널1) `vercel dev`, (터미널2) `npm run test:share:e2e` → 소유권 삭제 포함 PASS.
Run: (터미널1) `npm run dev`, (터미널2) `npm run test:join` 및 `npm run test:share:ui` → PASS.

- [ ] **Step 2: 배포 + 별칭**

```bash
npx vercel --prod --yes
```
배포 후 최신 배포를 `triporganizer-app.vercel.app`로 alias(기존 방식).

- [ ] **Step 3: 실기기/브라우저 확인**

`https://triporganizer-app.vercel.app/join/<shareId>`에서 비번 입장 → 하단 탭(지금·일정·미션·갤러리)
전환, 일정 표시, 갤러리 올리기/내 사진 삭제·교체 동작 확인. (서비스워커 캐시 주의: 새로고침 필요할 수 있음)

---

## Self-Review Notes

- **스펙 커버리지(2단계)**: B(탭 셸) = Task 2; C-일정 = Task 2(PlanTab); C-갤러리 = Task 3;
  D(사진 소유권·삭제·교체) = Task 1(서버) + Task 3(UI); A-5(참가자 자동 새로고침) = Task 2(refresh).
  지금·미션 탭은 자리표시자(3·4단계에서 대체).
- **타입 일관성**: `ownerToken`/`storageKey`는 `Join.tsx`에서 export → `GalleryTab`에서 import.
  `PhotoMeta.owner`가 Task 1 정의와 Task 3 사용에서 일치.
- **플레이스홀더 없음**: 실제 코드/명령 포함. (Task 3 Step 4 스모크의 owner 고정 방식은 구현 지침으로 명시.)
- **4장 상한 회귀**: Task 1 Step 4에서 삭제로 자리 비운 뒤 상한 테스트를 4장 채움으로 조정.
