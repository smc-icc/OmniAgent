/** Derive ITR observe WS URL. Business RPC stays on TARS/HTTP. */
export function deriveItrWsUrl(httpBase: string, explicit?: string): string {
  const given = (explicit || '').trim();
  if (given) return given;
  const u = new URL((httpBase || 'http://127.0.0.1:9400').replace(/\/$/, ''));
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/ws/observe';
  u.search = '';
  u.hash = '';
  return u.toString();
}
