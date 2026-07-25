// 공유·삭제 인앱 모달 스모크: prompt/confirm 없이 모달이 뜨는지 검증.
// window.fetch를 스텁해 /api 왕복 없이 npm run dev(5173)만으로 실행.
// 실행: npm run dev (다른 터미널) 후 node scripts/smoke-share-ui.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();

// 앱 로드 전에 /api/share POST를 성공 응답으로 스텁 + 네이티브 대화상자 감지.
await page.addInitScript(() => {
  const orig = window.fetch;
  window.fetch = (url, opts) => {
    if (typeof url === 'string' && url.includes('/api/share/')) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    }
    return orig(url, opts);
  };
  // 네이티브 대화상자가 호출되면 표시(그러면 회귀).
  window.__nativeDialogUsed = false;
  window.prompt = () => { window.__nativeDialogUsed = true; return null; };
  window.confirm = () => { window.__nativeDialogUsed = true; return false; };
});

await page.goto(BASE, { waitUntil: 'networkidle' });

// 데모 여행 시드.
const tripId = await page.evaluate(async () => {
  const { db } = await import('/src/db.ts');
  const id = await db.trips.add({
    title: '스모크 데모 여행', startDate: '2026-09-14', dayCount: 1, mode: 'relaxed', createdAt: Date.now(),
  });
  await db.places.add({ tripId: id, name: '테스트장소', region: '제주', kind: 'sight' });
  await db.slots.add({ tripId: id, dayIndex: 0, band: '오전', plannedTime: '10:00', order: 0, placeId: null, activityText: '집합' });
  return id;
});
check('여행 시드 성공', typeof tripId === 'number');

await page.reload({ waitUntil: 'networkidle' });

// 공유 버튼 클릭 → 인앱 모달의 비번 입력창이 뜨는지.
await page.getByRole('button', { name: '여행 공유' }).first().click();
const pwInput = page.getByPlaceholder('참가자에게 알려줄 비밀번호');
await pwInput.waitFor({ timeout: 3000 }).catch(() => {});
check('공유 모달 비번 입력창 표시', await pwInput.isVisible());

// 비번 입력 → 공유하기 → 결과 화면(QR svg + 링크) 표시.
await pwInput.fill('1234');
await page.getByRole('button', { name: '공유하기' }).click();
const modal = page.locator('.fixed.inset-0').first();
const qr = modal.locator('svg').first();
await qr.waitFor({ timeout: 4000 }).catch(() => {});
check('결과 화면 QR 표시', await qr.isVisible());
check('결과에 참여 링크 표시', (await modal.innerText()).includes('/join/'));

// 모달 닫기(배경 클릭) 후 삭제 버튼 → 확인 모달.
await page.mouse.click(5, 5);
await page.getByRole('button', { name: '여행 삭제' }).first().click();
const delConfirm = page.getByRole('button', { name: '삭제', exact: true });
await delConfirm.waitFor({ timeout: 3000 }).catch(() => {});
check('삭제 확인 모달 표시', await delConfirm.isVisible());

// 네이티브 대화상자가 한 번도 안 쓰였는지(회귀 방지).
check('네이티브 prompt/confirm 미사용', (await page.evaluate(() => window.__nativeDialogUsed)) === false);

await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
if (pass < results.length) console.log('FAILED:', results.filter((r) => !r.ok).map((r) => r.name).join(' | '));
process.exit(pass === results.length ? 0 : 1);
