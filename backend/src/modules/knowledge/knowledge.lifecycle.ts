export interface VersionCandidate {
  readonly id: string;
  readonly indexState: string;
  readonly reviewState: string;
}

export function selectActiveVersion(currentId: string | null, candidate: VersionCandidate): string | null {
  return candidate.indexState === 'ready' && candidate.reviewState === 'approved' ? candidate.id : currentId;
}

export function buildSyncDedupeKey(operation: string, documentId: string, versionId?: string): string {
  if (!operation.trim() || !documentId.trim()) throw new Error('invalid_sync_key');
  return [operation, documentId, versionId].filter((value): value is string => Boolean(value?.trim())).join(':');
}

export function isLeaseClaimable(lockedUntil: Date | null, now = new Date()): boolean {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return false;
  return lockedUntil === null || lockedUntil.getTime() <= now.getTime();
}
