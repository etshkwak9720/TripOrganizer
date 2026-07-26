import * as XLSX from 'xlsx';
import { BANDS, type Band } from './db';

export interface ParsedRow {
  dayIndex: number;      // 0-based
  band: Band;
  time: string;          // HH:MM
  place: string;         // place name ('' if none)
  region: string;        // address / area
  activity: string;
  learn: string;         // notes (비고) — shown as place guidance
}

export interface ParseResult {
  rows: ParsedRow[];
  headers: string[];
  skipped: number;
  sheetName: string;
}

const norm = (s: unknown) => String(s ?? '').replace(/\s|_|-/g, '').toLowerCase();

// header synonyms -> field. Order matters: first exact match wins.
const FIELD_KEYS: Record<string, string[]> = {
  day: ['일자', '일차', '날짜', 'day', 'date'],
  band: ['구분', '시간대', '밴드', 'band', '분류'],
  time: ['시간', 'time', '시각', '출발시간'],
  // '일정' is a category label (공항집결/오전볼거리/점심식사) in real files
  category: ['일정', '구분내용', '카테고리'],
  place: ['세부', '장소', '방문지', '방문장소', 'place', '목적지', '관광지', '상세', '세부일정'],
  region: ['주소', '지역', 'region', '위치', '소재지'],
  activity: ['활동', '내용', 'activity'],
  note: ['비고', '메모', 'note', '참고', '안내', '유래', '학습'],
};

function matchField(header: string): string | null {
  const h = norm(header);
  if (!h) return null;
  for (const [field, keys] of Object.entries(FIELD_KEYS)) {
    if (keys.some((k) => h === norm(k))) return field;
  }
  for (const [field, keys] of Object.entries(FIELD_KEYS)) {
    if (keys.some((k) => h.includes(norm(k)))) return field;
  }
  return null;
}

// Longest match wins so 저녁식사 -> 석식 rather than 저녁.
const BAND_SYNONYMS: Record<Band, string[]> = {
  조식: ['조식', '아침식사', '아침', 'breakfast', '조반'],
  중식: ['중식', '점심식사', '점심', 'lunch'],
  석식: ['석식', '저녁식사', '저녁', 'dinner', '만찬'],
  오전: ['오전', 'am', 'morning'],
  오후: ['오후', 'pm', 'afternoon'],
  저녁: ['야간', '야간활동', '숙소', 'night', 'evening', '나이트'],
};

/** Band from a category/구분 label such as '점심식사' or '오전볼거리'. */
export function toBand(v: unknown): Band | null {
  const s = norm(v);
  if (!s) return null;
  for (const b of BANDS) if (BAND_SYNONYMS[b].some((x) => norm(x) === s)) return b;
  let best: { band: Band; len: number } | null = null;
  for (const b of BANDS) {
    for (const w of BAND_SYNONYMS[b]) {
      const n = norm(w);
      if (s.includes(n) && (!best || n.length > best.len)) best = { band: b, len: n.length };
    }
  }
  return best?.band ?? null;
}

/** Fallback when a file has no 구분 column: place the entry by its clock time. */
export function bandFromTime(time: string, isMeal: boolean): Band | null {
  const m = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  if (isMeal) {
    if (mins < 10 * 60 + 30) return '조식';
    if (mins < 15 * 60) return '중식';
    return '석식';
  }
  if (mins < 12 * 60) return '오전';
  if (mins < 17 * 60 + 30) return '오후';
  return '저녁';
}

const MEAL_WORDS = ['식사', '조식', '중식', '석식', '점심', '아침', '저녁', '맛집', '국밥', '식당'];
const isMealish = (s: string) => MEAL_WORDS.some((w) => s.includes(w));

/** '1일차' | 1 | Date | '7월18일(토)' | '2026-07-18' -> a stable key per day. */
function dayKey(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return `d:${v.getFullYear()}-${v.getMonth() + 1}-${v.getDate()}`;
  const s = String(v).trim();
  if (!s) return null;
  const nth = s.match(/(\d+)\s*일\s*차/) || s.match(/^\s*(\d+)\s*$/) || s.match(/day\s*(\d+)/i);
  if (nth) return `n:${Number(nth[1])}`;
  const kor = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);     // 7월18일(토)
  if (kor) return `d:${kor[1]}-${kor[2]}`;
  const iso = s.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/); // 2026-07-18
  if (iso) return `d:${iso[1]}-${Number(iso[2])}-${Number(iso[3])}`;
  const md = s.match(/^(\d{1,2})[-./](\d{1,2})$/);            // 7/18
  if (md) return `d:${md[1]}-${md[2]}`;
  return null;
}

/** kept for the OCR path: '1일차' -> 0 */
export function toDayIndex(v: unknown, _startDate?: string): number | null {
  const k = dayKey(v);
  if (!k) return null;
  if (k.startsWith('n:')) return Math.max(0, Number(k.slice(2)) - 1);
  return null;
}

/** Excel time cell (Date | fraction-of-day | '09:30' | '6:30' | '오전 9시') -> 'HH:MM' */
export function toTime(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return `${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}`;
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const mins = Math.round(v * 24 * 60);
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  let m = s.match(/(\d{1,2})\s*[:시]\s*(\d{1,2})?/);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    if (/오후|pm/i.test(s) && h < 12) h += 12;
    if (/오전|am/i.test(s) && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{3,4})$/);
  if (m) {
    const n = m[1].padStart(4, '0');
    return `${n.slice(0, 2)}:${n.slice(2)}`;
  }
  return null;
}

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
  XLSX.writeFile(wb, 'TripOrganizer_일정_템플릿.xlsx');
}
