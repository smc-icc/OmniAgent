import type { FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { resolveCcsWorkNo } from '../../integrations/ccs/ccs-workno.js';
import { getLoginSession, occupyLogin, releaseLogin, withLoginTransition } from '../../shared/services/login-session.js';

export interface AuthenticatedUser {
  id: number; email: string | null; name: string; uid: string; provider: string;
  pubsub_token: string | null; confirmed_at: Date | null; created_at: Date;
}
export interface LoginSessionOptions {
  deviceId: string;
  method: 'password' | 'social' | 'authorization_code' | 'sms';
  accountId?: number;
  vdnId?: number;
  social?: { organizationId: string; installationId: string; revision: number; subjectId: string };
}

/** Same occupation, kick and JWT path for passwords and verified social identities. */
export async function issueLoginSession(request: FastifyRequest, user: AuthenticatedUser, options: LoginSessionOptions) {
  const occupied = occupyLogin({ userId: user.id, deviceId: options.deviceId,
    userAgent: String(request.headers['user-agent'] ?? ''), ip: request.ip, authenticationMethod: options.method,
    socialOrganizationId: options.social?.organizationId, socialInstallationId: options.social?.installationId,
    socialRevision: options.social?.revision, socialSubjectId: options.social?.subjectId });
  if (process.env.OMNI_EXTENSION_BINDING_ENABLED === '1' && occupied.displaced.length) {
    const { database, execute } = await import('../access/access.db.js');
    for (const displaced of occupied.displaced) await execute(await database(), "UPDATE t_omni_extension_voice SET State='logged_out' WHERE OmniUserID=? AND LoginSID=?", [displaced.userId,displaced.sessionId]);
  }
  for (const displaced of occupied.displaced) {
    request.server.emitToUser?.(displaced.userId, 'auth.kicked', {
      reason: displaced.reason, session_id: displaced.sessionId,
      message: displaced.reason === 'same_terminal' ? '本终端已登录其他账号' : '账号已在其他终端登录',
    });
    request.server.disconnectUserSockets?.(displaced.userId);
    if (displaced.reason === 'same_terminal' && displaced.userId !== user.id) {
      void request.server.ccsBridge?.logoutUser(displaced.userId).catch(err => {
        request.log.warn({ err, userId: displaced.userId }, 'kick terminal CCS logout failed');
      });
    }
  }
  const token = request.server.jwt.sign({
    id: user.id, email: user.email ?? '', name: user.name, provider: user.provider, uid: user.uid, pubsub_token: user.pubsub_token,
    sid: occupied.session.sessionId, did: occupied.session.deviceId, authentication_method: options.method,
    ...(options.social ? { social_organization_id: options.social.organizationId, social_installation_id: options.social.installationId,
      social_revision: options.social.revision, social_subject_id: options.social.subjectId } : {}),
  });
  const binding = process.env.OMNI_EXTENSION_BINDING_ENABLED === '1' ? await (await import('../extension-binding/voice.js')).startIdentityVoice({ ...request, currentUser: { ...user, accounts: [] }, params: {}, query: {}, headers: { ...(options.accountId ? { 'x-account-id': String(options.accountId) } : {}), ...(options.vdnId ? { 'x-vdn-id': String(options.vdnId) } : {}) } } as unknown as FastifyRequest, occupied.session.sessionId) : {};
  return {
    status: 'success',
    data: { id: user.id, email: user.email ?? '', name: user.name, provider: user.provider, uid: user.uid,
      work_no: resolveCcsWorkNo(user, env.CCS_WORK_NO_FIELD),
      ...(options.accountId ? { account_id: options.accountId, vdn_id: options.vdnId } : {}),
      confirmed: !!user.confirmed_at, created_at: user.created_at.getTime(), accounts: [],
      session_id: occupied.session.sessionId, device_id: occupied.session.deviceId,
      authentication_method: options.method, voice_signed_in_before: false, ...binding },
    headers: { 'access-token': token, client: '', expiry: '', uid: user.email ?? '' },
  };
}

export async function completeSocialLoginSession(request: FastifyRequest, user: AuthenticatedUser, options: LoginSessionOptions) {
  if (options.method !== 'social' || !options.social) throw new Error('Social authorization context is required');
  return completeIdentityLoginSession(request, user, options);
}

export async function completeIdentityLoginSession(request: FastifyRequest, user: AuthenticatedUser, options: LoginSessionOptions) {
  if (options.method === 'password' || (options.method === 'social' && !options.social)) throw new Error('Verified identity authorization is required');
  return withLoginTransition(user.id, async () => {
    if (process.env.OMNI_EXTENSION_BINDING_ENABLED === '1') return issueLoginSession(request,user,options);
    const previous = getLoginSession(user.id);
    if (previous) {
      releaseLogin(user.id, previous.sessionId);
      request.server.emitToUser?.(user.id, 'auth.kicked', { reason: 'same_account', session_id: previous.sessionId, message: '账号已在其他终端登录' });
    }
    request.server.disconnectUserSockets?.(user.id);
    await request.server.ccsBridge?.logoutUser(user.id);
    return issueLoginSession(request, user, options);
  });
}
