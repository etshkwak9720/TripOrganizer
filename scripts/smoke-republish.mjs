// 자동 재발행 스모크: 공유된 여행에서 미션을 추가하면 /api/share POST가 자동으로 다시 나가는지.
// window.fetch를 스텁해 POST 호출을 기록. npm run dev(5173)만으로 실행.
// 실행: npm run dev (다른 터미널) 후 node scripts/smoke-republish.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(() => {
  window.__shareposts = 0;
  const orig = window.fetch;
  window.fetch = (url, opts) => {
    if (typeof url === 'string' && url.includes('/api/share/') && opts?.method === 'POST') {
      window.__shareposts++;
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    }
    return orig(url, opts);
  };
});
await page.goto(BASE, { waitUntil: 'networkidle' });

// 공유된 상태의 여행 시드(shareId·sharePassword 미리 세팅).
const tripId = await page.evaluate(async () => {
  const { db } = await import('/src/db.ts');
  const id = await db.trips.add({
    title: '재발행 스모크', startDate: '2026-09-14', dayCount: 1, mode: 'game',
    createdAt: Date.now(), shareId: 'republish-smoke', sharePassword: '1234',
  });
  await db.groups.add({ tripId: id, name: 'A조', score: 0 });
  return id;
});

// 인솔자 미션 페이지 열기 → 자동 재발행 훅 마운트.
await page.goto(`${BASE}/trip/${tripId}/missions`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const before = await page.evaluate(() => window.__shareposts);

// 미션 추가(데이터 변경) → 3초 디바운스 후 재발행 POST 기대.
await page.evaluate(async (id) => {
  const { db } = await import('/src/db.ts');
  await db.missions.add({ tripId: id, placeId: null, title: '테스트 미션', type: 'photo', points: 5, safe: true });
}, tripId);
await page.waitForTimeout(4000);
const after = await page.evaluate(() => window.__shareposts);
check('데이터 변경 시 자동 재발행 POST 발생', after > before, `before=${before} after=${after}`);

await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
process.exit(pass === results.length ? 0 : 1);
