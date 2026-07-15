# 여정 (Yeojeong) — 여행 플래너 + 미션 게임 PWA

구성원·장소·일정을 직접 입력해 쓰는 범용 여행 앱. 서버 없이 기기 안(IndexedDB)에서 동작하는
설치형 PWA입니다. React + Vite + TypeScript + Tailwind + Dexie.

## 실행

```bash
npm install
npm run dev          # 개발 서버 → http://localhost:5173

npm run build        # 프로덕션 빌드
npm run preview      # 빌드 결과 확인 → http://localhost:4173  (PWA/오프라인은 여기서 테스트)
```

> `dist/index.html`을 파일로 직접 열면(file://) 모듈 스크립트·서비스워커가 차단돼 동작하지 않습니다.
> 반드시 위 주소로 여세요.

## 검증 (Playwright)

```bash
npm run test:e2e      # 기능 26종을 실제 UI 조작으로 검증 (dev 서버 필요)
npm run test:offline  # 서비스워커/오프라인/설치 요건 검증 (preview 서버 필요)
npm run shots         # 데모 데이터 심고 전 화면 캡처 → screenshots/
npm run icons         # PWA 아이콘 재생성 → public/icons/
```

## 화면

| 탭 | 내용 |
|---|---|
| 지금 | 실시간 지도(Leaflet+OSM 타일, OSRM 도로 경로)·이동 시뮬레이션·ETA·진행률, 실 GPS 토글, 이동 중 장소 안내, 도착 알림(배너+진동) |
| 일정 | 일자별 타임라인, 장소 간 이동시간, 게임/휴식 모드 토글 |
| 미션 | 장소별 자동 추천 미션, 모둠 완료 체크·실시간 랭킹, 1등 상/꼴찌 벌, 관리자 상벌점 |
| 갤러리 | 장소별 사진 업로드 + 한줄 감상평 |
| 구성 | 구성원·모둠·장소(지역·유래/문화유산 학습 콘텐츠) |

일정은 하루를 **조식·오전·중식·오후·석식·저녁** 6밴드로 나눠 짜며,
식사 밴드도 활동 밴드와 같은 방식으로 **지도 검색(PlacePicker)으로 등록한 식당(장소)**에 연결합니다 —
등록된 식당은 슬롯의 `placeId`로 연결되어 방문지와 동일하게 지도·경로·사진에 포함됩니다.

## 알려진 제약

- **지도·지오코딩·경로는 OpenStreetMap(Leaflet 타일) · Nominatim · OSRM 공개 서버**를 씁니다(`src/geo.ts`).
  카카오/네이버 지도 API로 교체할 땐 이 파일만 바꾸면 됩니다. 이동시간의 **오프라인/OSRM 실패 시 폴백 추정치**만
  목업 로직입니다(`src/mock.ts`의 `estimateTravelMinutes`, 직선거리 기반).
- 위치·알림은 **앱이 열려 있을 때** 기준입니다. 백그라운드 추적·예약 푸시는 PWA(특히 iOS) 제약으로 별도 작업이 필요합니다.
- 사진·점수는 **기기 로컬 저장**입니다. 여러 명이 실시간 공유하려면 백엔드(Firebase 등)가 필요합니다.
- 사진 자동 슬라이드쇼 영상은 미구현(음원 저작권 때문에 로열티프리 한정 예정).

## 서비스워커 주의

`src/sw.js`는 직접 작성한 워커입니다. vite-plugin-pwa의 workbox 자동생성 SW는 이 Vite 빌드에서
평가에 실패해 **오프라인이 조용히 동작하지 않았습니다**(빌드 로그의 "precache N entries"는 런타임 보장이 아님).
또한 `caches.match`에는 `ignoreVary: true`가 필요합니다 — SW의 install fetch에는 `Origin` 헤더가 없어
`Vary: Origin` 응답과 매치되지 않기 때문입니다. 오프라인 동작을 바꿀 땐 `npm run test:offline`으로 확인하세요.
