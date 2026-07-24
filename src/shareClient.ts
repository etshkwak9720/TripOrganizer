import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Trip } from './db.ts';
import { genShareId, type ShareSnapshot } from './share.ts';

export async function buildShareSnapshot(tripId: number): Promise<ShareSnapshot> {
  const trip = await db.trips.get(tripId);
  if (!trip) throw new Error(`trip ${tripId} not found`);

  const [members, groups, places, slots, missions, missionResults, adjustments, award] =
    await Promise.all([
      db.members.where('tripId').equals(tripId).toArray(),
      db.groups.where('tripId').equals(tripId).toArray(),
      db.places.where('tripId').equals(tripId).toArray(),
      db.slots.where('tripId').equals(tripId).toArray(),
      db.missions.where('tripId').equals(tripId).toArray(),
      db.missionResults.where('tripId').equals(tripId).toArray(),
      db.adjustments.where('tripId').equals(tripId).toArray(),
      db.awards.get(tripId),
    ]);

  return {
    trip: { title: trip.title, startDate: trip.startDate, dayCount: trip.dayCount, mode: trip.mode },
    members: members.map((m) => ({ name: m.name, groupId: m.groupId })),
    groups: groups.map((g) => ({ id: g.id!, name: g.name })),
    places: places.map((p) => ({
      id: p.id!, name: p.name, region: p.region, kind: p.kind,
      address: p.address, lat: p.lat, lng: p.lng, learn: p.learn,
    })),
    slots: slots.map((s) => ({
      dayIndex: s.dayIndex, band: s.band, plannedTime: s.plannedTime,
      order: s.order, placeId: s.placeId, activityText: s.activityText,
    })),
    missions: missions.map((m) => ({
      id: m.id!, placeId: m.placeId, title: m.title, type: m.type, points: m.points, safe: m.safe,
    })),
    missionResults: missionResults.map((r) => ({ missionId: r.missionId, groupId: r.groupId, done: r.done })),
    adjustments: adjustments.map((a) => ({ groupId: a.groupId, delta: a.delta, reason: a.reason, ts: a.ts })),
    awards: award ? { firstGroupReward: award.firstGroupReward, lastGroupPenalty: award.lastGroupPenalty } : null,
  };
}

// 처음 공유하거나, 이미 공유된 여행을 다시 공유(갱신)할 때 호출한다.
// 비밀번호는 호출부(공유 모달)에서 받아 넘긴다. 반환값은 참가자에게 보낼 URL.
export async function publishShare(
  tripId: number,
  password: string,
): Promise<{ url: string; password: string }> {
  const trip = await db.trips.get(tripId);
  if (!trip) throw new Error(`trip ${tripId} not found`);
  if (!password) throw new Error('비밀번호가 필요합니다');

  const shareId = trip.shareId ?? genShareId();
  const schedule = await buildShareSnapshot(tripId);
  const res = await fetch(`/api/share/${shareId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password, schedule }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? '공유에 실패했습니다');
  }

  await db.trips.update(tripId, { shareId, sharePassword: password } satisfies Partial<Trip>);
  return { url: `${window.location.origin}/join/${shareId}`, password };
}

// 공유된 여행을 인솔자가 여는 동안, 관련 데이터 변경을 감지해 3초 디바운스 후 스냅샷을 재발행한다.
// 참가자 화면이 GET으로 최신 스냅샷을 받아가 거의 실시간 반영된다.
export function useAutoRepublish(tripId: number) {
  const trip = useLiveQuery(() => db.trips.get(tripId), [tripId]);
  const sig = useLiveQuery(async () => {
    const [places, slots, groups, missions, results, adjustments, award] = await Promise.all([
      db.places.where('tripId').equals(tripId).count(),
      db.slots.where('tripId').equals(tripId).toArray(),
      db.groups.where('tripId').equals(tripId).count(),
      db.missions.where('tripId').equals(tripId).toArray(),
      db.missionResults.where('tripId').equals(tripId).toArray(),
      db.adjustments.where('tripId').equals(tripId).count(),
      db.awards.get(tripId),
    ]);
    const slotSig = slots.map((s) => `${s.dayIndex}:${s.band}:${s.plannedTime}:${s.placeId}:${s.activityText}`).join('|');
    const misSig = missions.map((m) => `${m.id}:${m.points}:${m.title}`).join('|');
    const resSig = results.map((r) => `${r.missionId}:${r.groupId}:${r.done ? 1 : 0}`).join('|');
    return `${places}|${groups}|${adjustments}|${slotSig}|${misSig}|${resSig}|${award?.firstGroupReward}|${award?.lastGroupPenalty}`;
  }, [tripId]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const firstRef = useRef(true);

  useEffect(() => {
    if (!trip?.shareId || !trip?.sharePassword || sig === undefined) return;
    // 최초 렌더는 건너뛴다(이미 발행된 상태). 이후 변경부터 재발행.
    if (firstRef.current) { firstRef.current = false; return; }
    clearTimeout(timerRef.current);
    const pw = trip.sharePassword;
    timerRef.current = setTimeout(() => { publishShare(tripId, pw).catch(() => {}); }, 3000);
    return () => clearTimeout(timerRef.current);
  }, [sig, trip?.shareId, trip?.sharePassword, tripId]);
}
