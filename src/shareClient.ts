import { db, type Trip } from './db.ts';
import { genShareId, type ShareSnapshot } from './share.ts';

export async function buildShareSnapshot(tripId: number): Promise<ShareSnapshot> {
  const trip = await db.trips.get(tripId);
  if (!trip) throw new Error(`trip ${tripId} not found`);

  const [members, groups, places, slots] = await Promise.all([
    db.members.where('tripId').equals(tripId).toArray(),
    db.groups.where('tripId').equals(tripId).toArray(),
    db.places.where('tripId').equals(tripId).toArray(),
    db.slots.where('tripId').equals(tripId).toArray(),
  ]);

  return {
    trip: { title: trip.title, startDate: trip.startDate, dayCount: trip.dayCount, mode: trip.mode },
    members: members.map((m) => ({ name: m.name, groupId: m.groupId })),
    groups: groups.map((g) => ({ name: g.name, score: g.score })),
    places: places.map((p) => ({
      id: p.id!, name: p.name, region: p.region, kind: p.kind, address: p.address, lat: p.lat, lng: p.lng,
    })),
    slots: slots.map((s) => ({
      dayIndex: s.dayIndex, band: s.band, plannedTime: s.plannedTime,
      order: s.order, placeId: s.placeId, activityText: s.activityText,
    })),
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
