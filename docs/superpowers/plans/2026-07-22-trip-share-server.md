# 여행 공유 서버 (비밀번호 게이트 + 일정 동기화 + 사진 업/다운로드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인솔자가 로컬에서 구성한 일정을 여행 비밀번호로 서버에 공유하고, 그 비밀번호를 아는 누구나
일정을 조회하고 사진을 자유롭게 올리고 받을 수 있게 한다.

**Architecture:** Vercel KV에 여행별 스냅샷(JSON, 사진 제외)과 사진 메타데이터를 저장하고,
Vercel Blob에 압축된 사진 원본을 저장한다. 세 개의 Vercel Functions(`/api/share/*`)가 단일
여행 비밀번호(bcrypt 해시로 저장)를 매 요청마다 검증하는 문지기 역할을 한다. 인솔자 전용 토큰은
없다 — 비밀번호를 아는 사람은 조회·업로드·재공유를 전부 할 수 있다.

**Tech Stack:** Vercel Functions (Node runtime), `@vercel/kv`, `@vercel/blob`, `bcryptjs`,
기존 Vite/React/Dexie 클라이언트.

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-07-22-trip-share-server-design.md` (이번 플랜의 근거)
- 단일 비밀번호 모델 — 인솔자/참가자 구분 없음, 별도 편집 토큰 없음 (스펙 "결정된 설계" 참고)
- 장소당 사진 4장 상한 (로드맵 0번, 2026-07-17 결정) — 서버에서 최종 검증
- 사진은 업로드 전 클라이언트에서 압축 (긴 변 1600px, JPEG q0.8) — 이미 승인된
  `2026-07-17-export-format-design.md`의 `compressPhoto` 규격 재사용
- 비밀번호는 평문 저장 금지, bcrypt 해시만 서버(KV)에 저장
- 시도 제한: `shareId`+IP당 10분에 10회 초과 시 429
- 기존 스크립트 컨벤션 유지: 순수 로직 테스트는 `vite.ssrLoadModule` + 목 fetch(`scripts/test-*.mjs`),
  브라우저 필요한 것은 Playwright 스모크(`scripts/smoke-*.mjs`), `check()` 함수로 pass/fail 집계 후
  `process.exit(pass === total ? 0 : 1)`
- 범위 밖(후속 스펙): 사진 원본 자동 삭제/Cron, 슬라이드쇼, 로컬 `exportTrip`/`importTrip`(로드맵 1번),
  참가자별 개인 계정

---

### Task 1: 서버 의존성 추가 + 스크립트 등록

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `@vercel/kv`, `@vercel/blob`, `bcryptjs` 런타임 의존성. `npm run test:share`,
  `npm run test:share:e2e`, `npm run test:image` 스크립트

- [ ] **Step 1: 의존성 추가**

`package.json`의 `dependencies`에 추가:

```json
    "@vercel/blob": "^0.27.3",
    "@vercel/kv": "^3.0.0",
    "bcryptjs": "^2.4.3",
```

`devDependencies`에 추가:

```json
    "@types/bcryptjs": "^2.4.6",
    "@vercel/node": "^3.2.29",
```

- [ ] **Step 2: 스크립트 등록**

`package.json`의 `scripts`에 추가 (`"test:geo"` 항목 다음 줄):

```json
    "test:image": "node scripts/smoke-image.mjs",
    "test:share": "node scripts/test-share.mjs",
    "test:share:e2e": "node scripts/smoke-share.mjs",
```

- [ ] **Step 3: 설치**

Run: `npm install`
Expected: `@vercel/blob`, `@vercel/kv`, `bcryptjs`, `@types/bcryptjs`, `@vercel/node`가
`node_modules`에 설치되고 `package-lock.json`이 갱신됨. 에러 없이 종료.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add server dependencies for trip-share feature"
```

---

### Task 2: 공유 로직 순수 모듈 (`src/share.ts`)

클라이언트(공유 버튼, 참가자 화면)와 서버(Vercel Functions) 양쪽에서 import하는, 프레임워크
의존성 없는 순수 모듈. Dexie를 절대 import하지 않는다 — 서버 번들에 IndexedDB 관련 코드가 딸려가지
않게 하기 위함. 타입은 `db.ts`에서 `import type`으로만 가져와 중복 정의를 피한다(타입 전용 import는
런타임에 완전히 지워지므로 Dexie 런타임 코드가 섞이지 않는다).

**Files:**
- Create: `src/share.ts`
- Test: `scripts/test-share.mjs`

**Interfaces:**
- Produces: `genShareId()`, `shareKey(shareId)`, `photosKey(shareId)`, `attemptsKey(shareId, ip)`,
  `checkRateLimit(kv, shareId, ip)`, `countPhotosForPlace(photos, placeId)`, `KVClient` 인터페이스,
  `ShareSnapshot`/`ShareRecord`/`PhotoMeta` 타입, `MAX_ATTEMPTS`, `ATTEMPT_WINDOW_SECONDS`,
  `MAX_PHOTOS_PER_PLACE` 상수

- [ ] **Step 1: 실패하는 테스트 작성**

Create `scripts/test-share.mjs`:

```js
// src/share.ts 순수 로직 테스트: fetch 없이 순수 함수 + 가짜 KV로 검증.
// 실행: node scripts/test-share.mjs
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true } });
const share = await vite.ssrLoadModule('/src/share.ts');

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name} ${extra}`);
  ok ? pass++ : fail++;
};

// --- genShareId ---
const id1 = share.genShareId();
const id2 = share.genShareId();
check('genShareId: 32자 16진수', /^[0-9a-f]{32}$/.test(id1), id1);
check('genShareId: 매번 다름', id1 !== id2);

// --- key builders ---
check('shareKey', share.shareKey('abc') === 'trip:abc');
check('photosKey', share.photosKey('abc') === 'trip:abc:photos');
check('attemptsKey', share.attemptsKey('abc', '1.2.3.4') === 'trip:abc:attempts:1.2.3.4');

// --- countPhotosForPlace ---
const photos = [
  { id: '1', placeId: 5, slotId: null, caption: '', ts: 0, blobUrl: '' },
  { id: '2', placeId: 5, slotId: null, caption: '', ts: 0, blobUrl: '' },
  { id: '3', placeId: 7, slotId: null, caption: '', ts: 0, blobUrl: '' },
];
check('countPhotosForPlace: placeId 5 → 2개', share.countPhotosForPlace(photos, 5) === 2);
check('countPhotosForPlace: placeId 7 → 1개', share.countPhotosForPlace(photos, 7) === 1);
check('countPhotosForPlace: placeId 999 → 0개', share.countPhotosForPlace(photos, 999) === 0);

// --- checkRateLimit: 가짜 KV로 in-memory 카운터 구현 ---
class FakeKV {
  store = new Map();
  async get(key) { return this.store.has(key) ? this.store.get(key) : null; }
  async set(key, value) { this.store.set(key, value); }
  async incr(key) {
    const next = (this.store.get(key) ?? 0) + 1;
    this.store.set(key, next);
    return next;
  }
  async expire() { /* no-op: 테스트에서는 TTL 만료를 시뮬레이션하지 않음 */ }
}

const kv = new FakeKV();
for (let i = 0; i < share.MAX_ATTEMPTS; i++) {
  const ok = await share.checkRateLimit(kv, 'trip1', '1.1.1.1');
  if (i === 0) check('checkRateLimit: 첫 시도 허용', ok);
}
const overLimit = await share.checkRateLimit(kv, 'trip1', '1.1.1.1');
check('checkRateLimit: 한도 초과 시 거부', overLimit === false);

const otherIp = await share.checkRateLimit(kv, 'trip1', '2.2.2.2');
check('checkRateLimit: 다른 IP는 별도 카운트', otherIp === true);

console.log(`\n==== ${pass}/${pass + fail} PASS ====`);
if (fail > 0) console.log('FAILED count:', fail);
await vite.close();
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node scripts/test-share.mjs`
Expected: `Cannot find module '/src/share.ts'` 류의 에러 또는 모든 체크 실패 (아직 `src/share.ts`가
없으므로 `ssrLoadModule`이 던짐)

- [ ] **Step 3: 최소 구현 작성**

Create `src/share.ts`:

```ts
import type { Place, Slot, Member, Group, Trip } from './db.ts';

export interface KVClient {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
}

export const MAX_ATTEMPTS = 10;
export const ATTEMPT_WINDOW_SECONDS = 600; // 10분
export const MAX_PHOTOS_PER_PLACE = 4;

export function genShareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function shareKey(shareId: string): string {
  return `trip:${shareId}`;
}

export function photosKey(shareId: string): string {
  return `trip:${shareId}:photos`;
}

export function attemptsKey(shareId: string, ip: string): string {
  return `trip:${shareId}:attempts:${ip}`;
}

export type ShareSnapshot = {
  trip: Pick<Trip, 'title' | 'startDate' | 'dayCount' | 'mode'>;
  members: Pick<Member, 'name' | 'groupId'>[];
  groups: Pick<Group, 'name' | 'score'>[];
  // id를 보존해야 slots[].placeId가 이 배열의 어느 장소를 가리키는지 참가자 화면에서 찾을 수 있다
  // (로컬 Dexie PK 그대로 — 배열 인덱스가 아님).
  places: (Pick<Place, 'name' | 'region' | 'kind' | 'address' | 'lat' | 'lng'> & { id: number })[];
  slots: Pick<Slot, 'dayIndex' | 'band' | 'plannedTime' | 'order' | 'placeId' | 'activityText'>[];
};

export interface ShareRecord {
  passwordHash: string;
  schedule: ShareSnapshot;
  updatedAt: number;
}

export interface PhotoMeta {
  id: string;
  placeId: number | null;
  slotId: number | null;
  caption: string;
  ts: number;
  blobUrl: string;
}

export async function checkRateLimit(kv: KVClient, shareId: string, ip: string): Promise<boolean> {
  const count = await kv.incr(attemptsKey(shareId, ip));
  if (count === 1) await kv.expire(attemptsKey(shareId, ip), ATTEMPT_WINDOW_SECONDS);
  return count <= MAX_ATTEMPTS;
}

export function countPhotosForPlace(photos: PhotoMeta[], placeId: number | null): number {
  return photos.filter((p) => p.placeId === placeId).length;
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node scripts/test-share.mjs`
Expected: `==== 11/11 PASS ====` (fail 0으로 종료 코드 0)

- [ ] **Step 5: Commit**

```bash
git add src/share.ts scripts/test-share.mjs package.json
git commit -m "feat: add pure share-logic module with rate-limit and photo-cap helpers"
```

---

### Task 3: 사진 압축 모듈 (`src/image.ts`)

이미 승인된 `2026-07-17-export-format-design.md`의 `compressPhoto` 규격을 그대로 구현한다.
이번 작업(참가자 사진 업로드)의 전제 조건이며, 나중에 로드맵 1번(로컬 내보내기) 구현 시에도
재사용된다. `addPhoto` 게이트웨이(로컬 IndexedDB 저장용)는 로드맵 1번의 몫이므로 **이번 범위에
넣지 않는다** — 여기서는 압축 함수만 만든다.

**Files:**
- Create: `src/image.ts`
- Test: `scripts/smoke-image.mjs` (Playwright — `createImageBitmap`/canvas는 Node에 없으므로
  브라우저에서 검증)

**Interfaces:**
- Produces: `compressPhoto(file: File): Promise<Blob>`

- [ ] **Step 1: 최소 구현 작성** (브라우저 API라 Node에서 실패하는 테스트를 먼저 못 만드므로,
  스모크 스크립트를 먼저 작성해 "구현 전 실패"를 확인하는 순서로 진행)

Create `src/image.ts`:

```ts
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;

export async function compressPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    return blob ?? file;
  } catch {
    return file; // 디코딩 실패 시 원본 반환 — 사진을 잃는 것보다 낫다
  }
}
```

- [ ] **Step 2: 스모크 테스트 작성**

Create `scripts/smoke-image.mjs`:

```js
// compressPhoto 검증: 큰 이미지를 넣고 긴 변이 1600 이하로 줄었는지, 원본보다 작아졌는지 확인.
// 실행: node scripts/smoke-image.mjs (dev server 필요; BASE_URL로 override)
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });

const result = await page.evaluate(async () => {
  const mod = await import('/src/image.ts');

  // 2400x1800 캔버스로 원본 이미지를 만든다 (긴 변 1600 초과 케이스).
  const canvas = document.createElement('canvas');
  canvas.width = 2400;
  canvas.height = 1800;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'red';
  ctx.fillRect(0, 0, 2400, 1800);
  const originalBlob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const file = new File([originalBlob], 'test.png', { type: 'image/png' });

  const compressed = await mod.compressPhoto(file);
  const bitmap = await createImageBitmap(compressed);
  return {
    originalSize: file.size,
    compressedSize: compressed.size,
    width: bitmap.width,
    height: bitmap.height,
    type: compressed.type,
  };
});

check('긴 변이 1600 이하로 축소됨', Math.max(result.width, result.height) <= 1600, `${result.width}x${result.height}`);
check('원본보다 작아짐', result.compressedSize < result.originalSize, `${result.originalSize} -> ${result.compressedSize}`);
check('JPEG로 변환됨', result.type === 'image/jpeg', result.type);

await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
process.exit(pass === results.length ? 0 : 1);
```

- [ ] **Step 3: 실행해서 통과 확인**

Run: `npm run dev` (다른 터미널에서 띄워둔 채로) 후 `npm run test:image`
Expected: `==== 3/3 PASS ====`

- [ ] **Step 4: Commit**

```bash
git add src/image.ts scripts/smoke-image.mjs package.json
git commit -m "feat: add client-side photo compression (compressPhoto)"
```

---

### Task 4: `Trip`에 공유 필드 추가

**Files:**
- Modify: `src/db.ts:16-23`

**Interfaces:**
- Produces: `Trip.shareId?: string`, `Trip.sharePassword?: string`

새 필드는 둘 다 optional이고 인덱싱(쿼리)이 필요 없으므로 Dexie 스키마 버전을 올리지 않는다 —
기존 버전 5의 `.upgrade()`는 `kind` 필드가 필수가 되면서 기존 행을 백필해야 했기 때문에 필요했던
것이고, 이번 필드는 없으면 그냥 `undefined`로 취급되므로 마이그레이션이 필요 없다.

- [ ] **Step 1: 필드 추가**

`src/db.ts:16-23`을 다음으로 교체:

```ts
export interface Trip {
  id?: number;
  title: string;
  startDate: string;   // YYYY-MM-DD
  dayCount: number;
  mode: TripMode;
  createdAt: number;
  shareId?: string;      // 참가자 링크용 공개 식별자. 첫 공유 시 발급, 숫자 PK와 별개(추측 방지)
  sharePassword?: string; // 인솔자 기기에만 저장되는 평문. 재공유 시 재입력 없이 서버로 전송하기 위함.
                           // 서버(KV)에는 이 값의 bcrypt 해시만 저장된다
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 타입 에러 없이 빌드 성공 (기존 `db.trips.add({...})` 호출부는 새 optional 필드를
채우지 않아도 되므로 깨지지 않음)

- [ ] **Step 3: Commit**

```bash
git add src/db.ts
git commit -m "feat: add shareId/sharePassword fields to Trip"
```

---

### Task 5: 서버 전용 유틸 — 비밀번호 해시 + KV/Blob 클라이언트

**Files:**
- Create: `api/_lib/hash.ts`
- Create: `api/_lib/kv.ts`
- Create: `api/_lib/blob.ts`
- Create: `tsconfig.api.json`
- Modify: `tsconfig.json`
- Test: `scripts/test-share.mjs` (확장)

**Interfaces:**
- Consumes: `KVClient` (from `src/share.ts`)
- Produces: `hashPassword(password): Promise<string>`, `verifyPassword(password, hash): Promise<boolean>`,
  `kvClient: KVClient`, `putPhoto(shareId, id, ext, buffer): Promise<{ url: string }>`

- [ ] **Step 1: tsconfig에 api 프로젝트 추가**

Create `tsconfig.api.json` (기존 `tsconfig.node.json`과 동일한 패턴):

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.api.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023"],
    "types": ["node"],
    "skipLibCheck": true,
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "allowImportingTsExtensions": false,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["api"]
}
```

`tsconfig.json`의 `references` 배열에 추가:

```json
    { "path": "./tsconfig.api.json" }
```

- [ ] **Step 2: 실패하는 테스트 작성** (`scripts/test-share.mjs` 끝, `await vite.close();` 앞에 추가)

```js
// --- hash.ts: bcrypt 라운드트립 ---
const hashMod = await vite.ssrLoadModule('/api/_lib/hash.ts');
const hash = await hashMod.hashPassword('제주도수학여행2026');
check('hashPassword: 평문과 다름', hash !== '제주도수학여행2026');
check('verifyPassword: 맞는 비번 통과', await hashMod.verifyPassword('제주도수학여행2026', hash) === true);
check('verifyPassword: 틀린 비번 거부', await hashMod.verifyPassword('틀린비번', hash) === false);
```

- [ ] **Step 3: 테스트 실행해서 실패 확인**

Run: `node scripts/test-share.mjs`
Expected: `/api/_lib/hash.ts`를 찾을 수 없다는 에러

- [ ] **Step 4: 구현**

Create `api/_lib/hash.ts`:

```ts
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

Create `api/_lib/kv.ts`:

```ts
import { kv } from '@vercel/kv';
import type { KVClient } from '../../src/share.ts';

export const kvClient: KVClient = {
  get: (key) => kv.get(key),
  set: async (key, value) => {
    await kv.set(key, value);
  },
  incr: (key) => kv.incr(key),
  expire: async (key, seconds) => {
    await kv.expire(key, seconds);
  },
};
```

Create `api/_lib/blob.ts`:

```ts
import { put } from '@vercel/blob';

export async function putPhoto(
  shareId: string,
  id: string,
  ext: string,
  buffer: Buffer,
): Promise<{ url: string }> {
  const result = await put(`photos/${shareId}/${id}.${ext}`, buffer, { access: 'public' });
  return { url: result.url };
}
```

- [ ] **Step 5: 테스트 실행해서 통과 확인**

Run: `node scripts/test-share.mjs`
Expected: 이전 11개 + 새 3개 = `==== 14/14 PASS ====`

- [ ] **Step 6: 빌드 확인**

Run: `npm run build`
Expected: `tsc -b`가 `tsconfig.api.json`도 함께 검사하며 에러 없이 통과

- [ ] **Step 7: Commit**

```bash
git add api/_lib tsconfig.json tsconfig.api.json scripts/test-share.mjs
git commit -m "feat: add server-only password hashing and KV/Blob client wrappers"
```

---

### Task 6: 공유/재공유 API (`POST /api/share/[shareId]`)

**Files:**
- Create: `api/share/[shareId].ts`

**Interfaces:**
- Consumes: `shareKey` (`src/share.ts`), `hashPassword`/`verifyPassword` (`api/_lib/hash.ts`),
  `kvClient` (`api/_lib/kv.ts`)
- Produces: `POST /api/share/:shareId` — 최초 호출 시 비밀번호 해시 생성, 이후 호출은 기존 해시와
  일치해야 스냅샷 교체 허용

- [ ] **Step 1: 구현**

Create `api/share/[shareId].ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { shareKey, type ShareRecord, type ShareSnapshot } from '../../src/share.ts';
import { hashPassword, verifyPassword } from '../_lib/hash.ts';
import { kvClient } from '../_lib/kv.ts';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const shareId = req.query.shareId as string;
  const { password, schedule } = (req.body ?? {}) as { password?: string; schedule?: ShareSnapshot };
  if (!shareId || !password || !schedule) {
    res.status(400).json({ error: 'invalid request' });
    return;
  }

  const existing = await kvClient.get<ShareRecord>(shareKey(shareId));
  const passwordHash = existing ? existing.passwordHash : await hashPassword(password);

  if (existing) {
    const ok = await verifyPassword(password, existing.passwordHash);
    if (!ok) {
      res.status(401).json({ error: '비밀번호가 틀렸습니다' });
      return;
    }
  }

  const record: ShareRecord = { passwordHash, schedule, updatedAt: Date.now() };
  await kvClient.set(shareKey(shareId), record);
  res.status(200).json({ ok: true });
}
```

- [ ] **Step 2: 로컬 통합 확인** (Task 11의 `vercel dev` 스모크 테스트에서 실제 검증. 지금은 타입
  검사만)

Run: `npm run build`
Expected: 에러 없이 통과

- [ ] **Step 3: Commit**

```bash
git add api/share/[shareId].ts
git commit -m "feat: add trip share/re-share API endpoint"
```

---

### Task 7: 비밀번호 검증 API (`POST /api/share/[shareId]/verify`)

**Files:**
- Create: `api/share/[shareId]/verify.ts`

**Interfaces:**
- Consumes: `shareKey`, `checkRateLimit` (`src/share.ts`), `verifyPassword` (`api/_lib/hash.ts`),
  `kvClient` (`api/_lib/kv.ts`)
- Produces: `POST /api/share/:shareId/verify` — 성공 시 `{ schedule }` 반환, 실패 시 401,
  시도 초과 시 429

- [ ] **Step 1: 구현**

Create `api/share/[shareId]/verify.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { shareKey, checkRateLimit, type ShareRecord } from '../../../src/share.ts';
import { verifyPassword } from '../../_lib/hash.ts';
import { kvClient } from '../../_lib/kv.ts';

function clientIp(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return first?.split(',')[0]?.trim() || 'unknown';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const shareId = req.query.shareId as string;
  const { password } = (req.body ?? {}) as { password?: string };
  if (!shareId || !password) {
    res.status(400).json({ error: 'invalid request' });
    return;
  }

  const withinLimit = await checkRateLimit(kvClient, shareId, clientIp(req));
  if (!withinLimit) {
    res.status(429).json({ error: '잠시 후 다시 시도하세요' });
    return;
  }

  const record = await kvClient.get<ShareRecord>(shareKey(shareId));
  if (!record || !(await verifyPassword(password, record.passwordHash))) {
    res.status(401).json({ error: '비밀번호가 틀렸습니다' });
    return;
  }

  res.status(200).json({ schedule: record.schedule });
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 에러 없이 통과

- [ ] **Step 3: Commit**

```bash
git add "api/share/[shareId]/verify.ts"
git commit -m "feat: add trip password verification API endpoint"
```

---

### Task 8: 사진 업로드/조회 API (`/api/share/[shareId]/photos`)

**Files:**
- Create: `api/share/[shareId]/photos.ts`

**Interfaces:**
- Consumes: `shareKey`, `photosKey`, `countPhotosForPlace`, `MAX_PHOTOS_PER_PLACE` (`src/share.ts`),
  `verifyPassword` (`api/_lib/hash.ts`), `kvClient` (`api/_lib/kv.ts`), `putPhoto` (`api/_lib/blob.ts`)
- Produces: `GET /api/share/:shareId/photos` (헤더 `x-trip-password`) → `{ photos }`,
  `POST /api/share/:shareId/photos` (body에 `password` 포함) → `{ photo }`

- [ ] **Step 1: 구현**

Create `api/share/[shareId]/photos.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  shareKey, photosKey, countPhotosForPlace, MAX_PHOTOS_PER_PLACE,
  type ShareRecord, type PhotoMeta,
} from '../../../src/share.ts';
import { verifyPassword } from '../../_lib/hash.ts';
import { kvClient } from '../../_lib/kv.ts';
import { putPhoto } from '../../_lib/blob.ts';

async function authenticate(shareId: string, password: string | undefined): Promise<ShareRecord | null> {
  if (!password) return null;
  const record = await kvClient.get<ShareRecord>(shareKey(shareId));
  if (!record) return null;
  return (await verifyPassword(password, record.passwordHash)) ? record : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const shareId = req.query.shareId as string;
  if (!shareId) {
    res.status(400).json({ error: 'invalid request' });
    return;
  }

  if (req.method === 'GET') {
    const headerPassword = req.headers['x-trip-password'];
    const password = Array.isArray(headerPassword) ? headerPassword[0] : headerPassword;
    const record = await authenticate(shareId, password);
    if (!record) {
      res.status(401).json({ error: '비밀번호가 틀렸습니다' });
      return;
    }
    const photos = (await kvClient.get<PhotoMeta[]>(photosKey(shareId))) ?? [];
    res.status(200).json({ photos });
    return;
  }

  if (req.method === 'POST') {
    const body = (req.body ?? {}) as {
      password?: string;
      placeId?: number | null;
      slotId?: number | null;
      caption?: string;
      fileBase64?: string;
      contentType?: string;
    };
    const record = await authenticate(shareId, body.password);
    if (!record) {
      res.status(401).json({ error: '비밀번호가 틀렸습니다' });
      return;
    }
    if (!body.fileBase64) {
      res.status(400).json({ error: 'invalid request' });
      return;
    }

    const photos = (await kvClient.get<PhotoMeta[]>(photosKey(shareId))) ?? [];
    const placeId = body.placeId ?? null;
    if (countPhotosForPlace(photos, placeId) >= MAX_PHOTOS_PER_PLACE) {
      res.status(400).json({ error: '이 장소는 이미 사진 4장이 채워져 있습니다' });
      return;
    }

    const id = crypto.randomUUID();
    const ext = body.contentType === 'image/png' ? 'png' : 'jpg';
    const buffer = Buffer.from(body.fileBase64, 'base64');
    const { url } = await putPhoto(shareId, id, ext, buffer);

    const meta: PhotoMeta = {
      id, placeId, slotId: body.slotId ?? null,
      caption: body.caption ?? '', ts: Date.now(), blobUrl: url,
    };
    await kvClient.set(photosKey(shareId), [...photos, meta]);
    res.status(200).json({ photo: meta });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 에러 없이 통과

- [ ] **Step 3: Commit**

```bash
git add "api/share/[shareId]/photos.ts"
git commit -m "feat: add photo upload/list API endpoint with per-place cap"
```

---

### Task 9: 인솔자 UI — 여행 목록에서 공유 설정

**Files:**
- Create: `src/shareClient.ts`
- Modify: `src/pages/Trips.tsx`

**Interfaces:**
- Consumes: `db` (`src/db.ts`), `genShareId`, `ShareSnapshot` (`src/share.ts`)
- Produces: `buildShareSnapshot(tripId): Promise<ShareSnapshot>`, `publishShare(tripId): Promise<string>`
  (반환값은 참가자용 공유 URL)

`buildShareSnapshot`/`publishShare`는 Dexie(`db`)를 쓰므로 클라이언트 전용 파일
(`src/shareClient.ts`)에 둔다 — `src/share.ts`는 서버에서도 import되므로 Dexie 의존을 넣지 않는다.

- [ ] **Step 1: `src/shareClient.ts` 작성**

Create `src/shareClient.ts`:

```ts
import { db, type Trip } from './db.ts';
import { genShareId, type ShareSnapshot } from './share.ts';

export async function buildShareSnapshot(tripId: number): Promise<ShareSnapshot> {
  const trip = await db.trips.get(tripId);
  if (!trip) throw new Error(`trip ${tripId} not found`);

  const [members, groups, places, slots] = await Promise.all([
    db.members.where('tripId').equals(tripId).toArray(),
    db.groups.where('tripId').equals(tripId).toArray(),
    db.places.where('tripId').equals(tripId).toArray(),
    db.slots.where('tripId').equals(tripId).toArray(),
  ]);

  return {
    trip: { title: trip.title, startDate: trip.startDate, dayCount: trip.dayCount, mode: trip.mode },
    members: members.map((m) => ({ name: m.name, groupId: m.groupId })),
    groups: groups.map((g) => ({ name: g.name, score: g.score })),
    places: places.map((p) => ({
      id: p.id!, name: p.name, region: p.region, kind: p.kind, address: p.address, lat: p.lat, lng: p.lng,
    })),
    slots: slots.map((s) => ({
      dayIndex: s.dayIndex, band: s.band, plannedTime: s.plannedTime,
      order: s.order, placeId: s.placeId, activityText: s.activityText,
    })),
  };
}

// 처음 공유하거나, 이미 공유된 여행을 다시 공유(갱신)할 때 호출한다.
// 반환값은 참가자에게 보낼 URL.
export async function publishShare(tripId: number): Promise<{ url: string; password: string }> {
  const trip = await db.trips.get(tripId);
  if (!trip) throw new Error(`trip ${tripId} not found`);

  const shareId = trip.shareId ?? genShareId();
  const password = trip.sharePassword ?? window.prompt('여행 비밀번호를 설정하세요 (참가자와 공유할 값)') ?? '';
  if (!password) throw new Error('비밀번호가 필요합니다');

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

- [ ] **Step 2: `Trips.tsx`에 공유 버튼 추가**

`src/pages/Trips.tsx`에서 여행 카드를 렌더링하는 부분(기존 `여행 삭제` 버튼이 있는 자리)에
공유 버튼을 추가한다. 정확한 삽입 위치는 기존 카드 JSX 구조를 확인 후 "여행 삭제" 버튼 옆에
아래 버튼을 추가:

```tsx
import { publishShare } from '../shareClient';

// ...카드 컴포넌트 내부, 기존 삭제 버튼 근처에 추가:
<button
  onClick={async (e) => {
    e.stopPropagation();
    try {
      const { url, password } = await publishShare(trip.id!);
      await navigator.clipboard.writeText(`${url}\n비밀번호: ${password}`).catch(() => {});
      alert(`공유 링크가 클립보드에 복사됐습니다:\n${url}\n비밀번호: ${password}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : '공유에 실패했습니다');
    }
  }}
  className="chip bg-primary-container/15 text-primary-container"
>
  <Icon name="ios_share" className="text-[16px]" /> 공유
</button>
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 에러 없이 통과

- [ ] **Step 4: Commit**

```bash
git add src/shareClient.ts src/pages/Trips.tsx
git commit -m "feat: add share button to trip list (publish snapshot + password)"
```

---

### Task 10: 참가자 화면 (`/join/:shareId`)

**Files:**
- Create: `src/pages/Join.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `compressPhoto` (`src/image.ts`), `BANDS`, `isMealBand` (`src/db.ts`)
- Produces: 라우트 `/join/:shareId`

- [ ] **Step 1: `Join.tsx` 작성**

Create `src/pages/Join.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BANDS, isMealBand, type Band } from '../db';
import { compressPhoto } from '../image';
import { Icon, Screen, TopBar } from '../ui';
import type { ShareSnapshot, PhotoMeta } from '../share';

function storageKey(shareId: string) {
  return `share-password:${shareId}`;
}

export default function Join() {
  const { shareId } = useParams<{ shareId: string }>();
  const [password, setPassword] = useState('');
  const [schedule, setSchedule] = useState<ShareSnapshot | null>(null);
  const [photos, setPhotos] = useState<PhotoMeta[]>([]);
  const [error, setError] = useState('');
  const [day, setDay] = useState(0);

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
      return false;
    }
    const body = await res.json();
    setSchedule(body.schedule);
    localStorage.setItem(storageKey(shareId!), pw);
    await loadPhotos(pw);
    return true;
  }

  async function loadPhotos(pw: string) {
    const res = await fetch(`/api/share/${shareId}/photos`, {
      headers: { 'x-trip-password': pw },
    });
    if (res.ok) setPhotos((await res.json()).photos);
  }

  useEffect(() => {
    const saved = localStorage.getItem(storageKey(shareId!));
    if (saved) verify(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareId]);

  async function uploadPhoto(file: File) {
    const pw = localStorage.getItem(storageKey(shareId!));
    if (!pw) return;
    const compressed = await compressPhoto(file);
    const buffer = await compressed.arrayBuffer();
    const fileBase64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    const res = await fetch(`/api/share/${shareId}/photos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw, placeId: null, caption: '', fileBase64, contentType: compressed.type }),
    });
    if (res.ok) await loadPhotos(pw);
    else alert((await res.json().catch(() => ({}))).error ?? '업로드 실패');
  }

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
          <button className="btn-primary w-full" onClick={() => verify(password)}>
            입장
          </button>
          {error && <p className="text-[13px] text-red-600">{error}</p>}
        </div>
      </Screen>
    );
  }

  const daySlots = schedule.slots.filter((s) => s.dayIndex === day);

  return (
    <>
      <TopBar title={schedule.trip.title} />
      <div className="flex gap-2 px-4 pt-3 overflow-x-auto no-scrollbar">
        {Array.from({ length: schedule.trip.dayCount }).map((_, i) => (
          <button
            key={i}
            onClick={() => setDay(i)}
            className={`shrink-0 px-4 py-2 rounded-full text-[14px] font-semibold ${
              day === i ? 'bg-primary-container text-on-primary-container' : 'bg-surface-variant text-on-surface-variant'
            }`}
          >
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
                <span className={`chip ${isMealBand(band) ? 'bg-emerald/10 text-emerald' : 'bg-primary-container/15 text-primary-container'}`}>
                  {band}
                </span>
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

        <div className="mt-6 pt-4 border-t border-outline-variant/30">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">사진 ({photos.length})</h3>
            <label className="chip bg-emerald/10 text-emerald cursor-pointer">
              <Icon name="add_a_photo" className="text-[16px]" /> 올리기
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])}
              />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <a key={p.id} href={p.blobUrl} target="_blank" rel="noreferrer" download>
                <img src={p.blobUrl} alt="" className="w-full aspect-square object-cover rounded-md" />
              </a>
            ))}
          </div>
        </div>
      </Screen>
    </>
  );
}
```

`schedule.places`는 로컬 Dexie PK(`id`)를 그대로 담고 있으므로(Task 2에서 이미 `ShareSnapshot`에
포함), `slots[].placeId`가 가리키는 장소를 `find`로 정확히 찾을 수 있다 — 배열 인덱스로 접근하면
안 된다.

- [ ] **Step 2: 라우트 등록**

`src/App.tsx`에 import 추가:

```tsx
import Join from './pages/Join';
```

`<Routes>` 안, `<Route path="/" ...>` 다음 줄에 추가:

```tsx
        <Route path="/join/:shareId" element={<Join />} />
```

(이 라우트는 `TripLayout`으로 감싸지 않는다 — 참가자는 하단 탭 없이 단일 화면만 본다.)

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 에러 없이 통과

- [ ] **Step 4: Commit**

```bash
git add src/pages/Join.tsx src/App.tsx
git commit -m "feat: add participant join page (view schedule, upload/download photos)"
```

---

### Task 11: 엔드투엔드 스모크 테스트 + 수동 준비물 문서화

`vercel dev`는 실제 프로비저닝된 Vercel KV/Blob에 연결한다 — 이 테스트는 로컬 목이 아니라
진짜 클라우드 자원을 쓴다. 매 실행마다 새 `shareId`를 써서 이전 실행과 충돌하지 않게 한다.

**Files:**
- Create: `scripts/smoke-share.mjs`
- Modify: `docs/superpowers/specs/2026-07-22-trip-share-server-design.md` (준비물 섹션 추가)

**Interfaces:**
- Consumes: 실행 중인 `vercel dev` (기본 포트 3000, `BASE_URL`로 override 가능)

- [ ] **Step 1: 수동 준비물 — 사용자가 직접 해야 함**

다음은 Vercel 대시보드에서 사람이 직접 해야 하는 일회성 작업이다(계정 설정 변경이라 AI가
대신 할 수 없음):

1. https://vercel.com/shkwak9720-6323s-projects/triporganizer/stores 에서 KV(Upstash Redis)
   스토어 하나, Blob 스토어 하나를 생성하고 프로젝트에 연결
2. 로컬에서 `vercel env pull .env.local` 실행 — `KV_REST_API_URL`, `KV_REST_API_TOKEN`,
   `BLOB_READ_WRITE_TOKEN` 등이 `.env.local`에 채워짐 (이미 `.gitignore`에 `.env*` 있음)

- [ ] **Step 2: 스모크 스크립트 작성**

Create `scripts/smoke-share.mjs`:

```js
// 여행 공유 서버 E2E 스모크: vercel dev가 떠 있어야 함 (npm run dev로는 /api가 안 뜸).
// 실행: vercel dev (다른 터미널) 후 node scripts/smoke-share.mjs
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const shareId = `smoke-${Date.now()}`;
const password = 'smoke-test-password';
const schedule = {
  trip: { title: '스모크 테스트 여행', startDate: '2026-08-01', dayCount: 1, mode: 'relaxed' },
  members: [], groups: [],
  places: [{ id: 1, name: '테스트 장소', region: '제주', kind: 'sight', lat: 33.4, lng: 126.9 }],
  slots: [{ dayIndex: 0, band: '오전', plannedTime: '10:00', order: 0, placeId: 1, activityText: '' }],
};

// 1. 공유(최초)
let res = await fetch(`${BASE}/api/share/${shareId}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password, schedule }),
});
check('최초 공유 성공', res.ok, `status=${res.status}`);

// 2. 틀린 비번으로 재공유 시도 → 거부
res = await fetch(`${BASE}/api/share/${shareId}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'wrong', schedule }),
});
check('틀린 비번 재공유 거부', res.status === 401);

// 3. 참가자 비번 검증 (정답)
res = await fetch(`${BASE}/api/share/${shareId}/verify`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password }),
});
check('참가자 비번 검증 성공', res.ok);
const verifyBody = await res.json();
check('스냅샷 일치', verifyBody.schedule?.trip?.title === '스모크 테스트 여행');

// 4. 참가자 비번 검증 (오답)
res = await fetch(`${BASE}/api/share/${shareId}/verify`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'wrong' }),
});
check('오답 비번 거부', res.status === 401);

// 5. 사진 업로드 (1x1 PNG)
const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
res = await fetch(`${BASE}/api/share/${shareId}/photos`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password, placeId: 1, caption: '', fileBase64: tinyPngBase64, contentType: 'image/png' }),
});
check('사진 업로드 성공', res.ok, `status=${res.status}`);

// 6. 사진 목록 조회
res = await fetch(`${BASE}/api/share/${shareId}/photos`, { headers: { 'x-trip-password': password } });
const photosBody = await res.json();
check('업로드한 사진이 목록에 반영됨', photosBody.photos?.length === 1);

// 7. 장소당 4장 상한
for (let i = 0; i < 3; i++) {
  await fetch(`${BASE}/api/share/${shareId}/photos`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password, placeId: 1, caption: '', fileBase64: tinyPngBase64, contentType: 'image/png' }),
  });
}
res = await fetch(`${BASE}/api/share/${shareId}/photos`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password, placeId: 1, caption: '', fileBase64: tinyPngBase64, contentType: 'image/png' }),
});
check('장소당 4장 초과 시 거부', res.status === 400);

// 8. rate limit (11번째 오답 시도는 429)
for (let i = 0; i < 10; i++) {
  await fetch(`${BASE}/api/share/${shareId}/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'wrong' }),
  });
}
res = await fetch(`${BASE}/api/share/${shareId}/verify`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'wrong' }),
});
check('시도 초과 시 429', res.status === 429);

const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
if (pass < results.length) console.log('FAILED:', results.filter((r) => !r.ok).map((r) => r.name).join(' | '));
process.exit(pass === results.length ? 0 : 1);
```

- [ ] **Step 3: 실행해서 통과 확인**

Run: (터미널 1) `vercel dev`, (터미널 2) `npm run test:share:e2e`
Expected: `==== 8/8 PASS ====`

- [ ] **Step 4: 스펙 문서에 준비물 기록**

`docs/superpowers/specs/2026-07-22-trip-share-server-design.md`의 "검증" 섹션 끝에 추가:

```markdown

## 로컬 실행 준비물

`vercel dev`로 `/api`를 로컬에서 띄우려면 먼저 Vercel 대시보드에서 KV·Blob 스토어를 생성하고
`vercel env pull .env.local`로 자격 증명을 받아야 한다(1회성, 사람이 직접). 이후
`vercel dev` → `npm run test:share:e2e` 순서로 검증한다.
```

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-share.mjs docs/superpowers/specs/2026-07-22-trip-share-server-design.md
git commit -m "test: add end-to-end smoke test for trip share API"
```

---

## Self-Review Notes

- **스펙 커버리지**: 스펙의 A~F 섹션 전부 태스크로 매핑됨 — 데이터 모델(Task 2, 4), API 3개
  엔드포인트(Task 6, 7, 8), 비밀번호 보안·rate limit(Task 2, 5, 7), 4장 상한(Task 8),
  에러 처리(각 API 태스크에 포함), 테스트(Task 2, 3, 11)
- **범위 밖 재확인**: 사진 수명 관리·Cron·슬라이드쇼·로컬 export/import는 포함하지 않음(후속 스펙)
- **타입 일관성**: 초안에서는 `ShareSnapshot.places`에 `id`가 빠져 있어 Join.tsx의 장소 조회가
  배열 인덱스 접근이 되는 버그가 있었다. Task 2(타입 정의)와 Task 9(스냅샷 조립)에서 처음부터
  `id`를 포함하도록 고쳐서, Task 10은 처음부터 `find(p => p.id === s.placeId)`로 올바르게 작성함
  — 나중에 고치는 방식이 아니라 정의 시점에서 바로잡음
