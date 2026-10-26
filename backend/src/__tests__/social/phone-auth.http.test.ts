import crypto from 'node:crypto';
import Redis from 'ioredis';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerErrorHandler } from '../../shared/errors/index.js';
import { PhoneAuthService } from '../../modules/auth/phone-auth.service.js';
import { redisPhoneChallengeStore } from '../../modules/auth/phone-auth.store.js';
import { registerPhoneAuthRoutes } from '../../modules/auth/phone-auth.routes.js';
import { completeIdentityLoginSession } from '../../modules/auth/auth-session.js';
import { getLoginSession, resetLoginSessions } from '../../shared/services/login-session.js';
const testUrl = process.env.TEST_PHONE_REDIS_URL;
describe.skipIf(!testUrl)('SMS HTTP exchange with real Redis and JWT', () => {
  let redis: Redis;
  beforeAll(async () => { if (new URL(testUrl!).hostname !== '127.0.0.1') throw new Error('Use isolated local Redis'); redis = new Redis(testUrl!, { lazyConnect: true }); await redis.connect(); });
  afterAll(async () => { if (redis) await redis.quit(); });
  beforeEach(resetLoginSessions);
  async function fixture(ready = true, multiple = false) {
    const app = Fastify(); registerErrorHandler(app);
    await app.register(jwt, { secret: crypto.randomBytes(32).toString('hex') });
    let delivered = '', completions = 0, voiceLogins = 0;
    app.decorate('ccsBridge', { logoutUser: async () => {}, loginUser: async () => { voiceLogins++; } } as never);
    const user = { id: 2, uid: 'work-2', provider: 'email', name: 'Fixture Seat', email: 'fixture@example.test', pubsub_token: null, confirmed_at: null, created_at: new Date() };
    const service = new PhoneAuthService(redisPhoneChallengeStore(redis), {
      list: async phone => phone === '+8613800000000' ? (multiple ? [{ userId: 2, accountId: 10, vdnId: 7, operatorId: 20, name: 'A' }, { userId: 3, accountId: 11, vdnId: 8, operatorId: 21, name: 'B' }] : [{ userId: 2, accountId: 10, vdnId: 7, operatorId: 20 }]) : [],
      validate: async target => ({ ...user, id: target.userId, uid: 'work-' + target.userId }),
    }, { readiness: async () => ({ supported: true, ready, reason: ready ? '' : '短信服务尚未配置' }), send: async (_phone, code) => { delivered = code; } }, crypto.randomBytes(32));
    await app.register(async scoped => registerPhoneAuthRoutes(scoped, { service, complete: async (req, identity, target, did) => {
      completions++;
      return { ...await completeIdentityLoginSession(req, identity, { method: 'sms', deviceId: did, accountId: target.accountId, vdnId: target.vdnId }), status: 'authenticated' };
    } }));
    return { app, service, code: () => delivered, counts: () => ({ completions, voiceLogins }) };
  }
  const input = { phone: '13800000000', device_id: 'fixture-phone' };
  it('shows supported-but-unconfigured state and sends no messages', async () => {
    const f = await fixture(false);
    const capabilities = await f.app.inject('/auth/phone/capabilities');
    expect(capabilities.json()).toMatchObject({ supported: true, ready: false });
    expect(capabilities.headers['cache-control']).toBe('no-store');
    expect((await f.app.inject({ method: 'POST', url: '/auth/phone/request', payload: input })).statusCode).toBe(503);
    expect(f.code()).toBe(''); await f.app.close();
  });
  it('authenticates an existing seat once, with its unchanged UID and no voice sign-in', async () => {
    const f = await fixture();
    const request = await f.app.inject({ method: 'POST', url: '/auth/phone/request', payload: input });
    expect(request.statusCode).toBe(200); await f.service.drainDeliveries();
    expect(request.json()).not.toHaveProperty('code'); expect(request.headers['cache-control']).toBe('no-store');
    const payload = { ...input, request_id: request.json().request_id, code: f.code() };
    expect((await f.app.inject({ method: 'POST', url: '/auth/phone/sign_in', payload: { ...payload, user_id: 99 } })).statusCode).toBe(422);
    const signed = await f.app.inject({ method: 'POST', url: '/auth/phone/sign_in', payload });
    expect(signed.statusCode).toBe(200);
    expect(signed.json().data).toMatchObject({ id: 2, uid: 'work-2', account_id: 10, vdn_id: 7, authentication_method: 'sms', voice_signed_in_before: false });
    expect(f.app.jwt.verify(signed.json().headers['access-token'])).toMatchObject({ id: 2, uid: 'work-2', authentication_method: 'sms' });
    expect(getLoginSession(2)?.voiceSessionExpected).toBe(false);
    expect((await f.app.inject({ method: 'POST', url: '/auth/phone/sign_in', payload })).statusCode).toBe(401);
    expect(f.counts()).toEqual({ completions: 1, voiceLogins: 0 }); await f.app.close();
  });
  it('issues no JWT until a verified multi-VDN phone selects a recorded association, once', async () => {
    const f = await fixture(true, true);
    expect((await f.app.inject({ method: 'POST', url: '/auth/phone/request', payload: { ...input, organization_code: '7' } })).statusCode).toBe(422);
    const request = await f.app.inject({ method: 'POST', url: '/auth/phone/request', payload: input }); await f.service.drainDeliveries();
    const proof = { ...input, request_id: request.json().request_id, code: f.code() };
    const verified = await f.app.inject({ method: 'POST', url: '/auth/phone/sign_in', payload: proof });
    expect(verified.json()).toMatchObject({ status: 'select_vdn', vdns: [{ vdn_id: 7, name: 'A' }, { vdn_id: 8, name: 'B' }] });
    expect(verified.json()).not.toHaveProperty('headers'); expect(f.counts().completions).toBe(0);
    const choice = { ...input, selection_ticket: verified.json().selection_ticket, vdn_id: 8 };
    expect((await f.app.inject({ method: 'POST', url: '/auth/phone/select_vdn', payload: { ...choice, vdn_id: 99 } })).statusCode).toBe(401);
    expect((await f.app.inject({ method: 'POST', url: '/auth/phone/select_vdn', payload: { ...choice, device_id: 'another-device' } })).statusCode).toBe(401);
    expect((await f.app.inject({ method: 'POST', url: '/auth/phone/select_vdn', payload: { ...choice, account_id: 999 } })).statusCode).toBe(422);
    const signed = await f.app.inject({ method: 'POST', url: '/auth/phone/select_vdn', payload: choice });
    expect(signed.statusCode).toBe(200); expect(signed.json().data).toMatchObject({ id: 3, uid: 'work-3', account_id: 11, vdn_id: 8, authentication_method: 'sms' });
    expect(getLoginSession(3)?.voiceSessionExpected).toBe(false);
    expect((await f.app.inject({ method: 'POST', url: '/auth/phone/select_vdn', payload: choice })).statusCode).toBe(401);
    expect(f.counts()).toEqual({ completions: 1, voiceLogins: 0 }); await f.app.close();
  });
  it('verifies an unbound number but does not issue a JWT or expose VDNs', async () => {
    const f = await fixture(), payload = { ...input, phone: '13900000000' };
    const request = await f.app.inject({ method: 'POST', url: '/auth/phone/request', payload });
    expect(request.statusCode).toBe(200); await f.service.drainDeliveries();
    expect(request.json()).not.toHaveProperty('vdns'); expect(f.code()).toMatch(/^\d{6}$/);
    const verified = await f.app.inject({ method: 'POST', url: '/auth/phone/sign_in', payload: { ...payload, request_id: request.json().request_id, code: f.code() } });
    expect(verified.statusCode).toBe(200); expect(verified.json()).toMatchObject({ status: 'unbound', message: expect.stringContaining('未绑定 VDN') });
    expect(verified.json()).not.toHaveProperty('headers'); expect(f.counts().completions).toBe(0); await f.app.close();
  });
});
