// Verifies the two new features: multiple activities per band, and Excel import.
// Run: node scripts/e2e-import.mjs   (dev server on :5173)
import { chromium } from 'playwright';
import * as XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = join(HERE, '.tmp');
mkdirSync(TMP, { recursive: true });
const BASE = 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

// ---- build a schedule workbook that mimics a real, messy file ----
const XLSX_PATH = join(TMP, 'test-schedule.xlsx');
{
  const aoa = [
    ['2학년 3반 제주 수학여행 일정표'], // junk title row above the header
    [],
    ['일차', '구분', '시간', '방문장소', '지역', '세부일정'],
    ['1일차', '조식', '08:00', '', '', '호텔 조식'],
    ['1일차', '오전', '09:30', '성산일출봉', '서귀포시 성산읍', '정상 등반'],
    ['', '오전', '11:00', '', '', '해녀 공연 관람'],        // merged 일차 (blank) + 2nd activity
    ['1일차', '점심', '12:30', '', '', '성산 해녀의 집'],   // '점심' synonym
    ['1일차', '오후', '14:00', '만장굴', '제주시 구좌읍', '동굴 탐방'],
    ['1일차', '저녁', '20:00', '', '', '숙소 레크리에이션'],
    ['2일차', '오전', '09:00', '우도 해변', '제주시 우도면', '해안 산책'],
    ['2일차', '오후', '15:30', '', '', '자유시간'],
    ['', '', '', '', '', ''],                              // blank row
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '일정표');
  XLSX.writeFile(wb, XLSX_PATH);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 140)));

const readDB = (store) =>
  page.evaluate((s) => new Promise((r) => {
    const q = indexedDB.open('yeojeong');
    q.onsuccess = () => { q.result.transaction(s).objectStore(s).getAll().onsuccess = (e) => r(e.target.result); };
  }), store);

// clean slate + trip
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase('yeojeong'); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.getByRole('button', { name: /새 여행 만들기/ }).click();
await page.getByPlaceholder('예: 3반 제주 수학여행').fill('엑셀 테스트 여행');
await page.getByRole('button', { name: /여행 만들고 구성 시작/ }).click();
await page.waitForURL(/setup/);

// ================= 1. multiple activities per band =================
await page.goto(`${BASE}/trip/1/schedule`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

const morning = page.locator('div.card').filter({ hasText: '오전' }).first();
// band shows one input by default
check('활동 밴드 기본 입력창 1개', await morning.getByPlaceholder('또는 활동/지역 직접 입력').count() === 1);

await morning.getByPlaceholder('또는 활동/지역 직접 입력').first().fill('성산일출봉 등반');
await page.waitForTimeout(300);
await morning.getByRole('button', { name: /활동 추가/ }).click();   // 2nd
await page.waitForTimeout(300);
await morning.getByPlaceholder('또는 활동/지역 직접 입력').nth(1).fill('해녀 공연 관람');
await page.waitForTimeout(300);
await morning.getByRole('button', { name: /활동 추가/ }).click();   // 3rd
await page.waitForTimeout(300);
await morning.getByPlaceholder('또는 활동/지역 직접 입력').nth(2).fill('카페 휴식');
await page.waitForTimeout(500);

const slots1 = await readDB('slots');
const amSlots = slots1.filter((s) => s.band === '오전' && s.dayIndex === 0);
check('오전 밴드에 활동 3개 입력', amSlots.length === 3, `${amSlots.length}개`);
check('입력한 활동 내용 저장', amSlots.map((s) => s.activityText).join('|') === '성산일출봉 등반|해녀 공연 관람|카페 휴식',
  amSlots.map((s) => s.activityText).join(' / '));

const inputCount = await morning.getByPlaceholder('또는 활동/지역 직접 입력').count();
check('입력창이 3개로 늘어남', inputCount === 3, `${inputCount}개`);

// extra entries are removable; the base (first) input has no delete button
const delBtns = await morning.locator('button[aria-label=삭제]').count();
check('추가 활동만 삭제 버튼 노출 (기본 입력은 유지)', delBtns === 2, `삭제버튼 ${delBtns}개 / 활동 3개`);
await morning.locator('button[aria-label=삭제]').last().click();
await page.waitForTimeout(400);
const slots2 = await readDB('slots');
check('활동 삭제', slots2.filter((s) => s.band === '오전' && s.dayIndex === 0).length === 2);

// itinerary shows all entries of the band
await page.goto(`${BASE}/trip/1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const itin = await page.locator('main').innerText();
check('일정 화면에 같은 밴드 활동 여러 개 표시', itin.includes('성산일출봉 등반') && itin.includes('해녀 공연 관람'));

// ================= 2. Excel import =================
await page.goto(`${BASE}/trip/1/schedule`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.getByRole('button', { name: /가져오기/ }).click();
await page.waitForTimeout(400);
check('엑셀 가져오기 시트 열림', await page.getByText('일정 가져오기').isVisible());

await page.locator('input[type=file]').setInputFiles(XLSX_PATH);
await page.waitForTimeout(1200);

const sheetText = await page.locator('.fixed.inset-0').innerText();
check('제목행/빈행 있어도 머리글 자동 인식', /개 일정/.test(sheetText), (sheetText.match(/\d+개 일정/) || [''])[0]);
// preview cells are editable inputs, so read their values rather than text
const placeVals = await page.locator('.fixed.inset-0 input[placeholder="장소 (선택)"]').evaluateAll((els) => els.map((e) => e.value));
check('미리보기에 장소 채워짐', placeVals.includes('성산일출봉') && placeVals.includes('만장굴'), placeVals.filter(Boolean).join(', '));
check("'점심' → 중식 으로 인식", /중식/.test(sheetText));
check('병합된 빈 일차 셀 → 앞 일차 승계', (sheetText.match(/1일/g) || []).length >= 5, `${(sheetText.match(/1일/g) || []).length}행이 1일차`);

await page.getByRole('button', { name: /개 일정 적용하기/ }).click();
await page.waitForTimeout(1500);

const slots3 = await readDB('slots');
const places3 = await readDB('places');
const trips3 = await readDB('trips');
// blank placeholder slots exist for untouched bands, so count only filled ones
const filled = slots3.filter((s) => s.placeId || s.activityText);
check('엑셀 일정 적용됨', filled.length === 8, `${filled.length}개 일정`);
check('기존 일정 덮어쓰기 (수동 입력분 제거)', !filled.some((s) => s.activityText === '카페 휴식'));
check('장소 자동 생성', places3.length === 3, places3.map((p) => p.name).join(', '));
check('장소 지역 반영', places3.find((p) => p.name === '성산일출봉')?.region === '서귀포시 성산읍');
check('일수 자동 확장 (2일차 포함)', trips3[0].dayCount >= 2, `${trips3[0].dayCount}일`);
const am2 = filled.filter((s) => s.dayIndex === 0 && s.band === '오전').sort((a, b) => a.order - b.order);
check('엑셀의 같은 밴드 2개 활동 유지', am2.length === 2 && am2[0].activityText === '정상 등반' && am2[1].activityText === '해녀 공연 관람',
  am2.map((s) => s.activityText).join(' / '));
check('시간 파싱', am2[0].plannedTime === '09:30', am2[0].plannedTime);

// itinerary reflects imported plan
await page.goto(`${BASE}/trip/1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const itin2 = await page.locator('main').innerText();
check('가져온 일정이 타임라인에 표시', itin2.includes('성산일출봉') && itin2.includes('해녀 공연 관람'));

await browser.close();
const pass = results.filter(Boolean).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
