export type NativeShell = 'web' | 'tauri' | 'capacitor' | 'harmonyos'

/** 后端据此区分在线语义：mobile 切后台不等于坐席离开。 */
export type ClientKind = 'web' | 'mobile' | 'desktop'

declare global {
  interface Window {
    __OMNI_NATIVE_SHELL__?: NativeShell
    __OMNI_API_BASE__?: string
  }
}

export function getNativeShell(): NativeShell {
  if (window.__OMNI_NATIVE_SHELL__) return window.__OMNI_NATIVE_SHELL__
  const capacitor = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor
  if (capacitor?.getPlatform?.() === 'android' || capacitor?.getPlatform?.() === 'ios') return 'capacitor'
  if ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) return 'tauri'
  if (window.location.protocol === 'capacitor:' || window.location.protocol === 'ionic:') {
    return 'capacitor'
  }
  return 'web'
}

export function isNativeApp(): boolean {
  return getNativeShell() !== 'web'
}

export function getClientKind(): ClientKind {
  try {
    const forced = localStorage.getItem('omni_client_kind')?.trim()
    if (forced === 'mobile' || forced === 'desktop' || forced === 'web') return forced
  } catch {
    /* ignore */
  }
  const shell = getNativeShell()
  if (shell === 'capacitor' || shell === 'harmonyos') return 'mobile'
  if (shell === 'tauri') return 'desktop'
  return 'web'
}

export function isMobileClient(): boolean {
  return getClientKind() === 'mobile'
}

/** 移动端布局判定：原生移动壳，或窄视口（便于浏览器调试移动 UI）。 */
export function useMobileLayout(): boolean {
  if (isMobileClient()) return true
  return typeof window !== 'undefined' && window.innerWidth <= 768
}

export function resolveApiBaseUrl(): string {
  const fromWindow = window.__OMNI_API_BASE__?.replace(/\/$/, '')
  if (fromWindow) return fromWindow

  const fromEnv = import.meta.env.VITE_API_BASE?.replace(/\/$/, '')
  if (fromEnv) return fromEnv

  if (import.meta.env.VITE_NATIVE_APP === 'true' || isNativeApp()) {
    try {
      const stored = localStorage.getItem('omni_api_base')?.replace(/\/$/, '')
      if (stored) return stored
    } catch {
      /* ignore */
    }
    return 'http://127.0.0.1:3001'
  }

  return ''
}

export function resolveSocketUrl(): string {
  const fromEnv = import.meta.env.VITE_SOCKET_URL?.replace(/\/$/, '')
  if (fromEnv) return fromEnv
  const apiBase = resolveApiBaseUrl()
  if (apiBase) return apiBase
  // Packaged web UI proxies Socket.IO through its own nginx origin. A remote
  // browser must not connect to localhost (the seat's machine, not the server).
  // Keep the existing direct-backend default for Vite development.
  return import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin
}
