import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerErrorHandler } from '../../shared/errors/index.js';
import { registerSocialRoutes } from '../../modules/social-auth/social.routes.js';

describe('social route deployment gates', () => {
  it('has no enabled providers and rejects authorization before integration is ready', async () => {
    const app = Fastify();
    registerErrorHandler(app);
    await app.register(async scoped => registerSocialRoutes(scoped, { service: null, complete: async () => { throw new Error('must not issue session'); } }));
    const providers = await app.inject({ method: 'GET', url: '/auth/social/providers?platform=harmonyos&organization_code=' });
    expect(providers.statusCode).toBe(200);
    expect(providers.json()).toEqual({ providers: [] });
    expect(providers.headers['cache-control']).toBe('no-store');
    const authorization = await app.inject({ method: 'POST', url: '/auth/social/authorize', payload: {
      provider: 'wechat', platform: 'harmonyos', organization_code: 'enterprise-1', proof_challenge: 'a'.repeat(43), device_id: 'phone-1',
    } });
    expect(authorization.statusCode).toBe(503);
    expect(authorization.json().error_code).toBe('social_unavailable');
    await app.close();
  });
  it('rejects missing proof and limits repeated binding attempts', async () => {
    const app = Fastify();
    registerErrorHandler(app);
    await app.register(async scoped => registerSocialRoutes(scoped, { service: null, complete: async () => null }));
    const missing = await app.inject({ method: 'POST', url: '/auth/social/exchange', payload: { ticket: 'a'.repeat(43), transaction_id: 'b'.repeat(43) } });
    expect(missing.statusCode).toBe(422);
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await app.inject({ method: 'POST', url: '/auth/social/bind', payload: {} })).statusCode;
    expect(last).toBe(429);
    await app.close();
  });
});
