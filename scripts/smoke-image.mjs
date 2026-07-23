// compressPhoto 검증: 큰 이미지를 넣고 긴 변이 1600 이하로 줄었는지, 원본보다 작아졌는지 확인.
// 실행: node scripts/smoke-image.mjs (dev server 필요; BASE_URL로 override)
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });

const result = await page.evaluate(async () => {
  const mod = await import('/src/image.ts');

  // 2400x1800 캔버스로 원본 이미지를 만든다 (긴 변 1600 초과 케이스).
  const canvas = document.createElement('canvas');
  canvas.width = 2400;
  canvas.height = 1800;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'red';
  ctx.fillRect(0, 0, 2400, 1800);
  const originalBlob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const file = new File([originalBlob], 'test.png', { type: 'image/png' });

  const compressed = await mod.compressPhoto(file);
  const bitmap = await createImageBitmap(compressed);
  return {
    originalSize: file.size,
    compressedSize: compressed.size,
    width: bitmap.width,
    height: bitmap.height,
    type: compressed.type,
  };
});

check('긴 변이 1600 이하로 축소됨', Math.max(result.width, result.height) <= 1600, `${result.width}x${result.height}`);
check('원본보다 작아짐', result.compressedSize < result.originalSize, `${result.originalSize} -> ${result.compressedSize}`);
check('JPEG로 변환됨', result.type === 'image/jpeg', result.type);

await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
process.exit(pass === results.length ? 0 : 1);
