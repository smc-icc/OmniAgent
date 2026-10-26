import { beforeEach, describe, expect, it } from 'vitest';
import { getLoginSession, markLoginVoiceSignedIn, markLoginVoiceSignedOut, occupyLogin, resetLoginSessions, revokeSocialLogins } from '../../shared/services/login-session.js';

beforeEach(resetLoginSessions);
describe('social identity session history', () => {
  it('starts with identity but no voice history', () => {
    const { session } = occupyLogin({ userId: 1, deviceId: 'device1', authenticationMethod: 'social', socialOrganizationId: 'org1', socialInstallationId: 'install1' });
    expect(session.authenticationMethod).toBe('social');
    expect(session.hadVoiceSignIn).toBe(false);
    markLoginVoiceSignedIn(1);
    expect(getLoginSession(1)?.hadVoiceSignIn).toBe(true);
  });
  it('revokes only social sessions belonging to the revoked enterprise', () => {
    occupyLogin({ userId: 1, deviceId: 'device1', authenticationMethod: 'social', socialOrganizationId: 'org1', socialInstallationId: 'install1' });
    occupyLogin({ userId: 2, deviceId: 'device2', authenticationMethod: 'social', socialOrganizationId: 'org2', socialInstallationId: 'install2' });
    occupyLogin({ userId: 3, deviceId: 'device3' });
    expect(revokeSocialLogins('install1')).toEqual([1]);
    expect(getLoginSession(1)).toBeUndefined();
    expect(getLoginSession(2)?.authenticationMethod).toBe('social');
    expect(getLoginSession(3)?.authenticationMethod).toBe('password');
  });
  it('distinguishes voluntary voice sign-out from an expired voice session', () => {
    occupyLogin({ userId: 1, deviceId: 'device1', authenticationMethod: 'social' });
    markLoginVoiceSignedIn(1);
    expect(getLoginSession(1)?.voiceSessionExpected).toBe(true);
    markLoginVoiceSignedOut(1);
    expect(getLoginSession(1)?.hadVoiceSignIn).toBe(true);
    expect(getLoginSession(1)?.voiceSessionExpected).toBe(false);
  });
  it('does not apply a late voice sign-out to the replacement identity session', () => {
    const first = occupyLogin({ userId: 1, deviceId: 'device1' }).session;
    const replacement = occupyLogin({ userId: 1, deviceId: 'device2', authenticationMethod: 'social' }).session;
    markLoginVoiceSignedIn(1, replacement.sessionId);
    markLoginVoiceSignedOut(1, first.sessionId);
    expect(getLoginSession(1)?.voiceSessionExpected).toBe(true);
  });
});
