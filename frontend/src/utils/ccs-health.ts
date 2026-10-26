/** 本页签已话务签入。Omni/CCS 重启后内存会话没了，靠它把前端踢回登录页。 */
export const CCS_IN_KEY = 'omni_ccs_in'
/** 本页签话务签入时记下的 CCS 世代，用来识别「断过又起来了」。 */
export const CCS_GEN_KEY = 'omni_ccs_gen'
export const CCS_BOOT_KEY = 'omni_ccs_boot'

function storageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    /* 隐私模式等 */
  }
}

function storageRemove(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function markCcsSignedIn(): void {
  storageSet(CCS_IN_KEY, '1')
}

export function clearCcsSignInMark(): void {
  storageRemove(CCS_IN_KEY)
}

export function isOnLoginPage(): boolean {
  if (typeof window === 'undefined') return false
  const path = window.location.pathname.replace(/\/+$/, '')
  return path === '/login' || path.endsWith('/login')
}

/** 本页签是否认定「曾经话务签入、且不是主动签出」。 */
export function tabHadCcsSignIn(opts?: {
  agentId?: number | null
  callActive?: boolean
}): boolean {
  if (opts?.agentId) return true
  if (opts?.callActive) return true
  if (storageGet(CCS_IN_KEY) === '1') return true
  const gen = storageGet(CCS_GEN_KEY)
  return gen != null && gen !== ''
}

/** 服务端明确没签入时才踢；登录页 / 从未签入 / 主动签出都不踢。 */
export function shouldKickMissingCcsSession(
  hadCcs: boolean,
  onLoginPage: boolean,
  loggedIn: boolean | undefined,
): boolean {
  if (onLoginPage) return false
  if (!hadCcs) return false
  return loggedIn === false
}

export type CcsHealthPayload = {
  up: boolean
  generation: number
  bootId?: string
  /** 仅连上时按连接带；全员脉冲没有这个字段。 */
  logged_in?: boolean
}

let lastHealth: CcsHealthPayload | null = null

export function noteCcsHealth(payload: CcsHealthPayload): void {
  lastHealth = payload
}

export function lastCcsHealth(): CcsHealthPayload | null {
  return lastHealth
}

export function readSignedCcsHealth(): { gen: number | null; boot: string } {
  const raw = storageGet(CCS_GEN_KEY)
  const gen = raw != null && raw !== '' ? Number(raw) : Number.NaN
  return {
    gen: Number.isFinite(gen) ? gen : null,
    boot: storageGet(CCS_BOOT_KEY) ?? '',
  }
}

export function rememberCcsHealth(payload: CcsHealthPayload): void {
  noteCcsHealth(payload)
  storageSet(CCS_GEN_KEY, String(payload.generation))
  if (payload.bootId) storageSet(CCS_BOOT_KEY, payload.bootId)
}

export function clearCcsHealthMarks(): void {
  lastHealth = null
  storageRemove(CCS_GEN_KEY)
  storageRemove(CCS_BOOT_KEY)
}

export function decideCcsHealthAction(
  hadCcs: boolean,
  signed: { gen: number | null; boot: string },
  payload: CcsHealthPayload,
): 'kick' | 'baseline' | 'keep' {
  if (!hadCcs) return 'keep'
  if (payload.logged_in === false) return 'kick'
  if (!payload.up) return 'kick'
  if (signed.gen != null && payload.generation > signed.gen) return 'kick'
  if (signed.boot && payload.bootId && payload.bootId !== signed.boot) return 'kick'
  if (signed.gen == null) return 'baseline'
  return 'keep'
}
