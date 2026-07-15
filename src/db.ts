import Dexie, { type Table } from 'dexie';

// --- domain types ---
export type TripMode = 'game' | 'relaxed';
export type Band = '조식' | '오전' | '중식' | '오후' | '석식' | '저녁';
export const BANDS: Band[] = ['조식', '오전', '중식', '오후', '석식', '저녁'];
export const MEAL_BANDS: Band[] = ['조식', '중식', '석식'];
export const isMealBand = (b: Band) => MEAL_BANDS.includes(b);

// default planned time per band (HH:MM), used as a starting suggestion
export const BAND_DEFAULT_TIME: Record<Band, string> = {
  조식: '08:00', 오전: '10:00', 중식: '12:30',
  오후: '14:30', 석식: '18:00', 저녁: '20:00',
};

export interface Trip {
  id?: number;
  title: string;
  startDate: string;   // YYYY-MM-DD
  dayCount: number;
  mode: TripMode;
  createdAt: number;
}

export interface Member {
  id?: number;
  tripId: number;
  name: string;
  groupId?: number | null;
}

export interface Group {
  id?: number;
  tripId: number;
  name: string;
  score: number;
}

export type PlaceKind = 'sight' | 'food';

export interface Place {
  id?: number;
  tripId: number;
  name: string;
  region: string;
  kind: PlaceKind;     // NEW: 방문지/식당 구분
  address?: string;    // NEW: 검색 결과 표시 주소
  lat?: number;
  lng?: number;
  learn?: string;      // 의미/유래/문화유산/학습 콘텐츠
}

// One entry in a day's band. Activity bands (오전/오후/저녁) may hold several
// entries; meal bands hold one.
export interface Slot {
  id?: number;
  tripId: number;
  dayIndex: number;    // 0-based day
  band: Band;
  plannedTime: string; // HH:MM
  order?: number;      // position within the band (activity bands)
  placeId?: number | null;    // for activity bands
  activityText?: string;      // free-text activity/region
}

// Slots of a day in running order: band order first, then position in band.
export function orderSlots(slots: Slot[]): Slot[] {
  return [...slots].sort(
    (a, b) =>
      BANDS.indexOf(a.band) - BANDS.indexOf(b.band) ||
      (a.order ?? 0) - (b.order ?? 0) ||
      (a.id ?? 0) - (b.id ?? 0),
  );
}

export const hasContent = (s: Slot) => !!s.placeId || !!s.activityText?.trim();

export interface Award {
  tripId: number;             // primary key
  firstGroupReward: string;
  lastGroupPenalty: string;
}

export type MissionType = 'photo' | 'gather' | 'timing' | 'quiz';
export const MISSION_TYPE_META: Record<MissionType, { label: string; icon: string }> = {
  photo: { label: '사진', icon: 'photo_camera' },
  gather: { label: '집합', icon: 'groups_2' },
  timing: { label: '타이밍', icon: 'timer' },
  quiz: { label: '퀴즈', icon: 'quiz' },
};

export interface Mission {
  id?: number;
  tripId: number;
  placeId?: number | null;    // null = 공통 미션
  title: string;
  type: MissionType;
  points: number;
  safe: boolean;              // 비경쟁/안전형
}

export interface MissionResult {
  id?: number;
  tripId: number;
  missionId: number;
  groupId: number;
  done: boolean;
  ts: number;
}

// 관리자 수동 가·감점
export interface Adjustment {
  id?: number;
  tripId: number;
  groupId: number;
  delta: number;
  reason: string;
  ts: number;
}

// 장소별 사진 + 한줄 감상평 (로컬 Blob)
export interface Photo {
  id?: number;
  tripId: number;
  placeId: number | null;   // null = 장소 미지정
  slotId?: number | null;   // null = 슬롯 미지정 (일정 연동 사진용)
  blob: Blob;
  caption: string;
  ts: number;
}

class YeojeongDB extends Dexie {
  trips!: Table<Trip, number>;
  members!: Table<Member, number>;
  groups!: Table<Group, number>;
  places!: Table<Place, number>;
  slots!: Table<Slot, number>;
  awards!: Table<Award, number>;
  missions!: Table<Mission, number>;
  missionResults!: Table<MissionResult, number>;
  adjustments!: Table<Adjustment, number>;
  photos!: Table<Photo, number>;

  constructor() {
    super('yeojeong');
    this.version(1).stores({
      trips: '++id, createdAt',
      members: '++id, tripId, groupId',
      groups: '++id, tripId',
      places: '++id, tripId',
      slots: '++id, tripId, [tripId+dayIndex]',
      meals: '++id, region',
      awards: 'tripId',
    });
    this.version(2).stores({
      missions: '++id, tripId, placeId',
      missionResults: '++id, tripId, missionId, groupId, [missionId+groupId]',
      adjustments: '++id, tripId, groupId',
    });
    this.version(3).stores({
      photos: '++id, tripId, placeId',
    });
    this.version(4).stores({
      photos: '++id, tripId, placeId, slotId',
    });
    this.version(5).stores({
      meals: null, // drop mock recommendation table
    }).upgrade(async (tx) => {
      await tx.table('places').toCollection().modify((p) => { if (!p.kind) p.kind = 'sight'; });
      // mealId: 추천 선택 시 이름이 activityText로 복사돼 있으므로 필드만 버린다
      await tx.table('slots').toCollection().modify((s) => { delete s.mealId; });
    });
  }
}

export const db = new YeojeongDB();

export async function deleteTrip(tripId: number) {
  await db.transaction('rw', [
    db.trips,
    db.members,
    db.groups,
    db.places,
    db.slots,
    db.awards,
    db.missions,
    db.missionResults,
    db.adjustments,
    db.photos,
  ], async () => {
    await db.trips.delete(tripId);
    await db.members.where('tripId').equals(tripId).delete();
    await db.groups.where('tripId').equals(tripId).delete();
    await db.places.where('tripId').equals(tripId).delete();
    await db.slots.where('tripId').equals(tripId).delete();
    await db.awards.where('tripId').equals(tripId).delete();
    await db.missions.where('tripId').equals(tripId).delete();
    await db.missionResults.where('tripId').equals(tripId).delete();
    await db.adjustments.where('tripId').equals(tripId).delete();
    await db.photos.where('tripId').equals(tripId).delete();
  });
}

