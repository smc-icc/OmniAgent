import crypto from 'node:crypto';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redisLoginCodeStore } from '../../modules/auth/login-code.store.js';
import type { LoginCodeRecord } from '../../modules/auth/login-code.service.js';

const testUrl = process.env.TEST_LOGIN_CODE_REDIS_URL;
describe.skipIf(!testUrl)('login codes against an isolated local Redis', () => {
  let redis: Redis;
  beforeAll(async () => {
    if (new URL(testUrl!).hostname !== '127.0.0.1') throw new Error('Use an isolated local Redis fixture only');
    redis = new Redis(testUrl!, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await redis.connect();
  });
  afterAll(async () => { if (redis) await redis.quit(); });
  const record = (): LoginCodeRecord => {
    const now = Date.now();
    return { id: crypto.randomUUID(), tokenHash: crypto.randomBytes(32).toString('hex'), userId: 2, issuerId: 1,
      accountId: 10, vdnId: 7, operatorId: crypto.randomInt(10000, 1000000), issuedAt: now, expiresAt: now + 900000 };
  };
  it('atomically consumes one credential across concurrent exchanges', async () => {
    const store = redisLoginCodeStore(redis), r = record();
    expect(await store.put(r, 900)).toBe(true);
    const exchanges = await Promise.all(Array.from({ length: 20 }, () => store.take(r.tokenHash)));
    expect(exchanges.filter(Boolean)).toEqual([r]);
    expect(await store.get(r.id)).toBeNull();
    expect(await store.list(r)).toEqual([]);
  });
  it('revokes the credential and metadata together', async () => {
    const store = redisLoginCodeStore(redis), r = record();
    await store.put(r, 900);
    expect(await store.list(r)).toEqual([r]);
    expect(await store.revoke(r)).toBe(true);
    expect(await store.take(r.tokenHash)).toBeNull();
    expect(await store.get(r.id)).toBeNull();
    expect(await store.list(r)).toEqual([]);
  });
  it('prevents issue races from exceeding five active codes per seat', async () => {
    const store = redisLoginCodeStore(redis), base = record();
    const issued = await Promise.all(Array.from({ length: 12 }, () => store.put({ ...record(), operatorId: base.operatorId }, 900)));
    expect(issued.filter(Boolean)).toHaveLength(5);
    expect(await store.list(base)).toHaveLength(5);
  });
  it('never overwrites an existing credential on a hash collision', async () => {
    const store = redisLoginCodeStore(redis), a = record(), b = { ...record(), tokenHash: a.tokenHash };
    expect(await store.put(a, 900)).toBe(true);
    expect(await store.put(b, 900)).toBe(false);
    expect(await store.take(a.tokenHash)).toEqual(a);
    expect(await store.get(b.id)).toBeNull();
  });
  it('expires both credential and metadata', async () => {
    const store = redisLoginCodeStore(redis), r = record();
    await store.put(r, 900);
    await redis.pexpire('omni:login-code:token:' + r.tokenHash, 20);
    await redis.pexpire('omni:login-code:record:' + r.id, 20);
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(await store.take(r.tokenHash)).toBeNull();
    expect(await store.get(r.id)).toBeNull();
    expect(await store.list(r)).toEqual([]);
  });
  it('shares rate limits across concurrent operations', async () => {
    const store = redisLoginCodeStore(redis);
    const key = 'fixture:' + crypto.randomUUID();
    const attempts = await Promise.all(Array.from({ length: 20 }, () => store.limit(key, 10, 60)));
    expect(attempts.filter(Boolean)).toHaveLength(10);
  });
});
