// 여행 1건을 파일 한 개로 내보내고 되살린다.
//
// 왜 필요한가: 모든 여행 데이터가 브라우저 IndexedDB 에만 있다. 브라우저 저장소를
// 지우거나 기기를 잃으면 사진·미션 점수·일정이 복구 수단 없이 사라진다. 되돌릴 수
// 없는 유일한 리스크라 백업 경로가 하나는 있어야 한다.
//
// 두 가지 용도를 한 형식으로 쓴다.
//   1) 인솔자 백업     — 사진까지 포함한 완전본
//   2) 참가자에게 전달  — 일정만. 사진을 빼면 파일이 작아져 메신저로 보낼 수 있다
// 그래서 사진 포함 여부가 옵션이다. 사진 없이 내보낸 파일도 그대로 복원된다.

import type {
  Adjustment, Award, Group, Member, Mission, MissionResult, Place, Slot, Trip,
} from './db';

export const TRIP_FILE_FORMAT = 'triporganizer-trip';
export const TRIP_FILE_VERSION = 1;

/** 내보낼 때 사진 한 장. Blob 은 JSON 에 못 담으므로 base64 로 바꾼다. */
export interface ExportedPhoto {
  id: number;
  placeId: number | null;
  slotId?: number | null;
  caption: string;
  ts: number;
  mime: string;
  data: string;   // base64 (data: 접두사 없음)
}

export interface TripFile {
  format: typeof TRIP_FILE_FORMAT;
  version: number;
  exportedAt: number;
  photosIncluded: boolean;
  trip: Omit<Trip, 'id'>;
  groups: Group[];
  members: Member[];
  places: Place[];
  slots: Slot[];
  missions: Mission[];
  missionResults: MissionResult[];
  adjustments: Adjustment[];
  award: Award | null;
  photos: ExportedPhoto[];
}

/** 한 여행에서 읽어온 원본 행들. DB 접근과 순수 변환을 분리하기 위한 입력 형태. */
export interface TripRows {
  trip: Trip;
  groups: Group[];
  members: Member[];
  places: Place[];
  slots: Slot[];
  missions: Mission[];
  missionResults: MissionResult[];
  adjustments: Adjustment[];
  award: Award | null;
  photos: ExportedPhoto[];
}

/**
 * 내보내기 파일을 만든다.
 *
 * 공유 관련 필드는 일부러 뺀다. `sharePassword` 는 인솔자 기기에만 있어야 하는
 * 평문 비밀번호인데, 이 파일은 참가자에게 메신저로 건네질 수 있다. `shareId` 도
 * 빼야 한다 — 복원한 여행이 원본과 같은 공유 주소를 주장하면 서로 덮어쓴다.
 * 인솔자 실시간 위치(admin*)는 지금 이 순간의 값이라 백업할 의미가 없다.
 */
export function buildTripFile(rows: TripRows, opts: { includePhotos: boolean }): TripFile {
  const {
    id: _id, shareId: _shareId, sharePassword: _pw,
    adminLat: _a, adminLng: _b, adminTargetIdx: _c, adminDayIndex: _d,
    ...trip
  } = rows.trip;

  return {
    format: TRIP_FILE_FORMAT,
    version: TRIP_FILE_VERSION,
    exportedAt: Date.now(),
    photosIncluded: opts.includePhotos,
    trip,
    groups: rows.groups,
    members: rows.members,
    places: rows.places,
    slots: rows.slots,
    missions: rows.missions,
    missionResults: rows.missionResults,
    adjustments: rows.adjustments,
    award: rows.award,
    photos: opts.includePhotos ? rows.photos : [],
  };
}

export function isTripFile(v: unknown): v is TripFile {
  if (!v || typeof v !== 'object') return false;
  const f = v as TripFile;
  return (
    f.format === TRIP_FILE_FORMAT &&
    typeof f.version === 'number' &&
    !!f.trip && typeof f.trip.title === 'string' &&
    Array.isArray(f.groups) && Array.isArray(f.places) && Array.isArray(f.slots)
  );
}

/** 되살릴 때 새로 받은 id 로 갈아끼운 행들. */
export interface RemappedRows {
  trip: Omit<Trip, 'id'>;
  groups: Omit<Group, 'id'>[];
  members: Omit<Member, 'id'>[];
  places: Omit<Place, 'id'>[];
  slots: Omit<Slot, 'id'>[];
  missions: Omit<Mission, 'id'>[];
  missionResults: Omit<MissionResult, 'id'>[];
  adjustments: Omit<Adjustment, 'id'>[];
  award: Award | null;
  photos: (Omit<ExportedPhoto, 'id'> & { placeId: number | null; slotId: number | null })[];
}

/** 옛 id → 새 id. 없으면 null (참조가 끊긴 것은 살리지 않는다). */
export type IdMap = Map<number, number>;

const look = (m: IdMap, old: number | null | undefined): number | null =>
  old == null ? null : (m.get(old) ?? null);

/**
 * 파일의 옛 id 들을 새로 발급받은 id 로 갈아끼운다.
 *
 * Dexie 의 `++id` 는 자동증가라 되살릴 때 번호가 달라진다. 그런데 slot 은 place 를,
 * missionResult 는 mission 과 group 을 번호로 가리킨다. 번호만 새로 받고 참조를
 * 그대로 두면 엉뚱한 장소를 가리키거나 조용히 끊긴다. 같은 여행을 두 번 되살렸을 때
 * 두 번째 것이 첫 번째 장소를 가리키는 사고가 여기서 난다.
 */
export function remapIds(
  file: TripFile,
  newTripId: number,
  ids: { groups: number[]; places: number[]; slots: number[]; missions: number[] },
): RemappedRows {
  const map = (olds: { id?: number }[], news: number[]): IdMap => {
    const m: IdMap = new Map();
    olds.forEach((row, i) => { if (row.id != null && news[i] != null) m.set(row.id, news[i]); });
    return m;
  };
  const gm = map(file.groups, ids.groups);
  const pm = map(file.places, ids.places);
  const sm = map(file.slots, ids.slots);
  const mm = map(file.missions, ids.missions);

  const strip = <T extends { id?: number }>(r: T) => { const { id: _i, ...rest } = r; return rest; };

  return {
    trip: { ...file.trip },
    groups: file.groups.map((g) => ({ ...strip(g), tripId: newTripId })),
    places: file.places.map((p) => ({ ...strip(p), tripId: newTripId })),
    slots: file.slots.map((s) => ({ ...strip(s), tripId: newTripId, placeId: look(pm, s.placeId) })),
    missions: file.missions.map((m) => ({ ...strip(m), tripId: newTripId, placeId: look(pm, m.placeId) })),
    members: file.members.map((m) => ({ ...strip(m), tripId: newTripId, groupId: look(gm, m.groupId) })),
    // 가리키던 미션이나 모둠이 파일에 없으면 이 기록은 버린다. 남겨두면 순위가 틀어진다.
    missionResults: file.missionResults
      .map((r) => ({ ...strip(r), tripId: newTripId, missionId: look(mm, r.missionId), groupId: look(gm, r.groupId) }))
      .filter((r): r is Omit<MissionResult, 'id'> => r.missionId != null && r.groupId != null),
    adjustments: file.adjustments
      .map((a) => ({ ...strip(a), tripId: newTripId, groupId: look(gm, a.groupId) }))
      .filter((a): a is Omit<Adjustment, 'id'> => a.groupId != null),
    award: file.award ? { ...file.award, tripId: newTripId } : null,
    photos: file.photos.map((p) => ({
      ...strip(p), tripId: newTripId,
      placeId: look(pm, p.placeId),
      slotId: look(sm, p.slotId),
    })) as RemappedRows['photos'],
  };
}

/** 파일 이름. 같은 날 여러 번 내보내도 덮어쓰지 않게 시각까지 넣는다. */
export function tripFileName(title: string, at = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}`;
  const safe = title.replace(/[\/:*?"<>|]/g, '').trim() || '여행';
  return `${safe}-${stamp}.trip.json`;
}
