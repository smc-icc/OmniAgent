import { describe, expect, it } from 'vitest';
import {
  isCurrentSession,
  occupyLogin,
  releaseLogin,
  resetLoginSessions,
} from '../shared/services/login-session.js';

describe('exclusive login session', () => {
  it('keeps one session per account and kicks the previous one', () => {
    resetLoginSessions();
    const first = occupyLogin({ userId: 1, deviceId: 'device-aaaa-1111' });
    const second = occupyLogin({ userId: 1, deviceId: 'device-bbbb-2222' });
    expect(second.displaced).toEqual([
      expect.objectContaining({ userId: 1, reason: 'same_account', sessionId: first.session.sessionId }),
    ]);
    expect(isCurrentSession(1, first.session.sessionId)).toBe(false);
    expect(isCurrentSession(1, second.session.sessionId)).toBe(true);
  });

  it('allows only one account on the same terminal', () => {
    resetLoginSessions();
    occupyLogin({ userId: 1, deviceId: 'device-shared-0001' });
    const other = occupyLogin({ userId: 2, deviceId: 'device-shared-0001' });
    expect(other.displaced.some((d) => d.userId === 1 && d.reason === 'same_terminal')).toBe(true);
    expect(isCurrentSession(1, undefined)).toBe(true);
    expect(isCurrentSession(2, other.session.sessionId)).toBe(true);
  });

  it('release only matches current sid', () => {
    resetLoginSessions();
    const cur = occupyLogin({ userId: 3, deviceId: 'device-cccc-3333' });
    expect(releaseLogin(3, 'not-this')).toBe(false);
    expect(isCurrentSession(3, cur.session.sessionId)).toBe(true);
    expect(releaseLogin(3, cur.session.sessionId)).toBe(true);
    expect(isCurrentSession(3, cur.session.sessionId)).toBe(false);
  });
});
