/** conv → inbox → VDN default → env */
export function pickItrFlowId(parts: {
  conv?: number;
  inbox?: number;
  vdn?: number;
  envDefault?: number;
}): number {
  const conv = Number(parts.conv) || 0;
  if (conv > 0) return conv;
  const inbox = Number(parts.inbox) || 0;
  if (inbox > 0) return inbox;
  const vdn = Number(parts.vdn) || 0;
  if (vdn > 0) return vdn;
  return Number(parts.envDefault) || 1001;
}
