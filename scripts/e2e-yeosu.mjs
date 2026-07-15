// Tests import against the REAL schedule file shape the user shared (여수 1박2일):
// Korean dates, no 구분 column, place in 세부, address in 주소, notes in 비고.
// Run: node scripts/e2e-yeosu.mjs
import { chromium } from 'playwright';
import * as XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';
import { HEADER, ROWS, html } from './fixtures/yeosu.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = join(HERE, '.tmp');
mkdirSync(TMP, { recursive: true });
const XLSX_PATH = join(TMP, 'yeosu.xlsx');
const IMG_PATH = join(TMP, 'yeosu.png');
const BASE = 'http://localhost:5173';
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

// xlsx replica
{
  const ws = XLSX.utils.aoa_to_sheet([HEADER, ...ROWS]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '일정표');
  XLSX.writeFile(wb, XLSX_PATH);
}

const browser = await chromium.launch();

// png replica (for the OCR question)
{
  const p = await browser.newPage({ viewport: { width: 1360, height: 700 } });
  await p.setContent(html());
  await p.waitForTimeout(400);
  await p.screenshot({ path: IMG_PATH, fullPage: true });
  await p.close();
}

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 140)));
const readDB = (s) => page.evaluate((st) => new Promise((r) => {
  const q = indexedDB.open('yeojeong');
  q.onsuccess = () => { q.result.transaction(st).objectStore(st).getAll().onsuccess = (e) => r(e.target.result); };
}), s);

const newTrip = async (title) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase('yeojeong'); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /새 여행 만들기/ }).click();
  await page.getByPlaceholder('예: 3반 제주 수학여행').fill(title);
  await page.getByRole('button', { name: /여행 만들고 구성 시작/ }).click();
  await page.waitForURL(/setup/);
  await page.goto(`${BASE}/trip/1/schedule`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
};

// ================= A. the real file as Excel =================
console.log('===== 실제 여수 일정표 (엑셀) =====');
await newTrip('여수 1박2일');
await page.getByRole('button', { name: /가져오기/ }).click();
await page.waitForTimeout(300);
await page.locator('input[type=file]').setInputFiles(XLSX_PATH);
await page.waitForTimeout(1500);

const vals = (sel) => page.locator(`.fixed.inset-0 ${sel}`).evaluateAll((els) => els.map((e) => e.value));
const rowN = (await page.locator('.fixed.inset-0 select').count()) / 2;
check('행 인식', rowN >= 15, `${rowN}행`);

const places = await vals('input[placeholder="장소 (선택)"]');
check('세부 열 → 장소로 인식', places.includes('보성 녹차밭') && places.includes('오동도') && places.includes('향일암'),
  places.filter(Boolean).slice(0, 4).join(', '));

const bands = await page.locator('.fixed.inset-0 select').evaluateAll((els) =>
  els.filter((_, i) => i % 2 === 1).map((e) => e.value));
const days = await page.locator('.fixed.inset-0 select').evaluateAll((els) =>
  els.filter((_, i) => i % 2 === 0).map((e) => e.value));
check('7월18일/7월19일 → 1·2일차', new Set(days).size === 2 && days.includes('0') && days.includes('1'),
  `일차 ${[...new Set(days)].join(',')}`);
check('점심식사 → 중식', bands.filter((b) => b === '중식').length >= 2, `중식 ${bands.filter((b) => b === '중식').length}건`);
check('아침식사 → 조식', bands.includes('조식'));
check("'저녁'(식사) → 석식", bands.includes('석식'));
check('구분 열 없어도 시간으로 밴드 추론(오전/오후)', bands.includes('오전') && bands.includes('오후'),
  `${[...new Set(bands)].join(', ')}`);

await page.getByRole('button', { name: /개 일정 적용하기/ }).click();
await page.waitForTimeout(2000);
const slots = await readDB('slots');
const dbPlaces = await readDB('places');
const trips = await readDB('trips');
const filled = slots.filter((s) => s.placeId || s.activityText);
check('적용됨', filled.length >= 15, `${filled.length}개 일정`);
check('2일로 자동 확장', trips[0].dayCount === 2, `${trips[0].dayCount}일`);
check('장소 자동 생성', dbPlaces.length >= 12, `${dbPlaces.length}곳`);
const nokcha = dbPlaces.find((p) => p.name === '보성 녹차밭');
check('주소 → 지역', nokcha?.region === '전남광주 보성군 보성읍 녹차로 763-43', nokcha?.region ?? '(없음)');
check('비고 → 장소 안내', nokcha?.learn === '입장료 3,000원', nokcha?.learn ?? '(없음)');
check('꼬리 안내문 행 제외', !filled.some((s) => (s.activityText ?? '').includes('빡빡할수도')));
check("저녁 A/B 두 곳 모두 유지", dbPlaces.some((p) => p.name.includes('미로횟집')) && dbPlaces.some((p) => p.name.includes('낭만포차')),
  dbPlaces.filter((p) => /횟집|포차/.test(p.name)).map((p) => p.name).join(' / '));

await page.goto(`${BASE}/trip/1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
const itin = await page.locator('main').innerText();
check('타임라인 반영', itin.includes('보성 녹차밭') && itin.includes('정가네원조꼬막회관 본점'));

// ================= B. the same file as an image (OCR) =================
console.log('\n===== 같은 표를 이미지로 (OCR) =====');
await newTrip('여수 이미지');
await page.getByRole('button', { name: /가져오기/ }).click();
await page.waitForTimeout(300);
await page.locator('input[type=file]').setInputFiles(IMG_PATH);
await page.waitForFunction(() => !/글자 인식 중|이미지 준비 중/.test(document.body.innerText), null, { timeout: 180000 }).catch(() => {});
await page.waitForTimeout(1000);
await page.locator('summary', { hasText: '인식된 글자' }).click().catch(() => {});
const raw = await page.locator('[data-testid=ocr-raw]').innerText().catch(() => '');
console.log('--- OCR 원문(앞 500자) ---');
console.log(raw.slice(0, 500));
const ocrRows = (await page.locator('.fixed.inset-0 select').count()) / 2;
console.log(`--- OCR 미리보기 행: ${ocrRows} ---`);
const hit = ['보성', '녹차', '오동도', '향일암', '여수'].filter((w) => raw.includes(w));
console.log(`--- 원문에서 찾은 핵심 단어: ${hit.join(', ') || '(없음)'} ---`);

await browser.close();
console.log(`\n==== ${results.filter(Boolean).length}/${results.length} PASS (엑셀) ====`);
