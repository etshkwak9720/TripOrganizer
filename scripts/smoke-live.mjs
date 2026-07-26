// Smoke test for LiveMap + Live page (Task 5): numbered map markers, OSRM
// route polylines, simulated movement, ETA text, and arrival banner.
// Run: node scripts/smoke-live.mjs   (dev server must be running; set BASE_URL to override)
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

// Mock OSRM route responses.
await page.route('**router.project-osrm.org/**', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      routes: [
        {
          geometry: { coordinates: [[126.4914, 33.5104], [126.9426, 33.4581]] },
          duration: 3600,
          distance: 60000,
        },
      ],
    }),
  }),
);
// Avoid real tile traffic: 1x1 transparent PNG for any tile request.
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
await page.route('**tile.openstreetmap.org/**', (route) =>
  route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG }),
);
// Block Nominatim entirely — Live must never call it.
await page.route('**nominatim**', (route) => route.abort());

// ---------- clean slate ----------
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase('yeojeong'); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// ---------- seed trip + places + slots straight into IndexedDB ----------
await page.evaluate(() => new Promise((resolve, reject) => {
  const rq = indexedDB.open('yeojeong');
  rq.onerror = () => reject(rq.error);
  rq.onsuccess = () => {
    const db = rq.result;
    const names = ['trips', 'places', 'slots'];
    const tx = db.transaction(names, 'readwrite');
    const S = (n) => tx.objectStore(n);
    names.forEach((n) => S(n).clear());

    S('trips').put({ id: 1, title: '실시간 내비 스모크 테스트', startDate: '2026-09-14', dayCount: 1, mode: 'relaxed', createdAt: Date.now() });
    S('places').put({ id: 1, tripId: 1, name: '제주공항', region: '제주시', kind: 'sight', lat: 33.5104, lng: 126.4914 });
    S('places').put({ id: 2, tripId: 1, name: '성산일출봉', region: '서귀포시 성산읍', kind: 'sight', lat: 33.4581, lng: 126.9426 });
    S('places').put({ id: 3, tripId: 1, name: '서귀포', region: '서귀포시', kind: 'sight', lat: 33.2541, lng: 126.5601 });
    S('slots').put({ id: 1, tripId: 1, dayIndex: 0, band: '오전', plannedTime: '10:00', placeId: 1 });
    S('slots').put({ id: 2, tripId: 1, dayIndex: 0, band: '오후', plannedTime: '14:00', placeId: 2 });
    S('slots').put({ id: 3, tripId: 1, dayIndex: 0, band: '저녁', plannedTime: '18:00', placeId: 3 });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  };
}));

// ---------- navigate to Live ----------
await page.goto(`${BASE}/trip/1/live`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
check('지금 페이지 이동', page.url().includes('/live'));

// ---------- map + markers ----------
const mapVisible = await page.locator('[data-kakao-map]').first().isVisible().catch(() => false);
check('지도 표시', mapVisible);

const markerCount = await page.locator('[data-map-pin="stop"]').count().catch(() => 0);
check('번호 마커 3개 표시', markerCount === 3, `count=${markerCount}`);

// ---------- switch to simulation mode ----------
const modeChip = page.locator('button', { hasText: /실 GPS|시뮬/ }).first();
check('GPS/시뮬 전환 칩 노출', await modeChip.isVisible().catch(() => false));
await modeChip.click();
await page.waitForTimeout(300);
check('시뮬 모드로 전환', /시뮬/.test(await modeChip.innerText().catch(() => '')));

// ---------- entering sim mode parks on stop 1 (distance 0) — must NOT fire an arrival banner ----------
await page.waitForTimeout(1000); // let position/arrival effects settle
const earlyText = await page.locator('main').innerText().catch(() => '');
check('시뮬 진입 시 조기 도착 배너 없음', !/도착!/.test(earlyText), earlyText.match(/도착!/)?.[0] || 'none (expected)');

// ---------- ETA check BEFORE starting movement ----------
await page.waitForTimeout(1500); // let mocked OSRM leg resolve
const bodyText = await page.locator('main').innerText().catch(() => '');
const etaMatch = bodyText.match(/약\s*\d+분/)?.[0] || 'not found';
check('ETA 텍스트(약 N분) 표시', /약\s*\d+분/.test(bodyText), etaMatch);

// ---------- leg polyline ----------
const pathCount = await page.locator('[data-kakao-map] svg path').count().catch(() => 0);
check('경로 폴리라인 표시', pathCount > 0, `path count=${pathCount}`);

// ---------- 12x speed + start ----------
const speedChip = page.locator('button', { hasText: '12x' });
await speedChip.click().catch(() => {});
const startBtn = page.getByRole('button', { name: /이동 시작/ });
check('이동 시작 버튼 노출', await startBtn.isVisible().catch(() => false));
await startBtn.click();

// ---------- wait for arrival at the LAST stop (서귀포) — traverses two legs at 12x ----------
let arrived = false;
try {
  await page.getByText(/서귀포 도착!/).waitFor({ state: 'visible', timeout: 40000 });
  arrived = true;
} catch {
  arrived = false;
}
check('도착 배너 표시 (최종 목적지)', arrived);

// ---------- check for completion card ----------
const completionVisible = await page.locator('main').innerText().then(text => /오늘 일정 완료!/.test(text)).catch(() => false);
check('일정 완료 카드 표시', completionVisible);

await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
if (pass < results.length) console.log('FAILED:', results.filter((r) => !r.ok).map((r) => r.name).join(' | '));
process.exit(pass === results.length ? 0 : 1);
