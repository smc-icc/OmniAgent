import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueLoginSession } from '../../modules/auth/auth-session.js';
import { resetLoginSessions, getLoginSession } from '../../shared/services/login-session.js';

beforeEach(resetLoginSessions);
const user = { id: 12, email: 'seat@example.test', name: 'Seat', uid: 'ccs-work-001', provider: 'email', pubsub_token: null, confirmed_at: null, created_at: new Date(0) };
describe('shared login response', () => {
  it('keeps CCS uid/provider while signing social context into the existing JWT', async () => {
    const app = Fastify();
    await app.register(jwt, { secret: 'test-secret-not-a-production-key' });
    const request = { server: app, headers: {}, ip: '127.0.0.1', log: app.log };
    const body = await issueLoginSession(request as never, user, { deviceId: 'phone-1', method: 'social', accountId: 7, vdnId: 9,
      social: { organizationId: 'org-1', installationId: 'install-1', revision: 1, subjectId: 'subject-1' } });
    const claims = app.jwt.verify(body.headers['access-token']) as Record<string, unknown>;
    expect(claims).toMatchObject({ uid: 'ccs-work-001', provider: 'email', authentication_method: 'social', social_installation_id: 'install-1' });
    expect(body.data).toMatchObject({ account_id: 7, vdn_id: 9, authentication_method: 'social', voice_signed_in_before: false });
    expect(getLoginSession(12)?.hadVoiceSignIn).toBe(false);
    await app.close();
  });
  it('retains password login and same-account/same-terminal occupation', async () => {
    const app = Fastify();
    await app.register(jwt, { secret: 'test-secret-not-a-production-key' });
    const request = { server: app, headers: {}, ip: '127.0.0.1', log: app.log };
    const first = await issueLoginSession(request as never, user, { deviceId: 'phone-1', method: 'password' });
    const second = await issueLoginSession(request as never, user, { deviceId: 'phone-2', method: 'password' });
    expect(first.data.session_id).not.toBe(second.data.session_id);
    expect(second.data.authentication_method).toBe('password');
    expect(getLoginSession(12)?.deviceId).toBe('phone-2');
    await app.close();
  });
});
