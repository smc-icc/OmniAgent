function base64url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Kept in memory until exchange/binding; never in a callback URI or storage. */
export async function createAuthorizationProof(): Promise<{ verifier: string; challenge: string }> {
  if (!crypto.subtle) throw new Error('当前系统无法建立安全授权事务')
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const bytes = Uint8Array.from(verifier, character => character.charCodeAt(0))
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
  return { verifier, challenge }
}

export type AuthorizationResult = { state: string; code: string } | { state: string; ticket: string }
export function validateAuthorizationResult(raw: unknown, state: string): AuthorizationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('授权返回结果无效')
  const value = raw as Record<string, unknown>
  if (value.state !== state || !Object.keys(value).every(key => ['state', 'code', 'ticket', 'cancelled'].includes(key))) {
    throw new Error('授权返回结果不属于当前登录事务')
  }
  if (value.cancelled === true) throw new Error('授权已取消')
  if (typeof value.code === 'string' && value.code.length > 0 && value.code.length <= 4096 && value.ticket == null) {
    return { state, code: value.code }
  }
  if (typeof value.ticket === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.ticket) && value.code == null) {
    return { state, ticket: value.ticket }
  }
  throw new Error('授权返回结果无效')
}
