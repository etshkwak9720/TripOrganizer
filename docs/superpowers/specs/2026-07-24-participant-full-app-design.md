# 설계: 참가자 화면을 4탭 앱으로 (지금·일정·미션·갤러리, 거의 실시간)

## 배경 — 왜 필요한가

현재 참가자 화면(`/join/:shareId`, `src/pages/Join.tsx`)은 일정 일부와 사진 업로드만
보여준다. 인솔자 앱의 핵심 탭 — **지금**(위치·도착시간), **일정**, **미션**(랭킹),
**갤러리** — 은 참가자에게 공유되지 않는다. 학생도 이 네 화면을 볼 수 있어야 여행 앱의
가치가 참가자에게 전달된다.

또한 미션 점수·상벌점처럼 여행 중 계속 바뀌는 값이 참가자에게 **거의 실시간**으로 반영돼야
하고, 학생이 **자기가 올린 사진을 삭제·교체**할 수 있어야 한다.

## 목표

- 참가자 화면을 하단 탭(지금·일정·미션·갤러리)을 가진 앱으로 확장.
- 인솔자가 여행 중 데이터를 바꾸면 참가자 화면에 거의 실시간 반영(자동 재발행 + 자동 새로고침).
- 학생이 **자기가 올린** 사진만 삭제·교체 가능(계정 없이 기기 토큰으로 구분).

## 범위 밖

- 인솔자/그룹의 **실시간 위치 스트리밍**(지금은 학생 본인 GPS 기준으로 계산 — 결정됨)
- 참가자별 개인 계정·로그인
- 사진 자동 삭제/수명 관리, 슬라이드쇼(기존 후속 스펙)
- 참가자가 미션 완료 토글·상벌점 부여(읽기 전용)

## 결정된 설계 (사용자 확정)

1. **지금**의 도착시간은 **학생 본인 핸드폰 GPS** 기준(인솔자 앱과 동일 방식, 서버 실시간 동기화 없음).
2. 미션 점수 등 바뀌는 정보는 **자동 갱신(거의 실시간)** — 인솔자 앱 자동 재발행 + 참가자 자동 새로고침.
3. 사진 삭제·교체는 **자기가 올린 것만** — 기기 토큰(localStorage UUID)으로 소유권 구분.

## 아키텍처

### A. 데이터 계층

**A-1. 스냅샷 확장** (`src/share.ts`의 `ShareSnapshot`)
아래를 추가한다(기존 `trip/members/groups/places/slots` 유지):
- `groups`: `{ id, name }[]` — 랭킹 매핑에 id 필요(현재는 name/score만). score는 미션에서 계산하므로 제외.
- `places`: 기존 필드 + `learn?`(장소 안내) 추가.
- `missions`: `{ id, placeId, title, type, points, safe }[]`
- `missionResults`: `{ missionId, groupId, done }[]`
- `adjustments`: `{ groupId, delta, reason, ts }[]`
- `awards`: `{ firstGroupReward, lastGroupPenalty } | null`

**A-2. 랭킹 계산 공용화** — `computeRanking(groups, missions, missionResults, adjustments)`를
순수 함수로 `src/share.ts`(또는 인접 순수 모듈)에 추출해 인솔자 `Missions`와 참가자 미션 뷰가 공유.

**A-3. 인솔자 자동 재발행** — `src/shareClient.ts`에 `useAutoRepublish(tripId)` 훅(또는 컴포넌트)
추가. 공유된 여행(`shareId`·`sharePassword` 존재)에 한해, 관련 테이블(trips/places/slots/groups/
missions/missionResults/adjustments/awards)을 Dexie liveQuery로 구독하고 변경 시 **디바운스
(~3초)** 후 `publishShare(tripId, sharePassword)` 재호출. 인솔자 `TripLayout`에서 마운트.

**A-4. 참가자 스냅샷 조회 API** — `GET /api/share/:shareId` 신설. 헤더 `x-trip-password`로 검증
후 최신 `{ schedule }` 반환(쿼리스트링에 비번 금지 — 기존 photos GET과 동일 규약).

**A-5. 참가자 자동 새로고침** — 참가자 앱이 인증 후: 화면 열 때 1회 + `visibilitychange`(포커스)
+ 주기(~20초) 타이머로 `GET /api/share/:id` 재요청해 스냅샷 갱신.

### B. 참가자 탭 셸

- 라우트: `/join/:shareId`(입장/셸) 하위에 탭 상태로 지금·일정·미션·갤러리 전환(하단 탭).
  기존 인솔자 `BottomTabs`의 참가자용 버전을 별도 컴포넌트로 둔다(경로가 `/trip/:id/*`가 아니라
  탭 로컬 상태 또는 `/join/:shareId/:tab`).
- 비번 입장 → 스냅샷 로드(+A-5 자동 새로고침 시작) → 탭별 뷰 렌더. 읽기 전용(갤러리 예외).

### C. 각 탭 뷰 (참가자, 읽기 전용)

- **일정**: 스냅샷 `slots`/`places`를 일차·시간대(band)별로. 현재 Join 일정 화면을 정돈.
- **지금**: `LiveMap`(기존 컴포넌트) + 동선 + "다음 목적지까지 약 N분". 위치는 **학생 본인 GPS**
  (`navigator.geolocation`), 경로/ETA는 기존 `fetchRoute`·`estimateTravelMinutes`·`orderSlots`
  재사용. 인솔자 `Live.tsx`의 지도·ETA 로직 중 재사용 가능한 부분을 공용 컴포넌트로 추출.
- **미션**: `computeRanking`으로 실시간 랭킹 + 1등상/꼴찌벌(`awards`) + 장소별 미션 목록.
  완료 토글·관리자 상벌점 UI 없음(읽기 전용).
- **갤러리**: 서버 사진(`GET /api/share/:id/photos`) 장소별 필터·감상평 표시 + 올리기 + 내 사진
  삭제·교체.

### D. 사진 소유권 · 삭제 · 교체

- **기기 토큰**: 참가자 앱 최초 실행 시 `crypto.randomUUID()`를 `localStorage`(`photo-owner`)에
  저장. 업로드 요청 body에 `owner` 포함.
- **`PhotoMeta.owner`**: `src/share.ts`의 `PhotoMeta`에 `owner?: string` 추가. 업로드 API가 저장.
- **삭제 API**: `DELETE /api/share/:shareId/photos` — body `{ password, id, owner }`. 비번 검증 +
  대상 사진의 `owner`가 요청 `owner`와 **일치할 때만** 삭제(Blob del + KV 목록에서 제거). 불일치 403.
- **교체**: 삭제 + 새 업로드(별도 특수 API 없음). UI에서 "교체" = 기존 삭제 후 파일 선택 업로드.
- **UI**: 갤러리에서 사진의 `owner === 내 토큰`일 때만 삭제·교체 버튼 노출. 장소당 4장 상한은
  삭제로 자리 회복.

## 검증

- 순수 로직 단위 테스트(`scripts/test-share.mjs` 확장): `computeRanking`, 스냅샷 확장 타입,
  삭제 소유권 검사 헬퍼.
- E2E 스모크(`scripts/smoke-share.mjs` 확장): 스냅샷에 미션/그룹 포함, `GET /api/share/:id`,
  사진 업로드→소유자 삭제 성공/타인 삭제 403.
- 브라우저 스모크: 참가자 탭 전환, 각 탭 렌더, 갤러리 삭제/교체 버튼 노출 규칙.
- 배포본(`triporganizer-app.vercel.app`) 실기기 확인.

## 구현 단계 (각 단계가 독립적으로 동작 — 단계별 플랜 권장)

1. **데이터 계층**: 스냅샷 확장 + `computeRanking` + 인솔자 자동 재발행 + `GET /api/share/:id` + 참가자 자동 새로고침.
2. **탭 셸 + 일정 + 갤러리**(사진 소유권·삭제·교체 포함).
3. **미션**(랭킹 읽기 전용).
4. **지금**(지도·ETA, 본인 GPS).
