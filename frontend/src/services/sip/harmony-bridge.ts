/**
 * 鸿蒙 ArkWeb 的 JSBridge 客户端。
 *
 * ArkWeb 的 javaScriptProxy 只能传字符串，所以约定：所有方法同步返回
 * `{"ok":true,"data":{...}}` 形式的 JSON 字符串；原生事件通过
 * window.__omniHarmonyEvent(name, jsonPayload) 反向投递。
 */

interface HarmonyNative {
  sipAvailable(): string
  sipRegister(configJson: string): string
  sipUnregister(registrationId?: string): string
  sipRegistrationState(): string
  sipCall(number: string, video: boolean): string
  sipAnswer(callId: string, video: boolean): string
  sipSetVideo(callId: string, on: boolean): string
  sipShowVideo(callId: string): string
  sipRequestVideoPermission(requestId: string): string
  sipHangup(callId: string): string
  sipHold(callId: string, on: boolean): string
  sipMute(on: boolean): string
  sipSendDtmf(digits: string, callId: string): string
  sipSetAudioRoute(route: string): string
  sipCalls(): string
  pushToken(): string
  keepAlive(on: boolean): string
}

interface BridgeResult<T> {
  ok: boolean
  data?: T
  error?: string
}

type EventHandler = (payload: unknown) => void

declare global {
  interface Window {
    OmniHarmonyNative?: HarmonyNative
    __omniHarmonyEvent?: (name: string, payloadJson: string) => void
  }
}

const handlers = new Map<string, Set<EventHandler>>()
let wired = false

export function harmonyNative(): HarmonyNative | null {
  const native = window.OmniHarmonyNative
  return native && typeof native.sipAvailable === 'function' ? native : null
}

/** ArkTS 侧调这个函数投递事件；只挂一次 */
function wireEventSink(): void {
  if (wired) return
  wired = true
  window.__omniHarmonyEvent = (name: string, payloadJson: string) => {
    let payload: unknown = {}
    try {
      payload = JSON.parse(payloadJson)
    } catch {
      /* 原生侧已经保证是 JSON，解析失败就当空负载 */
    }
    handlers.get(name)?.forEach((fn) => fn(payload))
  }
}

export function onHarmonyEvent(name: string, handler: EventHandler): () => void {
  wireEventSink()
  if (!handlers.has(name)) handlers.set(name, new Set())
  handlers.get(name)!.add(handler)
  return () => handlers.get(name)?.delete(handler)
}

/** 同步调用并解包；ok=false 时抛出原生给的错误文案 */
export function callHarmony<T>(fn: () => string): T {
  const raw = fn()
  const result = JSON.parse(raw) as BridgeResult<T>
  if (!result.ok) throw new Error(result.error || '鸿蒙原生调用失败')
  return (result.data ?? {}) as T
}

export function harmonySipAvailable(): boolean {
  const native = harmonyNative()
  if (!native) return false
  try {
    return callHarmony<{ available: boolean }>(() => native.sipAvailable()).available === true
  } catch {
    return false
  }
}

let permissionSequence = 0

export function requestHarmonyVideoPermission(): Promise<boolean> {
  const native = harmonyNative()
  if (!native || typeof native.sipRequestVideoPermission !== 'function') return Promise.resolve(false)
  return new Promise((resolve, reject) => {
    const id = `video-${Date.now()}-${++permissionSequence}`
    const timer = setTimeout(() => { off(); reject(new Error('摄像头授权超时')) }, 60_000)
    const off = onHarmonyEvent('videoPermission', payload => {
      const result = payload as { requestId?: string; granted?: boolean }
      if (result.requestId !== id) return
      clearTimeout(timer)
      off()
      resolve(result.granted === true)
    })
    try {
      callHarmony(() => native.sipRequestVideoPermission(id))
    } catch (error) {
      clearTimeout(timer)
      off()
      reject(error)
    }
  })
}

/** 值机期间申请长时任务，签出时释放 */
export function harmonyKeepAlive(on: boolean): void {
  const native = harmonyNative()
  if (!native) return
  try {
    callHarmony(() => native.keepAlive(on))
  } catch (err) {
    console.warn('[harmony] keepAlive failed', (err as Error).message)
  }
}
