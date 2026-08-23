// 내보내기 → 자료 삭제 → 되살리기 가 실제로 되는가.
//
// 로드맵 1-5. 되돌릴 수 없는 유일한 리스크(브라우저 자료 삭제)를 막는 경로라
// 브라우저에서 통째로 돌려봐야 의미가 있다.
// Run: node scripts/smoke-backup.mjs   (dev server must be running)
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

// 이미 끝난 여행이어야 "저장 권유"가 뜬다. 날짜를 박아두면 그날이 지나며 시험이 썩는다.
const past = new Date(Date.now() - 10 * 24 * 3600 * 1000);
const PAST_START = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')}`;
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

const wipe = () => page.evaluate(() => new Promise((r) => {
  const d = indexedDB.deleteDatabase('triporganizer');
  d.onsuccess = d.onerror = d.onblocked = () => r();
}));

await page.goto(BASE, { waitUntil: 'networkidle' });
await wipe();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// ---------- 사진까지 있는 여행 한 건을 심는다 ----------
await page.evaluate((PAST_START) => new Promise((resolve, reject) => {
  const rq = indexedDB.open('triporganizer');
  rq.onerror = () => reject(rq.error);
  rq.onsuccess = () => {
    const db = rq.result;
    const names = ['trips', 'places', 'slots', 'groups', 'members', 'missions', 'missionResults', 'adjustments', 'awards', 'photos'];
    const tx = db.transaction(names, 'readwrite');
    const S = (n) => tx.objectStore(n);
    names.forEach((n) => S(n).clear());
    S('trips').put({ id: 1, title: '백업 시험 여행', startDate: PAST_START, dayCount: 2, mode: 'game', createdAt: 1, sharePassword: 'secret-pw', shareId: 'shr-1' });
    S('groups').put({ id: 1, tripId: 1, name: '1모둠', score: 30 });
    S('groups').put({ id: 2, tripId: 1, name: '2모둠', score: 10 });
    S('members').put({ id: 1, tripId: 1, name: '학생A', groupId: 1 });
    S('places').put({ id: 1, tripId: 1, name: '제주공항', region: '제주시', kind: 'sight', lat: 33.5104, lng: 126.4914 });
    S('places').put({ id: 2, tripId: 1, name: '성산일출봉', region: '서귀포', kind: 'sight', lat: 33.4581, lng: 126.9426 });
    S('slots').put({ id: 1, tripId: 1, dayIndex: 0, band: '오전', plannedTime: '10:00', placeId: 1 });
    S('slots').put({ id: 2, tripId: 1, dayIndex: 0, band: '오후', plannedTime: '14:00', placeId: 2 });
    S('missions').put({ id: 1, tripId: 1, placeId: 2, title: '단체사진', type: 'photo', points: 10, safe: false });
    S('missionResults').put({ id: 1, tripId: 1, missionId: 1, groupId: 1, done: true, ts: 5 });
    S('adjustments').put({ id: 1, tripId: 1, groupId: 2, delta: -5, reason: '지각', ts: 6 });
    S('awards').put({ tripId: 1, firstGroupReward: '아이스크림', lastGroupPenalty: '정리' });
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const png = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    S('photos').put({ id: 1, tripId: 1, placeId: 1, slotId: 1, blob: new Blob([png], { type: 'image/png' }), caption: '도착', ts: 7 });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  };
}), PAST_START);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
check('여행이 목록에 보인다', await page.getByText('백업 시험 여행').first().isVisible().catch(() => false));
check('로컬 저장 경고가 보인다', await page.getByText(/이 기기 브라우저에만/).first().isVisible().catch(() => false));

// 열흘 전에 끝난 여행이라 저장 권유가 떠야 한다 — 아직 한 번도 저장 안 했으므로
const promptShown = await page.getByText(/끝난 여행을 파일로 남겨두세요/).first().isVisible().catch(() => false);
check('끝난 여행 저장 권유가 뜬다', promptShown);

// ---------- 내보내기 (앱의 실제 함수로) ----------
const exported = await page.evaluate(async () => {
  const m = await import('/src/db.ts');
  return await m.exportTrip(1, { includePhotos: true });
});
check('내보내기 성공', !!exported && exported.format === 'triporganizer-trip');
check('사진이 담겼다', exported.photos.length === 1 && exported.photos[0].data.length > 0);
check('공유 비밀번호는 파일에 없다', !JSON.stringify(exported).includes('secret-pw'));

// ---------- 자료를 통째로 지운다 ----------
await wipe();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check('지운 뒤 여행이 사라졌다', !(await page.getByText('백업 시험 여행').first().isVisible().catch(() => false)));

// ---------- 되살린다 ----------
const restored = await page.evaluate(async (file) => {
  const m = await import('/src/db.ts');
  const id = await m.importTrip(file);
  const d = m.db;
  const [trip, places, slots, groups, members, missions, results, adj, award, photos] = await Promise.all([
    d.trips.get(id),
    d.places.where('tripId').equals(id).toArray(),
    d.slots.where('tripId').equals(id).toArray(),
    d.groups.where('tripId').equals(id).toArray(),
    d.members.where('tripId').equals(id).toArray(),
    d.missions.where('tripId').equals(id).toArray(),
    d.missionResults.where('tripId').equals(id).toArray(),
    d.adjustments.where('tripId').equals(id).toArray(),
    d.awards.get(id),
    d.photos.where('tripId').equals(id).toArray(),
  ]);
  const placeById = Object.fromEntries(places.map((p) => [p.id, p.name]));
  const groupById = Object.fromEntries(groups.map((g) => [g.id, g.name]));
  return {
    id, title: trip?.title, sharePassword: trip?.sharePassword ?? null,
    counts: { places: places.length, slots: slots.length, groups: groups.length, members: members.length,
              missions: missions.length, results: results.length, adj: adj.length, photos: photos.length },
    slotPlaces: slots.sort((a, b) => a.id - b.id).map((s) => placeById[s.placeId] ?? null),
    missionPlace: placeById[missions[0]?.placeId] ?? null,
    memberGroup: groupById[members[0]?.groupId] ?? null,
    adjGroup: groupById[adj[0]?.groupId] ?? null,
    awardReward: award?.firstGroupReward ?? null,
    photoSize: photos[0]?.blob?.size ?? 0,
    photoPlace: placeById[photos[0]?.placeId] ?? null,
  };
}, exported);

check('여행이 되살아났다', restored.title === '백업 시험 여행');
check('행 개수가 원본과 같다',
  JSON.stringify(restored.counts) === JSON.stringify({ places: 2, slots: 2, groups: 2, members: 1, missions: 1, results: 1, adj: 1, photos: 1 }),
  JSON.stringify(restored.counts));
check('일정이 올바른 장소를 가리킨다',
  JSON.stringify(restored.slotPlaces) === JSON.stringify(['제주공항', '성산일출봉']),
  JSON.stringify(restored.slotPlaces));
check('미션이 올바른 장소를 가리킨다', restored.missionPlace === '성산일출봉', String(restored.missionPlace));
check('구성원이 올바른 모둠에 붙었다', restored.memberGroup === '1모둠', String(restored.memberGroup));
check('점수 조정이 올바른 모둠에 붙었다', restored.adjGroup === '2모둠', String(restored.adjGroup));
check('상벌이 살아있다', restored.awardReward === '아이스크림');
check('사진이 실제 이미지로 복원됐다', restored.photoSize > 0, `${restored.photoSize} bytes`);
check('사진이 올바른 장소에 붙었다', restored.photoPlace === '제주공항', String(restored.photoPlace));
check('공유 비밀번호는 복원되지 않는다', !restored.sharePassword);

// ---------- 같은 파일을 한 번 더 되살린다 ----------
const second = await page.evaluate(async (file) => {
  const m = await import('/src/db.ts');
  const id = await m.importTrip(file);
  const d = m.db;
  const [places, slots] = await Promise.all([
    d.places.where('tripId').equals(id).toArray(),
    d.slots.where('tripId').equals(id).toArray(),
  ]);
  const byId = Object.fromEntries(places.map((p) => [p.id, p.name]));
  const total = await d.trips.count();
  return { id, total, slotPlaces: slots.sort((a, b) => a.id - b.id).map((s) => byId[s.placeId] ?? '(다른 여행 장소)') };
}, exported);

check('두 번 되살리면 여행이 2개', second.total === 2, `${second.total}개`);
check('두 번째 복원이 자기 장소를 가리킨다',
  JSON.stringify(second.slotPlaces) === JSON.stringify(['제주공항', '성산일출봉']),
  JSON.stringify(second.slotPlaces));

// ---------- 사진 없이 내보내기 ----------
const light = await page.evaluate(async () => {
  const m = await import('/src/db.ts');
  const f = await m.exportTrip(1, { includePhotos: false });
  return { photos: f.photos.length, slots: f.slots.length, bytes: JSON.stringify(f).length };
});
const heavy = JSON.stringify(exported).length;
check('사진 제외 시 일정은 남고 사진만 빠진다', light.photos === 0 && light.slots === 2);
check('사진 제외 파일이 더 작다', light.bytes < heavy, `${light.bytes} < ${heavy}`);

await browser.close();
console.log(`\n==== ${pass}/${pass + fail} ${fail ? 'FAIL' : 'PASS'} ====`);
process.exit(fail ? 1 : 0);
