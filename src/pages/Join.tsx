import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BANDS, isMealBand, type Band } from '../db';
import { Icon, Screen, TopBar } from '../ui';
import type { ShareSnapshot } from '../share';
import GalleryTab from './join/GalleryTab';
import MissionTab from './join/MissionTab';
import NowTab from './join/NowTab';

export function storageKey(shareId: string) {
  return `share-password:${shareId}`;
}

// 사진 소유자 식별용 기기 토큰(계정 없이 '내 사진'을 구분).
export function ownerToken(): string {
  let t = localStorage.getItem('photo-owner');
  if (!t) { t = crypto.randomUUID(); localStorage.setItem('photo-owner', t); }
  return t;
}

const TABS = [
  { key: 'now', label: '지금', icon: 'near_me' },
  { key: 'plan', label: '일정', icon: 'event_note' },
  { key: 'mission', label: '미션', icon: 'flag', gameOnly: true },
  { key: 'gallery', label: '갤러리', icon: 'photo_library' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default function Join() {
  const { shareId } = useParams<{ shareId: string }>();
  const [password, setPassword] = useState('');
  const [schedule, setSchedule] = useState<ShareSnapshot | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<TabKey>('plan');

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
      return;
    }
    const body = await res.json();
    setSchedule(body.schedule);
    localStorage.setItem(storageKey(shareId!), pw);
  }

  async function refresh() {
    const pw = localStorage.getItem(storageKey(shareId!));
    if (!pw) return;
    const res = await fetch(`/api/share/${shareId}`, { headers: { 'x-trip-password': pw } });
    if (res.ok) setSchedule((await res.json()).schedule);
  }

  useEffect(() => {
    const saved = localStorage.getItem(storageKey(shareId!));
    if (saved) verify(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareId]);

  // 거의 실시간: 20초마다 + 창 포커스 시 최신 스냅샷 재조회.
  useEffect(() => {
    if (!schedule) return;
    const iv = setInterval(refresh, 20000);
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule === null, shareId]);

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
          <button className="btn-primary w-full" onClick={() => verify(password)}>입장</button>
          {error && <p className="text-[13px] text-red-600">{error}</p>}
        </div>
      </Screen>
    );
  }

  const tabs = TABS.filter((t) => !('gameOnly' in t && t.gameOnly) || schedule.trip.mode === 'game');

  return (
    <>
      <TopBar title={schedule.trip.title} />
      <main className="pb-20">
        {tab === 'plan' && <PlanTab schedule={schedule} />}
        {tab === 'gallery' && <GalleryTab shareId={shareId!} places={schedule.places} />}
        {tab === 'mission' && <MissionTab schedule={schedule} />}
        {tab === 'now' && <NowTab schedule={schedule} />}
      </main>

      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[520px] bg-surface border-t border-outline-variant/30 z-40"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex justify-around items-center h-16">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex flex-col items-center justify-center gap-0.5 w-full h-full ${tab === t.key ? 'text-primary-container' : 'text-tertiary'}`}>
              <Icon name={t.icon} fill={tab === t.key} />
              <span className="text-[11px] font-medium">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}

function PlanTab({ schedule }: { schedule: ShareSnapshot }) {
  const [day, setDay] = useState(0);
  const daySlots = schedule.slots.filter((s) => s.dayIndex === day);
  return (
    <>
      <div className="flex gap-2 px-4 pt-3 overflow-x-auto no-scrollbar">
        {Array.from({ length: schedule.trip.dayCount }).map((_, i) => (
          <button key={i} onClick={() => setDay(i)}
            className={`shrink-0 px-4 py-2 rounded-full text-[14px] font-semibold ${day === i ? 'bg-primary-container text-on-primary-container' : 'bg-surface-variant text-on-surface-variant'}`}>
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
                <span className={`chip ${isMealBand(band) ? 'bg-emerald/10 text-emerald' : 'bg-primary-container/15 text-primary-container'}`}>{band}</span>
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
      </Screen>
    </>
  );
}

