// Seeds a demo trip into the app's IndexedDB, then screenshots every screen
// at phone size. Output: screenshots/*.png
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots');
mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:5173';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

// 1. let the app create the Dexie schema
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

// 2. seed a full demo trip straight into IndexedDB
await page.evaluate(async () => {
  const mk = (color, text) => {
    const c = document.createElement('canvas');
    c.width = 500; c.height = 500;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 500, 500);
    g.addColorStop(0, color); g.addColorStop(1, '#00000033');
    x.fillStyle = g; x.fillRect(0, 0, 500, 500);
    x.fillStyle = '#fff'; x.font = 'bold 40px sans-serif'; x.textAlign = 'center';
    x.fillText(text, 250, 265);
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  };
  const photos = [
    await mk('#ff8c00', '성산일출봉'), await mk('#008080', '만장굴'),
    await mk('#2563eb', '우도'), await mk('#db2777', '동문시장'),
  ];

  await new Promise((res) => {
    const rq = indexedDB.open('yeojeong');
    rq.onsuccess = () => {
      const db = rq.result;
      const names = ['trips', 'members', 'groups', 'places', 'slots', 'missions', 'missionResults', 'adjustments', 'awards', 'photos'];
      const tx = db.transaction(names, 'readwrite');
      const S = (n) => tx.objectStore(n);
      names.forEach((n) => S(n).clear());

      S('trips').put({ id: 1, title: '2학년 3반 제주 수학여행', startDate: '2026-09-14', dayCount: 3, mode: 'game', createdAt: Date.now() });

      ['1모둠', '2모둠', '3모둠'].forEach((name, i) => S('groups').put({ id: i + 1, tripId: 1, name, score: 0 }));
      ['김민준', '이서연', '박지호', '최수아', '정하윤', '강도윤'].forEach((name, i) =>
        S('members').put({ id: i + 1, tripId: 1, name, groupId: (i % 3) + 1 }));

      S('places').put({ id: 1, tripId: 1, name: '성산일출봉', region: '서귀포시 성산읍', lat: 33.458, lng: 126.9425, learn: '약 5천 년 전 얕은 바다에서 수성화산 분출로 만들어진 응회구입니다. 분화구 정상의 일출이 장관이라 영주십경 제일로 꼽히며, 2007년 유네스코 세계자연유산으로 지정됐습니다.' });
      S('places').put({ id: 2, tripId: 1, name: '만장굴', region: '제주시 구좌읍', lat: 33.5283, lng: 126.7715, learn: '약 10~30만 년 전 형성된 세계적 규모의 용암동굴로 총 길이 약 7.4km입니다. 내부의 높이 7.6m 용암석주는 세계 최대 규모로 알려져 있습니다.' });
      S('places').put({ id: 3, tripId: 1, name: '우도 해변', region: '제주시 우도면', lat: 33.5065, lng: 126.9527, learn: '소가 누운 모습을 닮아 우도라 불립니다. 홍조단괴 해빈은 천연기념물로, 산호가 아닌 홍조류가 만든 세계적으로 드문 백사장입니다.' });

      const slots = [
        { id: 1, dayIndex: 0, band: '조식', plannedTime: '08:00', mealId: 2 },
        { id: 2, dayIndex: 0, band: '오전', plannedTime: '10:00', placeId: 1 },
        { id: 3, dayIndex: 0, band: '중식', plannedTime: '12:30', mealId: 1 },
        { id: 4, dayIndex: 0, band: '오후', plannedTime: '14:30', placeId: 2 },
        { id: 5, dayIndex: 0, band: '석식', plannedTime: '18:00', mealId: 3 },
        { id: 6, dayIndex: 0, band: '저녁', plannedTime: '20:00', placeId: 3 },
      ];
      slots.forEach((s) => S('slots').put({ ...s, tripId: 1 }));

      const missions = [
        { id: 1, placeId: 1, title: '정상에서 하늘 향해 점프샷', type: 'photo', points: 20 },
        { id: 2, placeId: 1, title: '정상까지 모둠 전원 도착 인증', type: 'gather', points: 25 },
        { id: 3, placeId: 2, title: '동굴 안 실루엣 사진', type: 'photo', points: 15 },
        { id: 4, placeId: null, title: '지역 주민과 대화 인증샷', type: 'photo', points: 30 },
        { id: 5, placeId: null, title: '지정 장소에 3분 안에 모둠 전원 집합', type: 'gather', points: 20 },
      ];
      missions.forEach((m) => S('missions').put({ ...m, tripId: 1, safe: true }));

      const results = [[1, 1], [2, 1], [4, 1], [1, 2], [3, 2], [1, 3]];
      results.forEach(([missionId, groupId], i) =>
        S('missionResults').put({ id: i + 1, tripId: 1, missionId, groupId, done: true, ts: Date.now() }));
      S('adjustments').put({ id: 1, tripId: 1, groupId: 2, delta: 10, reason: '질서 잘 지킴', ts: Date.now() });
      S('awards').put({ tripId: 1, firstGroupReward: '저녁 간식 쏘기', lastGroupPenalty: '장기자랑 한 곡' });

      const caps = ['정상에서 본 일출 최고!', '용암동굴 진짜 웅장했다', '', '흑돼지 먹방 성공'];
      const pids = [1, 2, 3, null];
      photos.forEach((b, i) => S('photos').put({ id: i + 1, tripId: 1, placeId: pids[i], blob: b, caption: caps[i], ts: Date.now() + i }));

      tx.oncomplete = () => res();
    };
  });
});

const shots = [
  ['01-trips', '/', 0],
  ['02-setup', '/trip/1/setup', 0],
  ['03-schedule', '/trip/1/schedule', 0],
  ['04-itinerary', '/trip/1', 0],
  ['05-missions', '/trip/1/missions', 0],
  ['06-live', '/trip/1/live', 0],
  ['07-gallery', '/trip/1/gallery', 0],
];

for (const [name, path] of shots) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log('shot', name);
}

await browser.close();
console.log('done ->', OUT);
