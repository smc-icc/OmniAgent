import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canAutoAnswer,
  handleOnAgentCallback,
  initCcsBridge,
  maybeLogoutAfterCallEnd,
  onUiOfflineGraceElapsed,
  restoreSkillsAndStatus,
  signOutAllSkillsDueToUiOffline,
} from '../integrations/ccs/ccs-bridge.js';
import {
  bindAgentId,
  clearSession,
  getOrCreateSession,
} from '../integrations/ccs/session-manager.js';
import {
  getSignedInSkillIds,
  setGroupTree,
  setSignedInSkillIds,
} from '../shared/services/agent-skill-groups.js';

vi.mock('../plugins/db.js', () => ({ prisma: { conversations: { findMany: vi.fn().mockResolvedValue([]) }, conversation_participants: { upsert: vi.fn() } } }));
vi.mock('../integrations/ccs/ccs-client.js', () => ({
  invokeDoAgent: vi.fn().mockResolvedValue({ ret: 0, rsp: {} }),
}));
vi.mock('../shared/services/voice-session.js', () => ({
  persistVoiceFromCcs: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../integrations/ccs/acd-client.js', () => ({
  acdSetImsIdle: vi.fn().mockResolvedValue({ ret: 0 }),
  acdSignInGroups: vi.fn().mockResolvedValue(undefined),
  acdSignInSkills: vi.fn().mockResolvedValue(undefined),
  acdSignOutGroups: vi.fn().mockResolvedValue(undefined),
  acdSignOutSkills: vi.fn().mockResolvedValue(undefined),
  pushOmniAcdQueuing: vi.fn().mockResolvedValue(undefined),
  mediaModeNeedsCallerCount: vi.fn().mockReturnValue(true),
}));
vi.mock('../integrations/ccs/ims-acd.js', () => ({
  partitionAgentGroups: vi.fn(async (_agentId: number, groupIds: number[]) => ({
    tasIds: groupIds,
    imsOnlyIds: [],
    imsSkillIds: [],
  })),
  signInImsOnAcd: vi.fn().mockResolvedValue(undefined),
  signOutImsOnAcd: vi.fn().mockResolvedValue(undefined),
  signInImsAutoCheckIn: vi.fn().mockResolvedValue([]),
  signOutImsOnLogout: vi.fn().mockResolvedValue(undefined),
}));

import { invokeDoAgent } from '../integrations/ccs/ccs-client.js';
import { persistVoiceFromCcs } from '../shared/services/voice-session.js';

describe('ccs uiOffline skills / canAutoAnswer / deferred logout', () => {
  afterEach(() => {
    clearSession(1);
    clearSession(2);
    setSignedInSkillIds(1, []);
    setSignedInSkillIds(2, []);
    vi.mocked(invokeDoAgent).mockClear();
    vi.mocked(persistVoiceFromCcs).mockClear();
  });

  it('canAutoAnswer only requires loggedIn + autoAnswer + agentId', () => {
    const s = getOrCreateSession(1);
    bindAgentId(1, 10);
    s.loggedIn = true;
    s.autoAnswer = true;
    s.skillsToRestore = ['1', '2']; // 已签出技能也不禁代答
    expect(canAutoAnswer(s)).toBe(true);

    s.autoAnswer = false;
    expect(canAutoAnswer(s)).toBe(false);
  });

  it('signOutAllSkillsDueToUiOffline remembers ids+status and SignOutGroup', async () => {
    setGroupTree(1, [
      { id: 101, name: 'G1' },
      { id: 102, name: 'G2' },
    ]);
    setSignedInSkillIds(1, ['101', '102']);

    const s = getOrCreateSession(1);
    bindAgentId(1, 10);
    s.loggedIn = true;
    s.autoAnswer = true;
    s.status = 'idle';
    s.agentStatus = 0;

    signOutAllSkillsDueToUiOffline(1);

    expect(s.skillsToRestore).toEqual(['101', '102']);
    expect(s.agentStatusToRestore).toBe(0);
    expect(getSignedInSkillIds(1)).toEqual([]);
    expect(canAutoAnswer(s)).toBe(true);
    await vi.waitFor(() => {
      expect(invokeDoAgent).toHaveBeenCalledWith('DoAgentSignOutGroup', {
        AgentID: 10,
        agentGroupIDs: [101, 102],
        count: 2,
      });
    });
  });

  it('signOutAllSkillsDueToUiOffline also runs when idle (not only non-idle)', async () => {
    setGroupTree(1, [{ id: 1, name: 'G' }]);
    setSignedInSkillIds(1, ['1']);
    const s = getOrCreateSession(1);
    bindAgentId(1, 10);
    s.loggedIn = true;
    s.status = 'idle';
    s.agentStatus = 0;

    signOutAllSkillsDueToUiOffline(1);
    expect(s.skillsToRestore).toEqual(['1']);
    await vi.waitFor(() => {
      expect(invokeDoAgent).toHaveBeenCalledWith(
        'DoAgentSignOutGroup',
        expect.objectContaining({ AgentID: 10 }),
      );
    });
  });

  it('restoreSkillsAndStatus SignIn + SetIdle/SetBusy', async () => {
    setGroupTree(1, [
      { id: 101, name: 'G1' },
      { id: 102, name: 'G2' },
    ]);
    const s = getOrCreateSession(1);
    bindAgentId(1, 10);
    s.loggedIn = true;
    s.skillsToRestore = ['101', '102'];
    s.agentStatusToRestore = 1;
    s.pendingLogoutAfterCall = true;
    s.uiOfflineGraceElapsed = true;

    restoreSkillsAndStatus(1);

    expect(s.skillsToRestore).toEqual(['101', '102']);
    expect(s.pendingLogoutAfterCall).toBe(false);
    expect(s.uiOfflineGraceElapsed).toBe(false);

    // SignIn 成功后才清恢复列表、写缓存，再 SetBusy
    await vi.waitFor(() => {
      expect(invokeDoAgent).toHaveBeenCalledWith('DoAgentSignInGroup', {
        AgentID: 10,
        agentGroupIDs: [101, 102],
        count: 2,
      });
      expect(s.skillsToRestore).toBeNull();
      expect(getSignedInSkillIds(1)).toEqual(['101', '102']);
      expect(invokeDoAgent).toHaveBeenCalledWith('DoAgentSetBusy', { AgentID: 10 });
    });
  });

  it('restoreSkillsAndStatus does not write cache when SignIn fails', async () => {
    setGroupTree(1, [{ id: 101, name: 'G1' }]);
    setSignedInSkillIds(1, []);
    const s = getOrCreateSession(1);
    bindAgentId(1, 10);
    s.loggedIn = true;
    s.skillsToRestore = ['101'];
    s.agentStatusToRestore = 0;
    vi.mocked(invokeDoAgent).mockResolvedValueOnce({ ret: 0, rsp: { Result: 5 } });

    restoreSkillsAndStatus(1);

    await vi.waitFor(() => {
      expect(s.skillsRestoreInFlight).toBe(false);
    });
    expect(s.skillsToRestore).toEqual(['101']);
    expect(getSignedInSkillIds(1)).toEqual([]);
  });

  it('restoreSkillsAndStatus treats ACD Result=10 as signed in', async () => {
    setGroupTree(1, [{ id: 7, name: 'G7' }]);
    const s = getOrCreateSession(1);
    bindAgentId(1, 10);
    s.loggedIn = true;
    s.skillsToRestore = ['7'];
    s.agentStatusToRestore = 0;
    vi.mocked(invokeDoAgent).mockResolvedValueOnce({ ret: 0, rsp: { Result: 10 } });

    restoreSkillsAndStatus(1);

    await vi.waitFor(() => {
      expect(s.skillsToRestore).toBeNull();
      expect(getSignedInSkillIds(1)).toEqual(['7']);
    });
  });

  it('grace: idle → LoggedOff; in-call → pendingLogoutAfterCall', async () => {
    const s = getOrCreateSession(1);
    bindAgentId(1, 10);
    s.loggedIn = true;
    s.status = 'idle';

    expect(onUiOfflineGraceElapsed(1)).toBe('logged_off');
    await vi.waitFor(() => {
      expect(invokeDoAgent).toHaveBeenCalledWith('DoAgentLoggedOff', { AgentID: 10 });
    });

    clearSession(1);
    vi.mocked(invokeDoAgent).mockClear();

    const s2 = getOrCreateSession(1);
    bindAgentId(1, 11);
    s2.loggedIn = true;
    s2.status = 'talking';

    expect(onUiOfflineGraceElapsed(1)).toBe('deferred');
    expect(s2.pendingLogoutAfterCall).toBe(true);
    expect(s2.uiOfflineGraceElapsed).toBe(true);
    expect(invokeDoAgent).not.toHaveBeenCalledWith('DoAgentLoggedOff', expect.anything());
  });

  it('autoAnswer is agent config: same CallID still AnswerCall for each agent', async () => {
    initCcsBridge(vi.fn(), {
      vdnId: 1,
      servantObjName: 'SMC-ICC.OmniAgent.AgentObj',
      servantHost: '127.0.0.1',
      servantPort: 9105,
      invokeTimeoutMs: 30000,
    });
    const a = getOrCreateSession(1);
    bindAgentId(1, 10599);
    a.loggedIn = true;
    a.autoAnswer = true;
    const b = getOrCreateSession(2);
    bindAgentId(2, 10601);
    b.loggedIn = true;
    b.autoAnswer = true;

    handleOnAgentCallback('OnAgentOnCallOfferedEvt', { AgentID: 10599, CallID: 4 });
    handleOnAgentCallback('OnAgentOnCallOfferedEvt', { AgentID: 10601, CallID: 4 });

    await vi.waitFor(() => {
      expect(invokeDoAgent).toHaveBeenCalledWith('DoAgentAnswerCall', {
        AgentID: 10599,
        CallID: 4,
        CallIDType: 0,
      });
      expect(invokeDoAgent).toHaveBeenCalledWith('DoAgentAnswerCall', {
        AgentID: 10601,
        CallID: 4,
        CallIDType: 0,
      });
    });
  });

  it('autoAnswer does not pick up transfer/consult offers (CallOfferedType=7)', async () => {
    initCcsBridge(vi.fn(), {
      vdnId: 1,
      servantObjName: 'SMC-ICC.OmniAgent.AgentObj',
      servantHost: '127.0.0.1',
      servantPort: 9105,
      invokeTimeoutMs: 30000,
    });
    const b = getOrCreateSession(2);
    bindAgentId(2, 10601);
    b.loggedIn = true;
    b.autoAnswer = true;

    handleOnAgentCallback('OnAgentOnCallOfferedEvt', {
      AgentID: 10601,
      CallID: 10,
      CallOfferedType: 7,
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(invokeDoAgent).not.toHaveBeenCalledWith('DoAgentAnswerCall', expect.anything());
  });

  it('autoAnswer fires again after CallEnd for the same CallID', async () => {
    initCcsBridge(vi.fn(), {
      vdnId: 1,
      servantObjName: 'SMC-ICC.OmniAgent.AgentObj',
      servantHost: '127.0.0.1',
      servantPort: 9105,
      invokeTimeoutMs: 30000,
    });
    const a = getOrCreateSession(1);
    bindAgentId(1, 10599);
    a.loggedIn = true;
    a.autoAnswer = true;

    handleOnAgentCallback('OnAgentOnCallOfferedEvt', { AgentID: 10599, CallID: 4 });
    await vi.waitFor(() => {
      expect(invokeDoAgent).toHaveBeenCalledTimes(1);
    });
    handleOnAgentCallback('OnAgentOnCallEndEvt', { AgentID: 10599, CallID: 4 });
    handleOnAgentCallback('OnAgentOnCallOfferedEvt', { AgentID: 10599, CallID: 4 });
    await vi.waitFor(() => {
      expect(invokeDoAgent).toHaveBeenCalledTimes(2);
      expect(invokeDoAgent).toHaveBeenLastCalledWith('DoAgentAnswerCall', {
        AgentID: 10599,
        CallID: 4,
        CallIDType: 0,
      });
    });
  });

  it('CallEnd with pendingLogoutAfterCall → LoggedOff', async () => {
    const s = getOrCreateSession(1);
    bindAgentId(1, 10);
    s.loggedIn = true;
    s.status = 'idle';
    s.pendingLogoutAfterCall = true;

    maybeLogoutAfterCallEnd(1);
    await vi.waitFor(() => {
      expect(invokeDoAgent).toHaveBeenCalledWith('DoAgentLoggedOff', { AgentID: 10 });
    });
  });

  it('does not replace agent-to-agent Offered with SIP-leg inbound', () => {
    initCcsBridge(vi.fn(), {
      vdnId: 1,
      servantObjName: 'SMC-ICC.OmniAgent.AgentObj',
      servantHost: '127.0.0.1',
      servantPort: 9105,
      invokeTimeoutMs: 30000,
    });
    const a = getOrCreateSession(1);
    bindAgentId(1, 10599);
    a.loggedIn = true;
    a.autoAnswer = true;

    handleOnAgentCallback('OnAgentOnCallOfferedEvt', {
      AgentID: 10599,
      CallID: 4,
      CallOfferedType: 2,
      CallData: 'agent_caller',
      Caller: '1001',
      Called: '1002',
    });
    vi.mocked(persistVoiceFromCcs).mockClear();
    vi.mocked(invokeDoAgent).mockClear();

    handleOnAgentCallback('OnAgentOnCallOfferedEvt', {
      AgentID: 10599,
      CallID: 9,
      CallOfferedType: 0,
      Caller: '9001',
      Called: '9002',
    });

    expect(a.currentCall?.CallOfferedType).toBe(2);
    expect(a.currentCall?.Called).toBe('1002');
    expect(persistVoiceFromCcs).not.toHaveBeenCalled();
    expect(invokeDoAgent).not.toHaveBeenCalled();
  });
});
