/** The callback object name is carried by the TARS request, fencing reused WorkNO/AgentID values. */
export function callbackServantName(base: string, sid: string, version: number): string {
  if (!/^[a-f0-9]{32}$/.test(sid) || !Number.isSafeInteger(version) || version < 0)
    throw new Error('Invalid voice callback lease');
  return base + '.sid_' + sid + '.v_' + version;
}
export function callbackMatches(
  raw: string | undefined,
  base: string,
  sid: string | undefined,
  version: number | undefined,
): boolean {
  if (!sid || version == null) return false;
  try {
    return raw === callbackServantName(base, sid, version);
  } catch {
    return false;
  }
}
