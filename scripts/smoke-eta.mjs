// Regression: 이동 중 ETA가 갱신되는가.
//
// 재현 조건은 실 GPS + 느린 경로 서버다. watchPosition이 1초마다 틱하면 leg
// 조회 effect가 매번 재실행되는데, 예전 구현은 정리 함수로 진행 중이던 요청을
// 취소했다. 바로 위 throttle(30초/100m) 때문에 새 요청은 뜨지 않아서, 응답이
// 틱 간격보다 느리면 ETA가 영원히 첫 값(출발지 기준)에 멈춰버렸다.
//
// 그래서 여기서는 OSRM 응답을 일부러 1.2초 늦추고 GPS를 0.4초마다 움직인다.
// Run: node scripts/smoke-eta.mjs   (dev server must be running)
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

// 출발지(제주공항) → 목적지(성산일출봉). 남은 거리는 차수마다 줄어든다.
const LEGS = [60, 45, 30];
let served = 0;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

await page.route('**router.project-osrm.org/**', async (route) => {
  const durationMin = LEGS[Math.min(served, LEGS.length - 1)];
  served++;
  await new Promise((r) => setTimeout(r, 1200)); // GPS 틱(0.4초)보다 느린 응답
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      routes: [{
        geometry: { coordinates: [[126.4914, 33.5104], [126.9426, 33.4581]] },
        duration: durationMin * 60,
        distance: durationMin * 1000,
      }],
    }),
  });
});

// 이동하는 실 GPS를 흉내낸다. 속도가 중요하다 — 틱마다 100m 넘게 뛰면 매번
// 새 요청이 떠서 (정상적으로) 이전 요청이 무효화되므로 버그가 가려진다.
// 실제 차량처럼 틱당 ~11m씩 움직여야 throttle이 몇 틱 동안 새 요청을 막고,
// 그 사이 진행 중인 요청이 살아남는지를 본다.
// 목적지(제주공항)에서 서쪽 ~1.9km 지점에서 접근 — 도착 반경 80m 밖이라
// targetIdx가 넘어가지 않는다.
await page.addInitScript(() => {
  let step = 0;
  navigator.geolocation.watchPosition = (ok) => {
    const tick = () => {
      ok({ coords: { latitude: 33.5104, longitude: 126.4714 + step * 0.00012, accuracy: 12 } });
      step++;
    };
    tick();
    return setInterval(tick, 400);
  };
  navigator.geolocation.clearWatch = (id) => clearInterval(id);
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase('triporganizer'); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

await page.evaluate(() => new Promise((resolve, reject) => {
  const rq = indexedDB.open('triporganizer');
  rq.onerror = () => reject(rq.error);
  rq.onsuccess = () => {
    const db = rq.result;
    const names = ['trips', 'places', 'slots'];
    const tx = db.transaction(names, 'readwrite');
    const S = (n) => tx.objectStore(n);
    names.forEach((n) => S(n).clear());
    S('trips').put({ id: 1, title: 'ETA 갱신 회귀 테스트', startDate: '2026-09-14', dayCount: 1, mode: 'relaxed', createdAt: Date.now() });
    S('places').put({ id: 1, tripId: 1, name: '제주공항', region: '제주시', kind: 'sight', lat: 33.5104, lng: 126.4914 });
    S('places').put({ id: 2, tripId: 1, name: '성산일출봉', region: '서귀포시 성산읍', kind: 'sight', lat: 33.4581, lng: 126.9426 });
    S('slots').put({ id: 1, tripId: 1, dayIndex: 0, band: '오전', plannedTime: '10:00', placeId: 1 });
    S('slots').put({ id: 2, tripId: 1, dayIndex: 0, band: '오후', plannedTime: '14:00', placeId: 2 });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  };
}));

// networkidle을 쓰면 안 된다 — 이 테스트는 경로 요청이 끊임없이 도는 상황을
// 일부러 만들기 때문에 네트워크가 조용해질 일이 없다.
await page.goto(`${BASE}/trip/1/live`, { waitUntil: 'domcontentloaded' });

const eta = async () => Number((await page.locator('main').innerText().catch(() => '')).match(/약\s*(\d+)분/)?.[1] ?? NaN);

// 1) GPS가 계속 틱하는 동안에도 첫 ETA가 끝내 도착해야 한다.
await page.waitForFunction(() => /약\s*\d+분/.test(document.querySelector('main')?.innerText ?? ''), null, { timeout: 15000 })
  .catch(() => {});
const first = await eta();
check('이동 중에도 ETA가 표시된다', Number.isFinite(first), `약 ${first}분`);

// 2) 계속 이동하면 ETA가 출발지 기준 값에 멈추지 않고 갱신돼야 한다.
//    throttle이 30초라 여기선 100m 이동 조건으로 재조회가 걸린다.
await page.waitForFunction(
  (prev) => {
    const m = (document.querySelector('main')?.innerText ?? '').match(/약\s*(\d+)분/);
    return m && Number(m[1]) !== prev;
  },
  first,
  { timeout: 15000 },
).catch(() => {});
const second = await eta();
check('이동하면 ETA가 갱신된다', Number.isFinite(second) && second !== first, `약 ${first}분 → 약 ${second}분`);

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n==== ${results.length - failed}/${results.length} ${failed ? 'FAIL' : 'PASS'} ====`);
process.exit(failed ? 1 : 0);
