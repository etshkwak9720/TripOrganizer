import type { MissionType } from './db';

// A mission template that can be recommended for a place and turned into a
// real Mission row. `tags` decide which places it is suggested for; 'any'
// templates are suggested everywhere.
export interface MissionTemplate {
  title: string;
  type: MissionType;
  points: number;
  safe: boolean;
  tags: string[];
  note?: string;
}

// keyword -> place tag inference (from free-text place names)
const TAG_KEYWORDS: Record<string, string[]> = {
  sea: ['바다', '해변', '해수욕', '해안', '포구', '항', '등대', '우도', '협재', '함덕', '월정', '이호', '비치'],
  hill: ['오름', '봉', '악', '한라', '전망', '언덕', '정상'],
  cave: ['굴', '동굴', '만장'],
  market: ['시장', '올레시장', '동문', '오일장'],
  waterfall: ['폭포', '천지연', '정방', '천제연'],
  forest: ['숲', '곶자왈', '수목원', '휴양림', '사려니'],
  food: ['카페', '맛집', '식당', '거리', '골목'],
  activity: ['카트', '레이싱', '짚라인', '승마', '루지', '서핑', '카약'],
};

export function inferTags(placeName: string): string[] {
  const tags: string[] = [];
  for (const [tag, kws] of Object.entries(TAG_KEYWORDS)) {
    if (kws.some((k) => placeName.includes(k))) tags.push(tag);
  }
  return tags;
}

// Mission library — mix of 1박2일 / 패밀리가 떴다 style challenges plus
// safe non-competitive variants (e.g. lap-time "match the seconds").
const LIBRARY: MissionTemplate[] = [
  // sea
  { title: '바다 배경으로 모둠 단체사진 찍기', type: 'photo', points: 20, safe: true, tags: ['sea'] },
  { title: '가장 멋진 파도 순간 인증샷', type: 'photo', points: 10, safe: true, tags: ['sea'] },
  { title: '모둠원 전원 점프샷 (파도 앞에서)', type: 'photo', points: 25, safe: true, tags: ['sea'] },
  // hill / oreum
  { title: '정상에서 하늘 향해 점프샷', type: 'photo', points: 20, safe: true, tags: ['hill'] },
  { title: '정상까지 모둠 전원 도착 인증', type: 'gather', points: 25, safe: true, tags: ['hill'] },
  // cave
  { title: '동굴 안 실루엣 사진', type: 'photo', points: 15, safe: true, tags: ['cave'] },
  // market / food
  { title: '5,000원으로 모둠 최고의 간식 찾기', type: 'photo', points: 25, safe: true, tags: ['market', 'food'] },
  { title: '지역 상인분과 대화하고 추천 메뉴 인증', type: 'photo', points: 30, safe: true, tags: ['market', 'food'] },
  // waterfall / forest
  { title: '폭포/숲 배경 슬로우 영상 5초', type: 'photo', points: 15, safe: true, tags: ['waterfall', 'forest'] },
  // activity (safe non-competitive)
  { title: "카트 랩타임 '끝나는 초' 맞히기", type: 'timing', points: 30, safe: true, tags: ['activity'], note: '속도 경쟁 대신 예측: 랩타임의 초 단위를 맞히면 성공 (안전형)' },
  // any-place classics
  { title: '지정 장소에 3분 안에 모둠 전원 집합', type: 'gather', points: 20, safe: true, tags: ['any'], note: '1박2일式 집합 미션' },
  { title: '동네 반려견과 함께 사진 (주인 허락 후)', type: 'photo', points: 20, safe: true, tags: ['any'] },
  { title: '지역 주민과 대화 인증샷', type: 'photo', points: 30, safe: true, tags: ['any'], note: '패밀리가 떴다式 미션' },
  { title: '다음 장소 도착 정각 맞히기', type: 'timing', points: 15, safe: true, tags: ['any'] },
  { title: '이 장소 유래/의미 퀴즈 맞히기', type: 'quiz', points: 15, safe: true, tags: ['any'], note: '장소 안내(학습 콘텐츠) 연계' },
];

// Recommend templates for a place: tag matches first, then a few 'any'.
export function recommendMissions(placeName: string): MissionTemplate[] {
  const tags = inferTags(placeName);
  const matched = LIBRARY.filter((t) => t.tags.some((tag) => tags.includes(tag)));
  const anyOnes = LIBRARY.filter((t) => t.tags.includes('any'));
  return [...matched, ...anyOnes];
}

// Generic missions not tied to a place.
export function commonMissions(): MissionTemplate[] {
  return LIBRARY.filter((t) => t.tags.includes('any'));
}
