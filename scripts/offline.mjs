// Verifies the PWA actually loads offline from the service worker cache.
// Requires: npm run build && vite preview (port 4173)
import { chromium } from 'playwright';

const BASE = 'http://localhost:4173';
const log = (ok, name, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
console.log('  loaded page');

// wait for an ACTIVE service worker (bounded)
const active = await page.evaluate(async () => {
  const t = new Promise((r) => setTimeout(() => r('timeout'), 60000));
  const ready = navigator.serviceWorker.ready.then((reg) => (reg.active ? 'active' : 'no-active'));
  return Promise.race([ready, t]);
});
log(active === 'active', '서비스워커 활성', active);

const manifestOk = await page.evaluate(async () => {
  const l = document.querySelector('link[rel=manifest]');
  if (!l) return false;
  const j = await (await fetch(l.href)).json();
  return !!j.name && j.icons?.length >= 2 && j.display === 'standalone';
});
log(manifestOk, 'manifest (설치 가능 요건)');

// poll precache size until it stops growing
const cached = await page.evaluate(async () => {
  const count = async () => {
    let n = 0;
    for (const k of await caches.keys()) n += (await (await caches.open(k)).keys()).length;
    return n;
  };
  let cur = 0, stable = 0;
  for (let i = 0; i < 120 && stable < 4; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const next = await count();
    stable = next === cur && cur > 0 ? stable + 1 : 0;
    cur = next;
  }
  return cur;
});
// manifest lists 68 rows but contains duplicate urls; ~45 unique assets is full coverage
log(cached >= 40, '프리캐시 완료', `${cached}개 고유 자산`);

await page.reload({ waitUntil: 'domcontentloaded' });
const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
log(controlled, '서비스워커가 페이지 제어 중');

// offline reload
await ctx.setOffline(true);
let err = '';
await page.reload({ waitUntil: 'domcontentloaded' }).catch((e) => { err = e.message.split('\n')[0]; });
await page.waitForTimeout(2000);
const text = await page.locator('body').innerText().catch(() => '');
log(/여정|여행/.test(text), '오프라인 새로고침 로드', `"${text.replace(/\s+/g, ' ').slice(0, 36)}"${err ? ' | ' + err : ''}`);

const fontOk = await page.evaluate(async () => { try { return (await fetch('/assets/css/fonts.css')).ok; } catch { return false; } });
log(fontOk, '오프라인 폰트 CSS 캐시 제공');

await browser.close();
