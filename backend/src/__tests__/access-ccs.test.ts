import { describe, it, expect } from 'vitest';
import { bindCcsIdentity, ccsPermission } from '../modules/access/access.ccs.js';
describe('browser CCS authorization', () => {
  const identity = { workNO: '1001', vdnId: 1, agentId: 7 };
  it('denies infrastructure RPCs and separates supervisor powers', () => {
    expect(ccsPermission('DoReloadVdnConfig')).toBeUndefined();
    expect(ccsPermission('DoAgentForceLogOut')).toBe('monitor.force');
    expect(ccsPermission('DoAgentTransferAgent')).toBe('conversation.transfer');
  });
  it('rejects actor impersonation and cross-VDN login', () => {
    expect(() => bindCcsIdentity({ workNO: '1002' }, identity, true)).toThrow();
    expect(() => bindCcsIdentity({ VDNID: 2 }, identity, true)).toThrow();
    expect(() => bindCcsIdentity({ AgentID: 8 }, identity, false)).toThrow();
  });
  it('uses the server identity and callback endpoint', () => {
    const p: Record<string, unknown> = { AgentPrxEndpoint: 'attacker' };
    bindCcsIdentity(p, identity, true);
    expect(p).toEqual({ workNO: '1001', VDNID: 1, vdnId: 1 });
  });
});
