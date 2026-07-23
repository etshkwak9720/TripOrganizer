import { kv } from '@vercel/kv';
import type { KVClient } from '../../src/share.ts';

export const kvClient: KVClient = {
  get: (key) => kv.get(key),
  set: async (key, value) => {
    await kv.set(key, value);
  },
  incr: (key) => kv.incr(key),
  expire: async (key, seconds) => {
    await kv.expire(key, seconds);
  },
};
