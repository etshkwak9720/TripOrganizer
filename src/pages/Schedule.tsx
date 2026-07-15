import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db, BANDS, isMealBand, BAND_DEFAULT_TIME,
  type Band, type Slot, type Place, type Photo,
} from '../db';
import { Icon, TopBar, Screen } from '../ui';
import ScheduleImport from '../components/ScheduleImport';

const MAX_PER_BAND = 4;

export default function Schedule() {
  const { id } = useParams();
  const tripId = Number(id);
  const trip = useLiveQuery(() => db.trips.get(tripId), [tripId]);
  const [day, setDay] = useState(0);
  const [importOpen, setImportOpen] = useState(false);

  const slots = useLiveQuery(
    () => db.slots.where('[tripId+dayIndex]').equals([tripId, day]).toArray(),
    [tripId, day],
  );
  const places = useLiveQuery(() => db.places.where('tripId').equals(tripId).toArray(), [tripId]);

  // every band shows one input by default; extra entries are opt-in via '활동 추가'
  useEffect(() => {
    if (!slots) return;
    const missing = BANDS.filter((b) => !slots.some((s) => s.band === b));
    if (missing.length === 0) return;
    db.slots.bulkAdd(
      missing.map((b) => ({
        tripId, dayIndex: day, band: b,
        plannedTime: BAND_DEFAULT_TIME[b], order: 0,
        placeId: null, activityText: '',
      })),
    );
  }, [slots, tripId, day]);

  if (!trip) return null;

  const inBand = (band: Band) =>
    (slots ?? []).filter((s) => s.band === band).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id ?? 0) - (b.id ?? 0));

  async function addEntry(band: Band) {
    const existing = inBand(band);
    await db.slots.add({
      tripId, dayIndex: day, band,
      plannedTime: existing[existing.length - 1]?.plannedTime ?? BAND_DEFAULT_TIME[band],
      order: existing.length,
      placeId: null, activityText: '',
    });
  }

  return (
    <>
      <TopBar
        title="일정 짜기"
        back
        right={
          <button onClick={() => setImportOpen(true)} className="chip bg-emerald/10 text-emerald">
            <Icon name="upload_file" className="text-[16px]" /> 가져오기
          </button>
        }
      />

      <div className="flex gap-2 px-4 pt-3 overflow-x-auto no-scrollbar">
        {Array.from({ length: trip.dayCount }).map((_, i) => (
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
        <div className="relative pl-4">
          <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-primary-container/30" />
          <div className="space-y-3">
            {BANDS.map((band) => (
              <div key={band} className="relative">
                <div className="absolute -left-4 top-3 w-3.5 h-3.5 rounded-full bg-primary-container ring-4 ring-surface" />
                <BandCard
                  band={band}
                  entries={inBand(band)}
                  places={places ?? []}
                  onAdd={() => addEntry(band)}
                  ensureFirst={() => addEntry(band)}
                />
              </div>
            ))}
          </div>
        </div>
      </Screen>

      {importOpen && <ScheduleImport tripId={tripId} onClose={() => setImportOpen(false)} />}
    </>
  );
}

function BandCard({ band, entries, places, onAdd, ensureFirst }: {
  band: Band;
  entries: Slot[];
  places: Place[];
  onAdd: () => void;
  ensureFirst: () => void;
}) {
  const meal = isMealBand(band);
  // meal bands: single entry; activity bands: list
  const list = entries.length ? entries : [];

  return (
    <div className="card p-3 ml-1">
      <div className="flex items-center gap-2 mb-2">
        <span className={`chip ${meal ? 'bg-emerald/10 text-emerald' : 'bg-primary-container/15 text-primary-container'}`}>
          <Icon name={meal ? 'restaurant' : 'directions_walk'} className="text-[15px]" /> {band}
        </span>
        {!meal && (
          <span className="text-[11px] text-on-surface-variant">{list.length > 0 ? `${list.length}개 활동` : ''}</span>
        )}
      </div>

      {list.length === 0 ? (
        <button onClick={ensureFirst} className="btn-ghost w-full text-[14px] flex items-center justify-center gap-1">
          <Icon name="add" className="text-[18px]" /> {meal ? '식사 정하기' : '활동 추가'}
        </button>
      ) : (
        <div className="space-y-3">
          {list.map((slot, i) => (
            // the first entry is the band's base input and stays put; extras can be removed
            <Entry key={slot.id} slot={slot} band={band} places={places} index={i} canDelete={i > 0} />
          ))}
        </div>
      )}

      {!meal && list.length > 0 && list.length < MAX_PER_BAND && (
        <button onClick={onAdd} className="mt-3 w-full text-[13px] font-semibold text-primary-container flex items-center justify-center gap-1 py-2 rounded-md border border-dashed border-primary-container/50">
          <Icon name="add" className="text-[16px]" /> 활동 추가 ({list.length}/{MAX_PER_BAND})
        </button>
      )}
    </div>
  );
}

function Entry({ slot, band, places, index, canDelete }: {
  slot: Slot; band: Band; places: Place[]; index: number; canDelete: boolean;
}) {
  const meal = isMealBand(band);

  return (
    <div className={index > 0 ? 'pt-3 border-t border-outline-variant/25' : ''}>
      <div className="flex items-center gap-2 mb-2">
        {!meal && <span className="text-[11px] font-bold text-primary-container w-4">{index + 1}</span>}
        <input
          type="time"
          className="text-[13px] rounded-md border-outline-variant py-1"
          value={slot.plannedTime}
          onChange={(e) => db.slots.update(slot.id!, { plannedTime: e.target.value })}
        />
        {canDelete && (
          <button onClick={() => db.slots.delete(slot.id!)} className="ml-auto text-outline" aria-label="삭제">
            <Icon name="close" className="text-[18px]" />
          </button>
        )}
      </div>

      {meal ? (
        <input
          className="input text-[14px]"
          placeholder="식사 장소/메뉴 입력 (예: 갈치조림)"
          value={slot.activityText ?? ''}
          onChange={(e) => db.slots.update(slot.id!, { activityText: e.target.value })}
        />
      ) : (
        <div className="space-y-2">
          <select
            className="input text-[14px]"
            value={slot.placeId ?? ''}
            onChange={(e) => db.slots.update(slot.id!, { placeId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">방문 장소 선택…</option>
            {places.map((p) => <option key={p.id} value={p.id}>{p.name}{p.region ? ` (${p.region})` : ''}</option>)}
          </select>
          <input
            className="input text-[14px]"
            placeholder="또는 활동/지역 직접 입력"
            defaultValue={slot.activityText ?? ''}
            onChange={(e) => db.slots.update(slot.id!, { activityText: e.target.value })}
          />
        </div>
      )}

      <SlotPhotoManager slotId={slot.id!} tripId={slot.tripId} />
    </div>
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

function SlotPhotoThumb({ photo }: { photo: Photo }) {
  const url = useObjectUrl(photo.blob);
  return (
    <div className="relative w-14 h-14 rounded-md overflow-hidden bg-surface-variant shrink-0 group">
      {url && <img src={url} alt="방문/식사 사진" className="w-full h-full object-cover" />}
      <button
        onClick={() => db.photos.delete(photo.id!)}
        className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white grid place-items-center active:scale-95 transition"
        title="삭제"
      >
        <Icon name="close" className="text-[10px]" />
      </button>
    </div>
  );
}

function SlotPhotoManager({ slotId, tripId }: { slotId: number; tripId: number }) {
  const photos = useLiveQuery(() => db.photos.where('slotId').equals(slotId).toArray(), [slotId]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      await db.photos.add({
        tripId,
        placeId: null,
        slotId,
        blob: f,
        caption: '',
        ts: Date.now()
      });
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="mt-3 pt-2 border-t border-outline-variant/10">
      <div className="flex items-center gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          className="btn-ghost py-1 px-2.5 rounded text-[11px] font-semibold flex items-center gap-1 border border-dashed border-outline-variant/60 hover:bg-surface-variant/20 transition text-on-surface-variant shrink-0"
        >
          <Icon name="add_a_photo" className="text-[14px]" /> 사진
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
        
        {photos && photos.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            {photos.map((p) => (
              <SlotPhotoThumb key={p.id} photo={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
