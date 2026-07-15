import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type TripMode, type Trip, deleteTrip } from '../db';
import { Icon, Screen, EmptyState } from '../ui';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isTripFinished(startDateStr: string, dayCount: number) {
  const startDate = new Date(startDateStr);
  if (isNaN(startDate.getTime())) return false;
  
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + dayCount);
  
  const now = new Date();
  return now.getTime() >= endDate.getTime();
}

interface TripWithStats extends Trip {
  photoCount: number;
  placeCount: number;
  missionCount: number;
  coverBlob: Blob | null;
}

function TripCover({ blob, title }: { blob: Blob | null; title: string }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  if (url) {
    return <img src={url} alt={title} className="w-full h-full object-cover rounded-md" />;
  }

  return (
    <div className="w-full h-full rounded-md bg-primary-container/20 grid place-items-center">
      <Icon name="map" className="text-primary-container" />
    </div>
  );
}

function TripCard({
  trip,
  isFinished,
  onDelete,
}: {
  trip: TripWithStats;
  isFinished: boolean;
  onDelete: (id: number, title: string) => void;
}) {
  return (
    <li className="card p-4 relative group">
      <div className="flex items-center gap-3">
        <Link to={`/trip/${trip.id}`} className="flex-1 min-w-0 flex items-center gap-3">
          <div className="w-12 h-12 rounded-md overflow-hidden shrink-0">
            <TripCover blob={trip.coverBlob} title={trip.title} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-head font-bold text-on-surface truncate text-[16px]">{trip.title}</p>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ${
                isFinished ? 'bg-surface-variant text-on-surface-variant' : 'bg-emerald/10 text-emerald'
              }`}>
                {isFinished ? '기록' : '진행중'}
              </span>
            </div>
            <p className="text-[12px] text-on-surface-variant mt-0.5">
              {trip.startDate} · {trip.dayCount}일 · {trip.mode === 'game' ? '🎮 게임' : '🌿 휴식'}
            </p>
          </div>
        </Link>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(trip.id!, trip.title);
          }}
          className="w-8 h-8 rounded-full grid place-items-center text-outline hover:text-error hover:bg-error/10 active:scale-95 transition shrink-0"
          aria-label="여행 삭제"
        >
          <Icon name="delete" className="text-[18px]" />
        </button>
      </div>

      <div className="mt-3 pt-3 border-t border-outline-variant/20 flex gap-4 text-[12px] text-on-surface-variant">
        <span className="flex items-center gap-1">
          <Icon name="place" className="text-[14px] text-primary-container" /> 장소 {trip.placeCount}개
        </span>
        <span className="flex items-center gap-1">
          <Icon name="photo_camera" className="text-[14px] text-emerald" /> 사진 {trip.photoCount}장
        </span>
        {trip.mode === 'game' && (
          <span className="flex items-center gap-1">
            <Icon name="emoji_events" className="text-[14px] text-amber-500" /> 미션 {trip.missionCount}개 완료
          </span>
        )}
      </div>

      {isFinished && (
        <div className="mt-3 flex gap-2">
          <Link
            to={`/trip/${trip.id}/gallery`}
            className="flex-1 py-2 px-2 rounded-md bg-emerald/10 hover:bg-emerald/15 text-emerald text-[12px] font-bold text-center flex items-center justify-center gap-1 transition"
          >
            <Icon name="photo_library" className="text-[14px]" /> 추억 갤러리
          </Link>
          <Link
            to={`/trip/${trip.id}`}
            className="flex-1 py-2 px-2 rounded-md bg-primary-container/10 hover:bg-primary-container/15 text-primary-container text-[12px] font-bold text-center flex items-center justify-center gap-1 transition"
          >
            <Icon name="event_note" className="text-[14px]" /> 일정 기록
          </Link>
          {trip.mode === 'game' && (
            <Link
              to={`/trip/${trip.id}/missions`}
              className="flex-1 py-2 px-2 rounded-md bg-amber-500/10 hover:bg-amber-500/15 text-amber-600 text-[12px] font-bold text-center flex items-center justify-center gap-1 transition"
            >
              <Icon name="flag" className="text-[14px]" /> 미션 랭킹
            </Link>
          )}
        </div>
      )}
    </li>
  );
}

export default function Trips() {
  const trips = useLiveQuery(async () => {
    const list = await db.trips.orderBy('createdAt').reverse().toArray();
    const result: TripWithStats[] = [];
    for (const t of list) {
      const photoCount = await db.photos.where('tripId').equals(t.id!).count();
      const placeCount = await db.places.where('tripId').equals(t.id!).count();
      const missionCount = await db.missionResults.where('tripId').equals(t.id!).and((r) => r.done).count();
      
      const firstPhoto = await db.photos.where('tripId').equals(t.id!).first();
      const coverBlob = firstPhoto?.blob || null;

      result.push({
        ...t,
        photoCount,
        placeCount,
        missionCount,
        coverBlob,
      });
    }
    return result;
  }, []);

  const [creating, setCreating] = useState(false);

  async function handleDelete(tripId: number, title: string) {
    if (window.confirm(`'${title}' 여행에 대한 모든 데이터(사진, 일정, 미션 등)가 완전히 삭제되며 복구할 수 없습니다. 정말 삭제하시겠습니까?`)) {
      await deleteTrip(tripId);
    }
  }

  if (trips === undefined) return null;

  const activeTrips = trips.filter((t) => !isTripFinished(t.startDate, t.dayCount));
  const finishedTrips = trips.filter((t) => isTripFinished(t.startDate, t.dayCount));

  return (
    <>
      <header className="px-4 pt-6 pb-2">
        <p className="text-emerald font-head font-bold text-[13px] tracking-wide">YEOJEONG · 여정</p>
        <h1 className="font-head font-extrabold text-[28px] text-on-surface leading-tight">
          함께 떠나는 여행,<br />계획부터 미션까지
        </h1>
      </header>

      <Screen>
        {trips.length === 0 && !creating ? (
          <EmptyState icon="luggage" title="아직 여행이 없어요" hint="새 여행을 만들어 구성원과 일정을 정해보세요" />
        ) : (
          <div className="space-y-6 pb-12">
            {activeTrips.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-[16px] font-bold text-primary-container flex items-center gap-1.5 px-1">
                  <Icon name="flight_takeoff" className="text-[18px]" /> 진행 중 / 예정된 여정
                </h2>
                <ul className="space-y-3">
                  {activeTrips.map((t) => (
                    <TripCard key={t.id} trip={t} isFinished={false} onDelete={handleDelete} />
                  ))}
                </ul>
              </div>
            )}

            {finishedTrips.length > 0 && (
              <div className="space-y-3 pt-2">
                <h2 className="text-[16px] font-bold text-tertiary flex items-center gap-1.5 px-1">
                  <Icon name="auto_stories" className="text-[18px]" /> 지나간 여정 & 추억 기록
                </h2>
                <ul className="space-y-3">
                  {finishedTrips.map((t) => (
                    <TripCard key={t.id} trip={t} isFinished={true} onDelete={handleDelete} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {creating && <CreateForm onClose={() => setCreating(false)} />}
      </Screen>

      {!creating && (
        <button
          onClick={() => setCreating(true)}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 btn-primary shadow-lg flex items-center gap-2 px-5"
        >
          <Icon name="add" /> 새 여행 만들기
        </button>
      )}
    </>
  );
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(todayISO());
  const [dayCount, setDayCount] = useState(2);
  const [mode, setMode] = useState<TripMode>('game');

  async function create() {
    const id = await db.trips.add({
      title: title.trim() || '새 여행',
      startDate,
      dayCount,
      mode,
      createdAt: Date.now(),
    });
    nav(`/trip/${id}/setup`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-[520px] bg-surface rounded-t-2xl p-5 pb-8 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-head font-bold text-[20px]">새 여행 만들기</h2>
          <button onClick={onClose} className="text-outline"><Icon name="close" /></button>
        </div>

        <div>
          <label className="field-label">여행 이름</label>
          <input className="input" placeholder="예: 3반 제주 수학여행" value={title}
            onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="field-label">시작일</label>
            <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="w-24">
            <label className="field-label">일수</label>
            <input type="number" min={1} max={14} className="input" value={dayCount}
              onChange={(e) => setDayCount(Math.max(1, Math.min(14, Number(e.target.value) || 1)))} />
          </div>
        </div>

        <div>
          <label className="field-label">여행 모드</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setMode('game')}
              className={`rounded-md p-3 text-left border-2 ${mode === 'game' ? 'border-primary-container bg-primary-container/10' : 'border-outline-variant/40'}`}
            >
              <p className="font-semibold">🎮 게임 모드</p>
              <p className="text-[12px] text-on-surface-variant mt-0.5">미션·모둠 점수·랭킹</p>
            </button>
            <button
              onClick={() => setMode('relaxed')}
              className={`rounded-md p-3 text-left border-2 ${mode === 'relaxed' ? 'border-primary-container bg-primary-container/10' : 'border-outline-variant/40'}`}
            >
              <p className="font-semibold">🌿 휴식 모드</p>
              <p className="text-[12px] text-on-surface-variant mt-0.5">미션 없이 일정 중심</p>
            </button>
          </div>
        </div>

        <button className="btn-primary w-full" onClick={create}>여행 만들고 구성 시작</button>
      </div>
    </div>
  );
}
