import { describe, expect, it } from 'vitest';
import { isImsQueueRow } from '../integrations/ccs/ims-queue-filter.js';

describe('isImsQueueRow', () => {
  it('keeps ACD rows whose skill is IMS', () => {
    expect(isImsQueueRow(12, 99, new Set([12, 15]), new Set())).toBe(true);
  });

  it('drops TAS skill rows not in Omni queue memory', () => {
    expect(isImsQueueRow(1, 88, new Set([12]), new Set())).toBe(false);
  });

  it('keeps rows whose LogicNO is an Omni queued request/conversation', () => {
    expect(isImsQueueRow(0, 15, new Set([12]), new Set([15]))).toBe(true);
  });
});
