import { afterEach, describe, it, expect, vi } from 'vitest';
const rpc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../modules/extension-binding/ccs-state.js', () => ({
  remoteVoice: vi.fn(async () => ({ agentId: 55, status: 32, software: true })),
}));
vi.mock('../shared/services/omni-runtime-persist.js', () => ({
  dropCcsRuntime: vi.fn(async () => undefined),
  getRuntimeCcsBootId: () => '',
}));
vi.mock('../integrations/ccs/ccs-client.js', () => ({ invokeDoAgent: rpc.invoke }));
import {
  initCcsBridge,
  handleOnAgentCallback,
  logoutWithConfirmation,
} from '../integrations/ccs/ccs-bridge.js';
import {
  setCredentials,
  getSessionByUserId,
  bindAgentId,
  clearAllSessions,
} from '../integrations/ccs/session-manager.js';
import { occupyLogin, resetLoginSessions } from '../shared/services/login-session.js';
import { callbackServantName } from '../modules/extension-binding/callback-lease.js';
afterEach(() => {
  clearAllSessions();
  resetLoginSessions();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
function fixture() {
  vi.stubEnv('OMNI_EXTENSION_BINDING_ENABLED', '1');
  const base = 'SMC-ICC.OmniAgent.AgentObj';
  initCcsBridge(vi.fn(), {
    vdnId: 2,
    servantObjName: base,
    servantHost: '127.0.0.1',
    servantPort: 9105,
    invokeTimeoutMs: 1000,
  });
  const old = occupyLogin({ userId: 10, deviceId: 'old-device' }).session;
  setCredentials(
    10,
    { workNO: 'seat10', extension: '1001', password: 'private', vdnId: 2 },
    old.sessionId,
  );
  bindAgentId(10, 55);
  const s = getSessionByUserId(10)!;
  s.loggedIn = true;
  s.bindingVersion = 7;
  s.status = 'idle';
  const current = occupyLogin({ userId: 10, deviceId: 'new-device' }).session;
  return { name: callbackServantName(base, old.sessionId, 7), current, s };
}
describe('safe cleanup of a previous SID before a current voice retry', () => {
  it('uses the correlated RPC result rather than a delayed old callback', async () => {
    const f = fixture();
    let finish: (value: unknown) => void = () => {};
    rpc.invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = logoutWithConfirmation(10, f.current.sessionId);
    await new Promise((resolve) => setTimeout(resolve, 0));
    handleOnAgentCallback('OnAgentLoggedOffAck', { Result: 0, AgentID: 55 }, f.name);
    expect(getSessionByUserId(10)).toBe(f.s);
    finish({ ret: 0, rsp: { err: 0 } });
    await expect(pending).resolves.toBeUndefined();
    expect(getSessionByUserId(10)).toBeUndefined();
  });
  it('keeps the old session when the atomic CCS guard rejects a call race', async () => {
    const f = fixture();
    rpc.invoke.mockResolvedValue({ ret: 0, rsp: { err: -409 } });
    await expect(logoutWithConfirmation(10, f.current.sessionId)).rejects.toThrow('签出');
    expect(getSessionByUserId(10)).toBe(f.s);
    expect(f.s.loggedIn).toBe(true);
  });
  it('keeps the old session when the correlated RPC times out', async () => {
    const f = fixture();
    rpc.invoke.mockRejectedValue(new Error('rpc timeout'));
    await expect(logoutWithConfirmation(10, f.current.sessionId)).rejects.toThrow('超时');
    expect(getSessionByUserId(10)).toBe(f.s);
  });
});
