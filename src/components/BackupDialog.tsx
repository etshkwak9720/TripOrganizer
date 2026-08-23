import { useState } from 'react';
import { db, exportTrip, importTrip } from '../db';
import { isTripFile, tripFileName, type TripFile } from '../tripFile';
import { Icon } from '../ui';

/**
 * 여행 내보내기.
 *
 * 사진 포함 여부를 고르게 한다. 백업이면 포함이 맞지만, 참가자에게 메신저로 일정만
 * 건넬 때는 사진이 들어가면 파일이 너무 커진다.
 *
 * window.confirm / alert 은 쓰지 않는다 — 모바일 PWA·인앱브라우저에서 무시돼
 * 버튼이 아무 반응 없는 것처럼 보인다(이 앱에서 이미 겪은 문제).
 */
export function ExportDialog({ tripId, title, onClose }: {
  tripId: number; title: string; onClose: () => void;
}) {
  const [withPhotos, setWithPhotos] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const run = async () => {
    setBusy(true); setError('');
    try {
      const file = await exportTrip(tripId, { includePhotos: withPhotos });
      const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = tripFileName(title);
      a.click();
      URL.revokeObjectURL(url);
      markExported(tripId);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '내보내지 못했습니다');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-[520px] bg-surface rounded-t-2xl p-5 pb-8 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-head font-bold text-[17px] flex items-center gap-2">
          <Icon name="download" className="text-[20px]" /> 여행 파일로 저장
        </h3>

        <p className="text-[13px] text-on-surface-variant leading-relaxed">
          이 여행을 파일 하나로 내려받습니다. 브라우저 자료가 지워져도 이 파일로 되살릴 수 있습니다.
        </p>

        <label className="flex items-start gap-2.5 text-[14px] cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={withPhotos}
                 onChange={(e) => setWithPhotos(e.target.checked)} />
          <span>
            사진도 함께 저장
            <span className="block text-[12px] text-on-surface-variant mt-0.5">
              {withPhotos
                ? '완전한 백업입니다. 사진이 많으면 파일이 큽니다.'
                : '일정만 담깁니다. 파일이 작아 메신저로 보내기 좋습니다.'}
            </span>
          </span>
        </label>

        {error && <p className="text-[13px] text-red-600">{error}</p>}
        {done && (
          <p className="text-[13px] text-emerald flex items-center gap-1.5">
            <Icon name="check_circle" className="text-[16px]" /> 저장했습니다. 다운로드 폴더를 확인하세요.
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button className="btn-ghost flex-1" onClick={onClose}>닫기</button>
          <button className="btn-primary flex-1" onClick={run} disabled={busy}>
            {busy ? '만드는 중…' : done ? '다시 저장' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 여행 파일을 골라 되살린다. 원본은 건드리지 않고 항상 새 여행으로 들어간다. */
export function ImportButton({ onDone }: { onDone: (tripId: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async (f: File) => {
    setBusy(true); setError('');
    try {
      const parsed: unknown = JSON.parse(await f.text());
      if (!isTripFile(parsed)) throw new Error('여행 파일이 아닙니다');
      const id = await importTrip(parsed as TripFile);
      const t = await db.trips.get(id);
      onDone(id);
      setError(`"${t?.title ?? '여행'}" 을(를) 불러왔습니다.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오지 못했습니다');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <label className="btn-ghost inline-flex items-center justify-center gap-1.5 cursor-pointer" data-testid="import-trip">
        <Icon name="upload" className="text-[18px]" />
        {busy ? '불러오는 중…' : '여행 파일 불러오기'}
        <input type="file" accept=".json,application/json" hidden disabled={busy}
               onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f); }} />
      </label>
      {error && <p className="text-[12px] text-on-surface-variant">{error}</p>}
    </div>
  );
}

/**
 * 자료가 이 기기에만 있다는 사실을 알린다.
 *
 * 사용자는 앱이 어딘가에 저장해 줄 거라고 기대한다. 이 앱은 그러지 않는다 —
 * 알리지 않으면 브라우저 자료를 지운 뒤에야 알게 된다.
 */
export function LocalOnlyNotice({ onExport }: { onExport?: () => void }) {
  return (
    <div className="rounded-md bg-surface-variant/40 px-3.5 py-3 text-[12.5px] leading-relaxed">
      <p className="flex items-start gap-1.5 text-on-surface-variant">
        <Icon name="info" className="text-[16px] mt-px shrink-0" />
        <span>
          여행 자료는 <b>이 기기 브라우저에만</b> 저장됩니다. 브라우저 자료를 지우거나 기기를
          바꾸면 사라집니다. 여행이 끝나면 파일로 저장해 두세요.
          {onExport && (
            <button className="ml-1 underline font-semibold text-emerald" onClick={onExport}>
              지금 저장
            </button>
          )}
        </span>
      </p>
    </div>
  );
}

/**
 * 끝난 여행을 아직 파일로 안 남겼다면 눈에 띄게 권한다.
 *
 * 여행이 끝나는 순간이 회수 기회의 마지막이다. 그 뒤로는 앱을 열 이유가 없어져
 * 브라우저 정리 한 번에 통째로 날아간다. "한 번 저장했음"은 기기에만 기록하므로
 * 다른 기기에서는 다시 뜬다 — 자료가 기기마다 따로인 앱이라 그게 맞다.
 */
const SAVED_KEY = 'trip-exported';

export function markExported(tripId: number) {
  try {
    const done = new Set<number>(JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'));
    done.add(tripId);
    localStorage.setItem(SAVED_KEY, JSON.stringify([...done]));
  } catch { /* 저장소가 막혀 있어도 앱은 계속 돌아야 한다 */ }
}

export function wasExported(tripId: number): boolean {
  try {
    return (JSON.parse(localStorage.getItem(SAVED_KEY) || '[]') as number[]).includes(tripId);
  } catch { return false; }
}

export function FinishedTripPrompt({ trips, onExport }: {
  trips: { id: number; title: string }[];
  onExport: (id: number, title: string) => void;
}) {
  const pending = trips.filter((t) => !wasExported(t.id));
  if (pending.length === 0) return null;
  const first = pending[0];

  return (
    <div className="rounded-md border border-emerald/40 bg-emerald/5 px-3.5 py-3 space-y-2">
      <p className="text-[13px] font-semibold flex items-center gap-1.5">
        <Icon name="save" className="text-[17px] text-emerald" />
        끝난 여행을 파일로 남겨두세요
      </p>
      <p className="text-[12.5px] text-on-surface-variant leading-relaxed">
        {pending.length > 1
          ? `${first.title} 외 ${pending.length - 1}개의 여행이 아직 저장되지 않았습니다.`
          : `"${first.title}" 이(가) 아직 저장되지 않았습니다.`}
        {' '}지금이 사진과 기록을 챙길 마지막 기회입니다.
      </p>
      <div className="flex flex-wrap gap-2">
        {pending.slice(0, 3).map((t) => (
          <button key={t.id} className="btn-ghost text-[13px] px-3 py-2"
                  onClick={() => onExport(t.id, t.title)}>
            {t.title} 저장
          </button>
        ))}
      </div>
    </div>
  );
}
