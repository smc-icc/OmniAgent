export interface RetrievalHit {
  readonly chunkId: string;
  readonly documentId: string;
  readonly content: string;
  readonly [key: string]: unknown;
}

export function partitionDocumentIds(ids: readonly string[], size = 500): string[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('invalid_batch_size');
  if (ids.some((id) => !id.trim())) throw new Error('invalid_document_id');
  const result: string[][] = [];
  for (let i = 0; i < ids.length; i += size) result.push([...ids.slice(i, i + size)]);
  return result;
}

export function mergeRankedHits(groups: readonly (readonly RetrievalHit[])[], limit = 50): RetrievalHit[] {
  const scores = new Map<string, { score: number; hit: RetrievalHit }>();
  groups.forEach((group) => group.forEach((hit, index) => {
    if (!hit.chunkId || !hit.documentId) throw new Error('invalid_retrieval_hit');
    const score = 1 / (60 + index + 1);
    const current = scores.get(hit.chunkId);
    scores.set(hit.chunkId, { score: (current?.score ?? 0) + score, hit: current?.hit ?? hit });
  }));
  return [...scores.values()]
    .sort((a, b) => b.score - a.score || a.hit.chunkId.localeCompare(b.hit.chunkId))
    .slice(0, limit)
    .map(({ hit }) => hit);
}
