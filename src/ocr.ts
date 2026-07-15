import { toTime, toDayIndex, type ParsedRow } from './excel';
import { BANDS, type Band } from './db';

export interface OcrResult {
  rows: ParsedRow[];
  rawText: string;
  confidence: number;
}

const BAND_WORDS: Record<Band, string[]> = {
  조식: ['조식', '아침'],
  오전: ['오전'],
  중식: ['중식', '점심'],
  오후: ['오후'],
  석식: ['석식', '저녁식사'],
  저녁: ['저녁', '야간'],
};

/** Pull a band keyword out of a free-text OCR line (longest match wins). */
function findBand(line: string): { band: Band; word: string } | null {
  let best: { band: Band; word: string } | null = null;
  for (const b of BANDS) {
    for (const w of BAND_WORDS[b]) {
      if (line.includes(w) && (!best || w.length > best.word.length)) best = { band: b, word: w };
    }
  }
  return best;
}

const TIME_RE = /(오전|오후)?\s*(\d{1,2})\s*[:시]\s*(\d{1,2})?\s*분?/;
const DAY_RE = /(\d+)\s*일\s*차?/;

/**
 * OCR text -> schedule rows. Works line by line: a line contributes a row when
 * it carries a band keyword (or a time under a known day). Day markers carry
 * down until the next one, mirroring how printed schedules are laid out.
 */
export function parseOcrText(text: string, startDate?: string): ParsedRow[] {
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const rows: ParsedRow[] = [];
  let lastDay: number | null = null;

  for (const line of lines) {
    // a day header like "1일차" / "2일차 – 동부 코스"
    const dayM = line.match(DAY_RE);
    if (dayM) {
      const d = toDayIndex(dayM[0], startDate);
      if (d != null) lastDay = d;
    }

    const bandHit = findBand(line);
    const timeM = line.match(TIME_RE);
    if (!bandHit && !timeM) continue;          // nothing schedule-ish on this line
    if (lastDay == null && !bandHit) continue; // can't place it yet

    const band: Band | null = bandHit?.band ?? null;
    if (!band) continue;

    // strip the day / band / time tokens; what remains is the place+activity
    let rest = line;
    if (dayM) rest = rest.replace(dayM[0], ' ');
    rest = rest.replace(bandHit!.word, ' ');
    if (timeM) rest = rest.replace(timeM[0], ' ');
    rest = rest.replace(/[|·:\-–—~>]+/g, ' ').replace(/\s+/g, ' ').trim();

    rows.push({
      dayIndex: lastDay ?? 0,
      band,
      time: (timeM && toTime(timeM[0])) || '',
      place: '',          // OCR can't tell place from activity — user edits in preview
      region: '',
      activity: rest,
      learn: '',
    });
  }
  return rows;
}

/**
 * Upscale + grey + soften contrast before OCR. Tesseract needs roughly
 * 300dpi-sized glyphs; table text in a phone screenshot is far below that and
 * comes back as noise without this step.
 */
async function preprocess(file: File): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const TARGET = 2200; // px wide is plenty for tesseract
  const scale = Math.max(1, Math.min(4, TARGET / bmp.width));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);

  // greyscale only — hard thresholding merges the dense strokes of Hangul and
  // makes recognition worse, so leave the anti-aliasing intact.
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Run OCR on an image file. tesseract.js is loaded lazily (it is large). */
export async function imageToRows(
  file: File,
  startDate: string | undefined,
  onProgress?: (pct: number, status: string) => void,
): Promise<OcrResult> {
  onProgress?.(0, 'preprocessing');
  const canvas = await preprocess(file);

  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(['kor', 'eng'], 1, {
    logger: (m: { status: string; progress: number }) => {
      onProgress?.(Math.round((m.progress ?? 0) * 100), m.status);
    },
  });
  try {
    // PSM 4 = a single column of text of variable sizes; handles a ruled
    // schedule table better than the default auto-segmentation.
    await worker.setParameters({ tessedit_pageseg_mode: '4' as never });
    const { data } = await worker.recognize(canvas);
    return {
      rows: parseOcrText(data.text, startDate),
      rawText: data.text,
      confidence: data.confidence ?? 0,
    };
  } finally {
    await worker.terminate();
  }
}
