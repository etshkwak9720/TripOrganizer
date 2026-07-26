// End-to-end functional check: drives the real UI and asserts behaviour.
// Run: node scripts/e2e.mjs   (dev server must be running; set BASE_URL to override)
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

// mock external geo services — e2e must not hit public servers.
// Nominatim: echo the query back as the (only) candidate so any place name
// searched anywhere in this script resolves to a pickable result. Known
// place names get distinct real-ish Jeju coordinates (rather than one fixed
// point for everything) so the Live map's simulated travel between stops
// isn't a zero-distance no-op.
const KNOWN_COORDS = {
  성산일출봉: [33.4581, 126.9426],
  만장굴: [33.5296, 126.7715],
  올레국수: [33.4996, 126.5312],
};
await page.route('**nominatim.openstreetmap.org/**', (route) => {
  const u = new URL(route.request().url());
  const q = u.searchParams.get('q') || '장소';
  const [lat, lon] = KNOWN_COORDS[q] || [33.4996, 126.5312];
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ display_name: `${q}, 제주특별자치도`, name: q, lat: String(lat), lon: String(lon) }]),
  });
});
await page.route('**router.project-osrm.org/**', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ routes: [{ geometry: { coordinates: [[126.53, 33.49], [126.94, 33.45]] }, duration: 1800, distance: 45000 }] }),
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
await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase('triporganizer'); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// ---------- 1. create trip ----------
await page.getByRole('button', { name: /새 여행 만들기/ }).click();
await page.getByPlaceholder('예: 3반 제주 수학여행').fill('2학년 3반 제주 수학여행');
await page.locator('input[type=number]').fill('3');
await page.getByRole('button', { name: /여행 만들고 구성 시작/ }).click();
await page.waitForURL(/\/trip\/\d+\/setup/, { timeout: 5000 }).catch(() => {});
check('여행 생성 → 셋업 이동', /\/trip\/1\/setup/.test(page.url()), page.url().replace(BASE, ''));

// ---------- 2. members ----------
for (const n of ['김민준', '이서연', '박지호']) {
  await page.getByPlaceholder('구성원 이름 입력 후 Enter').fill(n);
  await page.getByPlaceholder('구성원 이름 입력 후 Enter').press('Enter');
  await page.waitForTimeout(150);
}
const memberCount = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('triporganizer'); q.onsuccess = () => { q.result.transaction('members').objectStore('members').count().onsuccess = (e) => r(e.target.result); }; }));
check('구성원 추가 (Enter)', memberCount === 3, `${memberCount}명`);

// ---------- 3. groups ----------
await page.getByRole('button', { name: /^diversity_3?모둠$|모둠$/ }).first().click().catch(() => {});
await page.locator('button', { hasText: '모둠' }).first().click();
await page.waitForTimeout(200);
for (const g of ['1모둠', '2모둠', '3모둠']) {
  await page.getByPlaceholder('모둠 이름 (예: 1모둠)').fill(g);
  await page.getByPlaceholder('모둠 이름 (예: 1모둠)').press('Enter');
  await page.waitForTimeout(150);
}
const groupCount = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('triporganizer'); q.onsuccess = () => { q.result.transaction('groups').objectStore('groups').count().onsuccess = (e) => r(e.target.result); }; }));
check('모둠 추가', groupCount === 3, `${groupCount}개`);

// ---------- 4. assign member to group ----------
await page.locator('button', { hasText: '구성원' }).first().click();
await page.waitForTimeout(250);
const sel = page.locator('select').first();
await sel.selectOption({ label: '1모둠' });
await page.waitForTimeout(300);
const assigned = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('triporganizer'); q.onsuccess = () => { q.result.transaction('members').objectStore('members').getAll().onsuccess = (e) => r(e.target.result.filter((m) => m.groupId).length); }; }));
check('구성원 → 모둠 배정', assigned >= 1, `${assigned}명 배정됨`);

// ---------- 5. places (+ learn content saves on change) ----------
await page.locator('button', { hasText: '장소' }).first().click();
await page.waitForTimeout(250);
for (const p of ['성산일출봉', '만장굴']) {
  await page.getByRole('button', { name: /장소 추가 \(지도 검색\)/ }).click();
  await page.waitForTimeout(200);
  await page.getByPlaceholder(/이름\/주소로 검색/).fill(p);
  await page.waitForTimeout(800); // debounce + mocked fetch
  await page.locator('li', { hasText: p }).first().click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /^저장$/ }).click();
  await page.waitForTimeout(300);
}
await page.locator('li', { hasText: '성산일출봉' }).getByText('expand_more').click();
await page.waitForTimeout(200);
await page.getByPlaceholder('지역 (예: 서귀포시)').fill('서귀포시 성산읍');
await page.getByPlaceholder(/장소 안내/).fill('유네스코 세계자연유산 응회구.');
await page.waitForTimeout(400);
// also give 만장굴 learn content so the Live page's learn card has something
// to show regardless of which stop it ends up parked on once simulation finishes.
await page.locator('li', { hasText: '만장굴' }).getByText('expand_more').click();
await page.waitForTimeout(200);
await page.getByPlaceholder(/장소 안내/).fill('세계자연유산 용암동굴.');
await page.waitForTimeout(400);
const placeData = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('triporganizer'); q.onsuccess = () => { q.result.transaction('places').objectStore('places').getAll().onsuccess = (e) => r(e.target.result.map((p) => ({ n: p.name, rg: p.region, lr: (p.learn || '').slice(0, 8) }))); }; }));
check('장소 추가', placeData.length === 2, placeData.map((p) => p.n).join(', '));
check('장소 지역/학습콘텐츠 저장', !!placeData[0].rg && !!placeData[0].lr, `${placeData[0].rg} / "${placeData[0].lr}…"`);

// ---------- 6. schedule: place select + register restaurant for a meal slot ----------
await page.goto(`${BASE}/trip/1/schedule`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
// Every band (meal and non-meal alike) auto-creates one slot entry on mount,
// so `select` elements are interleaved band-by-band in BANDS order (조식,
// 오전, 중식, 오후, 석식, 저녁) — scope by band card instead of a flat index.
const morningCard = page.locator('div.card').filter({ hasText: '오전' });
await morningCard.locator('select').selectOption('1'); // 오전 → 성산일출봉 (place id 1)
await page.waitForTimeout(250);
const afternoonCard = page.locator('div.card').filter({ hasText: '오후' });
await afternoonCard.locator('select').selectOption('2'); // 오후 → 만장굴 (place id 2)
await page.waitForTimeout(300);

// 조식 band already has its auto-created first entry — "식당 등록" is visible directly.
const breakfastCard = page.locator('div.card').filter({ hasText: '조식' });
check('조식 밴드 노출', await breakfastCard.isVisible().catch(() => false));
const needsFirstEntry = await breakfastCard.getByRole('button', { name: /식사 정하기/ }).isVisible().catch(() => false);
if (needsFirstEntry) {
  await breakfastCard.getByRole('button', { name: /식사 정하기/ }).click();
  await page.waitForTimeout(300);
}
await breakfastCard.getByRole('button', { name: /식당 등록/ }).click();
await page.waitForTimeout(300);
await page.getByPlaceholder(/이름\/주소로 검색/).fill('올레국수');
await page.waitForTimeout(800); // debounce + mocked fetch
await page.locator('li', { hasText: '올레국수' }).first().click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: /^저장$/ }).click();
await page.waitForTimeout(400);

const slotData = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('triporganizer'); q.onsuccess = () => { q.result.transaction('slots').objectStore('slots').getAll().onsuccess = (e) => r(e.target.result.map((s) => ({ b: s.band, p: s.placeId }))); }; }));
check('일정: 장소 배정', slotData.some((s) => s.b === '오전' && s.p) && slotData.some((s) => s.b === '오후' && s.p));
check('일정: 식당 장소 연결 저장', slotData.some((s) => s.b === '조식' && s.p));
const foodPlace = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('triporganizer'); q.onsuccess = () => { q.result.transaction('places').objectStore('places').getAll().onsuccess = (e) => r(e.target.result.find((p) => p.kind === 'food')); }; }));
check('식당 장소 kind=food + 좌표', !!foodPlace && foodPlace.lat != null, foodPlace ? `${foodPlace.name} @ ${foodPlace.lat},${foodPlace.lng}` : '');

// ---------- 7. itinerary: timeline + travel time ----------
await page.goto(`${BASE}/trip/1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const itinText = await page.locator('main').innerText();
check('일정 타임라인 렌더', itinText.includes('성산일출봉') && itinText.includes('만장굴'));
check('이동시간 자동 표시', /이동 약 \d+분/.test(itinText), (itinText.match(/이동 약 \d+분/) || [''])[0]);
check('장소 학습 콘텐츠 노출', itinText.includes('장소 안내 보기'));

// ---------- 8. missions: add + complete + ranking ----------
await page.goto(`${BASE}/trip/1/missions`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.locator('section', { hasText: '성산일출봉' }).getByRole('button', { name: /추천 미션/ }).click();
await page.waitForTimeout(500);
const recoVisible = await page.getByText(/추천 미션 ·/).isVisible().catch(() => false);
check('장소별 추천 미션 시트', recoVisible);
const recoText = await page.locator('.fixed ul').innerText().catch(() => '');
check('장소 성격 기반 추천(오름/정상)', /정상/.test(recoText), (recoText.split('\n')[0] || '').slice(0, 20));
const firstReco = page.locator('.fixed ul li button').first();
const recoTitle = (await firstReco.innerText()).split('\n')[1] || '';
await firstReco.click();
await page.waitForTimeout(300);
await page.locator('.fixed').getByText('close').click();
await page.waitForTimeout(400);

const missionCount = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('triporganizer'); q.onsuccess = () => { q.result.transaction('missions').objectStore('missions').count().onsuccess = (e) => r(e.target.result); }; }));
check('추천 미션 추가', missionCount >= 1, `${missionCount}개 · "${recoTitle}"`);

// complete for 1모둠
await page.locator('li', { hasText: recoTitle }).getByRole('button', { name: /1모둠/ }).click();
await page.waitForTimeout(500);
const rank1 = await page.locator('section', { hasText: '실시간 모둠 랭킹' }).innerText();
check('미션 완료 체크 → 점수 자동 합산', /1모둠\s*\n?\s*\d+점/.test(rank1.replace(/\s+/g, ' ')) && !/1모둠 0점/.test(rank1.replace(/\s+/g, ' ')), rank1.split('\n').slice(1, 4).join(' | '));

// ---------- 9. admin points ----------
await page.getByRole('button', { name: /관리자/ }).click();
await page.waitForTimeout(400);
await page.locator('.fixed select').selectOption('2'); // 2모둠 (group id 2)
await page.locator('.fixed input[type=number]').fill('30');
await page.getByRole('button', { name: /가점/ }).click();
await page.waitForTimeout(400);
await page.locator('.fixed').getByText('close').click();
await page.waitForTimeout(400);
const rank2 = await page.locator('section', { hasText: '실시간 모둠 랭킹' }).innerText();
check('관리자 가점 → 랭킹 반영', /2모둠/.test(rank2) && /30점|3\d점/.test(rank2.replace(/\s+/g, ' ')), rank2.replace(/\s+/g, ' ').slice(0, 60));

// ---------- 10. awards ----------
await page.getByPlaceholder('예: 저녁 간식 쏘기').fill('저녁 간식 쏘기');
await page.getByPlaceholder('예: 장기자랑 한 곡').fill('장기자랑 한 곡');
await page.waitForTimeout(500);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const awardVal = await page.getByPlaceholder('예: 저녁 간식 쏘기').inputValue();
check('1등 상/꼴찌 벌 저장(새로고침 유지)', awardVal === '저녁 간식 쏘기', `"${awardVal}"`);

// ---------- 11. live simulation ----------
await page.goto(`${BASE}/trip/1/live`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
// default mode is real GPS — switch to simulation before the speed/play controls show up.
await page.locator('button', { hasText: /실 GPS|시뮬/ }).first().click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '12x' }).click();
await page.getByRole('button', { name: /이동 시작/ }).click();
await page.waitForTimeout(1200);
const liveMid = await page.locator('main').innerText();
const movedOrDone = /이동 중|약 \d+분|일정 완료/.test(liveMid);
check('Live 이동 시뮬레이션 동작', movedOrDone, (liveMid.match(/이동 중|일정 완료/) || [''])[0]);
await page.waitForTimeout(3000);
const liveEnd = await page.locator('body').innerText();
check('도착 알림 배너', /도착!/.test(liveEnd), (liveEnd.match(/📍?\s*\S+ 도착!/) || [''])[0]);
check('이동 중 장소 안내(학습 콘텐츠)', /장소 안내/.test(liveEnd));

// ---------- 12. gallery: upload + caption ----------
await page.goto(`${BASE}/trip/1/gallery`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.locator('input[type=file]').setInputFiles(join(HERE, '..', 'public', 'icons', 'icon-512.png'));
await page.waitForTimeout(700);
const thumbs = await page.locator('main .grid button').count();
check('사진 업로드(파일 선택)', thumbs >= 1, `${thumbs}장`);
// no overlap check
const overlap = await page.evaluate(() => {
  const r = [...document.querySelectorAll('main img')].map((i) => i.getBoundingClientRect());
  for (let a = 0; a < r.length; a++) for (let b = a + 1; b < r.length; b++)
    if (r[a].left < r[b].right && r[a].right > r[b].left && r[a].top < r[b].bottom && r[a].bottom > r[b].top) return true;
  return false;
});
check('갤러리 이미지 겹침 없음', overlap === false);
await page.locator('main .grid button').first().click();
await page.waitForTimeout(400);
await page.getByPlaceholder('이 순간을 한 줄로 남겨보세요').fill('첫 사진 감상평');
await page.waitForTimeout(500);
const capSaved = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('triporganizer'); q.onsuccess = () => { q.result.transaction('photos').objectStore('photos').getAll().onsuccess = (e) => r(e.target.result.map((p) => p.caption)); }; }));
check('한줄 감상평 즉시 저장', capSaved.includes('첫 사진 감상평'), JSON.stringify(capSaved));

// ---------- 13. mode toggle hides missions tab ----------
await page.goto(`${BASE}/trip/1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const tabsBefore = await page.locator('nav a').count();
await page.locator('header button', { hasText: '게임' }).click();
await page.waitForTimeout(600);
const tabsAfter = await page.locator('nav a').count();
const navText = await page.locator('nav').innerText();
check('게임/휴식 모드 토글 → 미션 탭 숨김', tabsBefore === 5 && tabsAfter === 4 && !navText.includes('미션'), `${tabsBefore}탭 → ${tabsAfter}탭`);

// ---------- 14. persistence ----------
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);
const afterReload = await page.locator('main').innerText();
check('새로고침 후 데이터 유지', afterReload.includes('성산일출봉'));

await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
if (pass < results.length) console.log('FAILED:', results.filter((r) => !r.ok).map((r) => r.name).join(' | '));
