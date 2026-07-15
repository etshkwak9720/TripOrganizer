// geo.ts 단위 테스트: fetch를 목킹해 파싱·폴백 로직 검증.
// 실행: npm run build 후 node scripts/test-geo.mjs (dist가 아닌 tsx 소스를 직접 못 읽으므로
// vite-node 대신 esbuild 없는 간단한 방법: tsc 산출물이 없으니 동적 import는 불가.
// -> geo.ts는 브라우저 전용이 아니므로 Node에서 직접 읽을 수 있게 tsx 없이 순수 TS.
// Node 22는 TS를 직접 실행 못 하므로, 여기서는 dev 의존성 추가 없이
// fetch 목킹 + 로직 복제 대신 vite의 SSR 로더를 쓴다:
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true } });
const geo = await vite.ssrLoadModule('/src/geo.ts');

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name} ${extra}`);
  ok ? pass++ : fail++;
};

// --- geocodeSearch: 정상 응답 파싱 ---
globalThis.fetch = async () => new Response(JSON.stringify([
  { display_name: '성산일출봉, 성산읍, 서귀포시, 제주특별자치도, 대한민국', name: '성산일출봉', lat: '33.4581', lon: '126.9426' },
]), { status: 200 });
const cands = await geo.geocodeSearch('성산일출봉');
check('geocode: 후보 1개 파싱', cands.length === 1);
check('geocode: 좌표 숫자 변환', cands[0].lat === 33.4581 && cands[0].lng === 126.9426);
check('geocode: name 추출', cands[0].name === '성산일출봉');

// --- geocodeSearch: 실패 시 throw ---
globalThis.fetch = async () => new Response('', { status: 503 });
let threw = false;
try { await geo.geocodeSearch('x'); } catch { threw = true; }
check('geocode: HTTP 실패 시 throw', threw);

// --- fetchRoute: 정상 응답 → [lat,lng] 변환 + 분 단위 ---
globalThis.fetch = async () => new Response(JSON.stringify({
  routes: [{ geometry: { coordinates: [[126.9, 33.4], [126.95, 33.45]] }, duration: 720, distance: 12000 }],
}), { status: 200 });
const route = await geo.fetchRoute([{ lat: 33.4, lng: 126.9 }, { lat: 33.45, lng: 126.95 }]);
check('route: coords lat,lng 순서', route.coords[0][0] === 33.4 && route.coords[0][1] === 126.9);
check('route: duration 분 반올림', route.durationMin === 12);
check('route: distance km', route.distanceKm === 12);

// --- fetchRoute: 네트워크 실패 → null ---
globalThis.fetch = async () => { throw new Error('offline'); };
check('route: 실패 시 null', (await geo.fetchRoute([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }])) === null);

// --- fetchRoute: 좌표 1개 → null ---
check('route: 좌표 부족 시 null', (await geo.fetchRoute([{ lat: 1, lng: 1 }])) === null);

await vite.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
