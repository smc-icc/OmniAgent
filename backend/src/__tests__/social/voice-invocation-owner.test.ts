import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../integrations/ccs/ccs-client.js', () => ({ invokeDoAgent: async () => ({ ret: 0, rsp: {} }) }));
import { handleInvoke, handleOnAgentCallback, initCcsBridge, restoreSkillsAndStatus } from '../../integrations/ccs/ccs-bridge.js';
import { bindAgentId, clearSession, getSessionByUserId, setCredentials } from '../../integrations/ccs/session-manager.js';
import { getLoginSession, markLoginVoiceSignedIn, occupyLogin, resetLoginSessions } from '../../shared/services/login-session.js';

beforeEach(() => { resetLoginSessions(); clearSession(12); vi.stubEnv('CONF_TENANCY_ENABLED', '0'); });
afterEach(() => { clearSession(12); resetLoginSessions(); vi.unstubAllEnvs(); });
it('does not reattribute an outstanding old logout when the same CCS object gets a replacement password SID', async () => {
  initCcsBridge(() => {}, { vdnId: 1, servantObjName: 'Fixture', servantHost: '127.0.0.1', servantPort: 1, invokeTimeoutMs: 1000 });
  const old = occupyLogin({ userId: 12, deviceId: 'old-phone' }).session;
  setCredentials(12, { workNO: 'seat1', extension: '8003', password: 'old-password' }, old.sessionId);
  bindAgentId(12, 99);
  const runtime = getSessionByUserId(12)!;
  runtime.loggedIn = true;
  const pending = handleInvoke(12, 'old-logout', 'DoAgentLoggedOff', { AgentID: 99 }, old.sessionId);
  const replacement = occupyLogin({ userId: 12, deviceId: 'new-phone' }).session;
  setCredentials(12, { workNO: 'seat1', extension: '8003', password: 'new-password' }, replacement.sessionId);
  markLoginVoiceSignedIn(12, replacement.sessionId);
  handleOnAgentCallback('OnAgentLoggedOffAck', { AgentID: 99, Result: 0 });
  await expect(pending).rejects.toThrow('session_replaced');
  expect(runtime.loggedIn).toBe(true);
  expect(getLoginSession(12)?.voiceSessionExpected).toBe(true);
});

it('still accepts a legitimate voice login acknowledgement owned by the current SID', async () => {
  initCcsBridge(() => {}, { vdnId: 1, servantObjName: 'Fixture', servantHost: '127.0.0.1', servantPort: 1, invokeTimeoutMs: 1000 });
  const identity = occupyLogin({ userId: 12, deviceId: 'phone' }).session;
  setCredentials(12, { workNO: 'seat1', extension: '8003', password: 'current-password' }, identity.sessionId);
  const login = handleInvoke(12, 'current-login', 'DoAgentLoginEx', { workNO: 'seat1' }, identity.sessionId);
  handleOnAgentCallback('OnAgentLoginExAck', { workNO: 'seat1', AgentID: 99, Result: 0 });
  expect((await login)?.Result).toBe(0);
  expect(getSessionByUserId(12)?.loggedIn).toBe(true);
  expect(getLoginSession(12)?.hadVoiceSignIn).toBe(true);
});

it.each([
  { status: 1, initial: 'ready', mode: 'busy', ack: 'OnAgentSetBusyAck' } as const,
  { status: 0, initial: 'busy', mode: 'ready', ack: 'OnAgentSetIdleAck' } as const,
])('restores current SID-owned $mode state through a correlated internal invocation', async ({ status, initial, mode, ack }) => {
  const events: unknown[] = [];
  initCcsBridge((_user, _event, body) => events.push(body), { vdnId: 1, servantObjName: 'Fixture', servantHost: '127.0.0.1', servantPort: 1, invokeTimeoutMs: 1000 });
  const identity = occupyLogin({ userId: 12, deviceId: 'phone' }).session;
  const runtime = setCredentials(12, { workNO: 'seat1', extension: '8003', password: 'current-password' }, identity.sessionId);
  bindAgentId(12, 99);
  runtime.loggedIn = true;
  runtime.skillsToRestore = [];
  runtime.agentStatusToRestore = status;
  runtime.workMode = initial;
  restoreSkillsAndStatus(12);
  handleOnAgentCallback(ack, { AgentID: 99, Result: 0 });
  await Promise.resolve();
  expect(runtime.workMode).toBe(mode);
  expect(events).toContainEqual(expect.objectContaining({ method: ack }));
});
