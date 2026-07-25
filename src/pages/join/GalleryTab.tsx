import { useEffect, useRef, useState } from 'react';
import { compressPhoto } from '../../image';
import { Icon, Screen } from '../../ui';
import type { ShareSnapshot, PhotoMeta } from '../../share';
import { ownerToken, storageKey } from '../Join';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result as string;
      resolve(r.slice(r.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export default function GalleryTab({ shareId, places }: { shareId: string; places: ShareSnapshot['places'] }) {
  const [photos, setPhotos] = useState<PhotoMeta[]>([]);
  const [filter, setFilter] = useState<number | 'all'>('all');
  const [error, setError] = useState('');
  const me = ownerToken();
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<{ placeId: number | null } | null>(null);
  const pw = () => localStorage.getItem(storageKey(shareId)) ?? '';

  async function load() {
    const res = await fetch(`/api/share/${shareId}/photos`, { headers: { 'x-trip-password': pw() } });
    if (res.ok) setPhotos((await res.json()).photos);
  }
  useEffect(() => {
    load();
    const iv = setInterval(load, 20000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareId]);

  async function upload(file: File, placeId: number | null) {
    setError('');
    const compressed = await compressPhoto(file);
    const fileBase64 = await blobToBase64(compressed);
    const res = await fetch(`/api/share/${shareId}/photos`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw(), placeId, caption: '', fileBase64, contentType: compressed.type, owner: me }),
    });
    if (res.ok) load();
    else setError((await res.json().catch(() => ({}))).error ?? '업로드 실패');
  }

  async function remove(photo: PhotoMeta) {
    const res = await fetch(`/api/share/${shareId}/photos`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw(), id: photo.id, owner: me }),
    });
    if (res.ok) load();
    else setError((await res.json().catch(() => ({}))).error ?? '삭제 실패');
  }

  // 교체 = 기존 삭제(자리 확보) 후 같은 장소로 새 사진 선택 업로드
  async function replace(photo: PhotoMeta) {
    await remove(photo);
    replaceRef.current = { placeId: photo.placeId };
    fileRef.current?.click();
  }

  function onPick(file: File | undefined) {
    if (!file) return;
    const target = replaceRef.current;
    replaceRef.current = null;
    upload(file, target ? target.placeId : (filter === 'all' ? null : filter));
  }

  const shown = photos.filter((p) => filter === 'all' || p.placeId === filter);
  const placeName = (pid: number | null) => places.find((p) => p.id === pid)?.name ?? '장소 미지정';

  return (
    <>
      <div className="flex gap-2 px-4 pt-3 overflow-x-auto no-scrollbar">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>전체</FilterChip>
        {places.map((p) => (
          <FilterChip key={p.id} active={filter === p.id} onClick={() => setFilter(p.id)}>{p.name}</FilterChip>
        ))}
      </div>
      <Screen>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-[15px]">사진 ({shown.length})</h3>
          <button className="chip bg-primary-container text-on-primary-container" onClick={() => { replaceRef.current = null; fileRef.current?.click(); }}>
            <Icon name="add_a_photo" className="text-[16px]" /> 올리기
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onPick(e.target.files?.[0])} />
        </div>
        {error && <p className="text-[13px] text-red-600 mb-2">{error}</p>}
        {shown.length === 0 ? (
          <p className="text-[13px] text-on-surface-variant py-8 text-center">아직 사진이 없어요. 첫 사진을 올려보세요.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {shown.map((ph) => (
              <div key={ph.id} className="relative aspect-square rounded-lg overflow-hidden bg-surface-variant">
                <a href={ph.blobUrl} target="_blank" rel="noreferrer" download>
                  <img src={ph.blobUrl} alt={placeName(ph.placeId)} className="w-full h-full object-cover" />
                </a>
                <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/45 text-white text-[10px] font-medium max-w-[85%] truncate">{placeName(ph.placeId)}</span>
                {ph.owner === me && (
                  <div className="absolute bottom-1.5 right-1.5 flex gap-1">
                    <button onClick={() => replace(ph)} aria-label="교체" className="w-7 h-7 rounded-full bg-black/55 grid place-items-center text-white"><Icon name="swap_horiz" className="text-[16px]" /></button>
                    <button onClick={() => remove(ph)} aria-label="삭제" className="w-7 h-7 rounded-full bg-black/55 grid place-items-center text-white"><Icon name="delete" className="text-[16px]" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Screen>
    </>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-[13px] font-semibold ${active ? 'bg-primary-container text-on-primary-container' : 'bg-surface-variant text-on-surface-variant'}`}>
      {children}
    </button>
  );
}
