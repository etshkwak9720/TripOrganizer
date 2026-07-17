# 개발 일지 (devlog)

TripOrganizer(여정앱)의 날짜별 개발 기록입니다. 각 `YYYY-MM-DD.md` 파일은
그날 만들어진 git 커밋(제목·본문)에서 **자동 생성**됩니다.

## 갱신 방법

```bash
npm run devlog      # 오늘 날짜 파일을 최신 커밋 기준으로 다시 생성
```

새 커밋이 쌓이면 그날 파일이 갱신되고, 날짜가 바뀌면 새 파일이 생깁니다.
이 `README.md`는 사람이 쓰는 개요 파일이라 스크립트가 건드리지 않습니다.

## 프로젝트 개요

React 19 + TypeScript + Vite로 만든 **여행 기록 PWA**. 여러 종류의 여행을
구성원·일정·장소·사진·미션과 함께 기록하고, 실시간 지도로 이동을 안내합니다.

- **저장소**: [github.com/etshkwak9720/TripOrganizer](https://github.com/etshkwak9720/TripOrganizer)
- **스택**: React 19, TypeScript, Vite, Dexie(IndexedDB), Tailwind, Leaflet
- **지도/경로**: OpenStreetMap 타일, Nominatim(장소 검색), OSRM(도로 경로) — `src/geo.ts`에 격리
- **오프라인**: 서비스워커 프리캐시(PWA), 지도 타일 런타임 캐시

## 지금까지의 큰 흐름

- **2026-07-15** — 초기 커밋, 지도·실시간 위치 기능 전체 구현: 식당 추천(목업) 제거,
  식당을 좌표 있는 장소로 통합(DB v5), PlacePicker(검색+핀), Live 지도(내 위치·OSRM 경로·ETA·도착 감지).
- **2026-07-16** — 첫 화면 제목·배경 정비, 아이콘 폰트 서브셋으로 첫 로딩 9.0MB → 1.7MB.
- **2026-07-17** — 첫 화면에 비행기 히어로 + 유리 패널 제목 + 카드 그림자(Stitch 디자인 패턴).

날짜별 상세는 같은 폴더의 `YYYY-MM-DD.md`를 참고하세요.
