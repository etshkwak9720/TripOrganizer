// 참가자 탭 셸 스모크: 입장 후 하단 탭(일정·갤러리·지금) 전환이 되는지. /api는 스텁.
// 실행: npm run dev (다른 터미널) 후 node scripts/smoke-join.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const snapshot = {
  trip: { title: '스모크 참여여행', startDate: '2026-09-14', dayCount: 2, mode: 'game' },
  members: [],
  groups: [{ id: 1, name: 'A조' }, { id: 2, name: 'B조' }],
  places: [{ id: 1, name: '성산일출봉', region: '제주', kind: 'sight', lat: 33.4, lng: 126.9 }],
  slots: [{ dayIndex: 0, band: '오전', plannedTime: '09:00', order: 0, placeId: 1, activityText: '' }],
  missions: [{ id: 10, placeId: 1, title: '단체 사진 찍기', type: 'photo', points: 5, safe: true }],
  missionResults: [{ missionId: 10, groupId: 1, done: true }],
  adjustments: [{ groupId: 2, delta: 3, reason: '', ts: 1 }],
  awards: { firstGroupReward: '간식 쏘기', lastGroupPenalty: '' },
};

// 내 소유 1장 + 타인 소유 1장 → 삭제 버튼은 내 사진에만 떠야 한다.
const photos = [
  { id: 'mine', placeId: 1, slotId: null, caption: '', ts: 1, blobUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', owner: 'test-owner' },
  { id: 'other', placeId: 1, slotId: null, caption: '', ts: 2, blobUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', owner: 'someone-else' },
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript((data) => {
  const { snap, photos } = data;
  localStorage.setItem('photo-owner', 'test-owner'); // 내 토큰 고정
  window.fetch = (url) => {
    const s = typeof url === 'string' ? url : url.url;
    if (s.includes('/verify')) return Promise.resolve(new Response(JSON.stringify({ schedule: snap }), { status: 200, headers: { 'content-type': 'application/json' } }));
    if (s.endsWith('/photos')) return Promise.resolve(new Response(JSON.stringify({ photos }), { status: 200, headers: { 'content-type': 'application/json' } }));
    if (s.includes('/api/share/')) return Promise.resolve(new Response(JSON.stringify({ schedule: snap }), { status: 200, headers: { 'content-type': 'application/json' } }));
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
}, { snap: snapshot, photos });

await page.goto(`${BASE}/join/smoke-join`, { waitUntil: 'networkidle' });
await page.getByPlaceholder('여행 비밀번호').fill('1234');
await page.getByRole('button', { name: '입장' }).click();

await page.getByText('성산일출봉').first().waitFor({ timeout: 4000 }).catch(() => {});
check('입장 후 일정 탭에 장소 표시', await page.getByText('성산일출봉').first().isVisible());

check('하단 탭 갤러리 노출(게임모드)', (await page.getByRole('button', { name: '갤러리' }).count()) > 0);
await page.getByRole('button', { name: '갤러리' }).click();
await page.waitForTimeout(400);
check('갤러리에 사진 2장 표시', (await page.locator('main img').count()) === 2);
check('내 사진에만 삭제 버튼(1개)', (await page.getByRole('button', { name: '삭제' }).count()) === 1);
check('내 사진에만 교체 버튼(1개)', (await page.getByRole('button', { name: '교체' }).count()) === 1);
await page.getByRole('button', { name: '미션' }).click();
await page.waitForTimeout(300);
const missionText = await page.locator('body').innerText();
check('미션 탭: 랭킹 표시', missionText.includes('실시간 모둠 랭킹') && missionText.includes('A조'));
check('미션 탭: 장소별 미션 표시', missionText.includes('단체 사진 찍기'));
check('미션 탭: 읽기전용(관리자 버튼 없음)', (await page.getByRole('button', { name: '관리자' }).count()) === 0);

await page.getByRole('button', { name: '지금' }).click();
await page.waitForTimeout(200);
check('지금 탭 자리표시자', (await page.locator('body').innerText()).includes('곧 제공'));

await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
process.exit(pass === results.length ? 0 : 1);
