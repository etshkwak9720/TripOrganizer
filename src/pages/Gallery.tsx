import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Photo } from '../db';
import { Icon, TopBar, Screen, EmptyState } from '../ui';

export default function Gallery() {
  const { id } = useParams();
  const tripId = Number(id);
  const trip = useLiveQuery(() => db.trips.get(tripId), [tripId]);
  const places = useLiveQuery(() => db.places.where('tripId').equals(tripId).toArray(), [tripId]);
  const photos = useLiveQuery(() => db.photos.where('tripId').equals(tripId).reverse().toArray(), [tripId]);
  const [filter, setFilter] = useState<number | 'all'>('all');
  const [selected, setSelected] = useState<Photo | null>(null);

  if (!trip) return null;

  const shown = (photos ?? []).filter((p) => filter === 'all' || p.placeId === filter);
  const placeName = (pid: number | null) => places?.find((p) => p.id === pid)?.name ?? '장소 미지정';

  return (
    <>
      <TopBar
        title="추억 갤러리"
        backTo="/"
        right={<UploadButton tripId={tripId} placeId={filter === 'all' ? null : filter} />}
      />

      <div className="flex gap-2 px-4 pt-3 overflow-x-auto no-scrollbar">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>전체</Chip>
        {places?.map((p) => (
          <Chip key={p.id} active={filter === p.id} onClick={() => setFilter(p.id!)}>{p.name}</Chip>
        ))}
      </div>

      <Screen>
        {shown.length === 0 ? (
          <EmptyState icon="add_a_photo" title="아직 사진이 없어요"
            hint={filter === 'all' ? '오른쪽 위 버튼으로 사진을 올려보세요' : '이 장소의 첫 사진을 올려보세요'} />
        ) : (
          <>
            <p className="text-[12px] text-on-surface-variant mb-2">{shown.length}장 · 사진을 탭하면 감상평을 남길 수 있어요</p>
            <div className="grid grid-cols-2 gap-2">
              {shown.map((ph) => (
                <Thumb key={ph.id} photo={ph} place={placeName(ph.placeId)} onClick={() => setSelected(ph)} />
              ))}
            </div>
            <button disabled className="btn-ghost w-full mt-5 opacity-60 flex items-center justify-center gap-1">
              <Icon name="movie" /> 자동 슬라이드쇼 영상 (곧 제공)
            </button>
          </>
        )}
      </Screen>

      {selected && (
        <PhotoDetail
          photo={selected}
          place={placeName(selected.placeId)}
          onClose={() => setSelected(null)}
          onDelete={() => { db.photos.delete(selected.id!); setSelected(null); }}
        />
      )}
    </>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-[13px] font-semibold ${active ? 'bg-primary-container text-on-primary-container' : 'bg-surface-variant text-on-surface-variant'}`}>
      {children}
    </button>
  );
}

function useObjectUrl(blob: Blob) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

function Thumb({ photo, place, onClick }: { photo: Photo; place: string; onClick: () => void }) {
  const url = useObjectUrl(photo.blob);
  return (
    <button onClick={onClick} className="relative aspect-square rounded-lg overflow-hidden bg-surface-variant active:scale-[0.98] transition">
      {url && <img src={url} alt={photo.caption || place} className="w-full h-full object-cover" />}
      <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/45 text-white text-[10px] font-medium max-w-[85%] truncate">{place}</span>
      {photo.caption ? (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pt-4 pb-1.5">
          <p className="text-white text-[11px] leading-tight line-clamp-2 text-left">{photo.caption}</p>
        </div>
      ) : (
        <span className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-full bg-black/45 grid place-items-center">
          <Icon name="edit_note" className="text-white text-[15px]" />
        </span>
      )}
    </button>
  );
}

function PhotoDetail({ photo, place, onClose, onDelete }: {
  photo: Photo; place: string; onClose: () => void; onDelete: () => void;
}) {
  const url = useObjectUrl(photo.blob);
  const [caption, setCaption] = useState(photo.caption);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={onClose}>
      <div className="flex items-center gap-2 p-3 text-white" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label="닫기"><Icon name="close" /></button>
        <span className="flex items-center gap-1 text-[14px] font-semibold"><Icon name="place" className="text-[16px]" /> {place}</span>
        <span className="ml-auto text-[12px] text-white/70">{new Date(photo.ts).toLocaleDateString()}</span>
        <button onClick={onDelete} aria-label="삭제" className="text-white/80"><Icon name="delete" /></button>
      </div>
      <div className="flex-1 flex items-center justify-center px-3 min-h-0" onClick={(e) => e.stopPropagation()}>
        {url && <img src={url} alt={caption || place} className="max-w-full max-h-full object-contain rounded-lg" />}
      </div>
      <div className="p-3 bg-surface" onClick={(e) => e.stopPropagation()}>
        <label className="field-label">한줄 감상평</label>
        <input
          className="input"
          placeholder="이 순간을 한 줄로 남겨보세요"
          value={caption}
          onChange={(e) => { setCaption(e.target.value); db.photos.update(photo.id!, { caption: e.target.value }); }}
        />
      </div>
    </div>
  );
}

function UploadButton({ tripId, placeId }: { tripId: number; placeId: number | null }) {
  const ref = useRef<HTMLInputElement>(null);
  async function onFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      await db.photos.add({ tripId, placeId, blob: f, caption: '', ts: Date.now() });
    }
    if (ref.current) ref.current.value = '';
  }
  return (
    <>
      <button onClick={() => ref.current?.click()} className="chip bg-primary-container text-on-primary-container">
        <Icon name="add_a_photo" className="text-[16px]" /> 올리기
      </button>
      <input ref={ref} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
    </>
  );
}
