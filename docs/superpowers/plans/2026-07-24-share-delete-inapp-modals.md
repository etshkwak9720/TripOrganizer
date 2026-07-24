# 공유·삭제 인앱 모달 (네이티브 팝업 제거) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여행 목록의 공유·삭제를 브라우저 기본 대화상자(`prompt`/`confirm`/`alert`) 대신 앱 내부 바텀시트 모달로 처리해, 모바일 PWA·인앱 브라우저에서도 동작하게 한다.

**Architecture:** `publishShare`에서 `window.prompt`를 제거해 비밀번호를 인자로 받도록 순수화하고, `Trips.tsx`에 `ShareDialog`(비번 입력→게시→링크/복사/공유/QR 결과)와 `ConfirmDialog`(삭제 확인)를 추가한다. 모달 상태는 `Trips` 상위 컴포넌트가 관리한다. QR은 오프라인 안전을 위해 `qrcode.react`(인라인 SVG)를 번들한다.

**Tech Stack:** 기존 Vite/React/Dexie 클라이언트, `qrcode.react`(신규), Playwright 스모크.

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-07-24-share-delete-inapp-modals-design.md`
- 네이티브 `window.prompt`/`window.confirm`/`window.alert`를 이 기능 경로에서 **완전히 제거**한다.
- 참여 링크(`/join/:shareId`)에 **비밀번호를 포함하지 않는다**(게이트 유지). 비번은 별도 표기·공유 텍스트에만 포함.
- 외부 CDN 금지 — QR 라이브러리는 번들되는 npm 패키지만 사용(인라인 SVG 렌더).
- 모달 스타일은 기존 `CreateForm` 바텀시트 패턴 재사용: `fixed inset-0 z-50 flex items-end justify-center bg-black/40` + 내부 `w-full max-w-[520px] bg-surface rounded-t-2xl p-5 pb-8`.
- `navigator.share`/`navigator.clipboard` 미지원 브라우저에서 안전하게 폴백(버튼 숨김/조용히 무시).
- 기존 스크립트 컨벤션: 브라우저 필요한 것은 Playwright 스모크(`scripts/smoke-*.mjs`), `check()`로 pass/fail 집계 후 `process.exit(pass === total ? 0 : 1)`.

---

### Task 1: QR 라이브러리 의존성 추가

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `qrcode.react`(런타임 의존성) — `QRCodeSVG` 컴포넌트 제공

- [ ] **Step 1: 의존성 추가**

`package.json`의 `dependencies`에 추가(알파벳 순, `leaflet` 앞):

```json
    "ioredis": "^5.4.1",
    "leaflet": "^1.9.4",
    "qrcode.react": "^4.2.0",
    "react": "^19.2.7",
```

주의: `ioredis`/`leaflet`/`react` 줄은 이미 존재한다 — `qrcode.react` 한 줄만 새로 끼워 넣는다.

- [ ] **Step 2: 설치**

Run: `npm install`
Expected: `qrcode.react`가 `node_modules`에 설치되고 `package-lock.json` 갱신, 에러 없이 종료.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add qrcode.react for share QR codes"
```

---

### Task 2: `publishShare` 순수화 (비밀번호를 인자로)

`window.prompt`를 제거하고 비밀번호를 호출부에서 받는다. 이 함수는 Dexie(IndexedDB)에 의존해
Node 단위 테스트가 어려우므로, 동작 검증은 Task 5의 브라우저 스모크에서 한다(여기서는 빌드만).

**Files:**
- Modify: `src/shareClient.ts`

**Interfaces:**
- Consumes: `db`, `genShareId`, `buildShareSnapshot`
- Produces: `publishShare(tripId: number, password: string): Promise<{ url: string; password: string }>`
  (기존 시그니처 `publishShare(tripId)` → 2번째 인자 `password` 추가, 내부 `window.prompt` 제거)

- [ ] **Step 1: 함수 교체**

`src/shareClient.ts`의 `publishShare` 함수 전체를 아래로 교체:

```ts
// 처음 공유하거나, 이미 공유된 여행을 다시 공유(갱신)할 때 호출한다.
// 비밀번호는 호출부(공유 모달)에서 받아 넘긴다. 반환값은 참가자에게 보낼 URL.
export async function publishShare(
  tripId: number,
  password: string,
): Promise<{ url: string; password: string }> {
  const trip = await db.trips.get(tripId);
  if (!trip) throw new Error(`trip ${tripId} not found`);
  if (!password) throw new Error('비밀번호가 필요합니다');

  const shareId = trip.shareId ?? genShareId();
  const schedule = await buildShareSnapshot(tripId);
  const res = await fetch(`/api/share/${shareId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password, schedule }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? '공유에 실패했습니다');
  }

  await db.trips.update(tripId, { shareId, sharePassword: password } satisfies Partial<Trip>);
  return { url: `${window.location.origin}/join/${shareId}`, password };
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 타입 에러. `src/pages/Trips.tsx`가 아직 옛 시그니처(`publishShare(trip.id!)`)로 호출하므로
"Expected 2 arguments, but got 1" 류 에러가 난다 — Task 4에서 호출부를 고치면 해소된다.
(이 태스크 단독 커밋은 Task 4와 함께 진행하므로 여기서는 커밋하지 않는다.)

---

### Task 3: 삭제 확인 모달 (`ConfirmDialog`) + 삭제 버튼 연결

**Files:**
- Modify: `src/pages/Trips.tsx`

**Interfaces:**
- Consumes: `deleteTrip`(기존 `../db`), `Icon`
- Produces: `ConfirmDialog` 컴포넌트, `Trips`의 `deleteTarget` 상태

- [ ] **Step 1: `ConfirmDialog` 컴포넌트 추가**

`src/pages/Trips.tsx` 파일 끝(마지막 `}` 뒤)에 추가:

```tsx
function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-[520px] bg-surface rounded-t-2xl p-5 pb-8 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-head font-bold text-[20px]">{title}</h2>
        <p className="text-[14px] text-on-surface-variant whitespace-pre-line">{message}</p>
        <div className="flex gap-3">
          <button className="btn-tonal flex-1" onClick={onClose}>취소</button>
          <button
            className="flex-1 py-3 rounded-md bg-error text-on-error font-semibold active:scale-95 transition"
            onClick={() => { onConfirm(); onClose(); }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

주의: `btn-tonal`/`bg-error`/`text-on-error`가 프로젝트 CSS(`src/index.css`, `tailwind.config.js`)에
없으면, 취소 버튼은 `className="flex-1 py-3 rounded-md bg-surface-variant text-on-surface-variant font-semibold"`,
삭제 버튼 색은 `bg-red-600 text-white`로 대체한다(빌드 후 화면에서 확인).

- [ ] **Step 2: `Trips`에 삭제 상태 + 모달 렌더 연결**

`src/pages/Trips.tsx`의 `Trips` 컴포넌트에서:

(a) 기존 `handleDelete`(window.confirm 사용) 함수를 **삭제**하고, `const [creating, setCreating] = useState(false);` 아래에 상태 추가:

```tsx
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; title: string } | null>(null);
```

(b) `activeTrips.map`/`finishedTrips.map`의 `<TripCard ... onDelete={handleDelete} />`를
`onDelete={(id, title) => setDeleteTarget({ id, title })}`로 교체(두 곳 모두).

(c) `{creating && <CreateForm .../>}` 다음 줄에 모달 렌더 추가:

```tsx
        {deleteTarget && (
          <ConfirmDialog
            title="여행 삭제"
            message={`'${deleteTarget.title}' 여행의 모든 데이터(사진·일정·미션 등)가 삭제되며 되돌릴 수 없습니다.`}
            confirmLabel="삭제"
            onConfirm={() => deleteTrip(deleteTarget.id)}
            onClose={() => setDeleteTarget(null)}
          />
        )}
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: Task 2의 `publishShare` 인자 에러는 여전히 남지만, `ConfirmDialog`/`deleteTarget` 관련
새 타입 에러는 없어야 한다. (공유 버튼은 Task 4에서 정리)

---

### Task 4: 공유 모달 (`ShareDialog`) + 공유 버튼 연결

**Files:**
- Modify: `src/pages/Trips.tsx`

**Interfaces:**
- Consumes: `publishShare`(Task 2), `db`, `Icon`, `QRCodeSVG`(`qrcode.react`)
- Produces: `ShareDialog` 컴포넌트, `Trips`의 `shareTripId` 상태

- [ ] **Step 1: import 추가**

`src/pages/Trips.tsx` 상단 import 구역에 추가:

```tsx
import { QRCodeSVG } from 'qrcode.react';
```

`publishShare`는 이미 import되어 있다(기존 `import { publishShare } from '../shareClient';`).

- [ ] **Step 2: `TripCard` 공유 버튼을 콜백으로 교체**

`TripCard`의 시그니처에 `onShare` 추가:

```tsx
function TripCard({
  trip,
  isFinished,
  onShare,
  onDelete,
}: {
  trip: TripWithStats;
  isFinished: boolean;
  onShare: (tripId: number) => void;
  onDelete: (id: number, title: string) => void;
}) {
```

기존 "여행 공유" 버튼(내부에서 `publishShare`+`clipboard`+`alert`를 직접 부르던 `<button>`)의
`onClick`을 아래로 교체(나머지 className/아이콘은 유지):

```tsx
          onClick={(e) => {
            e.stopPropagation();
            onShare(trip.id!);
          }}
```

- [ ] **Step 3: `Trips`에서 공유 상태 + 모달 렌더 + TripCard 연결**

(a) `deleteTarget` 상태 옆에 추가:

```tsx
  const [shareTripId, setShareTripId] = useState<number | null>(null);
```

(b) 두 곳의 `<TripCard ... />`에 `onShare={(id) => setShareTripId(id)}` prop 추가.

(c) `ConfirmDialog` 렌더 블록 옆(같은 위치)에 추가:

```tsx
        {shareTripId != null && (
          <ShareDialog tripId={shareTripId} onClose={() => setShareTripId(null)} />
        )}
```

- [ ] **Step 4: `ShareDialog` 컴포넌트 추가**

`src/pages/Trips.tsx` 파일 끝에 추가:

```tsx
function ShareDialog({ tripId, onClose }: { tripId: number; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<'input' | 'result'>('input');
  const [result, setResult] = useState<{ url: string; password: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share;

  async function doPublish(pw: string) {
    setError('');
    setBusy(true);
    try {
      const r = await publishShare(tripId, pw);
      setResult(r);
      setPhase('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : '공유에 실패했습니다');
    } finally {
      setBusy(false);
    }
  }

  // 이미 공유된 여행이면 저장된 비번으로 바로 결과 화면(재입력 없이 최신 일정으로 갱신).
  useEffect(() => {
    let alive = true;
    db.trips.get(tripId).then((t) => {
      if (alive && t?.sharePassword) doPublish(t.sharePassword);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  function copy() {
    if (!result) return;
    navigator.clipboard?.writeText(`${result.url}\n비밀번호: ${result.password}`).catch(() => {});
  }

  function share() {
    if (!result) return;
    navigator.share?.({ title: '여행 공유', text: `${result.url}\n비밀번호: ${result.password}` }).catch(() => {});
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-[520px] bg-surface rounded-t-2xl p-5 pb-8 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-head font-bold text-[20px]">여행 공유</h2>
          <button onClick={onClose} className="text-outline"><Icon name="close" /></button>
        </div>

        {phase === 'input' && (
          <>
            <div>
              <label className="field-label">공유 비밀번호</label>
              <input
                type="text"
                className="input"
                placeholder="참가자에게 알려줄 비밀번호"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
              <p className="text-[12px] text-on-surface-variant mt-1">
                이 비밀번호를 아는 사람만 일정을 보고 사진을 올릴 수 있어요.
              </p>
            </div>
            {error && <p className="text-[13px] text-red-600">{error}</p>}
            <button
              className="btn-primary w-full"
              disabled={busy || !password.trim()}
              onClick={() => doPublish(password.trim())}
            >
              {busy ? '공유 중…' : '공유하기'}
            </button>
          </>
        )}

        {phase === 'result' && result && (
          <div className="space-y-3">
            <div className="rounded-md bg-surface-variant/40 p-3 space-y-1 break-all">
              <p className="text-[12px] text-on-surface-variant">참여 링크</p>
              <p className="text-[14px] font-medium">{result.url}</p>
              <p className="text-[12px] text-on-surface-variant mt-2">비밀번호</p>
              <p className="text-[16px] font-bold tracking-wide">{result.password}</p>
            </div>

            <div className="grid place-items-center py-2">
              <QRCodeSVG value={result.url} size={168} />
              <p className="text-[12px] text-on-surface-variant mt-2">QR을 스캔하면 참여 페이지가 열려요</p>
            </div>

            <div className="flex gap-2">
              <button className="btn-tonal flex-1 flex items-center justify-center gap-1" onClick={copy}>
                <Icon name="content_copy" className="text-[16px]" /> 복사
              </button>
              {canNativeShare && (
                <button className="btn-primary flex-1 flex items-center justify-center gap-1" onClick={share}>
                  <Icon name="ios_share" className="text-[16px]" /> 공유하기
                </button>
              )}
            </div>
          </div>
        )}

        {phase === 'result' && !result && busy && (
          <p className="text-[14px] text-on-surface-variant py-4 text-center">공유 준비 중…</p>
        )}
      </div>
    </div>
  );
}
```

주의: `btn-tonal`이 CSS에 없으면 복사 버튼 className을
`"flex-1 py-3 rounded-md bg-surface-variant text-on-surface-variant font-semibold flex items-center justify-center gap-1"`로 대체.
아이콘 `content_copy`는 서브셋 자동 수집 대상이라 Task 5 빌드 전 `npm run icons:subset` 재생성이 필요할 수 있다(Step 참고).

- [ ] **Step 5: 아이콘 서브셋 재생성**

새 아이콘(`content_copy`)이 폰트 서브셋에 없으면 글자로 렌더된다. 재생성:

Run: `npm run icons:subset`
Expected: `NN icons: …` 출력, "missing" 에러 없이 종료. `content_copy`/`close`/`ios_share`가 포함됨.

- [ ] **Step 6: 빌드 확인**

Run: `npm run build`
Expected: 타입 에러 없이 통과(Task 2의 인자 에러가 이 태스크의 호출부 수정으로 해소됨).

- [ ] **Step 7: Commit (Task 2·3·4 함께)**

```bash
git add src/shareClient.ts src/pages/Trips.tsx public/assets/fonts/material-symbols-subset.woff2
git commit -m "feat: replace native share/delete dialogs with in-app modals (link, copy, native share, QR)"
```

---

### Task 5: 브라우저 스모크 테스트 + 검증

`window.prompt`/`confirm`에 의존하지 않으므로 전 흐름을 Playwright로 자동 검증할 수 있다.
서버(`/api`) 왕복은 `window.fetch`를 스텁해 `npm run dev`(vite, 5173)만으로 돌린다.

**Files:**
- Create: `scripts/smoke-share-ui.mjs`
- Modify: `package.json`(스크립트 등록)

**Interfaces:**
- Consumes: 실행 중인 `npm run dev`(기본 5173, `BASE_URL`로 override)

- [ ] **Step 1: 스크립트 등록**

`package.json`의 `scripts`에서 `"test:share:e2e"` 다음 줄에 추가:

```json
    "test:share:ui": "node scripts/smoke-share-ui.mjs",
```

- [ ] **Step 2: 스모크 작성**

Create `scripts/smoke-share-ui.mjs`:

```js
// 공유·삭제 인앱 모달 스모크: prompt/confirm 없이 모달이 뜨는지 검증.
// window.fetch를 스텁해 /api 왕복 없이 npm run dev(5173)만으로 실행.
// 실행: npm run dev (다른 터미널) 후 node scripts/smoke-share-ui.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();

// 앱 로드 전에 /api/share POST를 성공 응답으로 스텁 + 네이티브 대화상자 감지.
await page.addInitScript(() => {
  const orig = window.fetch;
  window.fetch = (url, opts) => {
    if (typeof url === 'string' && url.includes('/api/share/')) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    }
    return orig(url, opts);
  };
  // 네이티브 대화상자가 호출되면 표시(그러면 회귀).
  window.__nativeDialogUsed = false;
  window.prompt = () => { window.__nativeDialogUsed = true; return null; };
  window.confirm = () => { window.__nativeDialogUsed = true; return false; };
});

await page.goto(BASE, { waitUntil: 'networkidle' });

// 데모 여행 시드.
const tripId = await page.evaluate(async () => {
  const { db } = await import('/src/db.ts');
  const id = await db.trips.add({
    title: '스모크 데모 여행', startDate: '2026-09-14', dayCount: 1, mode: 'relaxed', createdAt: Date.now(),
  });
  await db.places.add({ tripId: id, name: '테스트장소', region: '제주', kind: 'sight' });
  await db.slots.add({ tripId: id, dayIndex: 0, band: '오전', plannedTime: '10:00', order: 0, placeId: null, activityText: '집합' });
  return id;
});
check('여행 시드 성공', typeof tripId === 'number');

await page.reload({ waitUntil: 'networkidle' });

// 공유 버튼 클릭 → 인앱 모달의 비번 입력창이 뜨는지.
await page.getByRole('button', { name: '여행 공유' }).first().click();
const pwInput = page.getByPlaceholder('참가자에게 알려줄 비밀번호');
await pwInput.waitFor({ timeout: 3000 }).catch(() => {});
check('공유 모달 비번 입력창 표시', await pwInput.isVisible());

// 비번 입력 → 공유하기 → 결과 화면(QR svg + 링크) 표시.
await pwInput.fill('1234');
await page.getByRole('button', { name: '공유하기' }).click();
const qr = page.locator('.fixed svg').first();
await qr.waitFor({ timeout: 4000 }).catch(() => {});
check('결과 화면 QR 표시', await qr.isVisible());
check('결과에 참여 링크 표시', (await page.locator('.fixed').innerText()).includes('/join/'));

// 모달 닫기(배경 클릭) 후 삭제 버튼 → 확인 모달.
await page.mouse.click(5, 5);
await page.getByRole('button', { name: '여행 삭제' }).first().click();
const delConfirm = page.getByRole('button', { name: '삭제' });
await delConfirm.waitFor({ timeout: 3000 }).catch(() => {});
check('삭제 확인 모달 표시', await delConfirm.isVisible());

// 네이티브 대화상자가 한 번도 안 쓰였는지(회귀 방지).
check('네이티브 prompt/confirm 미사용', (await page.evaluate(() => window.__nativeDialogUsed)) === false);

await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
if (pass < results.length) console.log('FAILED:', results.filter((r) => !r.ok).map((r) => r.name).join(' | '));
process.exit(pass === results.length ? 0 : 1);
```

- [ ] **Step 3: 실행해서 통과 확인**

Run: (터미널 1) `npm run dev`, (터미널 2) `npm run test:share:ui`
Expected: `==== 6/6 PASS ====`

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-share-ui.mjs package.json
git commit -m "test: add browser smoke for in-app share/delete modals"
```

- [ ] **Step 5: 배포 검증**

Run: `npx vercel --prod --yes`
그 후 `https://triporganizer-app.vercel.app`에서 실제 여행 카드의 공유·삭제 버튼을 눌러
모달이 뜨는지, 공유 결과의 QR/복사/공유가 동작하는지 확인(모바일 실기기 권장).

---

## Self-Review Notes

- **스펙 커버리지**: A(공유 모달: 입력→게시→링크/복사/공유/QR) = Task 2·4; B(삭제 확인 모달) = Task 3;
  C(publishShare 순수화·QR 번들·폴백) = Task 1·2·4; D(테스트) = Task 5. 전부 매핑됨.
- **네이티브 제거**: `window.prompt`(shareClient), `window.alert`(TripCard onClick), `window.confirm`(handleDelete)
  세 곳 모두 제거 — Task 2(prompt), Task 4 Step 2(alert 포함한 onClick 교체), Task 3(confirm 대체).
- **타입 일관성**: `publishShare(tripId, password)` 시그니처가 Task 2 정의와 Task 4 호출부에서 일치.
  `onShare(tripId)`, `onDelete(id, title)` 콜백 시그니처가 TripCard와 Trips에서 일치.
- **미해결 가정**: `btn-tonal`/`bg-error` 등 유틸 클래스 존재 여부는 실제 CSS에 따라 대체안을 주석으로 명시함
  (구현 시 빌드/화면으로 확정).
