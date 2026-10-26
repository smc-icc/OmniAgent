export type OmniLifecycle = 'active' | 'ended';

export function asAttrMap(attrs: unknown): Record<string, unknown> {
  return attrs && typeof attrs === 'object' && !Array.isArray(attrs)
    ? { ...(attrs as Record<string, unknown>) }
    : {};
}

export function mergeAttrs(current: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const next = asAttrMap(current);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) {
      delete next[k];
      continue;
    }
    next[k] = v;
  }
  return next;
}

export function readLifecycle(attrs: unknown): OmniLifecycle {
  return asAttrMap(attrs).omni_lifecycle === 'ended' ? 'ended' : 'active';
}
