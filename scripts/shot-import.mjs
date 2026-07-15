import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'screenshots');
const IMG = join(HERE, '.tmp', 'schedule.png');
const b = await chromium.launch();

// schedule image (same as the e2e fixture)
{
  const p = await b.newPage({ viewport: { width: 900, height: 560 } });
  await p.setContent(`<html><body style="margin:0;background:#fff;font-family:'Malgun Gothic',sans-serif;padding:24px">
  <h2 style="margin:0 0 16px">2학년 3반 제주 수학여행 일정표</h2>
  <table style="border-collapse:collapse;font-size:22px;width:100%">
  <tr style="background:#eee"><th style="border:1px solid #333;padding:10px">일차</th><th style="border:1px solid #333;padding:10px">구분</th><th style="border:1px solid #333;padding:10px">시간</th><th style="border:1px solid #333;padding:10px">내용</th></tr>
  <tr><td style="border:1px solid #333;padding:10px">1일차</td><td style="border:1px solid #333;padding:10px">조식</td><td style="border:1px solid #333;padding:10px">08:00</td><td style="border:1px solid #333;padding:10px">호텔 조식</td></tr>
  <tr><td style="border:1px solid #333;padding:10px">1일차</td><td style="border:1px solid #333;padding:10px">오전</td><td style="border:1px solid #333;padding:10px">09:30</td><td style="border:1px solid #333;padding:10px">성산일출봉 등반</td></tr>
  <tr><td style="border:1px solid #333;padding:10px">1일차</td><td style="border:1px solid #333;padding:10px">중식</td><td style="border:1px solid #333;padding:10px">12:30</td><td style="border:1px solid #333;padding:10px">해녀의 집</td></tr>
  </table></body></html>`);
  await p.waitForTimeout(300); await p.screenshot({ path: IMG }); await p.close();
}

const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await p.evaluate(() => new Promise(r => { const d = indexedDB.deleteDatabase('yeojeong'); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
await p.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await p.waitForTimeout(400);
await p.getByRole('button', { name: /새 여행 만들기/ }).click();
await p.getByPlaceholder('예: 3반 제주 수학여행').fill('2학년 3반 제주 수학여행');
await p.getByRole('button', { name: /여행 만들고 구성 시작/ }).click();
await p.waitForURL(/setup/);
await p.goto('http://localhost:5173/trip/1/schedule', { waitUntil: 'networkidle' });
await p.waitForTimeout(500);
await p.getByRole('button', { name: /가져오기/ }).click();
await p.waitForTimeout(400);
await p.locator('input[type=file]').setInputFiles(IMG);
await p.waitForFunction(() => !/글자 인식 중|이미지 준비 중/.test(document.body.innerText), null, { timeout: 150000 }).catch(()=>{});
await p.waitForTimeout(800);
await p.locator('input[placeholder="장소 (선택)"]').first().fill('성산일출봉');
await p.locator('input[placeholder="활동/내용"]').first().fill('정상 등반');
await p.waitForTimeout(400);
await p.screenshot({ path: join(OUT, '11-image-import.png') });
console.log('shot 11-image-import');
await b.close();
