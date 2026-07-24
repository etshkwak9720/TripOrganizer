// 여행 공유 서버 E2E 스모크: vercel dev가 떠 있어야 함 (npm run dev로는 /api가 안 뜸).
// 실행: vercel dev (다른 터미널) 후 node scripts/smoke-share.mjs
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const shareId = `smoke-${Date.now()}`;
const password = 'smoke-test-password';
const schedule = {
  trip: { title: '스모크 테스트 여행', startDate: '2026-08-01', dayCount: 1, mode: 'relaxed' },
  members: [], groups: [],
  places: [{ id: 1, name: '테스트 장소', region: '제주', kind: 'sight', lat: 33.4, lng: 126.9 }],
  slots: [{ dayIndex: 0, band: '오전', plannedTime: '10:00', order: 0, placeId: 1, activityText: '' }],
  missions: [], missionResults: [], adjustments: [], awards: null,
};

// 1. 공유(최초)
let res = await fetch(`${BASE}/api/share/${shareId}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password, schedule }),
});
check('최초 공유 성공', res.ok, `status=${res.status}`);

// 2. 틀린 비번으로 재공유 시도 → 거부
res = await fetch(`${BASE}/api/share/${shareId}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'wrong', schedule }),
});
check('틀린 비번 재공유 거부', res.status === 401);

// 3. 참가자 비번 검증 (정답)
res = await fetch(`${BASE}/api/share/${shareId}/verify`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password }),
});
check('참가자 비번 검증 성공', res.ok);
const verifyBody = await res.json();
check('스냅샷 일치', verifyBody.schedule?.trip?.title === '스모크 테스트 여행');

// 3b. GET 스냅샷 조회 (헤더 비번)
res = await fetch(`${BASE}/api/share/${shareId}`, { headers: { 'x-trip-password': password } });
const getBody = await res.json();
check('GET 스냅샷 조회 성공', res.ok && getBody.schedule?.trip?.title === '스모크 테스트 여행');
res = await fetch(`${BASE}/api/share/${shareId}`, { headers: { 'x-trip-password': 'wrong' } });
check('GET 오답 비번 거부', res.status === 401);

// 4. 참가자 비번 검증 (오답)
res = await fetch(`${BASE}/api/share/${shareId}/verify`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'wrong' }),
});
check('오답 비번 거부', res.status === 401);

// 5. 사진 업로드 (1x1 PNG)
const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
res = await fetch(`${BASE}/api/share/${shareId}/photos`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password, placeId: 1, caption: '', fileBase64: tinyPngBase64, contentType: 'image/png' }),
});
check('사진 업로드 성공', res.ok, `status=${res.status}`);

// 6. 사진 목록 조회
res = await fetch(`${BASE}/api/share/${shareId}/photos`, { headers: { 'x-trip-password': password } });
const photosBody = await res.json();
check('업로드한 사진이 목록에 반영됨', photosBody.photos?.length === 1);

// 7. 장소당 4장 상한
for (let i = 0; i < 3; i++) {
  await fetch(`${BASE}/api/share/${shareId}/photos`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password, placeId: 1, caption: '', fileBase64: tinyPngBase64, contentType: 'image/png' }),
  });
}
res = await fetch(`${BASE}/api/share/${shareId}/photos`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password, placeId: 1, caption: '', fileBase64: tinyPngBase64, contentType: 'image/png' }),
});
check('장소당 4장 초과 시 거부', res.status === 400);

// 8. rate limit (11번째 오답 시도는 429)
for (let i = 0; i < 10; i++) {
  await fetch(`${BASE}/api/share/${shareId}/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'wrong' }),
  });
}
res = await fetch(`${BASE}/api/share/${shareId}/verify`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'wrong' }),
});
check('시도 초과 시 429', res.status === 429);

const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
if (pass < results.length) console.log('FAILED:', results.filter((r) => !r.ok).map((r) => r.name).join(' | '));
process.exit(pass === results.length ? 0 : 1);
