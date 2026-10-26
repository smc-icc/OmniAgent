/** 登录态按页签隔离（sessionStorage），同浏览器可多页签登录不同账号 */
const TOKEN_KEY = 'omni_token'

export function readOmniToken(): string {
  try {
    const s = sessionStorage.getItem(TOKEN_KEY)?.trim()
    if (s) return s
  } catch {
    /* ignore */
  }
  // 不再回退 localStorage：否则第二页签会自动带上同一账号进工作台
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
  return ''
}

export function writeOmniToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

export function clearOmniToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}
