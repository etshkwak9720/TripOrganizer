import { chromium } from 'playwright';
import * as XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'screenshots'); mkdirSync(OUT, { recursive: true });
const TMP = join(HERE, '.tmp'); mkdirSync(TMP, { recursive: true });
const XP = join(TMP, 'demo.xlsx');
XLSX.writeFile((() => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['2학년 3반 제주 수학여행 일정표'], [],
  ['일차','구분','시간','방문장소','지역','세부일정'],
  ['1일차','조식','08:00','','','호텔 조식'],
  ['1일차','오전','09:30','성산일출봉','서귀포시 성산읍','정상 등반'],
  ['','오전','11:00','','','해녀 공연 관람'],
  ['1일차','점심','12:30','','','성산 해녀의 집'],
  ['1일차','오후','14:00','만장굴','제주시 구좌읍','동굴 탐방'],
  ['2일차','오전','09:00','우도 해변','제주시 우도면','해안 산책'],
]), '일정표'); return wb; })(), XP);

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await p.evaluate(() => new Promise(r => { const d = indexedDB.deleteDatabase('yeojeong'); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
await p.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await p.waitForTimeout(500);
await p.getByRole('button', { name: /새 여행 만들기/ }).click();
await p.getByPlaceholder('예: 3반 제주 수학여행').fill('2학년 3반 제주 수학여행');
await p.getByRole('button', { name: /여행 만들고 구성 시작/ }).click();
await p.waitForURL(/setup/);
await p.goto('http://localhost:5173/trip/1/schedule', { waitUntil: 'networkidle' });
await p.waitForTimeout(600);

// multi-activity shot
const am = p.locator('div.card').filter({ hasText: '오전' }).first();
await am.getByPlaceholder('또는 활동/지역 직접 입력').first().fill('성산일출봉 등반');
await p.waitForTimeout(200);
await am.getByRole('button', { name: /활동 추가/ }).click(); await p.waitForTimeout(250);
await am.getByPlaceholder('또는 활동/지역 직접 입력').nth(1).fill('해녀 공연 관람');
await p.waitForTimeout(200);
await am.getByRole('button', { name: /활동 추가/ }).click(); await p.waitForTimeout(250);
await am.getByPlaceholder('또는 활동/지역 직접 입력').nth(2).fill('카페 휴식');
await p.waitForTimeout(600);
await p.screenshot({ path: join(OUT, '08-multi-activity.png') });
console.log('shot 08-multi-activity');

// excel preview shot
await p.getByRole('button', { name: /엑셀/ }).click(); await p.waitForTimeout(400);
await p.locator('input[type=file]').setInputFiles(XP);
await p.waitForTimeout(1200);
await p.screenshot({ path: join(OUT, '09-excel-import.png') });
console.log('shot 09-excel-import');

// apply -> itinerary
await p.getByRole('button', { name: /개 일정 적용하기/ }).click();
await p.waitForTimeout(1500);
await p.goto('http://localhost:5173/trip/1', { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.screenshot({ path: join(OUT, '10-imported-itinerary.png') });
console.log('shot 10-imported-itinerary');
await b.close();
