// Guards the Material Symbols subset: every <Icon> must resolve to a glyph.
// An icon missing from the subset silently renders its name as literal text,
// so we walk each screen and flag any icon box that is far wider than tall.
// Run: node scripts/smoke-icons.mjs   (dev server must be running)
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.route('**tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }));
await page.route('**router.project-osrm.org/**', (r) => r.fulfill({ json: { routes: [{ geometry: { coordinates: [[126.49, 33.51], [126.94, 33.46]] }, duration: 3600, distance: 60000 }] } }));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase('triporganizer'); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

await page.evaluate(() => new Promise((resolve, reject) => {
  const rq = indexedDB.open('triporganizer');
  rq.onerror = () => reject(rq.error);
  rq.onsuccess = () => {
    const names = ['trips', 'places', 'slots', 'groups', 'members', 'missions'];
    const tx = rq.result.transaction(names, 'readwrite');
    const S = (n) => tx.objectStore(n);
    S('trips').put({ id: 1, title: '아이콘 점검', startDate: '2026-09-14', dayCount: 1, mode: 'game', createdAt: Date.now() });
    S('places').put({ id: 1, tripId: 1, name: '제주공항', region: '제주시', kind: 'sight', lat: 33.5104, lng: 126.4914 });
    S('places').put({ id: 2, tripId: 1, name: '흑돼지집', region: '제주시', kind: 'food', lat: 33.4996, lng: 126.5312 });
    S('slots').put({ id: 1, tripId: 1, dayIndex: 0, band: '오전', plannedTime: '10:00', order: 0, placeId: 1, activityText: '' });
    S('slots').put({ id: 2, tripId: 1, dayIndex: 0, band: '중식', plannedTime: '12:30', order: 0, placeId: 2, activityText: '오겹살' });
    S('groups').put({ id: 1, tripId: 1, name: '1모둠', score: 0 });
    S('members').put({ id: 1, tripId: 1, name: '가나', groupId: 1 });
    S('missions').put({ id: 1, tripId: 1, placeId: 1, title: '단체사진', type: 'photo', points: 10, safe: true });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  };
}));

// An unresolved ligature paints the icon name as text: much wider than tall.
const scan = () => page.evaluate(async () => {
  await document.fonts.ready;
  const els = [...document.querySelectorAll('.material-symbols-outlined')];
  return {
    total: els.length,
    broken: els
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > r.height * 1.6 && r.width > 0; })
      .map((e) => e.textContent.trim()),
  };
});

const screens = [
  ['여행 목록', '/'],
  ['일정', '/trip/1'],
  ['일정 짜기', '/trip/1/schedule'],
  ['구성', '/trip/1/setup'],
  ['미션', '/trip/1/missions'],
  ['갤러리', '/trip/1/gallery'],
  ['지금(지도)', '/trip/1/live'],
];

const allBroken = new Set();
let seen = 0;
for (const [label, path] of screens) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const { total, broken } = await scan();
  seen += total;
  broken.forEach((b) => allBroken.add(b));
  check(`${label}: 아이콘 ${total}개 모두 글리프로 렌더`, broken.length === 0, broken.length ? `깨짐: ${broken.join(', ')}` : `${total}개`);
}

check('전체 아이콘 검사 (누적)', allBroken.size === 0, allBroken.size ? [...allBroken].join(', ') : `${seen}개 검사`);

await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
if (pass < results.length) console.log('FAILED:', results.filter((r) => !r.ok).map((r) => r.name).join(' | '));
process.exit(pass === results.length ? 0 : 1);
