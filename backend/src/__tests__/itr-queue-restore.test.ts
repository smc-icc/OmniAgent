import { describe, expect, it } from 'vitest';
import { queueEntryFromAttrs } from '../modules/itr/itr-queue.js';

describe('queueEntryFromAttrs', () => {
  it('only restores rows marked acd_queued', () => {
    expect(queueEntryFromAttrs(34, { acd_request_id: 9, acd_vdn_id: 1 })).toBeNull();
    const row = queueEntryFromAttrs(34, {
      acd_queued: true,
      acd_request_id: 9,
      acd_vdn_id: 1,
      itr_connect_tip: 'hello',
      acd_skill_id: 12,
    });
    expect(row).toMatchObject({
      conversationId: 34,
      requestId: 9,
      vdnId: 1,
      skillId: 12,
      connectTip: 'hello',
    });
  });
});
