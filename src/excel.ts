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
  저녁: ['야간', 'night', 'evening', '나이트'],
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

/**
 * Parse a schedule workbook. Handles the shapes real files come in:
 * a title row above the header, merged 일자 cells, Korean dates, no 구분
 * column (band inferred from the 일정 label or the clock), and trailing
 * free-text note rows.
 */
export function parseWorkbook(buf: ArrayBuffer, _startDate?: string): ParseResult {
  const wb = XLSX.read(buf, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const grid: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false });

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

  // merged day cells: carry the last seen day down; order days by appearance
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
    // free-text note rows: no time, no place, just a long sentence
    if (!r.time && !r.place && (r.category.length > 25 || r.activity.length > 25)) { skipped++; return; }
    if (day == null) { skipped++; return; }

    let band = toBand(r.category) ?? toBand(r.activity);
    if (!band && r.time) band = bandFromTime(r.time, isMealish(label));
    if (!band) band = lastBand;                 // e.g. the 'B.' alternative under a dinner row
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

/** Downloadable template that always imports cleanly. */
export function downloadTemplate() {
  const data = [
    ['일자', '시간', '일정', '세부', '주소', '비고'],
    ['7월18일(토)', '9:00', '오전볼거리', '보성 녹차밭', '전남 보성군 보성읍 녹차로 763-43', '입장료 3,000원'],
    ['', '12:30', '점심식사', '정가네원조꼬막회관', '전남 보성군 벌교읍 조정래길 55', '추천-꼬막비빔밥'],
    ['', '16:00', '산책', '오동도', '전남 여수시 수정동 산1-11', '1시간30분 소요'],
    ['', '18:00', '저녁', '미로횟집', '전남 여수시 시청서3길 18', '택시 20분'],
    ['7월19일(일)', '8:30', '아침식사', '광장국밥', '전남 여수시 통제영5길 3', '바지락돼지국밥'],
    ['', '10:30', '볼거리', '돌산공원', '전남 여수시 돌산읍 우두리 산355-1', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 12 }, { wch: 7 }, { wch: 11 }, { wch: 20 }, { wch: 34 }, { wch: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '일정');
  XLSX.writeFile(wb, '여정_일정_템플릿.xlsx');
}
