# 설계: 여행 비밀번호 공유 서버 (1단계 — 일정 동기화 + 사진 업/다운로드)

날짜: 2026-07-22
상태: 승인 대기

로드맵 **5(a)**의 첫 단계다. 큰 목표("링크 공유 — 로그인 없이 링크만으로 참가 학생에게 정보
공유")를 한 스펙에 다 넣지 않고 3단계로 쪼갠 것 중 1단계: 비밀번호 게이트 + 일정 읽기 동기화 +
사진 업/다운로드. 수명 관리(원본 자동 삭제, Cron)는 별도 스펙(2단계)에서 다룬다.

## 배경 — 왜 서버가 지금 필요한가

지금 여행 데이터(`Trip`, `Member`, `Group`, `Place`, `Slot`, `Photo`)는 전부 인솔자 기기의
IndexedDB에만 있다(`src/db.ts`). 서버도 API도 없다. 참가자가 다른 기기에서 이 데이터를 보거나
사진을 올리려면, 그 데이터가 인솔자 기기 밖 어딘가에 있어야 한다 — 비밀번호 검증만 따로 만들어도
검증을 통과한 뒤 보여줄 데이터가 없으면 의미가 없다.

## 목표

1. 인솔자가 일정·장소·구성원·모둠을 로컬에서 구성한 뒤, 여행 비밀번호를 정하고 "공유"하면
   그 스냅샷이 서버에 올라간다
2. 참가자는 링크 접속 후 비밀번호 한 번만 입력하면(기기에 기억) 그 여행 일정을 계속 조회할 수
   있다
3. 참가자 누구나(인솔자 포함) 같은 비밀번호로 사진을 자유롭게 올리고 받을 수 있다 — 별도 승인이나
   권한 구분 없음

## 범위 밖

- 사진 원본의 자동 삭제/수명 관리 (2단계, Cron 필요)
- 슬라이드쇼 영상 제작·배포 (로드맵 6번, 5번 이후)
- 참가자별 개인 계정, 개별 접근 회수 — 로드맵에 "관리자 승인 게이트" 대안으로 검토했으나
  2026-07-22에 보류하고 단일 비밀번호 모델을 채택함(`docs/roadmap.md` 5(a) 참고)
- 일정 편집 UI를 참가자 기기에 새로 만드는 것 — 일정 편집은 여전히 인솔자 기기의 기존 화면에서만
  하고, 참가자는 결과만 조회함

## 결정된 설계

### 단일 비밀번호 모델

여행마다 비밀번호 하나. 이 비밀번호를 아는 사람은 누구나:

- 일정(장소·구성원·모둠·슬롯) 조회
- 사진 업로드·다운로드
- (인솔자 기기에서) 일정 재공유 — 비밀번호로 인증하므로 별도의 인솔자 전용 토큰은 두지 않음

인솔자와 참가자를 서버가 구분하지 않는다. 인솔자 기기가 특별한 건 그 기기에만 일정 "편집" UI가
있기 때문이지, 서버가 부여한 권한 때문이 아니다. 이 선택은 "정당한 참가자의 재배포는 못 막는다",
"공유 비밀번호라 개인별 회수 불가" 같은 이미 로드맵에 적힌 제약을 그대로 받아들이는 것이다.

### 데이터 모델

**로컬 `Trip` 확장** (`src/db.ts`, Dexie 스키마 버전 증가 필요):

```ts
interface Trip {
  // 기존 필드...
  shareId?: string;         // 랜덤 문자열, Dexie 숫자 PK와 별개. 첫 공유 시 발급
  sharePasswordHash?: string; // 서버에서만 검증하지만 로컬에도 복사본을 둬 "이미 공유됨"을 판단
}
```

`shareId`는 숫자 PK를 그대로 링크에 노출하면 순차 추측이 쉬워지므로 별도 발급한다(예: 16바이트
랜덤 → base62). 비밀번호가 뚫리지 않는 한 `shareId`를 안다고 뭔가 되는 건 아니지만, 그래도 무의미한
추측 시도 자체를 줄인다.

**Vercel KV:**

```
trip:{shareId}                → { passwordHash, schedule, updatedAt }
trip:{shareId}:photos         → [{ id, placeId, slotId, caption, ts, blobUrl }]
trip:{shareId}:attempts:{ip}  → 카운터, TTL 10분
```

`schedule`은 기존 내보내기 포맷(`2026-07-17-export-format-design.md`)의 `trip.json` 구조를
그대로 쓰되 `photos` 배열은 뺀다 — 사진은 별도 키로 관리한다(스냅샷 갱신 빈도와 사진 추가 빈도가
다르기 때문).

**Vercel Blob:**

```
photos/{shareId}/{photoId}.jpg
```

이미 승인된 `src/image.ts`의 압축 규격(긴 변 1600px, JPEG q0.8)을 그대로 재사용한다 — 업로드
전 클라이언트에서 압축하는 건 로컬 저장 때와 동일하고, 그 결과물을 로컬 IndexedDB 대신(또는 함께)
서버로도 보내는 것뿐이다.

### API 엔드포인트 (Vercel Functions, `/api/share/`)

| 메서드/경로 | 용도 | 인증 |
|---|---|---|
| `POST /api/share/:shareId` | 인솔자가 공유/재공유. body: `{ password, schedule }` | 최초 호출 시 `passwordHash` 없으면 새로 생성. 이후엔 body의 `password`가 기존 해시와 일치해야 교체 허용 |
| `POST /api/share/:shareId/verify` | 참가자가 비번 입력 | body의 `password` 해시 일치 시 `schedule` 반환 |
| `POST /api/share/:shareId/photos` | 사진 업로드 | body/헤더의 `password` 검증 |
| `GET /api/share/:shareId/photos` | 사진 목록+URL 조회 | 헤더의 `password` 검증(쿼리스트링에 평문 비번을 넣지 않음 — 접근 로그에 남는 걸 피함) |

모든 엔드포인트는 같은 `passwordHash` 검증 로직을 공유한다(별도 유틸 함수로 뺀다).

### 비밀번호 보안

- 저장: bcrypt 해시. 평문은 저장하지 않는다
- 시도 제한: `trip:{shareId}:attempts:{ip}` 카운터, 10분당 10회 초과 시 429. IP는 Vercel이
  제공하는 요청 헤더(`x-forwarded-for`)로 얻는다
- 오답 응답은 "비밀번호가 틀렸습니다"만 반환 — 남은 시도 횟수, 존재 여부 등 힌트를 주지 않는다
- 존재하지 않는 `shareId`도 "비밀번호가 틀렸습니다"와 동일하게 응답해 존재 여부를 숨긴다(사소하지만
  공짜인 방어)

### 에러 처리

- 비밀번호 미설정 여행에서 "공유" 시도 → 비밀번호 입력을 먼저 요구(공유 자체가 비번 없이 열리지
  않음)
- 사진 업로드 시 **장소당 4장 상한**(로드맵 0번 결정)을 서버에서도 검사 — `trip:{shareId}:photos`
  에서 해당 `placeId`의 개수를 세어 초과 시 거부. 클라이언트 쪽 상한 검사와 별개로 서버가 최종
  검증한다(클라이언트를 우회한 직접 API 호출 대비)
- 오프라인 상태의 업로드 시도 → 실패 안내만 하고 자동 재시도 큐는 두지 않는다(범위 밖, 필요해지면
  별도 스펙)
- rate limit 초과 → 429와 함께 "잠시 후 다시 시도하세요"

## 검증

기존 `scripts/smoke-*.mjs` 패턴을 따라 `scripts/smoke-share.mjs` 신설:

- 여행 공유(`POST /api/share/:shareId`) → 참가자로 비번 검증 → 스냅샷 일치 확인
- 오답 비밀번호 → 실패 응답 확인
- 시도 제한 초과 → 429 확인
- 사진 업로드 → 목록 조회에 반영 확인
- 장소당 4장 초과 업로드 → 거부 확인

`package.json`에 `test:share` 추가.

## 로컬 실행 준비물

`vercel dev`로 `/api`를 로컬에서 띄우려면 Vercel 대시보드에서 스토어를 만들고 프로젝트에
연결해야 한다(1회성, 사람이 직접). 이후 `vercel dev` → `npm run test:share:e2e` 순서로 검증
(2026-07-23 실측 **9/9 PASS**). 실제로 겪은 함정 4가지:

1. **Redis는 `@vercel/kv`가 아니라 `ioredis`로 붙는다.** Vercel 무료 Redis(마켓플레이스)는
   REST 자격증명(`KV_REST_API_*`) 없이 `REDIS_URL`(`redis://` 프로토콜)만 준다. 그래서 REST
   기반인 `@vercel/kv` 대신 `ioredis`로 연결한다(`api/_lib/kv.ts`). 값 직렬화는 JSON으로 처리.
2. **`/api`를 SPA rewrite에서 제외해야 한다.** `vercel.json`의 catch-all rewrite가 `/api/*`까지
   `index.html`로 돌려보내 함수가 안 잡힌다(HTML/500). 부정 룩어헤드에 `api/`를 추가한다.
3. **Blob 스토어는 반드시 "Public"으로.** 참가자가 사진을 공개 URL로 보므로 `access: 'public'`
   업로드가 필요하다. Private 스토어면 업로드가 거부된다(재생성 시 Public 선택).
4. **Blob 토큰(sensitive)은 Development에 자동 주입이 안 된다.** `BLOB_READ_WRITE_TOKEN`은
   민감 변수라 스토어 연결 시 Development 환경에 못 들어간다("sensitive cannot target
   development"). 로컬 테스트를 위해선 토큰을 **수동으로** Development에 non-sensitive로 등록한다:
   `vercel env add BLOB_READ_WRITE_TOKEN development` (값은 스토어 페이지의 `.env.local` 스니펫).
   `vercel dev`는 `.env.local`이 아니라 **클라우드 프로젝트의 Development 환경**을 함수에 주입하므로,
   `.env.local`에만 넣으면 함수가 못 본다.

## 후속 스펙에서 다룰 것

- 사진 원본 자동 삭제(슬라이드 제작 완료 시 + 유예기간 만료 시, 로드맵 5(a) "원본 사진의 수명"
  항목) — Vercel Cron 필요, 별도 스펙
- 슬라이드쇼 영상 제작·배포(로드맵 6번)
