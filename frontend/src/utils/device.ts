const KEY = 'omni_device_id'

/** 每页签独立设备 ID，便于同浏览器多页签登录不同账号 */
export function getOmniDeviceId(): string {
  try {
    const existing = sessionStorage.getItem(KEY)?.trim()
    if (existing && existing.length >= 8) return existing
    const id = crypto.randomUUID?.() ?? `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`
    sessionStorage.setItem(KEY, id)
    // 清除旧的跨页签共享 id，避免同终端互踢误伤其它账号页签
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* ignore */
    }
    return id
  } catch {
    return `dev-${Date.now()}`
  }
}
