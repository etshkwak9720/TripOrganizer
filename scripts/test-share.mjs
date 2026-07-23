// src/share.ts 순수 로직 테스트: fetch 없이 순수 함수 + 가짜 KV로 검증.
// 실행: node scripts/test-share.mjs
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true } });
const share = await vite.ssrLoadModule('/src/share.ts');

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name} ${extra}`);
  ok ? pass++ : fail++;
};

// --- genShareId ---
const id1 = share.genShareId();
const id2 = share.genShareId();
check('genShareId: 32자 16진수', /^[0-9a-f]{32}$/.test(id1), id1);
check('genShareId: 매번 다름', id1 !== id2);

// --- key builders ---
check('shareKey', share.shareKey('abc') === 'trip:abc');
check('photosKey', share.photosKey('abc') === 'trip:abc:photos');
check('attemptsKey', share.attemptsKey('abc', '1.2.3.4') === 'trip:abc:attempts:1.2.3.4');

// --- countPhotosForPlace ---
const photos = [
  { id: '1', placeId: 5, slotId: null, caption: '', ts: 0, blobUrl: '' },
  { id: '2', placeId: 5, slotId: null, caption: '', ts: 0, blobUrl: '' },
  { id: '3', placeId: 7, slotId: null, caption: '', ts: 0, blobUrl: '' },
];
check('countPhotosForPlace: placeId 5 → 2개', share.countPhotosForPlace(photos, 5) === 2);
check('countPhotosForPlace: placeId 7 → 1개', share.countPhotosForPlace(photos, 7) === 1);
check('countPhotosForPlace: placeId 999 → 0개', share.countPhotosForPlace(photos, 999) === 0);

// --- checkRateLimit: 가짜 KV로 in-memory 카운터 구현 ---
class FakeKV {
  store = new Map();
  async get(key) { return this.store.has(key) ? this.store.get(key) : null; }
  async set(key, value) { this.store.set(key, value); }
  async incr(key) {
    const next = (this.store.get(key) ?? 0) + 1;
    this.store.set(key, next);
    return next;
  }
  async expire() { /* no-op: 테스트에서는 TTL 만료를 시뮬레이션하지 않음 */ }
}

const kv = new FakeKV();
for (let i = 0; i < share.MAX_ATTEMPTS; i++) {
  const ok = await share.checkRateLimit(kv, 'trip1', '1.1.1.1');
  if (i === 0) check('checkRateLimit: 첫 시도 허용', ok);
}
const overLimit = await share.checkRateLimit(kv, 'trip1', '1.1.1.1');
check('checkRateLimit: 한도 초과 시 거부', overLimit === false);

const otherIp = await share.checkRateLimit(kv, 'trip1', '2.2.2.2');
check('checkRateLimit: 다른 IP는 별도 카운트', otherIp === true);

// --- hash.ts: bcrypt 라운드트립 ---
const hashMod = await vite.ssrLoadModule('/api/_lib/hash.ts');
const hash = await hashMod.hashPassword('제주도수학여행2026');
check('hashPassword: 평문과 다름', hash !== '제주도수학여행2026');
check('verifyPassword: 맞는 비번 통과', await hashMod.verifyPassword('제주도수학여행2026', hash) === true);
check('verifyPassword: 틀린 비번 거부', await hashMod.verifyPassword('틀린비번', hash) === false);

console.log(`\n==== ${pass}/${pass + fail} PASS ====`);
if (fail > 0) console.log('FAILED count:', fail);
await vite.close();
process.exit(fail === 0 ? 0 : 1);
