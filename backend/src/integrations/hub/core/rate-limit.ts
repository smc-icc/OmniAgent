/** 令牌桶。perSec=0 表示不限速。 */
export function createTokenBucket(perSec: number): { take(n?: number): Promise<void> } {
  if (!perSec || perSec <= 0) {
    return { async take() { /* unlimited */ } };
  }
  let tokens = perSec;
  let last = Date.now();
  return {
    async take(n = 1) {
      while (true) {
        const now = Date.now();
        const elapsed = (now - last) / 1000;
        last = now;
        tokens = Math.min(perSec, tokens + elapsed * perSec);
        if (tokens >= n) {
          tokens -= n;
          return;
        }
        const waitMs = Math.ceil(((n - tokens) / perSec) * 1000);
        await new Promise((r) => setTimeout(r, Math.max(1, waitMs)));
      }
    },
  };
}
