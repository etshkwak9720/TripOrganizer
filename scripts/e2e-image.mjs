// Verifies image (photo/screenshot) schedule import via OCR + editable preview.
// Run: node scripts/e2e-image.mjs   (dev server on :5173)
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = join(HERE, '.tmp');
mkdirSync(TMP, { recursive: true });
const IMG = join(TMP, 'schedule.png');
const BASE = 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();

// ---- 1. render a realistic schedule table image (browser => Korean fonts render) ----
{
  const p = await browser.newPage({ viewport: { width: 900, height: 640 } });
  await p.setContent(`
    <html><body style="margin:0;background:#fff;font-family:'Malgun Gothic',sans-serif;padding:24px">
      <h2 style="margin:0 0 16px">2학년 3반 제주 수학여행 일정표</h2>
      <table style="border-collapse:collapse;font-size:22px;width:100%">
        <tr style="background:#eee"><th style="border:1px solid #333;padding:10px">일차</th>
          <th style="border:1px solid #333;padding:10px">구분</th>
          <th style="border:1px solid #333;padding:10px">시간</th>
          <th style="border:1px solid #333;padding:10px">내용</th></tr>
        <tr><td style="border:1px solid #333;padding:10px">1일차</td><td style="border:1px solid #333;padding:10px">조식</td><td style="border:1px solid #333;padding:10px">08:00</td><td style="border:1px solid #333;padding:10px">호텔 조식</td></tr>
        <tr><td style="border:1px solid #333;padding:10px">1일차</td><td style="border:1px solid #333;padding:10px">오전</td><td style="border:1px solid #333;padding:10px">09:30</td><td style="border:1px solid #333;padding:10px">성산일출봉 등반</td></tr>
        <tr><td style="border:1px solid #333;padding:10px">1일차</td><td style="border:1px solid #333;padding:10px">중식</td><td style="border:1px solid #333;padding:10px">12:30</td><td style="border:1px solid #333;padding:10px">해녀의 집</td></tr>
        <tr><td style="border:1px solid #333;padding:10px">1일차</td><td style="border:1px solid #333;padding:10px">오후</td><td style="border:1px solid #333;padding:10px">14:00</td><td style="border:1px solid #333;padding:10px">만장굴 탐방</td></tr>
        <tr><td style="border:1px solid #333;padding:10px">2일차</td><td style="border:1px solid #333;padding:10px">오전</td><td style="border:1px solid #333;padding:10px">09:00</td><td style="border:1px solid #333;padding:10px">우도 해변 산책</td></tr>
      </table>
    </body></html>`);
  await p.waitForTimeout(400);
  await p.screenshot({ path: IMG });
  await p.close();
  console.log('  made schedule image');
}

// ---- 2. drive the app ----
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 140)));

const readDB = (store) =>
  page.evaluate((s) => new Promise((r) => {
    const q = indexedDB.open('triporganizer');
    q.onsuccess = () => { q.result.transaction(s).objectStore(s).getAll().onsuccess = (e) => r(e.target.result); };
  }), store);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase('triporganizer'); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.getByRole('button', { name: /새 여행 만들기/ }).click();
await page.getByPlaceholder('예: 3반 제주 수학여행').fill('이미지 업로드 테스트');
await page.getByRole('button', { name: /여행 만들고 구성 시작/ }).click();
await page.waitForURL(/setup/);

await page.goto(`${BASE}/trip/1/schedule`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.getByRole('button', { name: /가져오기/ }).click();
await page.waitForTimeout(400);
check('가져오기 시트가 엑셀+이미지 안내', /사진|스크린샷/.test(await page.locator('.fixed.inset-0').innerText()));

const accept = await page.locator('input[type=file]').getAttribute('accept');
check('파일 선택이 이미지도 허용', accept.includes('image/*'), accept);

await page.locator('input[type=file]').setInputFiles(IMG);
// OCR: first run downloads the Korean model — allow generous time
await page.waitForFunction(
  () => !/글자 인식 중|준비 중/.test(document.body.innerText),
  null, { timeout: 180000 },
).catch(() => {});
await page.waitForTimeout(1500);

const sheet = await page.locator('.fixed.inset-0').innerText();
console.log('  --- OCR 결과 미리보기 ---');
console.log('  ' + sheet.split('\n').filter(Boolean).slice(0, 14).join('\n  '));

// On-device OCR cannot reliably read Korean schedule tables, so the contract
// is: show the image, hand the user editable rows, apply what they confirm.
check('업로드한 이미지를 화면에 표시', await page.locator('.fixed.inset-0 img[alt="업로드한 일정표"]').isVisible());
check('OCR 정확도 한계를 안내', /정확도가 낮|고친 뒤 적용/.test(sheet));
check('인식된 원문 확인 가능', sheet.includes('인식된 글자 보기'));

let rowCount = await page.locator('.fixed.inset-0 select').count() / 2; // day+band select per row
check('바로 입력할 편집 행 제공', rowCount >= 1, `${rowCount}행`);

// fill the first row from what the image shows
await page.locator('.fixed.inset-0 input[placeholder="장소 (선택)"]').first().fill('성산일출봉');
await page.locator('.fixed.inset-0 input[placeholder="활동/내용"]').first().fill('정상 등반');
await page.waitForTimeout(300);
check('미리보기에서 직접 수정 가능',
  (await page.locator('.fixed.inset-0 input[placeholder="장소 (선택)"]').first().inputValue()) === '성산일출봉');

// add a second row
await page.getByRole('button', { name: /일정 행 추가/ }).click();
await page.waitForTimeout(300);
const after = await page.locator('.fixed.inset-0 select').count() / 2;
check('행 추가 가능', after === rowCount + 1, `${rowCount} → ${after}`);
await page.locator('.fixed.inset-0 select').nth(3).selectOption('중식'); // 2nd row band
await page.locator('.fixed.inset-0 input[placeholder="활동/내용"]').nth(1).fill('해녀의 집');
await page.waitForTimeout(300);

await page.getByRole('button', { name: /개 일정 적용하기/ }).click();
await page.waitForTimeout(1500);
const slots = await readDB('slots');
const places = await readDB('places');
const filled = slots.filter((s) => s.placeId || s.activityText);
check('입력한 일정이 실제로 적용됨', filled.length === 2, `${filled.length}개 일정`);
check('입력한 장소가 장소로 등록됨', places.some((p) => p.name === '성산일출봉'), places.map((p) => p.name).join(', '));
check('밴드 선택 반영', slots.some((s) => s.band === '중식' && s.activityText === '해녀의 집'));

await browser.close();
const pass = results.filter(Boolean).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
