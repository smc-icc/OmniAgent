import { describe, expect, it } from 'vitest';
import {
  formatTalkDuration,
  omniEventLabel,
  omniMethodLabel,
  omniReleaseLabel,
  omniTalkSec,
  omniWaitSec,
} from '../shared/services/omni-session-labels.js';

describe('omni session labels', () => {
  it('maps method / release / event', () => {
    expect(omniMethodLabel('snatch')).toBe('抢接');
    expect(omniMethodLabel('queue_take')).toBe('排队接');
    expect(omniReleaseLabel('force_end')).toBe('强制结束');
    expect(omniReleaseLabel('')).toBe('—');
    expect(omniEventLabel('barge')).toBe('强插');
  });

  it('computes wait and talk seconds', () => {
    const q = new Date('2026-09-05T03:00:00Z');
    const a = new Date('2026-09-05T03:00:15Z');
    const e = new Date('2026-09-05T03:01:15Z');
    expect(omniWaitSec(q, a)).toBe(15);
    expect(omniTalkSec(a, e)).toBe(60);
    expect(omniTalkSec(a, e, 12)).toBe(12);
    expect(formatTalkDuration(75)).toBe('1:15');
  });
});
