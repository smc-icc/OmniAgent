import { assertCurrentLogin, getLoginSession, revokeLogin } from '../../shared/services/login-session.js';
import { assertSocialSession } from './social-repository.js';

/** Used on every established socket packet and business broadcast, not only handshakes. */
export async function assertActiveSocialLogin(userId: number, sid?: string): Promise<void> {
  assertCurrentLogin(userId, sid);
  const session = getLoginSession(userId);
  if (session?.authenticationMethod !== 'social') return;
  try {
    await assertSocialSession(userId, { authentication_method: 'social', social_organization_id: session.socialOrganizationId,
      social_installation_id: session.socialInstallationId, social_revision: session.socialRevision, social_subject_id: session.socialSubjectId });
  } catch (error) {
    revokeLogin(userId, session.sessionId);
    throw error;
  }
  assertCurrentLogin(userId, sid);
}
