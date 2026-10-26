import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { beforeEach, describe, expect, it } from 'vitest';
import { completeSocialLoginSession } from '../../modules/auth/auth-session.js';
import { getLoginSession, isCurrentSession, markLoginVoiceSignedIn, occupyLogin, resetLoginSessions, withLoginTransition } from '../../shared/services/login-session.js';
import { clearSession, getSessionByUserId, setCredentials } from '../../integrations/ccs/session-manager.js';

beforeEach(() => { resetLoginSessions(); clearSession(12); });
describe('social login transition fencing', () => {
  it('retires the old SID before asynchronous CCS cleanup and rejects its credential writes', async () => {
    const app = Fastify();
    await app.register(jwt, { secret: 'local-test-signing-secret' });
    const previous = occupyLogin({ userId: 12, deviceId: 'old-phone' }).session;
    setCredentials(12, { workNO: 'seat1', extension: '8003', password: 'old-password' }, previous.sessionId);
    let finishCleanup!: () => void;
    const gate = new Promise<void>(resolve => { finishCleanup = resolve; });
    let cleanupStarted!: () => void;
    const started = new Promise<void>(resolve => { cleanupStarted = resolve; });
    app.decorate('disconnectUserSockets', () => {});
    app.decorate('ccsBridge', { logoutUser: async () => { clearSession(12); cleanupStarted(); await gate; } } as never);
    const request = { server: app, headers: {}, ip: '127.0.0.1', log: app.log };
    const completion = completeSocialLoginSession(request as never, {
      id: 12, email: 'seat@example.test', name: 'Seat', uid: 'seat1', provider: 'email', pubsub_token: null, confirmed_at: null, created_at: new Date(),
    }, { method: 'social', deviceId: 'new-phone', social: { organizationId: 'org1', installationId: 'install1', revision: 1, subjectId: 'subject1' } });
    await started;
    expect(isCurrentSession(12, previous.sessionId)).toBe(false);
    expect(isCurrentSession(12, undefined)).toBe(false);
    expect(() => setCredentials(12, { workNO: 'seat1', extension: '8003', password: 'old-password' }, previous.sessionId)).toThrow();
    expect(() => setCredentials(12, { workNO: 'seat1', extension: '8003', password: 'legacy-password' })).toThrow();
    finishCleanup();
    const body = await completion;
    expect(body.data.voice_signed_in_before).toBe(false);
    expect(getSessionByUserId(12)).toBeUndefined();
    expect(() => setCredentials(12, { workNO: 'seat1', extension: '8003', password: 'legacy-password' })).toThrow();
    markLoginVoiceSignedIn(12, previous.sessionId);
    expect(getLoginSession(12)?.hadVoiceSignIn).toBe(false);
    await app.close();
  });
  it('serializes same-user transitions through asynchronous cleanup', async () => {
    const order: string[] = [];
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const first = withLoginTransition(12, async () => { order.push('cleanup'); await gate; order.push('first-issued'); });
    const second = withLoginTransition(12, async () => { order.push('second-issued'); });
    await Promise.resolve();
    expect(order).toEqual(['cleanup']);
    finish();
    await Promise.all([first, second]);
    expect(order).toEqual(['cleanup', 'first-issued', 'second-issued']);
  });
});
