import { describe, expect, it } from 'vitest';
import { mergeRankedHits, partitionDocumentIds } from '../../modules/knowledge/knowledge.retrieval.js';

describe('knowledge retrieval', () => {
  it('partitions an authorization set into batches of at most 500', () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `d-${i}`);
    const batches = partitionDocumentIds(ids);
    expect(batches.map((batch) => batch.length)).toEqual([500, 500, 1]);
  });

  it('fuses rankings and deduplicates the same chunk', () => {
    const result = mergeRankedHits([
      [{ chunkId: 'a', documentId: 'd1', content: 'A' }, { chunkId: 'b', documentId: 'd2', content: 'B' }],
      [{ chunkId: 'b', documentId: 'd2', content: 'B' }, { chunkId: 'c', documentId: 'd3', content: 'C' }],
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]?.chunkId).toBe('b');
  });
});
