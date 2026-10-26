import { describe, expect, it, afterEach, vi } from 'vitest';
import {
  bindAgentId,
  clearAllSessions,
  clearSession,
  expectedAckForDo,
  getOrCreateSession,
  getSessionByAgentId,
  getSessionByUserId,
  hydrateLoggedInSession,
  setCredentials,
} from '../integrations/ccs/session-manager.js';

describe('ccs session-manager', () => {
  afterEach(() => {
    clearSession(1);
    clearSession(2);
  });

  it('maps DoAgent* to OnAgent*Ack for invoke correlation', () => {
    expect(expectedAckForDo('DoAgentLoginEx')).toBe('OnAgentLoginExAck');
    expect(expectedAckForDo('DoAgentAnswerCall')).toBe('OnAgentAnswerCallAck');
    expect(expectedAckForDo('DoAgentSnatchCall')).toBe('OnAgentSnatchCallAck');
    expect(expectedAckForDo('DoAgentUnknown')).toBeUndefined();
  });

  it('isolates sessions per user and agentId binding', () => {
    setCredentials(1, { workNO: '1001', extension: '8001', password: 'secret' });
    bindAgentId(1, 42);

    const s1 = getSessionByUserId(1);
    expect(s1?.workNO).toBe('1001');
    expect(s1?.extension).toBe('8001');
    expect(s1?.agentId).toBe(42);
    expect(getSessionByAgentId(42)?.userId).toBe(1);

    const s2 = getOrCreateSession(2);
    expect(s2.userId).toBe(2);
    expect(s2.agentId).toBeNull();
    expect(getSessionByAgentId(42)?.userId).toBe(1);
  });

  it('clears pending state on session teardown', () => {
    const s = getOrCreateSession(1);
    const reject = vi.fn();
    s.pending.set('req-1', {
      reqId: 'req-1',
      method: 'DoAgentAnswerCall',
      ackMethod: 'OnAgentAnswerCallAck',
      resolve: () => {},
      reject,
      timer: setTimeout(() => {}, 60_000),
    });
    clearSession(1);
    expect(getSessionByUserId(1)).toBeUndefined();
    expect(reject).toHaveBeenCalled();
  });

  it('clearAllSessions drops every user', () => {
    setCredentials(1, { workNO: '1001', extension: '9001', password: 'x' });
    setCredentials(2, { workNO: '1002', extension: '9002', password: 'x' });
    expect(clearAllSessions()).toBe(2);
    expect(getSessionByUserId(1)).toBeUndefined();
    expect(getSessionByUserId(2)).toBeUndefined();
  });

  it('hydrateLoggedInSession restores mapping without password', () => {
    const s = hydrateLoggedInSession({
      userId: 1,
      workNO: '1001',
      extension: '9001',
      agentId: 10599,
      vdnId: 1,
      workMode: 'ready',
      agentStatus: 0,
      acdQueuingConfirmed: true,
    });
    expect(s.loggedIn).toBe(true);
    expect(s.password).toBe('');
    expect(getSessionByAgentId(10599)?.userId).toBe(1);
  });
});
