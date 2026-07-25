// 3시트 템플릿 가져오기 e2e: 교사가 '세부'만 채운 양식을 UI로 가져오면 밴드/스킵/숙소 매핑이 맞는지.
// 실행: npm run dev (다른 터미널) 후 node scripts/e2e-template.mjs
import { chromium } from 'playwright';
import * as XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = join(HERE, '.tmp'); mkdirSync(TMP, { recursive: true });
const BASE = 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

// 골격은 downloadTemplate과 동일 (오전활동2/점심/오후활동2/저녁식사/숙소)
const SKELETON = [['09:00','오전활동①'],['11:00','오전활동②'],['13:00','점심'],['14:00','오후활동①'],['16:00','오후활동②'],['19:00','저녁식사'],['20:30','숙소']];
function sheetAoa(days) {
  const aoa = [['일자','시간','일정','세부','주소','비고']];
  for (let d = 0; d < days; d++) SKELETON.forEach(([t,l],i)=>aoa.push([i===0?`${d+1}일차`:'', t, l, '', '', '']));
  return aoa;
}
// 3시트 워크북 생성, '2박3일' 시트만 일부 장소 채움(점심·②·2일차 이후는 빈칸=스킵)
const XLSX_PATH = join(TMP, 'template-filled.xlsx');
{
  const wb = XLSX.utils.book_new();
  for (const [name, days] of [['1박2일',2],['2박3일',3],['3박4일',4]]) {
    const aoa = sheetAoa(days);
    if (name === '2박3일') {
      // 1일차: 09:00오전①/14:00오후①/19:00저녁식사/20:30숙소 → aoa 인덱스 1/4/6/7
      aoa[1][3] = '성산일출봉';   // 1일차 09:00 오전활동①
      aoa[4][3] = '만장굴';       // 1일차 14:00 오후활동①
      aoa[6][3] = '흑돼지맛집';   // 1일차 19:00 저녁식사
      aoa[7][3] = '제주그랜드호텔'; // 1일차 20:30 숙소
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  XLSX.writeFile(wb, XLSX_PATH);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const readDB = (store) => page.evaluate((s) => new Promise((r) => {
  const q = indexedDB.open('yeojeong');
  q.onsuccess = () => { q.result.transaction(s).objectStore(s).getAll().onsuccess = (e) => r(e.target.result); };
}), store);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase('yeojeong'); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.getByRole('button', { name: /새 여행 만들기/ }).click();
await page.getByPlaceholder('예: 3반 제주 수학여행').fill('템플릿 테스트');
await page.getByRole('button', { name: /여행 만들고 구성 시작/ }).click();
await page.waitForURL(/setup/);

await page.goto(`${BASE}/trip/1/schedule`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.getByRole('button', { name: /가져오기/ }).click();
await page.waitForTimeout(300);
await page.locator('.fixed.inset-0 input[type=file]').setInputFiles(XLSX_PATH);
await page.waitForTimeout(1200);

const previewText = await page.locator('.fixed.inset-0').innerText();
check('채워진 2박3일 시트만 인식(4개 일정)', /4개 일정/.test(previewText), (previewText.match(/\d+개 일정/) || [''])[0]);

await page.getByRole('button', { name: /개 일정 적용하기/ }).click();
await page.waitForTimeout(1200);

const slots = await readDB('slots');
const places = await readDB('places');
const filled = slots.filter((s) => s.placeId || (s.activityText && s.activityText.trim()));
const bandOf = (placeName) => {
  const p = places.find((x) => x.name === placeName); if (!p) return null;
  const s = slots.find((x) => x.placeId === p.id); return s?.band ?? null;
};
check('빈 장소 골격 행은 스킵(장소 4곳만)', places.length === 4, places.map((p)=>p.name).join(', '));
check('오전활동 → 오전', bandOf('성산일출봉') === '오전', String(bandOf('성산일출봉')));
check('오후활동 → 오후', bandOf('만장굴') === '오후', String(bandOf('만장굴')));
check('저녁식사 → 석식', bandOf('흑돼지맛집') === '석식', String(bandOf('흑돼지맛집')));
check('숙소 → 저녁', bandOf('제주그랜드호텔') === '저녁', String(bandOf('제주그랜드호텔')));
check('빈칸=종료: 2·3일차 미입력분 없음', filled.every((s) => s.dayIndex === 0), `dayIdx: ${[...new Set(filled.map((s)=>s.dayIndex))].join(',')}`);

await browser.close();
const pass = results.filter(Boolean).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
process.exit(pass === results.length ? 0 : 1);
