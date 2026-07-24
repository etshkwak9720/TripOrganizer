// 참가자 탭 셸 스모크: 입장 후 하단 탭(일정·갤러리·지금) 전환이 되는지. /api는 스텁.
// 실행: npm run dev (다른 터미널) 후 node scripts/smoke-join.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const snapshot = {
  trip: { title: '스모크 참여여행', startDate: '2026-09-14', dayCount: 2, mode: 'game' },
  members: [], groups: [],
  places: [{ id: 1, name: '성산일출봉', region: '제주', kind: 'sight', lat: 33.4, lng: 126.9 }],
  slots: [{ dayIndex: 0, band: '오전', plannedTime: '09:00', order: 0, placeId: 1, activityText: '' }],
  missions: [], missionResults: [], adjustments: [], awards: null,
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript((snap) => {
  window.fetch = (url) => {
    const s = typeof url === 'string' ? url : url.url;
    if (s.includes('/verify')) return Promise.resolve(new Response(JSON.stringify({ schedule: snap }), { status: 200, headers: { 'content-type': 'application/json' } }));
    if (s.endsWith('/photos')) return Promise.resolve(new Response(JSON.stringify({ photos: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    if (s.includes('/api/share/')) return Promise.resolve(new Response(JSON.stringify({ schedule: snap }), { status: 200, headers: { 'content-type': 'application/json' } }));
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
}, snapshot);

await page.goto(`${BASE}/join/smoke-join`, { waitUntil: 'networkidle' });
await page.getByPlaceholder('여행 비밀번호').fill('1234');
await page.getByRole('button', { name: '입장' }).click();

await page.getByText('성산일출봉').first().waitFor({ timeout: 4000 }).catch(() => {});
check('입장 후 일정 탭에 장소 표시', await page.getByText('성산일출봉').first().isVisible());

check('하단 탭 갤러리 노출(게임모드)', (await page.getByRole('button', { name: '갤러리' }).count()) > 0);
await page.getByRole('button', { name: '갤러리' }).click();
await page.waitForTimeout(300);
check('갤러리 탭 전환됨', (await page.locator('body').innerText()).includes('갤러리 준비 중'));
await page.getByRole('button', { name: '지금' }).click();
await page.waitForTimeout(200);
check('지금 탭 자리표시자', (await page.locator('body').innerText()).includes('곧 제공'));

await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
process.exit(pass === results.length ? 0 : 1);
