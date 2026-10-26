import { describe, it, expect } from 'vitest';
import {
  callbackServantName,
  callbackMatches,
} from '../modules/extension-binding/callback-lease.js';
describe('CCS callback SID and binding lease', () => {
  const base = 'SMC-ICC.OmniAgent.AgentObj',
    sid = 'a'.repeat(32),
    other = 'b'.repeat(32);
  it('puts the SID and binding version into the callback object identity', () => {
    expect(callbackServantName(base, sid, 7)).toBe(base + '.sid_' + sid + '.v_7');
  });
  it('accepts only the current SID and version even if WorkNO and AgentID were reused', () => {
    expect(callbackMatches(callbackServantName(base, sid, 7), base, sid, 7)).toBe(true);
    expect(callbackMatches(callbackServantName(base, other, 7), base, sid, 7)).toBe(false);
    expect(callbackMatches(callbackServantName(base, sid, 6), base, sid, 7)).toBe(false);
    expect(callbackMatches(base, base, sid, 7)).toBe(false);
  });
});
