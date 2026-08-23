// src/tripFile.ts 순수 로직 테스트: 브라우저 없이 형식·id 재매핑을 검증한다.
// 실행: node scripts/test-tripfile.mjs
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true } });
const tf = await vite.ssrLoadModule('/src/tripFile.ts');

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};

const rows = {
  trip: {
    id: 7, title: '제주 수학여행', startDate: '2026-09-14', dayCount: 2, mode: 'game', createdAt: 1,
    shareId: 'abc123', sharePassword: '1234',
    adminLat: 33.5, adminLng: 126.5, adminTargetIdx: 2, adminDayIndex: 0,
  },
  groups: [{ id: 11, tripId: 7, name: '1모둠', score: 30 }, { id: 12, tripId: 7, name: '2모둠', score: 10 }],
  members: [{ id: 21, tripId: 7, name: '학생A', groupId: 11 }, { id: 22, tripId: 7, name: '학생B', groupId: null }],
  places: [
    { id: 31, tripId: 7, name: '제주공항', region: '제주시', kind: 'sight', lat: 33.5, lng: 126.49 },
    { id: 32, tripId: 7, name: '성산일출봉', region: '서귀포', kind: 'sight', lat: 33.45, lng: 126.94 },
  ],
  slots: [
    { id: 41, tripId: 7, dayIndex: 0, band: '오전', plannedTime: '10:00', placeId: 31 },
    { id: 42, tripId: 7, dayIndex: 0, band: '오후', plannedTime: '14:00', placeId: 32 },
    { id: 43, tripId: 7, dayIndex: 1, band: '오전', plannedTime: '09:00', placeId: null, activityText: '자유시간' },
  ],
  missions: [
    { id: 51, tripId: 7, placeId: 32, title: '단체사진', type: 'photo', points: 10, safe: false },
    { id: 52, tripId: 7, placeId: null, title: '공통미션', type: 'quiz', points: 5, safe: true },
  ],
  missionResults: [
    { id: 61, tripId: 7, missionId: 51, groupId: 11, done: true, ts: 100 },
    { id: 62, tripId: 7, missionId: 999, groupId: 11, done: true, ts: 101 }, // 끊긴 참조
  ],
  adjustments: [{ id: 71, tripId: 7, groupId: 12, delta: -5, reason: '지각', ts: 102 }],
  award: { tripId: 7, firstGroupReward: '아이스크림', lastGroupPenalty: '정리' },
  photos: [
    { id: 81, placeId: 31, slotId: 41, caption: '도착', ts: 200, mime: 'image/jpeg', data: 'AAAA' },
    { id: 82, placeId: null, slotId: null, caption: '기타', ts: 201, mime: 'image/png', data: 'BBBB' },
  ],
};

// ---------- buildTripFile ----------
const withPhotos = tf.buildTripFile(rows, { includePhotos: true });
const noPhotos = tf.buildTripFile(rows, { includePhotos: false });

check('형식 표시', withPhotos.format === 'triporganizer-trip' && withPhotos.version === 1);
check('사진 포함', withPhotos.photos.length === 2 && withPhotos.photosIncluded === true);
check('사진 제외 선택 시 사진이 빠진다', noPhotos.photos.length === 0 && noPhotos.photosIncluded === false);
check('일정은 사진을 빼도 그대로', noPhotos.slots.length === 3 && noPhotos.places.length === 2);

// ---------- 새어나가면 안 되는 것 ----------
const json = JSON.stringify(withPhotos);
check('공유 비밀번호가 파일에 없다', !('sharePassword' in withPhotos.trip) && !json.includes('1234'));
check('공유 주소(shareId)가 파일에 없다', !('shareId' in withPhotos.trip) && !json.includes('abc123'));
check('인솔자 실시간 위치가 파일에 없다', !('adminLat' in withPhotos.trip) && !('adminTargetIdx' in withPhotos.trip));
check('여행 내부 id 는 빠진다', !('id' in withPhotos.trip));

// ---------- isTripFile ----------
check('정상 파일 통과', tf.isTripFile(withPhotos));
check('빈 객체 거부', !tf.isTripFile({}));
check('null 거부', !tf.isTripFile(null));
check('다른 앱 JSON 거부', !tf.isTripFile({ format: 'something-else', version: 1, trip: {}, groups: [], places: [], slots: [] }));

// ---------- remapIds : 여기가 핵심 ----------
// 되살릴 때 새 번호는 원본과 겹치지 않게 일부러 다르게 준다.
const r = tf.remapIds(withPhotos, 100, {
  groups: [211, 212], places: [231, 232], slots: [241, 242, 243], missions: [251, 252],
});

check('모든 행이 새 여행 id 를 가리킨다',
  [...r.groups, ...r.places, ...r.slots, ...r.missions, ...r.members, ...r.missionResults, ...r.adjustments]
    .every((x) => x.tripId === 100));

check('slot 이 새 place 를 가리킨다',
  r.slots[0].placeId === 231 && r.slots[1].placeId === 232,
  `${r.slots[0].placeId}, ${r.slots[1].placeId}`);
check('place 없는 slot 은 null 그대로', r.slots[2].placeId === null);
check('mission 이 새 place 를 가리킨다', r.missions[0].placeId === 232 && r.missions[1].placeId === null);
check('member 가 새 모둠을 가리킨다', r.members[0].groupId === 211 && r.members[1].groupId === null);
check('미션 결과가 새 미션·모둠을 가리킨다',
  r.missionResults.length === 1 && r.missionResults[0].missionId === 251 && r.missionResults[0].groupId === 211);
check('참조가 끊긴 미션 결과는 버린다 (순위가 틀어지므로)', r.missionResults.length === 1);
check('점수 조정이 새 모둠을 가리킨다', r.adjustments[0].groupId === 212);
check('상벌이 새 여행을 가리킨다', r.award.tripId === 100);
check('사진이 새 place·slot 을 가리킨다', r.photos[0].placeId === 231 && r.photos[0].slotId === 241);
check('장소 미지정 사진은 null 유지', r.photos[1].placeId === null && r.photos[1].slotId === null);
check('행마다 옛 id 가 남아있지 않다',
  [...r.groups, ...r.places, ...r.slots, ...r.missions].every((x) => x.id === undefined));

// ---------- 같은 파일을 두 번 되살리기 ----------
// 두 번째 복원이 첫 번째의 장소를 가리키면 안 된다 — 로드맵이 짚은 바로 그 사고.
const r2 = tf.remapIds(withPhotos, 200, {
  groups: [311, 312], places: [331, 332], slots: [341, 342, 343], missions: [351, 352],
});
check('두 번째 복원이 첫 번째 장소를 가리키지 않는다',
  r2.slots[0].placeId === 331 && r.slots[0].placeId === 231);
check('두 복원본이 서로 섞이지 않는다',
  r2.members[0].groupId === 311 && r.members[0].groupId === 211);

// ---------- 파일 이름 ----------
const name = tf.tripFileName('제주/수학:여행', new Date(2026, 8, 14, 9, 5));
check('파일 이름에 날짜·시각', name === '제주수학여행-20260914-0905.trip.json', name);
check('빈 제목도 이름이 나온다', tf.tripFileName('  ').includes('여행-'));

await vite.close();
console.log(`\n==== ${pass}/${pass + fail} ${fail ? 'FAIL' : 'PASS'} ====`);
process.exit(fail ? 1 : 0);
