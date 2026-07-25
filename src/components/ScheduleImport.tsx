import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, BANDS, BAND_DEFAULT_TIME, isMealBand, type Band } from '../db';
import { parseWorkbook, downloadTemplate, type ParsedRow } from '../excel';
import { imageToRows } from '../ocr';
import { geocodeSearch } from '../geo';
import { Icon } from '../ui';

type Source = 'excel' | 'image' | null;

export default function ScheduleImport({ tripId, onClose }: { tripId: number; onClose: () => void }) {
  const trip = useLiveQuery(() => db.trips.get(tripId), [tripId]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [source, setSource] = useState<Source>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [rawText, setRawText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  async function onFile(f: File | undefined) {
    if (!f) return;
    setError(''); setNote(''); setRows([]); setFileName(f.name); setProgress(''); setRawText('');

    const isImage = f.type.startsWith('image/');
    setSource(isImage ? 'image' : 'excel');
    try {
      if (isImage) {
        setBusy(true);
        setImageUrl(URL.createObjectURL(f));
        const res = await imageToRows(f, trip?.startDate, (pct, status) =>
          setProgress(status === 'recognizing text' ? `글자 인식 중… ${pct}%` : '이미지 준비 중…'),
        );
        setRawText(res.rawText);
        if (res.rows.length === 0) {
          // Korean schedule tables rarely survive on-device OCR — start the
          // user off with one blank row they can fill in from the image above.
          setRows([{ dayIndex: 0, band: '오전', time: '', place: '', region: '', activity: '', learn: '' }]);
          setNote('사진을 보면서 아래에 일정을 입력하세요. 자동 인식은 한글 표에서 정확도가 낮습니다.');
        } else {
          setRows(res.rows);
          setNote('자동으로 읽은 결과입니다. 한글 표는 오인식이 많으니 사진과 비교해 고친 뒤 적용하세요.');
        }
      } else {
        const res = parseWorkbook(await f.arrayBuffer(), trip?.startDate);
        setRows(res.rows);
        if (res.rows.length === 0) {
          setError(`읽을 수 있는 일정 행을 찾지 못했습니다.\n시트 "${res.sheetName}" 머리글: ${res.headers.filter(Boolean).join(', ') || '(없음)'}`);
        }
      }
    } catch (e) {
      setError('파일을 읽지 못했습니다: ' + (e as Error).message);
    } finally {
      setBusy(false); setProgress('');
    }
  }

  const patch = (i: number, p: Partial<ParsedRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  const addRow = () =>
    setRows((rs) => [...rs, { dayIndex: 0, band: '오전', time: '', place: '', region: '', activity: '', learn: '' }]);

  async function apply() {
    if (!rows.length || !trip) return;
    setBusy(true);
    try {
      const maxDay = Math.max(...rows.map((r) => r.dayIndex)) + 1;
      if (maxDay > trip.dayCount) await db.trips.update(tripId, { dayCount: maxDay });

      if (replace) {
        const old = await db.slots.where('tripId').equals(tripId).toArray();
        await db.slots.bulkDelete(old.map((s) => s.id!));
      }

      const places = await db.places.where('tripId').equals(tripId).toArray();
      const byName = new Map(places.map((p) => [p.name.trim(), p.id!]));
      for (const r of rows) {
        const name = r.place.trim();
        if (!name) continue;
        if (byName.has(name)) {
          if (r.region || r.learn) {
            const id = byName.get(name)!;
            const cur = places.find((p) => p.id === id);
            await db.places.update(id, { region: r.region || cur?.region || '', learn: r.learn || cur?.learn || '' });
          }
          continue;
        }
        let lat: number | undefined, lng: number | undefined;
        try {
          const query = r.region || name;
          const cands = await geocodeSearch(query);
          if (cands.length > 0) { lat = cands[0].lat; lng = cands[0].lng; }
        } catch {
          // geocoding failed; place saved without coordinates (user can add via PlacePicker later)
        }
        byName.set(name, await db.places.add({ tripId, name, region: r.region, kind: isMealBand(r.band) ? 'food' : 'sight', learn: r.learn || undefined, lat, lng }));
      }

      const counter = new Map<string, number>();
      for (const r of rows) {
        const key = `${r.dayIndex}|${r.band}`;
        const order = counter.get(key) ?? 0;
        counter.set(key, order + 1);
        await db.slots.add({
          tripId,
          dayIndex: r.dayIndex,
          band: r.band,
          plannedTime: r.time || BAND_DEFAULT_TIME[r.band],
          order,
          placeId: r.place.trim() ? byName.get(r.place.trim())! : null,
          activityText: r.activity || '',
        });
      }
      onClose();
    } catch (e) {
      setError('적용 중 오류: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const days = new Set(rows.map((r) => r.dayIndex)).size;
  const placeCount = new Set(rows.map((r) => r.place.trim()).filter(Boolean)).size;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-[520px] bg-surface rounded-t-2xl p-4 pb-8 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-head font-bold text-[18px] flex items-center gap-1">
            <Icon name="upload_file" className="text-emerald" /> 일정 가져오기
          </h2>
          <button onClick={onClose} className="text-outline"><Icon name="close" /></button>
        </div>
        <p className="text-[12px] text-on-surface-variant mb-3">
          <b>엑셀</b>(일차·구분·시간·장소·활동 열) 또는 <b>일정표 사진·스크린샷</b>을 올리세요.
        </p>

        <div className="flex gap-2 mb-3">
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            className="btn-primary flex-1 flex items-center justify-center gap-1 text-[14px]">
            <Icon name="folder_open" className="text-[18px]" /> 파일 선택
          </button>
          <button onClick={downloadTemplate} className="btn-ghost text-[13px] flex items-center gap-1">
            <Icon name="download" className="text-[16px]" /> 템플릿
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,image/*" hidden
          onChange={(e) => onFile(e.target.files?.[0])} />

        {fileName && (
          <p className="text-[12px] text-on-surface-variant mb-2 truncate flex items-center gap-1">
            <Icon name={source === 'image' ? 'image' : 'description'} className="text-[15px]" /> {fileName}
          </p>
        )}
        {busy && progress && (
          <div className="rounded-md bg-primary-container/10 text-primary-container text-[12px] p-2.5 mb-2 flex items-center gap-2">
            <Icon name="autorenew" className="text-[16px] animate-spin" /> {progress}
          </div>
        )}
        {error && <div className="rounded-md bg-error/10 text-error text-[12px] p-2.5 mb-2 whitespace-pre-wrap">{error}</div>}
        {note && <div className="rounded-md bg-emerald/10 text-emerald text-[12px] p-2.5 mb-2">{note}</div>}

        {/* keep the source image on screen so the schedule can be typed from it */}
        {imageUrl && (
          <a href={imageUrl} target="_blank" rel="noreferrer" className="block mb-2 shrink-0">
            <img src={imageUrl} alt="업로드한 일정표"
              className="w-full max-h-44 object-contain rounded-md border border-outline-variant/40 bg-surface-container" />
            <span className="text-[11px] text-on-surface-variant flex items-center gap-0.5 mt-0.5">
              <Icon name="zoom_in" className="text-[13px]" /> 탭하면 원본 크기로 열립니다
            </span>
          </a>
        )}
        {rawText && (
          <details className="mb-2">
            <summary className="text-[12px] text-on-surface-variant cursor-pointer">인식된 글자 보기</summary>
            <pre data-testid="ocr-raw" className="mt-1 max-h-32 overflow-auto rounded-md bg-surface-container p-2 text-[11px] whitespace-pre-wrap">{rawText}</pre>
          </details>
        )}

        {(rows.length > 0 || (fileName && !busy)) && (
          <>
            <div className="flex items-center gap-2 text-[12px] mb-2">
              <span className="chip bg-emerald/10 text-emerald">{rows.length}개 일정</span>
              {days > 0 && <span className="chip bg-surface-variant text-on-surface-variant">{days}일</span>}
              {placeCount > 0 && <span className="chip bg-surface-variant text-on-surface-variant">장소 {placeCount}곳</span>}
            </div>

            <div className="flex-1 overflow-y-auto -mx-1 px-1 mb-3 space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="rounded-md border border-outline-variant/40 p-2">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <select className="text-[12px] rounded border-outline-variant py-1 pr-6"
                      value={r.dayIndex} onChange={(e) => patch(i, { dayIndex: Number(e.target.value) })}>
                      {Array.from({ length: Math.max(trip?.dayCount ?? 1, days, r.dayIndex + 1) }).map((_, d) => (
                        <option key={d} value={d}>{d + 1}일차</option>
                      ))}
                    </select>
                    <select className={`text-[12px] rounded border-outline-variant py-1 pr-6 ${isMealBand(r.band) ? 'text-emerald' : 'text-primary-container'}`}
                      value={r.band} onChange={(e) => patch(i, { band: e.target.value as Band })}>
                      {BANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                    <input type="time" className="text-[12px] rounded border-outline-variant py-1"
                      value={r.time || BAND_DEFAULT_TIME[r.band]} onChange={(e) => patch(i, { time: e.target.value })} />
                    <button onClick={() => removeRow(i)} className="ml-auto text-outline" aria-label="행 삭제">
                      <Icon name="close" className="text-[16px]" />
                    </button>
                  </div>
                  <div className="flex gap-1.5">
                    <input className="input text-[12px] py-1.5 flex-1" placeholder="장소 (선택)"
                      value={r.place} onChange={(e) => patch(i, { place: e.target.value })} />
                    <input className="input text-[12px] py-1.5 flex-[1.4]" placeholder="활동/내용"
                      value={r.activity} onChange={(e) => patch(i, { activity: e.target.value })} />
                  </div>
                </div>
              ))}
              <button onClick={addRow} className="w-full text-[13px] font-semibold text-primary-container flex items-center justify-center gap-1 py-2 rounded-md border border-dashed border-primary-container/50">
                <Icon name="add" className="text-[16px]" /> 일정 행 추가
              </button>
            </div>

            <label className="flex items-center gap-2 text-[13px] mb-3">
              <input type="checkbox" className="rounded border-outline-variant text-primary-container focus:ring-primary-container"
                checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              기존 일정을 지우고 덮어쓰기
            </label>

            <button onClick={apply} disabled={busy || rows.length === 0} className="btn-primary w-full">
              {busy ? '적용 중…' : `${rows.length}개 일정 적용하기`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
