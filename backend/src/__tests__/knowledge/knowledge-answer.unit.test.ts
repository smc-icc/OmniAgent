import { describe, expect, it } from 'vitest';
import { groundedAnswer } from '../../modules/knowledge/knowledge.answer.js';

const hit = { documentId: 'doc', versionId: 'version', datasetId: 'dataset', chunkId: 'chunk', similarity: 0.9,
  content: '资料编号 ICCLOCAL20261011，金额 100.50 元，有效期 2026-10-11。' };
describe('exact-source answers', () => {
  it('preserves identifiers, amounts and dates verbatim', () => {
    const answer = groundedAnswer([hit]);
    expect(answer.answered).toBe(true);
    expect(answer.answer).toBe(`[1] ${hit.content}`);
    expect(answer.sources[0].content).toBe(hit.content);
  });
  it('refuses empty, missing-score and low-confidence evidence', () => {
    for (const hits of [[], [{ ...hit, similarity: 0.34 }], [{ ...hit, similarity: undefined }], [{ ...hit, content: ' ' }]]) {
      expect(groundedAnswer(hits).answered).toBe(false);
      expect(groundedAnswer(hits).sources).toEqual([]);
    }
  });
  it('limits the number of quoted chunks', () => {
    expect(groundedAnswer(Array.from({ length: 10 }, () => hit)).sources).toHaveLength(3);
  });
});
