import { BANDS, type Band } from './db';

// A day's ordered stops. `fromPrevDay` marks the previous night's lodging,
// which opens every day after the first: you wake up there, so the day's route
// and ETA start from it rather than from wherever the phone happens to be.
export interface DayStop<P> {
  place: P;
  time: string;
  band: Band;
  fromPrevDay?: boolean;
}

interface SlotLike {
  dayIndex: number;
  band: Band;
  order?: number;
  plannedTime: string;
  placeId?: number | null;
}

interface PlaceLike {
  lat?: number;
  lng?: number;
}

function daySlots<S extends SlotLike>(slots: S[], day: number): S[] {
  return slots
    .filter((s) => s.dayIndex === day)
    .sort((a, b) => BANDS.indexOf(a.band) - BANDS.indexOf(b.band) || (a.order ?? 0) - (b.order ?? 0));
}

// 전날 숙소: 엑셀 템플릿이 '숙소'를 저녁 밴드에 넣으므로 저녁 슬롯을 먼저 찾고,
// 저녁 슬롯이 없는 날은 그날 마지막 좌표 장소로 폴백한다.
function lodgingOf<P extends PlaceLike>(prevDay: DayStop<P>[]): DayStop<P> | undefined {
  const located = prevDay.filter((s) => s.place.lat != null && s.place.lng != null);
  if (located.length === 0) return undefined;
  const evening = [...located].reverse().find((s) => s.band === '저녁');
  return evening ?? located[located.length - 1];
}

export function buildDayStops<P extends PlaceLike, S extends SlotLike>(
  slots: S[],
  placesById: Map<number, P>,
  day: number,
): DayStop<P>[] {
  const toStops = (d: number): DayStop<P>[] =>
    daySlots(slots, d).flatMap((s) => {
      const place = s.placeId == null ? undefined : placesById.get(s.placeId);
      return place ? [{ place, time: s.plannedTime, band: s.band }] : [];
    });

  const stops = toStops(day);
  if (day === 0) return stops; // 1일차는 현위치에서 출발한다

  const lodging = lodgingOf(toStops(day - 1));
  // A day that already opens at the lodging (breakfast there, say) needs no
  // prepended copy of it.
  if (!lodging || stops[0]?.place === lodging.place) return stops;
  return [{ ...lodging, fromPrevDay: true }, ...stops];
}
