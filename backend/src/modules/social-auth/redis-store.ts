import type Redis from 'ioredis';
import type { EphemeralStore } from './authorization-ledger.js';

export function redisAuthorizationStore(redis: Redis): EphemeralStore {
  return {
    get: async key => redis.get(key),
    put: async (key, value, ttlSeconds) => await redis.set(key, value, 'EX', ttlSeconds, 'NX') === 'OK',
    take: async key => {
      const result = await redis.eval("local v=redis.call('GET',KEYS[1]); if v then redis.call('DEL',KEYS[1]); end; return v", 1, key);
      return typeof result === 'string' ? result : null;
    },
  };
}
