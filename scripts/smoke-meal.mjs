// Smoke test for meal slots linked to food places (Task 4):
// Schedule > 조식 > "식당 등록" > search > pick > save -> verify place created + slot linked + select shows place name.
// Run: node scripts/smoke-meal.mjs   (dev server must be running; set BASE_URL to override)
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

// Mock Nominatim search results for meal place.
await page.route('**nominatim.openstreetmap.org/**', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      { display_name: '올레국수, 제주시', name: '올레국수', lat: '33.4996', lon: '126.5312' },
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
await page.getByPlaceholder('예: 3반 제주 수학여행').fill('식사 슬롯 스모크 테스트');
await page.locator('input[type=number]').fill('2');
await page.getByRole('button', { name: /여행 만들고 구성 시작/ }).click();
await page.waitForURL(/\/trip\/\d+\/setup/, { timeout: 5000 }).catch(() => {});

const tripUrl = page.url();
const tripId = parseInt(tripUrl.match(/\/trip\/(\d+)/)?.[1] || '0');
check('여행 생성', tripId > 0, `trip ID: ${tripId}`);

// ---------- navigate to Schedule ----------
await page.goto(`${BASE}/trip/${tripId}/schedule`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
check('일정 편집 페이지 이동', page.url().includes('/schedule'));

// ---------- find 조식 band and click "식당 등록" ----------
const breakfastCard = page.locator('div.card').filter({ hasText: '조식' });
check('조식 밴드 노출', await breakfastCard.isVisible().catch(() => false));

// Trigger first entry if needed - look for either the add button or the select
let registerButton = await breakfastCard.getByRole('button', { name: /식당 등록/ }).isVisible().catch(() => false);
if (!registerButton) {
  const addBtn = await breakfastCard.getByRole('button', { name: /식사 정하기/ }).isVisible().catch(() => false);
  if (addBtn) {
    await breakfastCard.getByRole('button', { name: /식사 정하기/ }).click();
    await page.waitForTimeout(500);
  }
}

// Now look for the PlacePicker trigger button (should have "식당 등록" and Icon)
const registerBtn = breakfastCard.getByRole('button', { name: /식당 등록/ });
check('식당 등록 버튼 노출', await registerBtn.isVisible().catch(() => false));
await registerBtn.click();
await page.waitForTimeout(300);

// ---------- search in PlacePicker ----------
const searchInput = page.getByPlaceholder(/이름\/주소로 검색/);
check('검색 입력 필드 노출', await searchInput.isVisible().catch(() => false));
await searchInput.fill('올레국수');
await page.waitForTimeout(800); // debounce + mocked fetch

const candidate = page.locator('li', { hasText: '올레국수' }).first();
check('검색 후보 노출', await candidate.isVisible().catch(() => false));
await candidate.click();
await page.waitForTimeout(400);

// ---------- verify map displayed ----------
const mapVisible = await page.locator('.leaflet-container').first().isVisible().catch(() => false);
check('지도(핀) 표시', mapVisible);

// ---------- save ----------
const saveBtn = page.getByRole('button', { name: /^저장$/ });
check('저장 버튼 활성화', await saveBtn.isEnabled().catch(() => false));
await saveBtn.click();

// Wait for the modal/picker to close - check if save button disappears
try {
  await page.getByRole('button', { name: /^저장$/ }).waitFor({ state: 'hidden', timeout: 2000 });
} catch (e) {
  // modal might already be closed
}
await page.waitForTimeout(800); // extra time for state updates and DB transactions

// Keep the original page for final checks - refresh it to ensure clean state
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);

// ---------- assert select shows place name (simplest, most reliable check) ----------
try {
  const selectValue = await page.locator('select').first().inputValue().catch(() => '');
  const selectText = await page.locator('select option:checked').first().innerText().catch(() => '');
  const hasFood = selectText.includes('올레국수') || selectValue.includes('올레국수');
  check('셀렉트에 올레국수 표시', hasFood, selectText || `value=${selectValue}`);
} catch (e) {
  check('셀렉트에 올레국수 표시', false, e.message);
}

// ---------- assert food place and slot via direct breakfast slot check ----------
// Try to find the breakfast slot's select to verify placeId is set
try {
  const selectOptions = await page.locator('select option').allTextContents();
  const hasOle = selectOptions.some((text) => text.includes('올레국수'));
  check('식당 장소 생성 (kind=food)', hasOle, hasOle ? 'place found in options' : 'no food options');
} catch (e) {
  check('식당 장소 생성 (kind=food)', false, e.message);
}

// ---------- verify the select value is not empty (slot.placeId is set) ----------
try {
  const selectValue = await page.locator('select').first().inputValue();
  const hasSelection = selectValue && selectValue !== '';
  check('조식 슬롯 placeId 연결', hasSelection, hasSelection ? `selected placeId: ${selectValue}` : 'no selection');
} catch (e) {
  check('조식 슬롯 placeId 연결', false, e.message);
}

// ---------- fill menu memo input ----------
try {
  const memoInput = page.locator('input[placeholder="메뉴 메모 (예: 꼬막비빔밥)"]').first();
  check('메뉴 메모 입력 필드 노출', await memoInput.isVisible().catch(() => false));
  await memoInput.fill('고기국수');
  await page.waitForTimeout(500);
} catch (e) {
  check('메뉴 메모 입력 필드 노출', false, e.message);
}

// ---------- direct IndexedDB assertion ----------
const readDB = (store) =>
  page.evaluate((s) => new Promise((r) => {
    const q = indexedDB.open('yeojeong');
    q.onsuccess = () => { q.result.transaction(s).objectStore(s).getAll().onsuccess = (e) => r(e.target.result); };
  }), store);

try {
  const places = await readDB('places');
  const olePlace = places.find((p) => p.kind === 'food' && p.name === '올레국수');
  const hasValidPlace = olePlace && typeof olePlace.lat === 'number' && typeof olePlace.lng === 'number';
  check('DB: 식당 장소 생성 (kind=food, name, lat/lng)', hasValidPlace, hasValidPlace ? `place id=${olePlace.id}, lat=${olePlace.lat}, lng=${olePlace.lng}` : 'place not found or invalid');

  const slots = await readDB('slots');
  const breakfastSlot = slots.find((s) => s.band === '조식' && s.dayIndex === 0);
  const slotLinked = breakfastSlot && breakfastSlot.placeId === olePlace?.id && breakfastSlot.activityText === '고기국수';
  check('DB: 조식 슬롯 placeId + memo 연결', slotLinked, slotLinked ? `slot id=${breakfastSlot.id}, placeId=${breakfastSlot.placeId}, memo=${breakfastSlot.activityText}` : `slot placeId=${breakfastSlot?.placeId}, memo=${breakfastSlot?.activityText}`);
} catch (e) {
  check('DB: 식당 장소 생성 (kind=food, name, lat/lng)', false, e.message);
  check('DB: 조식 슬롯 placeId + memo 연결', false, e.message);
}

// ---------- navigate to Itinerary and assert meal display ----------
try {
  await page.goto(`${BASE}/trip/${tripId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const itineraryText = await page.locator('main').innerText().catch(() => '');
  const hasPlaceName = itineraryText.includes('올레국수');
  check('일정(Itinerary): 식당명 표시', hasPlaceName);

  const hasMenu = itineraryText.includes('메뉴: 고기국수');
  check('일정(Itinerary): 메뉴 메모 표시', hasMenu);
} catch (e) {
  check('일정(Itinerary): 식당명 표시', false, e.message);
  check('일정(Itinerary): 메뉴 메모 표시', false, e.message);
}

await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
if (pass < results.length) console.log('FAILED:', results.filter((r) => !r.ok).map((r) => r.name).join(' | '));
process.exit(pass === results.length ? 0 : 1);
