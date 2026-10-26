import crypto from 'node:crypto';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redisPhoneChallengeStore } from '../../modules/auth/phone-auth.store.js';
import type { PhoneChallenge } from '../../modules/auth/phone-auth.service.js';
const testUrl = process.env.TEST_PHONE_REDIS_URL;
describe.skipIf(!testUrl)('phone OTP atomic Redis behavior', () => {
  let redis: Redis;
  beforeAll(async () => { if (new URL(testUrl!).hostname !== '127.0.0.1') throw new Error('Use an isolated local fixture'); redis = new Redis(testUrl!, { lazyConnect: true, maxRetriesPerRequest: 1 }); await redis.connect(); });
  afterAll(async () => { if (redis) await redis.quit(); });
  const record = (): PhoneChallenge => ({ id: crypto.randomUUID(), version: 2, phoneHash: crypto.randomBytes(32).toString('hex'),
    deviceHash: crypto.randomBytes(32).toString('hex'), codeHash: crypto.randomBytes(32).toString('hex'), expiresAt: Date.now() + 300000,
    state: 'pending', attempts: 0 });
  it('permits one of twenty concurrent exchanges and never authenticates a pending delivery', async () => {
    const store = redisPhoneChallengeStore(redis), r = record(), proof = { ...r, now: Date.now() };
    expect(await store.reserve(r, 300, 60)).toBe(true);
    expect(await store.verify(r.id, proof)).toBeNull();
    await store.activate(r.id);
    const results = await Promise.all(Array.from({ length: 20 }, () => store.verify(r.id, proof)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it('enforces a five-attempt limit atomically', async () => {
    const store = redisPhoneChallengeStore(redis), r = record();
    await store.reserve(r, 300, 60); await store.activate(r.id);
    await Promise.all(Array.from({ length: 10 }, () => store.verify(r.id, { ...r, codeHash: '0'.repeat(64), now: Date.now() })));
    expect(await store.verify(r.id, { ...r, now: Date.now() })).toBeNull();
  });
  it('uses a global per-phone cooldown and retires the previous nonce on resend', async () => {
    const store = redisPhoneChallengeStore(redis), old = record();
    const results = await Promise.all(Array.from({ length: 10 }, () => store.reserve({ ...record(), phoneHash: old.phoneHash }, 300, 60)));
    expect(results.filter(Boolean)).toHaveLength(1);
    await redis.del('omni:phone-auth:cooldown:' + old.phoneHash);
    expect(await store.reserve(old, 300, 60)).toBe(true); await store.activate(old.id);
    await redis.del('omni:phone-auth:cooldown:' + old.phoneHash);
    const newer = { ...record(), phoneHash: old.phoneHash };
    expect(await store.reserve(newer, 300, 60)).toBe(true);
    await store.activate(old.id);
    expect(await store.verify(old.id, { ...old, now: Date.now() })).toBeNull();
    await store.activate(newer.id);
    expect(await store.verify(newer.id, { ...newer, now: Date.now() })).not.toBeNull();
  });
  it('atomically consumes one device-bound VDN choice and preserves it after invalid selection', async () => {
    const store = redisPhoneChallengeStore(redis), r = record(), hash = crypto.randomBytes(32).toString('hex');
    await store.saveSelection(hash, { phoneHash: r.phoneHash, deviceHash: r.deviceHash, expiresAt: r.expiresAt,
      targets: [{ userId: 2, accountId: 10, vdnId: 7, operatorId: 20 }, { userId: 3, accountId: 11, vdnId: 8, operatorId: 21 }] }, 120);
    const proof = { phoneHash: r.phoneHash, deviceHash: r.deviceHash, now: Date.now(), vdnId: 7 };
    expect(await store.consumeSelection(hash, { ...proof, vdnId: 999 })).toBeNull();
    expect(await store.consumeSelection(hash, { ...proof, deviceHash: '0'.repeat(64) })).toBeNull();
    const results = await Promise.all(Array.from({ length: 20 }, () => store.consumeSelection(hash, proof)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it('keeps the original expiry when activation and wrong attempts rewrite the record', async () => {
    const store = redisPhoneChallengeStore(redis), r = record();
    await store.reserve(r, 300, 60);
    await redis.pexpire('omni:phone-auth:challenge:' + r.id, 1000);
    await store.activate(r.id);
    await store.verify(r.id, { ...r, codeHash: '0'.repeat(64), now: Date.now() });
    const ttl = await redis.pttl('omni:phone-auth:challenge:' + r.id);
    expect(ttl).toBeGreaterThan(0); expect(ttl).toBeLessThanOrEqual(1000);
  });
});
