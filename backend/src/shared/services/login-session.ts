import crypto from 'crypto';

export type KickReason = 'same_account' | 'same_terminal';

export interface LoginSession {
  userId: number;
  sessionId: string;
  deviceId: string;
  userAgent: string;
  ip: string;
  issuedAt: number;
  authenticationMethod: 'password' | 'social' | 'authorization_code' | 'sms';
  hadVoiceSignIn: boolean;
  voiceSessionExpected: boolean;
  socialOrganizationId?: string;
  socialInstallationId?: string;
  socialRevision?: number;
  socialSubjectId?: string;
}

export interface DisplacedSession {
  userId: number;
  sessionId: string;
  reason: KickReason;
}

const byUser = new Map<number, LoginSession>();
const byDevice = new Map<string, number>();
const transitionTails = new Map<number, Promise<void>>();
const activeTransitions = new Set<number>();
const revocationListeners = new Set<(session: LoginSession) => void>();

export function newSessionId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function normalizeDeviceId(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (s && s.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(s)) return s;
  return `auto-${newSessionId()}`;
}

export function getLoginSession(userId: number): LoginSession | undefined {
  return byUser.get(userId);
}

export function isCurrentSession(userId: number, sessionId: string | undefined): boolean {
  if (activeTransitions.has(userId)) return false;
  if (!sessionId) return !byUser.has(userId);
  const cur = byUser.get(userId);
  return !!cur && cur.sessionId === sessionId;
}

export function occupyLogin(input: {
  userId: number;
  deviceId: string;
  userAgent?: string;
  ip?: string;
  authenticationMethod?: 'password' | 'social' | 'authorization_code' | 'sms';
  socialOrganizationId?: string;
  socialInstallationId?: string;
  socialRevision?: number;
  socialSubjectId?: string;
}): { session: LoginSession; displaced: DisplacedSession[] } {
  const deviceId = normalizeDeviceId(input.deviceId);
  const session: LoginSession = {
    userId: input.userId,
    sessionId: newSessionId(),
    deviceId,
    userAgent: (input.userAgent ?? '').slice(0, 240),
    ip: input.ip ?? '',
    issuedAt: Date.now(),
    authenticationMethod: input.authenticationMethod ?? 'password',
    hadVoiceSignIn: false,
    voiceSessionExpected: false,
    socialOrganizationId: input.socialOrganizationId,
    socialInstallationId: input.socialInstallationId,
    socialRevision: input.socialRevision,
    socialSubjectId: input.socialSubjectId,
  };
  const displaced: DisplacedSession[] = [];

  const prevUser = byUser.get(input.userId);
  if (prevUser && prevUser.sessionId !== session.sessionId) {
    displaced.push({
      userId: prevUser.userId,
      sessionId: prevUser.sessionId,
      reason: 'same_account',
    });
    if (byDevice.get(prevUser.deviceId) === prevUser.userId) {
      byDevice.delete(prevUser.deviceId);
    }
  }

  const ownerId = byDevice.get(deviceId);
  if (ownerId != null && ownerId !== input.userId) {
    const owner = byUser.get(ownerId);
    if (owner && owner.deviceId === deviceId) {
      displaced.push({
        userId: owner.userId,
        sessionId: owner.sessionId,
        reason: 'same_terminal',
      });
      byUser.delete(ownerId);
    }
  }

  byUser.set(input.userId, session);
  byDevice.set(deviceId, input.userId);
  return { session, displaced };
}

export function releaseLogin(userId: number, sessionId?: string): boolean {
  const cur = byUser.get(userId);
  if (!cur) return false;
  if (sessionId && cur.sessionId !== sessionId) return false;
  if (byDevice.get(cur.deviceId) === userId) byDevice.delete(cur.deviceId);
  byUser.delete(userId);
  return true;
}

export function maskDeviceId(deviceId: string): string {
  if (deviceId.length <= 10) return deviceId;
  return `${deviceId.slice(0, 6)}…${deviceId.slice(-4)}`;
}

export function markLoginVoiceSignedIn(userId: number, expectedSid?: string): void {
  if (activeTransitions.has(userId) || (expectedSid != null && !isCurrentSession(userId, expectedSid))) return;
  const session = byUser.get(userId);
  if (session) { session.hadVoiceSignIn = true; session.voiceSessionExpected = true; }
}

export function markLoginVoiceSignedOut(userId: number, expectedSid?: string): void {
  if (activeTransitions.has(userId) || (expectedSid != null && !isCurrentSession(userId, expectedSid))) return;
  const session = byUser.get(userId);
  if (session) session.voiceSessionExpected = false;
}

export function assertCurrentLogin(userId: number, expectedSid?: string): void {
  if (!isCurrentSession(userId, expectedSid)) throw new Error('session_replaced');
}

export function isLoginTransitioning(userId: number): boolean { return activeTransitions.has(userId); }

export async function withLoginTransition<T>(userId: number, action: () => Promise<T>): Promise<T> {
  const previous = transitionTails.get(userId) ?? Promise.resolve();
  const result = previous.then(async () => {
    activeTransitions.add(userId);
    try { return await action(); }
    finally { activeTransitions.delete(userId); }
  });
  const tail = result.then(() => undefined, () => undefined);
  transitionTails.set(userId, tail);
  try { return await result; }
  finally { if (transitionTails.get(userId) === tail) transitionTails.delete(userId); }
}

export function onLoginRevoked(listener: (session: LoginSession) => void): () => void {
  revocationListeners.add(listener);
  return () => { revocationListeners.delete(listener); };
}

export function revokeLogin(userId: number, expectedSid: string): boolean {
  const session = byUser.get(userId);
  if (!session || !releaseLogin(userId, expectedSid)) return false;
  for (const listener of revocationListeners) listener(session);
  return true;
}

export function revokeSocialLogins(installationId: string): number[] {
  const users: number[] = [];
  for (const session of byUser.values()) {
    if (session.authenticationMethod === 'social' && session.socialInstallationId === installationId) {
      users.push(session.userId);
      revokeLogin(session.userId, session.sessionId);
    }
  }
  return users;
}

/** test helper */
export function resetLoginSessions(): void {
  byUser.clear();
  byDevice.clear();
}

/** Called only after the JWT SID has been checked against the durable ICC login record. */
export function restoreLoginSession(saved: LoginSession): void {
  if (!saved || !Number.isSafeInteger(saved.userId) || !saved.sessionId || !saved.deviceId || byUser.has(saved.userId)) return;
  const other=byDevice.get(saved.deviceId); if(other != null && other!==saved.userId)return;
  byUser.set(saved.userId,saved); byDevice.set(saved.deviceId,saved.userId);
}
