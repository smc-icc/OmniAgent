/** Resolve CCS workNO from OmniAgent user record (maps Chatwoot uid → ICC WorkNO). */
export function resolveCcsWorkNo(
  user: { id: number; uid: string | null },
  workField: string,
): string {
  // Only a DB-loaded uid is supplied here; authorization still checks the durable source binding.
  const managed = /^conf-vdn:[1-9]\d*:[1-9]\d*:(.+)$/.exec(user.uid ?? '');
  if (managed) { try { return decodeURIComponent(managed[1]!); } catch { return ''; } }
  const raw =
    workField === 'uid'
      ? user.uid
      : String((user as Record<string, unknown>)[workField] ?? user.uid ?? '');
  const trimmed = String(raw ?? '').trim();
  return trimmed || String(user.id);
}

export function pickNonEmptyWorkNo(...candidates: Array<string | undefined | null>): string {
  for (const c of candidates) {
    const t = String(c ?? '').trim();
    if (t) return t;
  }
  return '';
}
