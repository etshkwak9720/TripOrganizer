import { db, type Meal } from './db';

// Mock restaurant recommendations — stands in for Naver Local/review data
// until real API keys are wired up. Fields mirror what the UI will show:
// price level, review count, rating.
const MOCK_MEALS: Omit<Meal, 'id'>[] = [
  { name: '성산 해녀의 집', region: '성산', priceLevel: 2, reviewCount: 4821, rating: 4.6, category: '해산물' },
  { name: '올레국수', region: '제주시', priceLevel: 1, reviewCount: 9210, rating: 4.4, category: '고기국수' },
  { name: '흑돼지 명가', region: '제주시', priceLevel: 3, reviewCount: 6540, rating: 4.7, category: '흑돼지' },
  { name: '동문시장 분식', region: '제주시', priceLevel: 1, reviewCount: 2110, rating: 4.2, category: '분식' },
  { name: '함덕 오션뷰 브런치', region: '함덕', priceLevel: 3, reviewCount: 3380, rating: 4.5, category: '브런치' },
  { name: '표선 갈치조림', region: '표선', priceLevel: 2, reviewCount: 1870, rating: 4.3, category: '한식' },
  { name: '중문 전복돌솥밥', region: '중문', priceLevel: 3, reviewCount: 5120, rating: 4.6, category: '한식' },
  { name: '애월 카페 몽상', region: '애월', priceLevel: 2, reviewCount: 7740, rating: 4.5, category: '카페' },
  { name: '서귀포 물회 1번지', region: '서귀포', priceLevel: 2, reviewCount: 4030, rating: 4.4, category: '물회' },
  { name: '한림 칼국수', region: '한림', priceLevel: 1, reviewCount: 1560, rating: 4.1, category: '칼국수' },
  { name: '우도 땅콩아이스크림', region: '우도', priceLevel: 1, reviewCount: 8890, rating: 4.3, category: '디저트' },
  { name: '제주 흑우 스테이크', region: '제주시', priceLevel: 4, reviewCount: 2240, rating: 4.8, category: '스테이크' },
];

export async function seedMealsIfEmpty() {
  const count = await db.meals.count();
  if (count === 0) await db.meals.bulkAdd(MOCK_MEALS as Meal[]);
}

export const PRICE_LABEL = ['', '₩', '₩₩', '₩₩₩', '₩₩₩₩'];

// Mock travel-time estimate between two places. Uses haversine if both have
// coords, otherwise a stable pseudo-estimate from names. Replace with a real
// directions API (Naver/Kakao) once keys are available.
export function estimateTravelMinutes(
  a: { lat?: number; lng?: number; name: string },
  b: { lat?: number; lng?: number; name: string },
): number {
  if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    const km = R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
    return Math.max(5, Math.round((km / 40) * 60)); // ~40km/h avg
  }
  // deterministic fallback from name hash -> 10..55 min
  let h = 0;
  const key = a.name + '→' + b.name;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return 10 + (h % 46);
}

const JEJU_COORDS: Record<string, { lat: number; lng: number }> = {
  '공항': { lat: 33.5104, lng: 126.4914 },
  '제주공항': { lat: 33.5104, lng: 126.4914 },
  '성산': { lat: 33.4581, lng: 126.9426 },
  '성산일출봉': { lat: 33.4581, lng: 126.9426 },
  '섭지코지': { lat: 33.4243, lng: 126.9311 },
  '함덕': { lat: 33.5434, lng: 126.6693 },
  '함덕해수욕장': { lat: 33.5434, lng: 126.6693 },
  '협재': { lat: 33.3938, lng: 126.2396 },
  '협재해수욕장': { lat: 33.3938, lng: 126.2396 },
  '중문': { lat: 33.2443, lng: 126.4124 },
  '애월': { lat: 33.4602, lng: 126.3195 },
  '한라산': { lat: 33.3617, lng: 126.5292 },
  '우도': { lat: 33.5043, lng: 126.9547 },
  '천지연': { lat: 33.2448, lng: 126.5544 },
  '정방폭포': { lat: 33.2449, lng: 126.5718 },
  '녹차밭': { lat: 33.3061, lng: 126.3152 },
  '오설록': { lat: 33.3061, lng: 126.3152 },
};

export function getJejuCoords(name: string) {
  for (const [key, value] of Object.entries(JEJU_COORDS)) {
    if (name.includes(key)) return value;
  }
  const offsetLat = (Math.random() - 0.5) * 0.15;
  const offsetLng = (Math.random() - 0.5) * 0.3;
  return {
    lat: 33.36 + offsetLat,
    lng: 126.53 + offsetLng,
  };
}
