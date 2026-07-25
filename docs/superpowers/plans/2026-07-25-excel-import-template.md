# 3시트 가져오기 양식 + 파서 연결 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 교사가 장소명만 채우면 되는 여행 길이별 3시트(1박2일·2박3일·3박4일) 엑셀 양식을 제공하고, 기존 가져오기 파서가 그 양식을 매끄럽게 읽어 일정에 반영한다.

**Architecture:** `src/excel.ts`의 `downloadTemplate()`를 3시트 골격 양식으로 교체하고, `parseWorkbook()`를 (1) 내용이 채워진 시트 선택, (2) 템플릿 시트(`N박N일`)에서만 빈-장소 행 스킵, (3) '숙소'→저녁 밴드 매핑으로 확장한다. 가져오기 UI(`ScheduleImport`)와 `apply()`는 그대로 재사용.

**Tech Stack:** 기존 Vite/React/Dexie, `xlsx`(SheetJS, 이미 의존), Playwright 스모크.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-25-excel-import-template-design.md`
- **기존 가져오기 회귀 금지**: 빈-장소 행 스킵은 **템플릿 시트명(`/\d+\s*박\s*\d+\s*일/`)일 때만** 적용. 다른 파일(예: 시트명 '일정표')은 현재 동작 유지 — `scripts/e2e-import.mjs`가 그대로 통과해야 함.
- 컬럼은 기존 파서와 동일: `일자·시간·일정·세부·주소·비고`.
- 하루 골격(7행): 09:00 오전활동① / 11:00 오전활동② / 13:00 점심 / 14:00 오후활동① / 16:00 오후활동② / 19:00 저녁식사 / 20:30 숙소. → 밴드 오전/오전/중식/오후/오후/석식/저녁.
- 시트: `1박2일`(2일)·`2박3일`(3일)·`3박4일`(4일).

---

### Task 1: `parseWorkbook` 다중 시트 + 템플릿 빈행 스킵 + '숙소' 매핑

**Files:**
- Modify: `src/excel.ts`

**Interfaces:**
- Produces: 다중 시트를 읽고 유효 행이 가장 많은 시트를 고르는 `parseWorkbook`; 템플릿 시트에서 빈-장소 행 스킵; `toBand('숙소') === '저녁'`

- [ ] **Step 1: '숙소' 밴드 동의어 추가**

`src/excel.ts:49-56`의 `BAND_SYNONYMS`에서 저녁 항목을 교체:

```ts
  저녁: ['야간', '야간활동', '숙소', 'night', 'evening', '나이트'],
```

(주의: '저녁식사'는 여전히 석식으로 매핑됨 — `toBand`가 최장 일치 우선이라 '저녁식사'(석식) > '저녁'.)

- [ ] **Step 2: 단일 시트 파싱을 `parseSheet`로 추출 + 템플릿 스킵**

`src/excel.ts`의 `parseWorkbook` 함수(148줄부터 끝 `}`까지, `downloadTemplate` 앞)를 아래로 교체.
기존 본문 로직은 그대로 두되, (a) 시트 하나를 받는 `parseSheet`로 감싸고, (b) 템플릿 시트일 때
빈-장소 행을 스킵하고, (c) `parseWorkbook`는 모든 시트를 파싱해 유효 행이 최다인 시트를 고른다.

```ts
function parseSheet(sheet: XLSX.WorkSheet, sheetName: string): ParseResult {
  const grid: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false });
  const isTemplate = /\d+\s*박\s*\d+\s*일/.test(sheetName);

  let headerIdx = 0, best = 0, mapping: Record<number, string> = {};
  for (let r = 0; r < Math.min(12, grid.length); r++) {
    const map: Record<number, string> = {};
    let score = 0;
    (grid[r] || []).forEach((cell, c) => {
      const f = matchField(String(cell ?? ''));
      if (f && !Object.values(map).includes(f)) { map[c] = f; score++; }
    });
    if (score > best) { best = score; headerIdx = r; mapping = map; }
  }

  const headers = (grid[headerIdx] || []).map((h) => String(h ?? ''));
  const colOf = (field: string) => {
    const e = Object.entries(mapping).find(([, f]) => f === field);
    return e ? Number(e[0]) : -1;
  };

  interface Raw { key: string | null; time: string; category: string; place: string; region: string; activity: string; note: string; }
  const raws: Raw[] = [];
  let skipped = 0;

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    if (row.every((c) => String(c ?? '').trim() === '')) continue;
    const cell = (f: string) => {
      const c = colOf(f);
      return c < 0 ? '' : String(row[c] ?? '').trim();
    };
    const rawDay = colOf('day') < 0 ? '' : row[colOf('day')];
    raws.push({
      key: dayKey(rawDay),
      time: toTime(colOf('time') < 0 ? '' : row[colOf('time')]) ?? '',
      category: cell('category') || cell('band'),
      place: cell('place'),
      region: cell('region'),
      activity: cell('activity'),
      note: cell('note'),
    });
  }

  const order: string[] = [];
  let last: string | null = null;
  const dayIdx: (number | null)[] = raws.map((r) => {
    if (r.key) { last = r.key; if (!order.includes(r.key)) order.push(r.key); }
    return last == null ? null : order.indexOf(last);
  });

  const rows: ParsedRow[] = [];
  let lastBand: Band | null = null;

  raws.forEach((r, i) => {
    const day = dayIdx[i];
    const label = `${r.category} ${r.place} ${r.activity}`.trim();
    // 템플릿 시트: 교사가 장소를 안 채운 골격 행은 무시("입력한 데까지가 여행").
    if (isTemplate && !r.place) { skipped++; return; }
    if (!r.time && !r.place && (r.category.length > 25 || r.activity.length > 25)) { skipped++; return; }
    if (day == null) { skipped++; return; }

    let band = toBand(r.category) ?? toBand(r.activity);
    if (!band && r.time) band = bandFromTime(r.time, isMealish(label));
    if (!band) band = lastBand;
    if (!band) { skipped++; return; }
    lastBand = band;

    if (!r.place && !r.activity && !r.category) { skipped++; return; }

    rows.push({
      dayIndex: day,
      band,
      time: r.time,
      place: r.place,
      region: r.region,
      activity: r.category || r.activity,
      learn: r.note,
    });
  });

  return { rows, headers, skipped, sheetName };
}

/**
 * Parse a schedule workbook. Reads every sheet and returns the one with the
 * most valid rows — so a multi-sheet template (1박2일/2박3일/3박4일) imports the
 * sheet the teacher actually filled, while single-sheet files behave as before.
 */
export function parseWorkbook(buf: ArrayBuffer, _startDate?: string): ParseResult {
  const wb = XLSX.read(buf, { cellDates: true });
  let best: ParseResult | null = null;
  for (const name of wb.SheetNames) {
    const res = parseSheet(wb.Sheets[name], name);
    if (!best || res.rows.length > best.rows.length) best = res;
  }
  return best ?? { rows: [], headers: [], skipped: 0, sheetName: wb.SheetNames[0] ?? '' };
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 타입 에러 없이 통과.

- [ ] **Step 4: Commit**

```bash
git add src/excel.ts
git commit -m "feat: parseWorkbook reads multi-sheet templates, skips empty rows in N박N일 sheets, maps 숙소→저녁"
```

---

### Task 2: `downloadTemplate` 3시트 골격 양식으로 교체

**Files:**
- Modify: `src/excel.ts`

**Interfaces:**
- Produces: `downloadTemplate()`가 `1박2일`/`2박3일`/`3박4일` 3시트 골격 워크북(`여정_일정_템플릿.xlsx`) 생성

- [ ] **Step 1: 함수 교체**

`src/excel.ts`의 `downloadTemplate` 함수(234줄 주석부터 끝까지)를 아래로 교체:

```ts
// 여행 길이별 3시트 골격 양식. 교사는 '세부'(장소) 칸만 채우면 된다.
// 하루 골격: 오전활동2 / 점심 / 오후활동2 / 저녁식사 / 숙소. 빈 장소 행은 가져오기 때 무시된다.
const TEMPLATE_SKELETON: [string, string][] = [
  ['09:00', '오전활동①'], ['11:00', '오전활동②'], ['13:00', '점심'],
  ['14:00', '오후활동①'], ['16:00', '오후활동②'], ['19:00', '저녁식사'], ['20:30', '숙소'],
];
const TEMPLATE_SHEETS: { name: string; days: number }[] = [
  { name: '1박2일', days: 2 }, { name: '2박3일', days: 3 }, { name: '3박4일', days: 4 },
];

export function buildTemplateSheet(days: number): unknown[][] {
  const aoa: unknown[][] = [['일자', '시간', '일정', '세부', '주소', '비고']];
  for (let d = 0; d < days; d++) {
    TEMPLATE_SKELETON.forEach(([time, label], i) => {
      aoa.push([i === 0 ? `${d + 1}일차` : '', time, label, '', '', '']);
    });
  }
  return aoa;
}

export function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  for (const { name, days } of TEMPLATE_SHEETS) {
    const ws = XLSX.utils.aoa_to_sheet(buildTemplateSheet(days));
    ws['!cols'] = [{ wch: 8 }, { wch: 7 }, { wch: 11 }, { wch: 20 }, { wch: 30 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, '여정_일정_템플릿.xlsx');
}
```

(주의: `buildTemplateSheet`를 export하는 이유 — Task 3 테스트가 같은 골격으로 시험 파일을 만들어
양식↔테스트 드리프트를 막기 위함.)

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 타입 에러 없이 통과.

- [ ] **Step 3: Commit**

```bash
git add src/excel.ts
git commit -m "feat: 3-sheet skeleton import template (1박2일/2박3일/3박4일)"
```

---

### Task 3: 브라우저 e2e 테스트 + 회귀 확인

**Files:**
- Create: `scripts/e2e-template.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: 실행 중인 `npm run dev`(5173), `xlsx`

- [ ] **Step 1: 스크립트 등록**

`package.json` scripts에 `"test:image"` 다음 줄에 추가:

```json
    "test:template": "node scripts/e2e-template.mjs",
```

- [ ] **Step 2: 테스트 작성**

Create `scripts/e2e-template.mjs`:

```js
// 3시트 템플릿 가져오기 e2e: 교사가 '세부'만 채운 양식을 UI로 가져오면 밴드/스킵/숙소 매핑이 맞는지.
// 실행: npm run dev (다른 터미널) 후 node scripts/e2e-template.mjs
import { chromium } from 'playwright';
import * as XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = join(HERE, '.tmp'); mkdirSync(TMP, { recursive: true });
const BASE = 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

// 골격은 downloadTemplate과 동일 (오전활동2/점심/오후활동2/저녁식사/숙소)
const SKELETON = [['09:00','오전활동①'],['11:00','오전활동②'],['13:00','점심'],['14:00','오후활동①'],['16:00','오후활동②'],['19:00','저녁식사'],['20:30','숙소']];
function sheetAoa(days) {
  const aoa = [['일자','시간','일정','세부','주소','비고']];
  for (let d = 0; d < days; d++) SKELETON.forEach(([t,l],i)=>aoa.push([i===0?`${d+1}일차`:'', t, l, '', '', '']));
  return aoa;
}
// 3시트 워크북 생성, '2박3일' 시트만 일부 장소 채움(점심·②·2일차 이후는 빈칸=스킵)
const XLSX_PATH = join(TMP, 'template-filled.xlsx');
{
  const wb = XLSX.utils.book_new();
  for (const [name, days] of [['1박2일',2],['2박3일',3],['3박4일',4]]) {
    const aoa = sheetAoa(days);
    if (name === '2박3일') {
      // 1일차: 오전활동①(2행)=성산일출봉, 오후활동①(5행)=만장굴, 저녁식사(7행)=흑돼지맛집, 숙소(8행)=제주그랜드호텔
      aoa[2][3] = '성산일출봉';   // 09:00 오전활동①
      aoa[5][3] = '만장굴';       // 14:00 오후활동①
      aoa[7][3] = '흑돼지맛집';   // 19:00 저녁식사
      aoa[8][3] = '제주그랜드호텔'; // 20:30 숙소
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  XLSX.writeFile(wb, XLSX_PATH);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const readDB = (store) => page.evaluate((s) => new Promise((r) => {
  const q = indexedDB.open('yeojeong');
  q.onsuccess = () => { q.result.transaction(s).objectStore(s).getAll().onsuccess = (e) => r(e.target.result); };
}), store);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase('yeojeong'); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.getByRole('button', { name: /새 여행 만들기/ }).click();
await page.getByPlaceholder('예: 3반 제주 수학여행').fill('템플릿 테스트');
await page.getByRole('button', { name: /여행 만들고 구성 시작/ }).click();
await page.waitForURL(/setup/);

await page.goto(`${BASE}/trip/1/schedule`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.getByRole('button', { name: /가져오기/ }).click();
await page.waitForTimeout(300);
await page.locator('input[type=file]').setInputFiles(XLSX_PATH);
await page.waitForTimeout(1200);

const previewText = await page.locator('.fixed.inset-0').innerText();
check('채워진 2박3일 시트만 인식(4개 일정)', /4개 일정/.test(previewText), (previewText.match(/\d+개 일정/) || [''])[0]);

await page.getByRole('button', { name: /개 일정 적용하기/ }).click();
await page.waitForTimeout(1200);

const slots = await readDB('slots');
const places = await readDB('places');
const filled = slots.filter((s) => s.placeId || (s.activityText && s.activityText.trim()));
const bandOf = (placeName) => {
  const p = places.find((x) => x.name === placeName); if (!p) return null;
  const s = slots.find((x) => x.placeId === p.id); return s?.band ?? null;
};
check('빈 장소 골격 행은 스킵(장소 4곳만)', places.length === 4, places.map((p)=>p.name).join(', '));
check('오전활동 → 오전', bandOf('성산일출봉') === '오전', String(bandOf('성산일출봉')));
check('오후활동 → 오후', bandOf('만장굴') === '오후', String(bandOf('만장굴')));
check('저녁식사 → 석식', bandOf('흑돼지맛집') === '석식', String(bandOf('흑돼지맛집')));
check('숙소 → 저녁', bandOf('제주그랜드호텔') === '저녁', String(bandOf('제주그랜드호텔')));
check('빈칸=종료: 2·3일차 미입력분 없음', filled.every((s) => s.dayIndex === 0), `dayIdx: ${[...new Set(filled.map((s)=>s.dayIndex))].join(',')}`);

await browser.close();
const pass = results.filter(Boolean).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
process.exit(pass === results.length ? 0 : 1);
```

- [ ] **Step 3: 실행해서 통과 확인**

Run: (터미널1) `npm run dev`, (터미널2) `npm run test:template`
Expected: `==== 7/7 PASS ====`

- [ ] **Step 4: 기존 가져오기 회귀 확인**

Run: (터미널1) `npm run dev`, (터미널2) `node scripts/e2e-import.mjs`
Expected: 기존과 동일하게 전부 PASS (템플릿 스킵이 '일정표' 시트엔 적용 안 되므로 무변화).

- [ ] **Step 5: Commit**

```bash
git add scripts/e2e-template.mjs package.json
git commit -m "test: e2e for 3-sheet template import (band mapping, empty-row skip, 숙소)"
```

---

## Self-Review Notes

- **스펙 커버리지**: A(3시트 양식) = Task 2; B1(다중 시트) = Task 1 Step 2; B2(빈행 스킵, 템플릿 한정) = Task 1 Step 2; B3('숙소'→저녁) = Task 1 Step 1; C(downloadTemplate 교체) = Task 2; 검증 = Task 3.
- **회귀 안전**: 빈-장소 스킵은 `isTemplate`(`/\d+박\d+일/`)일 때만 → 시트명 '일정표'인 `e2e-import`는 불변. 다중 시트 선택은 단일 시트 파일에 무영향. '숙소' 동의어는 순수 추가.
- **드리프트 방지**: 테스트 `SKELETON`이 `downloadTemplate`의 골격과 동일(양쪽 plan에 명시). (원하면 Task 2의 `buildTemplateSheet` export를 테스트가 import해 완전 일치도 가능하나, 브라우저 e2e에선 Node 인라인이 단순.)
- **타입 일관성**: `parseSheet`/`parseWorkbook`가 동일 `ParseResult` 반환. `toBand`/`BAND_SYNONYMS` 시그니처 불변.
- **플레이스홀더 없음**: 실제 코드/명령 포함.
