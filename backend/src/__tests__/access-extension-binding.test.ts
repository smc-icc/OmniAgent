import { describe, expect, it, vi } from 'vitest';
import {
  assertBindingChange,
  assertVoiceIdle,
  bindingAction,
  voiceState,
} from '../modules/extension-binding/policy.js';

describe('extension binding policy', () => {
  it('requires both direct permissions for self replacement', () => {
    expect(() =>
      assertBindingChange({
        old: '1001',
        target: '1002',
        version: 2,
        expectedVersion: 2,
        permissions: ['extension.bind_self'],
        self: true,
      }),
    ).toThrow('解绑');
    expect(() =>
      assertBindingChange({
        old: '1001',
        target: '1002',
        version: 2,
        expectedVersion: 2,
        permissions: ['extension.bind_self', 'extension.unbind_self'],
        self: true,
      }),
    ).not.toThrow();
  });
  it('rejects stale versions before side effects', () => {
    expect(() =>
      assertBindingChange({
        old: '1001',
        target: '',
        version: 3,
        expectedVersion: 2,
        permissions: ['extension.assign'],
        self: false,
      }),
    ).toThrow('版本');
  });
  it.each(['ringing', 'talking', 'hold'])('blocks changes during %s', (status) => {
    expect(() => assertVoiceIdle({ status, currentCall: null })).toThrow('通话');
  });
  it('blocks any active call, even when status is idle', () => {
    expect(() => assertVoiceIdle({ status: 'idle', currentCall: { CallID: 88 } })).toThrow('通话');
    expect(() => assertVoiceIdle(undefined)).not.toThrow();
  });
  it('distinguishes unbound and explicitly signed-out identity sessions', () => {
    expect(voiceState('', { voiceSessionExpected: true })).toBe('unbound');
    expect(voiceState('1001', { explicitlySignedOut: true })).toBe('signed_out');
    expect(voiceState('1001', { failed: true })).toBe('failed');
    expect(voiceState('1001', { signedIn: true })).toBe('signed_in');
    expect(voiceState('1001', {})).toBe('signing_in');
  });
  it('classifies bind, unbind and replacement', () => {
    expect(bindingAction('', '1001')).toBe('bind');
    expect(bindingAction('1001', '')).toBe('unbind');
    expect(bindingAction('1001', '1002')).toBe('replace');
  });
});

import { runBindingStages } from '../modules/extension-binding/execution.js';
describe('durable binding execution', () => {
  function fixture(phase = 'reserved') {
    const op = { phase, old_extension: '1001', target_extension: '1002' };
    const hooks = {
      authorize: vi.fn(),
      drain: vi.fn(),
      signOut: vi.fn(),
      revoke: vi.fn(),
      commit: vi.fn(),
      notify: vi.fn(),
      save: vi.fn(async (p: string) => {
        op.phase = p;
      }),
    };
    return { op, hooks };
  }
  it('never commits or releases a number when sign-out fails', async () => {
    const { op, hooks } = fixture();
    hooks.signOut.mockRejectedValue(new Error('CCS timeout'));
    await expect(runBindingStages(op, hooks)).rejects.toThrow('CCS timeout');
    expect(op.phase).toBe('draining');
    expect(hooks.commit).not.toHaveBeenCalled();
    expect(hooks.revoke).not.toHaveBeenCalled();
  });
  it('restarts at the saved stage after process failure', async () => {
    const { op, hooks } = fixture('signed_out');
    await runBindingStages(op, hooks);
    expect(hooks.signOut).not.toHaveBeenCalled();
    expect(hooks.drain).not.toHaveBeenCalled();
    expect(hooks.revoke).toHaveBeenCalledOnce();
    expect(hooks.commit).toHaveBeenCalledOnce();
    expect(op.phase).toBe('done');
  });
  it('does not repeat a committed database change on recovery', async () => {
    const { op, hooks } = fixture('committed');
    await runBindingStages(op, hooks);
    expect(hooks.commit).not.toHaveBeenCalled();
    expect(hooks.notify).toHaveBeenCalledOnce();
  });
  it('rechecks authorization before side effects and commit', async () => {
    const { op, hooks } = fixture();
    hooks.authorize.mockRejectedValueOnce(new Error('revoked'));
    await expect(runBindingStages(op, hooks)).rejects.toThrow('revoked');
    expect(hooks.drain).not.toHaveBeenCalled();
  });
});

import {ownedRevocationNumbers} from '../modules/extension-binding/policy.js';
describe('SIP revocation scope',()=>{
  it('repairs a foreign VDN reference without revoking that VDN registration',()=>{expect(ownedRevocationNumbers('3001','1001',2,[{num:'3001',vdn:3},{num:'1001',vdn:2}])).toEqual(['1001'])});
  it('rejects revocation of a foreign target and allows orphan cleanup',()=>{expect(()=>ownedRevocationNumbers('','3001',2,[{num:'3001',vdn:3}])).toThrow('VDN');expect(ownedRevocationNumbers('9999','',2,[])).toEqual(['9999'])});
});
