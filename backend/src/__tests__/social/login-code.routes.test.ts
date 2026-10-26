import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError, registerErrorHandler } from '../../shared/errors/index.js';
import { completeIdentityLoginSession } from '../../modules/auth/auth-session.js';
import { getLoginSession, occupyLogin, resetLoginSessions } from '../../shared/services/login-session.js';
import { registerLoginCodeRoutes } from '../../modules/auth/login-code.routes.js';
import type { LoginCodeService } from '../../modules/auth/login-code.service.js';

beforeEach(resetLoginSessions);
async function appFor(ready = true) {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(jwt, { secret: 'isolated-code-login-test-secret' });
  let completed = 0, voiceLogins = 0, voiceLogouts = 0, consumed = false;
  app.decorate('authenticate', async (request: import('fastify').FastifyRequest) => {
    if (!request.headers.authorization) throw new AppError(401, '请先登录');
  });
  app.decorate('ccsBridge', { logoutUser: async () => { voiceLogouts++; }, loginUser: async () => { voiceLogins++; } } as never);
  const receipt = { id: '00000000-0000-4000-8000-000000000001', userId: 2, issuerId: 1, accountId: 10, vdnId: 7, operatorId: 20, tokenHash: '', issuedAt: Date.now(), expiresAt: Date.now() + 900000 };
  const user = { id: 2, uid: 'seat2', name: 'Seat', email: 'seat@example.test', provider: 'email', pubsub_token: null, confirmed_at: null, created_at: new Date() };
  const service = {
    redeem: async () => { if (consumed) throw new AppError(401, '授权码已使用'); consumed = true; return { receipt, user }; },
    issue: async () => ({ id: receipt.id, code: 'synthetic-test-code' }),
    list: async () => [], revoke: async () => ({ success: true }),
  } as unknown as LoginCodeService;
  await app.register(async scoped => registerLoginCodeRoutes(scoped, {
    service: ready ? service : null,
    manager: async request => {
      if (request.headers.authorization !== 'Bearer synthetic-manager') throw new AppError(403, '没有管理权限');
      return { userId: 1, accountId: 10, vdnId: 7 };
    },
    complete: async (request, identity, record, deviceId) => {
      completed++;
      return { ...await completeIdentityLoginSession(request, identity, { method: 'authorization_code', deviceId, accountId: record.accountId, vdnId: record.vdnId }), status: 'authenticated' };
    },
  }));
  return { app, counts: () => ({ completed, voiceLogins, voiceLogouts }) };
}
describe('authorization code HTTP and shared session behavior', () => {
  it('hides unavailable capabilities and fails safely without creating a session', async () => {
    const { app, counts } = await appFor(false);
    const capability = await app.inject('/auth/login-code/capabilities');
    expect(capability.json().ready).toBe(false);
    expect(capability.headers['cache-control']).toBe('no-store');
    expect((await app.inject({ method: 'POST', url: '/auth/login-code/sign_in', payload: { code: 'x', device_id: 'phone' } })).statusCode).toBe(503);
    expect(counts().completed).toBe(0);
    await app.close();
  });
  it('does not allow anonymous or ordinary seats to issue codes', async () => {
    const { app } = await appFor();
    expect((await app.inject({ method: 'POST', url: '/api/access/users/20/login-codes', payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/access/users/20/login-codes', headers: { authorization: 'Bearer synthetic-seat' }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/access/users/20/login-codes', headers: { authorization: 'Bearer synthetic-manager' }, payload: {} })).statusCode).toBe(200);
    await app.close();
  });
  it('rejects injected recipient, VDN or account selectors in the public exchange body', async () => {
    const { app, counts } = await appFor();
    for (const injected of [{ user_id: 3 }, { vdn_id: 8 }, { account_id: 11 }]) {
      expect((await app.inject({ method: 'POST', url: '/auth/login-code/sign_in', payload: { code: 'x', device_id: 'phone', ...injected } })).statusCode).toBe(422);
    }
    expect(counts().completed).toBe(0);
    await app.close();
  });
  it('uses the recipient JWT and terminal occupation while starting no voice login', async () => {
    const { app, counts } = await appFor();
    const old = occupyLogin({ userId: 2, deviceId: 'old-phone' }).session;
    const response = await app.inject({ method: 'POST', url: '/auth/login-code/sign_in', payload: { code: 'x', device_id: 'new-phone' } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toMatchObject({ id: 2, uid: 'seat2', account_id: 10, vdn_id: 7, authentication_method: 'authorization_code', voice_signed_in_before: false });
    expect(app.jwt.verify(body.headers['access-token'])).toMatchObject({ id: 2, uid: 'seat2', authentication_method: 'authorization_code' });
    expect(getLoginSession(2)?.sessionId).not.toBe(old.sessionId);
    expect(getLoginSession(2)?.voiceSessionExpected).toBe(false);
    expect(counts()).toEqual({ completed: 1, voiceLogins: 0, voiceLogouts: 1 });
    expect((await app.inject({ method: 'POST', url: '/auth/login-code/sign_in', payload: { code: 'x', device_id: 'another-phone' } })).statusCode).toBe(401);
    expect(counts().completed).toBe(1);
    await app.close();
  });
});
