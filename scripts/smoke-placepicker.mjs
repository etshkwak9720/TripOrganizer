// Smoke test for PlacePicker (Task 3): Nominatim search -> pick candidate ->
// mini map with draggable pin -> save with coords, from Setup > Places tab.
// Temporary verification artifact; Task 6 may fold this into e2e.mjs.
// Run: node scripts/smoke-placepicker.mjs   (dev server must be running; set BASE_URL to override)
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

// Mock Nominatim search results.
await page.route('**nominatim.openstreetmap.org/**', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      { display_name: '성산일출봉, 서귀포시', name: '성산일출봉', lat: '33.4581', lon: '126.9426' },
    ]),
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

// ---------- clean slate ----------
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase('yeojeong'); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// ---------- create trip ----------
await page.getByRole('button', { name: /새 여행 만들기/ }).click();
await page.getByPlaceholder('예: 3반 제주 수학여행').fill('PlacePicker 스모크 테스트');
await page.locator('input[type=number]').fill('2');
await page.getByRole('button', { name: /여행 만들고 구성 시작/ }).click();
await page.waitForURL(/\/trip\/\d+\/setup/, { timeout: 5000 }).catch(() => {});
check('여행 생성 → 셋업 이동', /\/trip\/\d+\/setup/.test(page.url()), page.url().replace(BASE, ''));

// ---------- open Places tab ----------
await page.locator('button', { hasText: '장소' }).first().click();
await page.waitForTimeout(250);

// ---------- open PlacePicker via "장소 추가 (지도 검색)" ----------
const addBtn = page.getByRole('button', { name: /장소 추가 \(지도 검색\)/ });
check('장소 추가(지도 검색) 버튼 노출', await addBtn.isVisible().catch(() => false));
await addBtn.click();
await page.waitForTimeout(200);

// ---------- search ----------
const searchInput = page.getByPlaceholder(/이름\/주소로 검색/);
await searchInput.fill('성산일출봉');
await page.waitForTimeout(800); // debounce (500ms) + mocked fetch

const candidate = page.locator('li', { hasText: '성산일출봉' }).first();
check('검색 후보 노출', await candidate.isVisible().catch(() => false));
await candidate.click();
await page.waitForTimeout(400);

// ---------- map + pin ----------
const mapVisible = await page.locator('[data-kakao-map]').first().isVisible().catch(() => false);
check('지도(핀) 표시', mapVisible);

// ---------- save ----------
const saveBtn = page.getByRole('button', { name: /^저장$/ });
check('저장 버튼 활성화', await saveBtn.isEnabled().catch(() => false));
await saveBtn.click();
await page.waitForTimeout(400);

// ---------- assert saved with coords ----------
const placeRow = page.locator('li', { hasText: '성산일출봉' }).first();
const rowText = await placeRow.innerText().catch(() => '');
check('장소 목록에 📍 좌표 표시', /📍/.test(rowText), rowText.replace(/\n/g, ' | '));

// ---------- Bug A regression: re-opening 위치 찾기 on a place that ALREADY
// has coords must show the map+pin immediately (not '좌표 없이 저장'), and
// saving must never wipe the existing lat/lng (Dexie deletes on undefined).
const editBtn = placeRow.getByRole('button', { name: '지도에서 찾기' });
check('재편집(edit_location_alt) 버튼 노출', await editBtn.isVisible().catch(() => false));
await editBtn.click();
await page.waitForTimeout(400);

const reopenMapVisible = await page.locator('[data-kakao-map]').first().isVisible().catch(() => false);
check('재편집 시 지도+핀 즉시 표시 (기존 좌표로 시딩)', reopenMapVisible);

const reopenSaveBtn = page.locator('.fixed.inset-0 button.btn-primary').last();
const reopenSaveText = (await reopenSaveBtn.innerText().catch(() => '')).trim();
check('저장 버튼이 "좌표 없이 저장"이 아님', reopenSaveText === '저장', `text="${reopenSaveText}"`);

await reopenSaveBtn.click();
await page.waitForTimeout(400);

const readDB = (store) =>
  page.evaluate((s) => new Promise((r) => {
    const q = indexedDB.open('yeojeong');
    q.onsuccess = () => { q.result.transaction(s).objectStore(s).getAll().onsuccess = (e) => r(e.target.result); };
  }), store);

const placesAfterReedit = await readDB('places');
const seongsanAfter = placesAfterReedit.find((p) => p.name === '성산일출봉');
const coordsIntact = !!seongsanAfter && typeof seongsanAfter.lat === 'number' && typeof seongsanAfter.lng === 'number';
check(
  'DB: 재편집 저장 후에도 lat/lng이 숫자로 유지 (삭제되지 않음)',
  coordsIntact,
  seongsanAfter ? `lat=${seongsanAfter.lat}, lng=${seongsanAfter.lng}` : 'place not found',
);

await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
if (pass < results.length) console.log('FAILED:', results.filter((r) => !r.ok).map((r) => r.name).join(' | '));
process.exit(pass === results.length ? 0 : 1);
