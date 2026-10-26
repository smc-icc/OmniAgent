/** 与 CCS `CCS_OUTBOX_VDNS`、IVR `IVR_OUTBOX_VDNS` 同一约定：空=全部；有名单则只放行名单内。 */
export function parseVdnAllowlist(raw: string | undefined | null): number[] | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const ids: number[] = [];
  for (const part of s.split(/[,;\s]+/)) {
    if (!part) continue;
    const n = Number(part);
    if (Number.isInteger(n) && n >= 0) ids.push(n);
  }
  return ids;
}

export function vdnAllowed(vdnId: number, raw: string | undefined | null): boolean {
  const list = parseVdnAllowlist(raw);
  if (list == null) return true;
  if (!list.length) return false;
  return list.includes(vdnId);
}
