import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BANDS, isMealBand, type Band } from '../db';
import { compressPhoto } from '../image';
import { Icon, Screen, TopBar } from '../ui';
import type { ShareSnapshot, PhotoMeta } from '../share';

function storageKey(shareId: string) {
  return `share-password:${shareId}`;
}

// data URL로 읽어 접두사만 떼면, 큰 사진에서도 안전하게 base64를 얻는다.
// (String.fromCharCode(...bytes)는 인자 수 상한을 넘겨 RangeError가 날 수 있다)
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export default function Join() {
  const { shareId } = useParams<{ shareId: string }>();
  const [password, setPassword] = useState('');
  const [schedule, setSchedule] = useState<ShareSnapshot | null>(null);
  const [photos, setPhotos] = useState<PhotoMeta[]>([]);
  const [error, setError] = useState('');
  const [day, setDay] = useState(0);

  async function verify(pw: string) {
    setError('');
    const res = await fetch(`/api/share/${shareId}/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? '비밀번호가 틀렸습니다');
      return false;
    }
    const body = await res.json();
    setSchedule(body.schedule);
    localStorage.setItem(storageKey(shareId!), pw);
    await loadPhotos(pw);
    return true;
  }

  async function loadPhotos(pw: string) {
    const res = await fetch(`/api/share/${shareId}/photos`, {
      headers: { 'x-trip-password': pw },
    });
    if (res.ok) setPhotos((await res.json()).photos);
  }

  useEffect(() => {
    const saved = localStorage.getItem(storageKey(shareId!));
    if (saved) verify(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareId]);

  async function uploadPhoto(file: File) {
    const pw = localStorage.getItem(storageKey(shareId!));
    if (!pw) return;
    const compressed = await compressPhoto(file);
    const fileBase64 = await blobToBase64(compressed);
    const res = await fetch(`/api/share/${shareId}/photos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw, placeId: null, caption: '', fileBase64, contentType: compressed.type }),
    });
    if (res.ok) await loadPhotos(pw);
    else alert((await res.json().catch(() => ({}))).error ?? '업로드 실패');
  }

  if (!schedule) {
    return (
      <Screen>
        <TopBar title="여행 참여" />
        <div className="p-4 space-y-3">
          <input
            type="password"
            className="input"
            placeholder="여행 비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="btn-primary w-full" onClick={() => verify(password)}>
            입장
          </button>
          {error && <p className="text-[13px] text-red-600">{error}</p>}
        </div>
      </Screen>
    );
  }

  const daySlots = schedule.slots.filter((s) => s.dayIndex === day);

  return (
    <>
      <TopBar title={schedule.trip.title} />
      <div className="flex gap-2 px-4 pt-3 overflow-x-auto no-scrollbar">
        {Array.from({ length: schedule.trip.dayCount }).map((_, i) => (
          <button
            key={i}
            onClick={() => setDay(i)}
            className={`shrink-0 px-4 py-2 rounded-full text-[14px] font-semibold ${
              day === i ? 'bg-primary-container text-on-primary-container' : 'bg-surface-variant text-on-surface-variant'
            }`}
          >
            {i + 1}일차
          </button>
        ))}
      </div>
      <Screen>
        <div className="space-y-3">
          {(BANDS as Band[]).map((band) => {
            const entries = daySlots.filter((s) => s.band === band);
            if (entries.length === 0) return null;
            return (
              <div key={band} className="card p-3">
                <span className={`chip ${isMealBand(band) ? 'bg-emerald/10 text-emerald' : 'bg-primary-container/15 text-primary-container'}`}>
                  {band}
                </span>
                {entries.map((s, i) => {
                  const place = s.placeId != null ? schedule.places.find((p) => p.id === s.placeId) : undefined;
                  return (
                    <p key={i} className="text-[14px] mt-1">
                      {s.plannedTime} — {place?.name ?? s.activityText ?? '미정'}
                    </p>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="mt-6 pt-4 border-t border-outline-variant/30">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">사진 ({photos.length})</h3>
            <label className="chip bg-emerald/10 text-emerald cursor-pointer">
              <Icon name="add_a_photo" className="text-[16px]" /> 올리기
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])}
              />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <a key={p.id} href={p.blobUrl} target="_blank" rel="noreferrer" download>
                <img src={p.blobUrl} alt="" className="w-full aspect-square object-cover rounded-md" />
              </a>
            ))}
          </div>
        </div>
      </Screen>
    </>
  );
}
