import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, isMealBand, orderSlots, hasContent, type Band, type Place, type Photo } from '../db';
import { estimateTravelMinutes } from '../mock';
import { Icon, TopBar, Screen, EmptyState } from '../ui';
import RenameTripDialog from '../components/RenameTripDialog';

export default function Itinerary() {
  const { id } = useParams();
  const tripId = Number(id);
  const trip = useLiveQuery(() => db.trips.get(tripId), [tripId]);
  const [day, setDay] = useState(0);
  const [renaming, setRenaming] = useState(false);

  const slots = useLiveQuery(
    () => db.slots.where('[tripId+dayIndex]').equals([tripId, day]).toArray(),
    [tripId, day],
  );
  const places = useLiveQuery(() => db.places.where('tripId').equals(tripId).toArray(), [tripId]);

  if (!trip) return <Screen><EmptyState icon="error" title="여행을 찾을 수 없어요" /></Screen>;

  const placeById = (pid?: number | null) => places?.find((p) => p.id === pid);

  // filled slots for this day, in running order (a band may hold several)
  const ordered = orderSlots(slots ?? []).filter(hasContent);

  async function toggleMode() {
    await db.trips.update(tripId, { mode: trip!.mode === 'game' ? 'relaxed' : 'game' });
  }

  return (
    <>
      <TopBar
        title={trip.title}
        backTo="/"
        onEditTitle={() => setRenaming(true)}
        right={
          <button onClick={toggleMode} className="chip bg-surface-variant text-on-surface-variant">
            {trip.mode === 'game' ? '🎮 게임' : '🌿 휴식'}
          </button>
        }
      />

      {renaming && (
        <RenameTripDialog tripId={tripId} current={trip.title} onClose={() => setRenaming(false)} />
      )}

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
        {ordered.length === 0 ? (
          <EmptyState icon="event_note" title="이 날의 일정이 비어 있어요" hint="아래 '계획' 탭에서 일정을 채워보세요" />
        ) : (
          <div className="relative pl-5">
            <div className="absolute left-[9px] top-3 bottom-3 w-0.5 bg-primary-container/30" />
            <div className="space-y-4">
              {ordered.map((slot, i) => {
                const place = placeById(slot.placeId);
                const prev = ordered[i - 1];
                const prevPlace = placeById(prev?.placeId);
                const travel =
                  prevPlace && place ? estimateTravelMinutes(prevPlace, place) : null;
                return (
                  <div key={slot.id}>
                    {travel != null && (
                      <div className="flex items-center gap-1 text-[12px] text-on-surface-variant -mt-2 mb-1 ml-1">
                        <Icon name="directions_car" className="text-[15px]" /> 이동 약 {travel}분
                      </div>
                    )}
                    <TimelineItem band={slot.band} time={slot.plannedTime} place={place}
                      activity={slot.activityText} mode={trip.mode} slotId={slot.id!} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <Link to={`/trip/${tripId}/schedule`} className="btn-primary w-full mt-6 flex items-center justify-center gap-1">
          <Icon name="edit_calendar" /> 일정 편집
        </Link>
      </Screen>
    </>
  );
}

function TimelineItem({
  band, time, place, activity, mode, slotId
}: {
  band: Band; time: string; place?: Place; activity?: string; mode: 'game' | 'relaxed'; slotId: number;
}) {
  const isMeal = isMealBand(band);
  const [showLearn, setShowLearn] = useState(false);
  const photos = useLiveQuery(() => db.photos.where('slotId').equals(slotId).toArray(), [slotId]);

  return (
    <div className="relative">
      <div className="absolute -left-5 top-2 w-4 h-4 rounded-full bg-primary-container ring-4 ring-surface" />
      <div className="card p-3 ml-1">
        <div className="flex items-center gap-2 mb-1">
          <span className={`chip ${isMeal ? 'bg-emerald/10 text-emerald' : 'bg-primary-container/15 text-primary-container'}`}>
            <Icon name={isMeal ? 'restaurant' : 'directions_walk'} className="text-[15px]" /> {band}
          </span>
          <span className="ml-auto text-[13px] font-semibold text-on-surface-variant">{time}</span>
        </div>

        {isMeal ? (
          <div>
            <p className="font-head font-bold">{place ? place.name : (activity || '식사 내용이 없습니다.')}</p>
            {place && activity && <p className="text-[12px] text-on-surface-variant mt-0.5">메뉴: {activity}</p>}
            {place?.region && <p className="text-[12px] text-on-surface-variant">{place.region}</p>}
          </div>
        ) : place ? (
          <div>
            <p className="font-head font-bold">{place.name}</p>
            {place.region && <p className="text-[12px] text-on-surface-variant">{place.region}</p>}
            {activity && <p className="text-[13px] text-on-surface-variant mt-1">{activity}</p>}
            {place.learn && (
              <>
                <button onClick={() => setShowLearn((v) => !v)} className="mt-1 text-[12px] text-emerald font-semibold flex items-center gap-0.5">
                  <Icon name="menu_book" className="text-[15px]" /> 장소 안내 {showLearn ? '접기' : '보기'}
                </button>
                {showLearn && <p className="mt-1 text-[13px] leading-relaxed text-on-surface-variant whitespace-pre-wrap">{place.learn}</p>}
              </>
            )}
          </div>
        ) : (
          <p className="font-medium">{activity || '활동 내용이 없습니다.'}</p>
        )}

        {/* slot photos display */}
        {photos && photos.length > 0 && (
          <div className="mt-3 pt-2 border-t border-outline-variant/10">
            <p className="text-[11px] text-on-surface-variant mb-1 flex items-center gap-1 font-semibold">
              <Icon name="photo_camera" className="text-[13px] text-emerald" /> 방문 사진 / 음식 ({photos.length})
            </p>
            <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
              {photos.map((p) => (
                <TimelinePhotoThumb key={p.id} photo={p} />
              ))}
            </div>
          </div>
        )}

        {mode === 'game' && !isMeal && (place || activity) && (
          <div className="mt-2 pt-2 border-t border-outline-variant/20 flex items-center gap-1 text-[12px] text-primary-container">
            <Icon name="flag" className="text-[15px]" /> 이 장소의 미션 (곧 제공)
          </div>
        )}
      </div>
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

function TimelinePhotoThumb({ photo }: { photo: Photo }) {
  const url = useObjectUrl(photo.blob);
  const [showDetail, setShowDetail] = useState(false);
  return (
    <>
      <button
        onClick={() => setShowDetail(true)}
        className="relative w-20 h-20 rounded-md overflow-hidden bg-surface-variant shrink-0 active:scale-95 transition"
      >
        {url && <img src={url} alt="방문 사진" className="w-full h-full object-cover" />}
        {photo.caption && (
          <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 truncate text-white text-[9px]">
            {photo.caption}
          </div>
        )}
      </button>
      {showDetail && (
        <PhotoDetail
          photo={photo}
          place={photo.caption || '일정 사진'}
          onClose={() => setShowDetail(false)}
          onDelete={async () => {
            if (window.confirm('이 사진을 일정에서 삭제하시겠습니까?')) {
              await db.photos.delete(photo.id!);
              setShowDetail(false);
            }
          }}
        />
      )}
    </>
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
        <span className="flex items-center gap-1 text-[14px] font-semibold"><Icon name="photo" className="text-[16px]" /> {place}</span>
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
          onChange={(e) => {
            setCaption(e.target.value);
            db.photos.update(photo.id!, { caption: e.target.value });
          }}
        />
      </div>
    </div>
  );
}
