# 설계: 사진 업로드 압축 + 여행 내보내기 포맷

날짜: 2026-07-17
상태: 승인됨

로드맵 **1-1**에 해당한다. 구현은 1-2, 가져오기·ID 충돌 처리는 1-3에서 다룬다.

## 목표

1. 업로드 시점에 사진을 압축해 저장 용량과 내보내기 크기를 상한 안에 둔다.
2. 여행 하나를 **앱 없이도 열 수 있는** 단일 파일로 내보낸다.
3. "장소당 전체 4장" 상한이 갤러리·슬롯 양쪽에 적용될 수 있게 데이터를 정리한다.

## 배경 — 왜 압축이 내보내기보다 먼저인가

현재 두 업로드 지점이 카메라 File을 **원본 그대로** IndexedDB에 넣는다
(`src/pages/Gallery.tsx:141`, `src/pages/Schedule.tsx:279`). 압축이 전혀 없다.
`src/ocr.ts`에 canvas 처리가 있지만 일정표 OCR 전처리용이고 저장 사진과 무관하다.

요즘 폰 사진이 장당 2~5MB다. 장소 20곳짜리 여행이면 **20 × 4 × 3MB ≈ 240MB**.

- **내보내기**: 카톡 전송 한도를 넘고, 브라우저에서 만들다 메모리가 터진다
- **저장**: IndexedDB 용량 한도에 걸리면 지키려던 데이터가 날아간다 — 1번(데이터 보존)의 존재 이유와 자기모순
- **5번(서버)**: 이 크기로는 업로드가 불가능하다

긴 변 1600px · JPEG q0.8로 압축하면 **≈24MB**. 이 사진의 용도는 기록·슬라이드쇼이지
인화가 아니므로 1600px면 충분하다. 대가는 원본 화질의 영구 손실이다.

**압축이 정해지면 내보내기 답이 따라 나온다** — 24MB면 사진을 다 넣어도 카톡으로 넘어가므로
"백업용/공유용" 두 모드로 나눌 이유가 없어진다.

## 기술 선택 (확정)

| 항목 | 선택 | 근거 |
|---|---|---|
| 압축 | `createImageBitmap` → canvas → `toBlob('image/jpeg', 0.8)`, 긴 변 1600px | `ocr.ts`가 이미 쓰는 패턴. 새 의존성 없음 |
| 내보내기 컨테이너 | ZIP (JSZip) | 앱이 없어도 압축을 풀면 사진이 그대로 나온다 |
| JSZip 로딩 | 동적 `import()` | `ocr.ts`의 tesseract.js 지연 로딩 패턴. 첫 화면 로딩 1.7MB 유지 |
| 내보내기 모드 | 하나 | 압축 후 24MB면 공유도 되므로 분리 불필요 |
| 기존 사진 마이그레이션 | **안 함** | 실사용 전이라 저장된 사진이 없다 |

**왜 ZIP인가.** 이 기능의 목적은 데이터 보존이다. 백업이 우리 파서의 수명에 묶이면 그건 보존이
아니다. ZIP은 앱이 사라져도 어떤 압축 해제 도구로든 사진을 꺼낼 수 있다.
JSON+base64는 의존성이 없는 대신 33% 부풀고(24MB → 32MB) 열어도 base64 덩어리이며,
커스텀 바이너리는 가장 작지만 우리 파서 없이는 못 연다 — 둘 다 이 이유로 탈락.

## 1. 압축 모듈 (`src/image.ts` 신규)

이미지 처리를 한 모듈에 격리한다 — `geo.ts`가 외부 지오 서비스를 격리한 것과 같은 방식이다.

```ts
export async function compressPhoto(file: File): Promise<Blob>
```

- `createImageBitmap(file, { imageOrientation: 'from-image' })` — EXIF 회전을 반영해야
  세로로 찍은 사진이 눕지 않는다
- 긴 변을 `MAX = 1600`으로 축소. 이미 그보다 작으면 원본 크기를 유지한다(확대하지 않는다)
- `canvas.toBlob('image/jpeg', 0.8)`
- **디코딩 실패 시 원본 `file`을 그대로 반환한다.** 사진을 잃는 것보다 낫고,
  `accept="image/*"` + `createImageBitmap` 조합에서는 드문 경우다

## 2. 관문 (`src/db.ts`)

```ts
export async function addPhoto(p: {
  tripId: number;
  placeId?: number | null;
  slotId?: number | null;
  file: File;
}): Promise<number>
```

- `compressPhoto`를 통과시킨 뒤 `photos.add`
- **`slotId`가 있고 그 슬롯에 `placeId`가 있으면 `Photo.placeId`에 복사한다.**
  `Slot`에 이미 `placeId`가 있으므로 성산일출봉 슬롯에 붙인 사진은 성산일출봉 사진이다.
  이 비정규화가 있어야 상한이 `placeId` 단순 카운트로 성립하고,
  "장소당 전체 4장"이 갤러리·슬롯 양쪽을 자동으로 덮는다

`Gallery.tsx`·`Schedule.tsx`는 `db.photos.add()`를 직접 부르지 않고 이 함수만 부른다.
업로드 지점이 늘어나도 **압축을 우회할 방법이 구조적으로 없다.**

> **상한 검사(4장 초과 거부)는 이 설계의 범위 밖이다.** 0번의 "상한 도달 시 동작 —
> 업로드 차단인가 교체 유도인가"가 아직 미결이라 지금 구현할 수 없다. 2번(사진 정책 구현)에서
> 이 함수에 검사를 추가한다. 여기서는 그때 검사가 가능하도록 `placeId` 비정규화만 해둔다.

## 3. 내보내기 포맷

```
trip.json
photos/<id>.<ext>
```

`<ext>`는 저장된 blob의 `type`에서 뽑는다 — 압축을 통과했으면 `.jpg`지만, §1의 폴백으로
원본이 그대로 들어온 경우엔 `.png` 등이 될 수 있다. 확장자를 `.jpg`로 고정하면 그 사진의
이름표가 거짓이 되고, 압축을 풀어 열었을 때 열리지 않는다. 읽는 쪽은 확장자를 추측하지 말고
`trip.json`의 `file` 값을 그대로 쓴다.

```ts
export async function exportTrip(tripId: number): Promise<Blob>
```

`trip.json`:

```json
{
  "formatVersion": 1,
  "exportedAt": 1752710400000,
  "trip": { "id": 1, "title": "제주 수학여행", "startDate": "2026-07-20", "dayCount": 3, "mode": "game", "createdAt": 1752000000000 },
  "members": [],
  "groups": [],
  "places": [],
  "slots": [],
  "awards": null,
  "missions": [],
  "missionResults": [],
  "adjustments": [],
  "photos": [
    { "id": 1, "tripId": 1, "placeId": 3, "slotId": null, "caption": "", "ts": 1752700000000, "file": "photos/1.jpg" }
  ]
}
```

- **원래 `id`를 그대로 보존한다.** 1-3의 ID 재매핑이 원본 참조 관계를 알아야 하므로
  내보낼 때 ID를 지우거나 바꾸면 안 된다
- `photos` 레코드에서 `blob`을 빼고 `file` 경로로 대체한다
- `awards`는 `tripId`가 기본키인 단일 레코드다(`'tripId'`) — 배열이 아니며, 없으면 `null`
- 전 테이블을 `tripId`로 필터한다. `missionResults`·`missions`·`adjustments`는 모두
  `tripId`를 직접 들고 있어 조인 없이 걸러진다
- 사진은 ZIP에 **store 모드**(추가 압축 없음)로 넣는다 — JPEG·PNG 모두 이미 압축돼 있어
  deflate가 시간만 쓰고 크기를 못 줄인다

**오프라인 내보내기는 동작한다.** `vite.config.ts`의 `injectManifest.globPatterns`가
`**/*.js`를 잡으므로 JSZip 청크도 프리캐시에 들어간다. 첫 화면 로딩에는 안 실리고
서비스워커 설치 시 ~95KB가 늘어난다.

## 4. 에러 처리

- **이미지 디코딩 실패** → 원본 저장 (§1)
- **사진 blob 누락** (레코드는 있는데 blob이 없는 경우) → 그 사진만 건너뛰고
  `trip.json`에 `"file": null`로 기록한 뒤 나머지를 계속 내보낸다. 부분 백업이 실패보다 낫다
- **여행에 사진이 하나도 없음** → `photos/` 없이 `trip.json`만 든 ZIP. 정상 동작이다

## 5. 검증

`src/image.ts`는 **Node에서 테스트할 수 없다** — `createImageBitmap`과 canvas가 없다.
`scripts/test-geo.mjs`가 vite `ssrLoadModule`로 되는 것은 `geo.ts`가 순수 로직이기 때문이고,
`image.ts`에는 그 방법이 통하지 않는다. 저장소의 Playwright 스모크 패턴
(`smoke-live.mjs`·`smoke-meal.mjs`와 같은 형태, pass/fail 카운트)을 따른다.

- `scripts/smoke-image.mjs` — 큰 이미지를 `addPhoto`에 넣고: 저장된 blob의 긴 변이 1600 이하인가,
  원본보다 작은가, EXIF 회전이 반영됐는가, 슬롯 업로드 시 `placeId`가 복사됐는가
- `scripts/smoke-export.mjs` — 사진 있는 여행을 시드하고 내보낸 뒤:
  ZIP에 `trip.json`과 `photos/*.jpg`가 있는가, `trip.json`의 ID가 보존됐는가,
  전체 크기가 예상 범위인가

`package.json`에 `test:image`·`test:export`를 추가한다.

가져오기·복원 검증은 1-5의 몫이므로 여기 넣지 않는다.

## 범위 밖

- 가져오기·복원·ID 충돌 처리 → 1-3
- 상한 도달 시 UI 동작 → 2번 (0번의 미결 사항)
- 사진 종류(음식·단체·모둠) 태그 → 2번
- 서버 전송 → 5번
