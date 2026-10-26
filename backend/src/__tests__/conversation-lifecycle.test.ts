import { describe, expect, it } from 'vitest';
import { mergeAttrs, readLifecycle } from '../shared/services/conversation-attrs.js';

describe('conversation lifecycle attrs', () => {
  it('defaults to active', () => {
    expect(readLifecycle(undefined)).toBe('active');
    expect(readLifecycle({})).toBe('active');
  });

  it('reads ended', () => {
    expect(readLifecycle({ omni_lifecycle: 'ended' })).toBe('ended');
  });

  it('merges and deletes null keys', () => {
    const next = mergeAttrs({ omni_lifecycle: 'ended', session_ended_at: 'x', caller: '1' }, {
      omni_lifecycle: 'active',
      session_ended_at: null,
    });
    expect(next.omni_lifecycle).toBe('active');
    expect(next.session_ended_at).toBeUndefined();
    expect(next.caller).toBe('1');
  });
});
