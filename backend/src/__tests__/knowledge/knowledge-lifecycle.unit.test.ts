import { describe, expect, it } from 'vitest';
import { buildSyncDedupeKey, isLeaseClaimable, selectActiveVersion } from '../../modules/knowledge/knowledge.lifecycle.js';

describe('knowledge lifecycle', () => {
  it('keeps the current version when the candidate is not ready and approved', () => {
    expect(selectActiveVersion('v1', { id: 'v2', indexState: 'failed', reviewState: 'approved' })).toBe('v1');
    expect(selectActiveVersion('v1', { id: 'v2', indexState: 'ready', reviewState: 'approved' })).toBe('v2');
  });

  it('builds a stable dedupe key from operation and resource', () => {
    expect(buildSyncDedupeKey('publish', 'doc-1', 'v2')).toBe('publish:doc-1:v2');
    expect(buildSyncDedupeKey('delete', 'doc-1')).toBe('delete:doc-1');
  });

  it('allows an unleased job or an expired lease to be claimed', () => {
    const now = new Date('2026-09-16T00:00:00Z');
    expect(isLeaseClaimable(null, now)).toBe(true);
    expect(isLeaseClaimable(new Date('2026-09-15T23:59:59Z'), now)).toBe(true);
    expect(isLeaseClaimable(new Date('2026-09-16T00:00:01Z'), now)).toBe(false);
  });
});
