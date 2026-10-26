/** FNV-1a 32-bit → 分片。同一 key 永远落到同一分区。 */
export function hashMod(key: string, n: number): number {
  const count = Math.max(1, n | 0);
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % count;
}
