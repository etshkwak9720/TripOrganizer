# 설계: 식당 추천 제거 + 장소 통합 + 실시간 지도 내비게이션

날짜: 2026-07-15
상태: 승인됨

## 목표

1. 목업 데이터 기반 식당 추천 기능을 제거한다.
2. 식당을 좌표를 가진 장소로 직접 입력하게 하고, 사진(먹거리 포함) 업로드는 기존 슬롯 사진 기능을 그대로 쓴다.
3. Live 페이지에 실제 지도를 띄워 목적지·내 위치·이동경로·남은 시간을 실시간으로 보여준다.

## 기술 선택 (확정)

| 항목 | 선택 | 근거 |
|---|---|---|
| 지도 | Leaflet + OpenStreetMap 타일 | API 키·가입 불필요. 추후 카카오맵 교체 가능 |
| 경로/ETA | OSRM 공개 서버 (`router.project-osrm.org`) | 무료·키 불필요, 실제 도로 경로 + 소요시간 |
| 지오코딩 | Nominatim 공개 서버 | 무료·키 불필요, 이름/주소 → 좌표 |
| 지도 React 바인딩 | react-leaflet | 표준 선택지 |

공개 서버는 소규모 사용 전제. 검색·경로 호출은 각각 단일 모듈(`src/geo.ts`)로 격리해
나중에 카카오 API로 교체할 때 한 곳만 바꾸면 되게 한다.

## 1. 데이터 모델 (db.ts — 스키마 v5)

- `Place`에 추가:
  - `kind: 'sight' | 'food'` — 방문지/식당 구분. 기존 데이터는 마이그레이션에서 `'sight'`로 채움.
  - `address?: string` — 검색 결과의 표시 주소.
- `Slot`:
  - `mealId` 필드 제거. 식사 밴드도 활동 밴드처럼 `placeId`로 장소 참조.
  - `activityText`는 식사 밴드에서 메뉴 메모("꼬막비빔밥")로 유지.
- `meals` 테이블 삭제 (`this.version(5).stores({ meals: null })`).
- 마이그레이션(upgrade v5): 슬롯의 `mealId` 값은 버린다. 식당 이름은 추천 선택 시점에
  이미 `activityText`로 복사돼 있으므로 표시 데이터 손실 없음. 기존 place에 `kind: 'sight'` 부여.
- `deleteTrip`에서 meals 관련 코드 없음(전역 테이블이었음) — 삭제 목록 변화 없음.

## 2. 식당 추천 제거

- `Schedule.tsx`: MealPicker 모달, MealRow, "추천 보기" 버튼, "추천 선택됨" 표시, `pickMeal` 상태 삭제.
- `Itinerary.tsx`: `meals` 쿼리, `mealById`, "추천: …" 표시 줄 삭제.
- `mock.ts`: `MOCK_MEALS`, `seedMealsIfEmpty`, `PRICE_LABEL` 삭제.
  `estimateTravelMinutes`는 오프라인 폴백용으로 유지.
- `getJejuCoords` 삭제. 현재 Setup의 장소 추가에서 이름 매칭 실패 시 제주 인근 **임의 좌표**를
  부여하는데, 실제 지도가 생기면 임의 좌표는 엉뚱한 마커를 만들므로 제거하고
  PlacePicker 검색으로 대체한다. 좌표 미입력 장소는 좌표 없음으로 저장(5장 에러 처리 참조).
- `main.tsx`의 `seedMealsIfEmpty()` 호출(7행) 제거.

## 3. 장소 입력 — PlacePicker 컴포넌트

새 컴포넌트 `src/components/PlacePicker.tsx` + 지오코딩 모듈 `src/geo.ts`.

동작:
1. 이름/주소 입력(디바운스 500ms) → Nominatim 검색(`format=jsonv2`, `accept-language=ko`,
   `countrycodes=kr`, 결과 5개).
2. 후보 선택 → lat/lng/address 채움.
3. 미니 Leaflet 지도에 드래그 가능한 핀 표시 → 미세조정.
4. 저장 시 `places` 테이블에 추가(또는 기존 장소 좌표 갱신).

사용처:
- 구성(Setup) 페이지의 장소 추가/편집 → `kind: 'sight'` 기본.
- Schedule의 식사 슬롯 → "식당 등록" 버튼으로 열고 `kind: 'food'` 기본.
  등록된 식당은 슬롯의 `placeId`로 연결되고 방문지와 동일하게 지도·경로에 포함.
- 식사 슬롯 UI: 식당(장소) 선택 셀렉트 + 메뉴 메모 입력 + 기존 SlotPhotoManager(사진).

사진: 변경 없음. 기존 슬롯 사진 업로드가 식당·먹거리 사진을 이미 지원하며
일정표·앨범에 표시된다.

## 4. Live 페이지 — 지도 + 실시간 내비게이션

구성(위→아래): 지도(화면 상단 ~55%), 상태 카드, 동선 목록.

지도 표시물:
- 오늘 동선 장소들: 번호 마커(방문 순서), 식당은 아이콘 구분.
- 내 위치: 파란 점 + 정확도 원(`watchPosition`, `enableHighAccuracy`).
- 경로선: OSRM `route/v1/driving` polyline.
  - 하루 전체 동선 경로: 목적지 목록 변경 시 1회 조회.
  - 내 위치 → 다음 목적지 경로: 30초 간격 또는 100m 이상 이동 시 갱신.
- 자동 화면 맞춤: 최초 로드 시 전체 동선 bounds, 이동 중에는 내 위치+다음 목적지 bounds.

상태 카드:
- 이동 중: "다음: {장소} · 약 N분 남음 · 도착 예정 HH:MM" (OSRM duration 기반).
- 도착 감지: 다음 목적지 반경 80m 진입 시 배너 + 진동, 목적지 인덱스 자동 전진.
- 하루 완료 시 완료 카드.

모드:
- 실 GPS 기본. 기존 시뮬레이션 모드 유지(데모용) — 가상 위치가 지도 위 경로를 따라 이동.
- 시뮬/GPS 토글은 기존 TopBar 칩 유지.

## 5. 에러 처리

| 상황 | 처리 |
|---|---|
| 위치 권한 거부 | 안내 배너 + 시뮬 모드 전환 버튼 |
| OSRM 실패/오프라인 | 직선 polyline + `estimateTravelMinutes` 폴백, "추정치" 뱃지 |
| Nominatim 실패 | "검색 실패, 잠시 후 재시도" 안내, 핀 직접 찍기는 계속 가능 |
| 좌표 없는 장소 | 경로에서 제외, 동선 목록에 "좌표 없음" 배지 + 탭하면 PlacePicker 열기 |
| 오프라인 지도 타일 | 서비스워커에 OSM 타일 런타임 캐시(cache-first, 상한 있는 단순 캐시) — 본 적 있는 지역은 오프라인에서도 표시 |

Geolocation은 secure context 필요 — localhost·Vercel 배포 모두 충족.

## 6. 테스트

- 기존 e2e(scripts/e2e*.mjs)에서 식당 추천 관련 단계 제거·수정.
- 새 e2e: Nominatim/OSRM fetch 모킹 →
  1) 장소 검색·선택·핀 저장 → places에 좌표 저장 확인,
  2) Live 지도 마커·경로선 렌더 확인,
  3) 시뮬 모드 재생 → 도착 배너 표출 확인.
- `npm run build` 통과 확인.

## 범위 밖 (이번에 안 함)

- 카카오/네이버 지도·API 연동 (교체 지점만 격리)
- 대중교통·도보 경로 (OSRM driving만)
- 다중 사용자 위치 공유
