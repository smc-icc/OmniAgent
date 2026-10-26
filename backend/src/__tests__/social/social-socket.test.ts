import { beforeEach, describe, expect, it, vi } from 'vitest';
const authority = vi.hoisted(() => ({ allowed: true, claims: {} as Record<string, unknown> }));
vi.mock('../../plugins/db.js', () => ({ prisma: { users: { findUnique: async () => ({ id: 12 }) } } }));
vi.mock('../../modules/access/access.context.js', () => ({ getAccess: async () => ({ userId: 12, accountId: 7, vdnId: 9 }) }));
vi.mock('../../modules/social-auth/social-repository.js', () => ({ assertSocialSession: async (_id: number, claims: Record<string, unknown>) => {
  authority.claims = claims;
  if (!authority.allowed) throw new Error('installation revoked or expired');
} }));
import { socketAccess } from '../../modules/access/access.socket.js';
import { getLoginSession, occupyLogin, resetLoginSessions } from '../../shared/services/login-session.js';

beforeEach(() => { resetLoginSessions(); authority.allowed = true; authority.claims = {}; });
describe('established social socket authority', () => {
  it('retains and checks the full social scope for already established sockets', async () => {
    const { session } = occupyLogin({ userId: 12, deviceId: 'phone1', authenticationMethod: 'social', socialOrganizationId: 'org1',
      socialInstallationId: 'install1', socialRevision: 4, socialSubjectId: 'subject1' });
    expect((await socketAccess(12, session.sessionId)).accountId).toBe(7);
    expect(authority.claims).toMatchObject({ authentication_method: 'social', social_organization_id: 'org1',
      social_installation_id: 'install1', social_revision: 4, social_subject_id: 'subject1' });
  });
  it('retires an existing SID when its installation or identity becomes invalid', async () => {
    const { session } = occupyLogin({ userId: 12, deviceId: 'phone1', authenticationMethod: 'social', socialOrganizationId: 'org1', socialInstallationId: 'install1' });
    await socketAccess(12, session.sessionId);
    authority.allowed = false;
    await expect(socketAccess(12, session.sessionId)).rejects.toThrow();
    expect(getLoginSession(12)).toBeUndefined();
    await expect(socketAccess(12, session.sessionId)).rejects.toThrow();
  });
});
