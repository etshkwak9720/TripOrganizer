import { Redis } from 'ioredis';
import type { KVClient } from '../../src/share.ts';

// Vercel 마켓플레이스 Redis는 REST 자격증명(KV_REST_API_*) 없이 REDIS_URL만 제공하므로,
// REST 기반인 @vercel/kv 대신 표준 Redis 프로토콜 클라이언트(ioredis)로 붙는다.
// 값 직렬화는 @vercel/kv와 동일하게 JSON으로 처리해 호출부 코드를 그대로 유지한다.
const redis = new Redis(process.env.REDIS_URL!);

export const kvClient: KVClient = {
  get: async (key) => {
    const raw = await redis.get(key);
    return raw === null ? null : JSON.parse(raw);
  },
  set: async (key, value) => {
    await redis.set(key, JSON.stringify(value));
  },
  incr: (key) => redis.incr(key),
  expire: async (key, seconds) => {
    await redis.expire(key, seconds);
  },
};
