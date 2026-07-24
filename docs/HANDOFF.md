# TripOrganizer — 작업 인수인계 (2026-07-24)

> 이 문서는 진행 중인 "여행 공유 (참가자 앱)" 기능을 다른 AI/개발자가 이어받기 위한 요약이다.
> 상세 설계·구현 계획은 `docs/superpowers/specs/*` 와 `docs/superpowers/plans/*` 참고.

## 1. 프로젝트 개요

- **무엇**: 학교 수학여행/단체여행용 모바일 웹앱(PWA). 한국어 UI. 인솔자(교사)가 여행·일정·모둠·미션을 구성하고, 학생(참가자)이 링크+비밀번호로 접속해 일정·미션·사진·현재위치를 본다.
- **스택**: Vite 8 + React 19 + TypeScript(~6.0) + Dexie(IndexedDB, 로컬 저장) + react-router-dom 7 + Tailwind. 지도는 Leaflet/react-leaflet. 서버는 Vercel Functions(Node) + Vercel KV(Upstash Redis, `ioredis`) + Vercel Blob(사진).
- **로컬 데이터**: 인솔자 앱의 모든 데이터는 브라우저 IndexedDB(Dexie, `src/db.ts`)에 있다. 서버는 "공유된 스냅샷"만 저장한다.

## 2. 현재 배포/저장소 상태

- **브랜치**: `feat/trip-share-server` (origin과 동기화됨). **PR: https://github.com/etshkwak9720/TripOrganizer/pull/2** (아직 main에 머지 안 함 — 프로덕션은 이 브랜치를 직접 배포 중).
- **라이브 프로덕션**: **https://triporganizer-app.vercel.app** (Vercel 프로젝트명 `triporganizer`).
  - ⚠️ `vercel --prod`는 자동으로 `yeojeong-app.vercel.app`(옛 프로젝트 이름에서 남은 상용 도메인)에도 alias한다. 매 배포 후 최신 배포를 `triporganizer-app.vercel.app`로 수동 alias해야 한다: `npx vercel alias set <최신배포URL> triporganizer-app.vercel.app`. (영구 해결하려면 Vercel 대시보드 Settings→Domains에서 yeojeong-app 제거 + triporganizer-app을 Production Domain으로.)
- **데모 공유**(프로덕션 KV에 존재): `https://triporganizer-app.vercel.app/join/demo227416`, 비번 **1234** (미션/모둠 데이터 포함).

## 3. 완료된 것 (이 브랜치)

### A. 초기 공유 서버 (trip-share-server)
- 스펙 `docs/superpowers/specs/2026-07-22-trip-share-server-design.md`, 플랜 `.../plans/2026-07-22-trip-share-server.md`.
- `/api/share/*` 엔드포인트, 비밀번호 bcrypt 해시, rate-limit, 사진 업로드(장소당 4장), 참가자 join 페이지.

### B. 공유/삭제를 인앱 모달로 (네이티브 팝업 제거)
- 스펙/플랜: `.../2026-07-24-share-delete-inapp-modals*.md`.
- 문제: `window.prompt/confirm/alert`가 모바일 PWA·인앱브라우저에서 무시됨 → 공유·삭제 무반응.
- 해결: `src/pages/Trips.tsx`에 `ShareDialog`(비번 입력→게시→링크/복사/카톡공유/QR)·`ConfirmDialog`(삭제). `publishShare`는 비번을 인자로 받도록 순수화. `qrcode.react` 사용.

### C. 참가자 4탭 앱 (지금·일정·미션·갤러리) — **4단계 전부 완료**
- 스펙: `.../2026-07-24-participant-full-app-design.md`. 플랜 4개: `.../participant-app-phase{1,2,3,4}-*.md`.
- **1단계(데이터 계층)**: `ShareSnapshot` 확장(missions/groups(id)/missionResults/adjustments/awards/places.learn), 순수 `computeRanking`(`src/share.ts`), 인솔자 자동 재발행 훅 `useAutoRepublish`(`src/shareClient.ts`, `App.tsx`의 `TripLayout`에서 마운트, 데이터 변경 시 3초 디바운스 후 스냅샷 재전송), `GET /api/share/:id` 스냅샷 조회.
- **2단계(탭 셸 + 일정 + 갤러리)**: `src/pages/Join.tsx`를 하단 4탭 셸로 재작성. `PlanTab`(일정, 읽기전용). `src/pages/join/GalleryTab.tsx`(서버 사진 보기·올리기·장소필터·**내 사진만 삭제/교체**). 참가자 자동 새로고침(20초/포커스). 사진 소유권: 기기 토큰(`localStorage` `photo-owner`), `PhotoMeta.owner`, `DELETE /api/share/:id/photos`(owner 일치 검증).
- **3단계(미션 탭)**: `src/pages/join/MissionTab.tsx` — 실시간 랭킹(`computeRanking`) + 1등상/꼴찌벌 + 장소별 미션(어느 모둠 완료). 읽기 전용.
- **4단계(지금 탭)**: `src/pages/join/NowTab.tsx` — 지도(`LiveMap`) + 오늘의 동선 + "다음 목적지까지 약 N분"(**학생 본인 GPS** 기준). `Live.tsx`는 건드리지 않고 독립 유틸(`LiveMap`/`geo.fetchRoute`/`mock.estimateTravelMinutes`) 재사용.

### "거의 실시간" 동작 방식
인솔자 앱이 공유된 여행을 연 상태에서 데이터(일정/미션/점수/상벌점)를 바꾸면 → `useAutoRepublish`가 3초 뒤 스냅샷을 서버에 재전송 → 참가자 앱이 20초마다/포커스 시 `GET`으로 최신 스냅샷을 받아 반영.

## 4. 핵심 파일 지도

- `src/share.ts` — **서버·클라 공용 순수 모듈**(Dexie 런타임 import 금지, 타입만). `ShareSnapshot`, `PhotoMeta`, `computeRanking`, key builders, rate-limit, 상수.
- `src/shareClient.ts` — 클라 전용(Dexie 사용): `buildShareSnapshot`, `publishShare(tripId, password)`, `useAutoRepublish(tripId)`.
- `src/db.ts` — Dexie 스키마·도메인 타입(Trip/Place/Slot/Group/Mission/MissionResult/Adjustment/Award/Photo). `Trip.shareId?/sharePassword?` 필드 있음.
- `src/pages/Trips.tsx` — 인솔자 여행 목록 + 공유/삭제 모달.
- `src/pages/Join.tsx` — 참가자 탭 셸(입장 게이트 + 하단탭 + PlanTab). `ownerToken()`, `storageKey()` export.
- `src/pages/join/{GalleryTab,MissionTab,NowTab}.tsx` — 참가자 탭들.
- `api/share/[shareId].ts` — POST(공유/재공유) + GET(스냅샷 조회).
- `api/share/[shareId]/verify.ts` — 비번 검증(POST, rate-limit).
- `api/share/[shareId]/photos.ts` — 사진 GET/POST/DELETE(owner 검증).
- `api/_lib/{hash,kv,blob}.ts` — bcrypt, ioredis KV 클라, Blob put/del.
- `src/pages/Live.tsx`, `src/components/LiveMap.tsx`, `src/geo.ts`, `src/mock.ts` — 인솔자 지도·경로(참가자 NowTab이 재사용).

## 5. 빌드·테스트·실행

```bash
npm install
npm run build            # tsc -b && vite build (타입체크 포함)

# 프론트만 (/api 없음 — 공유/참여 API는 안 뜸)
npm run dev              # vite, http://localhost:5173

# 풀스택 로컬 (/api 함수 + 실제 Vercel KV/Blob 연결)
vercel dev               # http://localhost:3000  (.env.local 자격증명 필요)
```

**테스트(스모크)** — 각각 dev 서버가 떠 있어야 함:
- `npm run test:share`      순수 로직 단위(share.ts) — dev 서버 불필요
- `npm run test:image`      사진 압축 (vite dev 5173)
- `npm run test:share:e2e`  전체 API E2E (**vercel dev 3000 + 실 KV/Blob**)
- `npm run test:share:ui`   공유/삭제 모달 (vite dev 5173)
- `npm run test:republish`  인솔자 자동 재발행 (vite dev 5173)
- `npm run test:join`       참가자 4탭(일정/갤러리/미션/지금) (vite dev 5173)
- `npm run test:map`        인솔자 Live 지도 회귀 (vite dev 5173)
- `npm run icons:subset`    새 아이콘 추가 시 폰트 서브셋 재생성(Python+fonttools 필요)

**전부 통과 상태** (마지막 확인): E2E 13/13, join 10/10, share:ui 6/6, republish 1/1, map 11/11, unit 17/17.

## 6. 배포

```bash
npx vercel --prod --yes
# 그 후 반드시:
LATEST=$(npx vercel ls | grep -oE 'https://triporganizer-[a-z0-9]+-shkwak[^ ]+' | head -1)
npx vercel alias set "$LATEST" triporganizer-app.vercel.app
```

⚠️ **PWA 서비스워커 캐시 주의**: 배포 후 기존 사용자는 옛 버전이 캐시돼 있을 수 있다. 브라우저에서 새 버전이 안 보이면 새로고침 1~2회(서비스워커 갱신) 또는 설치형 PWA는 껐다 켜기.

## 7. Vercel 환경 함정 (겪은 것들 — 반드시 숙지)

1. **Redis는 `@vercel/kv` 아님 → `ioredis`**: 무료 Redis(마켓플레이스)는 `REDIS_URL`(redis:// 프로토콜)만 준다. `api/_lib/kv.ts`가 ioredis로 붙고 JSON 직렬화한다.
2. **`/api`를 SPA rewrite에서 제외**: `vercel.json` catch-all rewrite가 `/api/*`·`/@vite/*`까지 index.html로 보냈다 → 부정 룩어헤드에 `api/`·`@` 추가돼 있음.
3. **api 로컬 import는 `.js` 확장자**: Vercel 프로덕션 ESM 런타임이 `.ts`를 못 찾는다(`ERR_MODULE_NOT_FOUND`). 예: `from '../../src/share.js'`.
4. **Blob 스토어는 Public**: 참가자가 공개 URL로 사진 조회. `access: 'public'`.
5. **Blob 토큰(`BLOB_READ_WRITE_TOKEN`)은 sensitive → Development에 자동주입 안 됨**: 로컬 `vercel dev`용으로 CLI로 수동 등록해야 함: `vercel env add BLOB_READ_WRITE_TOKEN development` (스토어 페이지의 `.env.local` 스니펫 값). `vercel dev`는 `.env.local`이 아니라 클라우드 Development env를 함수에 주입한다. Production/Preview에도 유효 토큰이 있어야 배포본 업로드가 됨(옛 스토어의 stale 토큰이 남아있으면 `Access denied` → 유효 토큰으로 교체).
6. **REDIS_URL**은 이미 Development/Preview/Production 전부에 연결됨. 일정·비번은 배포에서 바로 동작.

## 8. 남은 것 / 다음 후보 (아직 안 함)

- **PR #2 머지**: 프로덕션이 feature 브랜치를 직접 배포 중이라 main이 뒤처져 있음. 정리하려면 PR 머지.
- **도메인 영구 정리**: yeojeong-app.vercel.app 제거 + triporganizer-app을 Production Domain으로(대시보드).
- 후속 스펙(기존 문서에 명시): 사진 원본 자동 삭제/수명(Vercel Cron), 갤러리 슬라이드쇼 영상, 로컬 `exportTrip/importTrip`(로드맵 1번), 참가자별 개인 계정.
- **미검증**: 4단계 "지금" 탭의 실기기 GPS 동작은 스모크(모의 위치)로만 확인됨 — 실제 폰 GPS로 도착시간이 맞는지 현장 확인 권장.
- 참가자 갤러리 사진에 감상평(caption) 입력 UI는 없음(보기만) — 필요시 추가.

## 9. 작업 방식(이 저장소 관례)

- 기능 작업은 **brainstorm(스펙) → plan(구현계획) → execute(TDD/스모크, 태스크별 커밋) → 배포 검증** 순서. 스펙은 `docs/superpowers/specs/`, 플랜은 `docs/superpowers/plans/`.
- 스모크 스크립트 컨벤션: `scripts/smoke-*.mjs` (Playwright, `check()`로 집계 후 `process.exit`). 순수 로직은 `scripts/test-*.mjs`(vite `ssrLoadModule`).
- 아이콘은 서브셋 폰트(`public/assets/fonts/material-symbols-subset.woff2`) — 새 아이콘 쓰면 `npm run icons:subset` 재생성 후 커밋.
- 커밋은 태스크 단위로 자주. 커밋 승인 시 push까지.
