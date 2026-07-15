import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type TripMode, type Trip, deleteTrip } from '../db';
import { Icon, Screen, EmptyState } from '../ui';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Sunset over water, after the user's own photo: amber sky, layered ridges,
// and the sun's reflection running down still water. Inline SVG rather than a
// photo so it stays offline-safe and adds no payload.
function HeaderBackdrop() {
  return (
    <div aria-hidden className="absolute inset-0 -z-10">
      <svg viewBox="0 0 375 210" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 w-full h-full">
        <defs>
          <linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e8801f" />
            <stop offset="0.4" stopColor="#ffa445" />
            <stop offset="0.75" stopColor="#ffc175" />
            <stop offset="1" stopColor="#ffd89c" />
          </linearGradient>
          <linearGradient id="river" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f5a24a" />
            <stop offset="0.4" stopColor="#eeae6f" />
            <stop offset="1" stopColor="#dcb894" />
          </linearGradient>
          <radialGradient id="dusksun">
            <stop offset="0" stopColor="#fff4cf" stopOpacity="0.95" />
            <stop offset="1" stopColor="#ffc266" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="375" height="210" fill="url(#dusk)" />
        {/* the sun sitting in the notch between ridges */}
        <ellipse cx="196" cy="96" rx="86" ry="46" fill="url(#dusksun)" />

        {/* wispy cloud streaks */}
        <g fill="none" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="2" strokeLinecap="round">
          <path d="M18 26 q 42 -8 84 2" />
          <path d="M6 44 q 30 -6 60 1" />
          <path d="M244 34 q 40 -7 80 3" />
        </g>

        {/* far peaks, hazed by distance */}
        <path d="M96 104 C 122 96, 138 84, 158 90 C 176 96, 188 82, 208 88 C 232 95, 252 86, 280 104 Z"
          fill="#9a8fa6" fillOpacity="0.5" />
        {/* the ridges either side, dropping to the notch the sun sits in */}
        <path d="M0 74 C 30 72, 56 86, 78 96 C 92 102, 100 105, 112 107 L 112 114 L 0 114 Z" fill="#6b6376" fillOpacity="0.92" />
        <path d="M375 70 C 344 68, 314 84, 290 95 C 276 101, 268 105, 258 107 L 258 114 L 375 114 Z" fill="#6b6376" fillOpacity="0.92" />
        {/* treeline along the far bank */}
        <path d="M0 108 q 26 -5 52 1 q 30 5 60 -2 q 32 -6 62 2 q 34 5 68 -3 q 36 -5 133 3 L375 116 L0 116 Z"
          fill="#443e50" fillOpacity="0.88" />

        {/* the water, and the sun's column running toward the viewer */}
        <rect y="114" width="375" height="96" fill="url(#river)" />
        <path d="M172 114 L220 114 L250 210 L142 210 Z" fill="#fff0c2" fillOpacity="0.4" />
        <g fill="none" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="1.5" strokeLinecap="round">
          <path d="M8 124 q 40 -3 80 0 t 80 0 t 80 0 t 80 0" />
          <path d="M0 140 q 46 -4 92 0 t 92 0 t 92 0" />
          <path d="M14 158 q 52 -4 104 0 t 104 0 t 104 0" />
          <path d="M0 180 q 58 -5 116 0 t 116 0 t 116 0" />
        </g>
        <g fill="none" stroke="#a06a3a" strokeOpacity="0.18" strokeWidth="1.5" strokeLinecap="round">
          <path d="M0 132 q 44 -3 88 0 t 88 0 t 88 0" />
          <path d="M20 168 q 50 -4 100 0 t 100 0" />
        </g>

      </svg>
      {/* the heading sits on the brightest part of the sky; this keeps it legible */}
      <div className="absolute inset-0 bg-gradient-to-br from-black/25 via-black/5 to-transparent" />
    </div>
  );
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
      <header className="relative isolate overflow-hidden px-4 pt-6 pb-24 mb-1">
        <HeaderBackdrop />
        <p className="text-white/80 font-head font-bold text-[13px] tracking-wide drop-shadow-sm">TripOrganizer</p>
        <h1 className="font-head font-extrabold text-[28px] text-white leading-tight [text-shadow:0_1px_10px_rgb(0_0_0_/_35%)]">
          같이 걷는 여정,<br />지도 위에 담다
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
