import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleOnAgentCallback, initCcsBridge } from '../integrations/ccs/ccs-bridge.js';
import {
  clearSession,
  getSessionByUserId,
  setCredentials,
} from '../integrations/ccs/session-manager.js';

const bridgeOpts = {
  vdnId: 1,
  servantObjName: 'SMC-ICC.OmniAgent.AgentObj',
  servantHost: '192.168.3.10',
  servantPort: 9105,
  invokeTimeoutMs: 30000,
};

describe('ccs-bridge login ack', () => {
  afterEach(() => {
    clearSession(1);
  });

  it('resolves pending DoAgentLoginEx when OnAgentLoginExAck arrives (match by workNO)', async () => {
    initCcsBridge(vi.fn(), bridgeOpts);
    setCredentials(1, { workNO: '1001', extension: '990001', password: 'demo123456' });
    const session = getSessionByUserId(1)!;

    const ackPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 5000);
      session.pending.set('req-login', {
        reqId: 'req-login',
        method: 'DoAgentLoginEx',
        ackMethod: 'OnAgentLoginExAck',
        resolve,
        reject,
        timer,
      });
    });

    handleOnAgentCallback('OnAgentLoginExAck', {
      workNO: '1001',
      Result: 0,
      AgentID: 99,
    });

    const ack = await ackPromise;
    expect(ack.AgentID).toBe(99);
    expect(session.loggedIn).toBe(true);
    expect(session.agentId).toBe(99);
    expect(session.pending.size).toBe(0);
  });

  it('resolves pending login with error Result from OnAgentLoginExAck', async () => {
    initCcsBridge(vi.fn(), bridgeOpts);
    setCredentials(1, { workNO: '1001', extension: '990001', password: 'demo123456' });
    const session = getSessionByUserId(1)!;

    const ackPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 5000);
      session.pending.set('req-login', {
        reqId: 'req-login',
        method: 'DoAgentLoginEx',
        ackMethod: 'OnAgentLoginExAck',
        resolve,
        reject,
        timer,
      });
    });

    handleOnAgentCallback('OnAgentLoginExAck', {
      workNO: '1001',
      Result: -2,
      AgentID: 0,
    });

    const ack = await ackPromise;
    expect(ack.Result).toBe(-2);
    expect(session.loggedIn).toBe(false);
  });
});
