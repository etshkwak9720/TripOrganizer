import { useState } from 'react';
import { db } from '../db';

export default function RenameTripDialog({ tripId, current, onClose }: {
  tripId: number;
  current: string;
  onClose: () => void;
}) {
  const [value, setValue] = useState(current);
  const trimmed = value.trim();

  async function save() {
    if (!trimmed) return;
    await db.trips.update(tripId, { title: trimmed });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-[520px] bg-surface rounded-t-2xl p-5 pb-8 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-head font-bold text-[20px]">여행 이름 수정</h2>
        <input
          className="input"
          autoFocus
          value={value}
          placeholder="예: 3반 제주 수학여행"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
        />
        <div className="flex gap-3">
          <button className="flex-1 py-3 rounded-md bg-surface-variant text-on-surface-variant font-semibold active:scale-95 transition" onClick={onClose}>
            취소
          </button>
          <button
            className="flex-1 py-3 rounded-md bg-primary-container text-on-primary-container font-semibold active:scale-95 transition disabled:opacity-40"
            disabled={!trimmed}
            onClick={save}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
