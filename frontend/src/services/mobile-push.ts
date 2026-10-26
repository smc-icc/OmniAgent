import { registerPushDevice, unregisterPushDevice, type PushProvider } from '@/api/mobile'
import { getNativeShell, isMobileClient } from '@/utils/platform'
import { callHarmony, harmonyNative, onHarmonyEvent } from '@/services/sip/harmony-bridge'

/**
 * 把厂商推送 token 注册到后端。
 *
 * token 由原生侧取得（Android FCM / iOS PushKit / 鸿蒙 Push Kit），这里只负责上报与换绑。
 * 不静态依赖任何推送插件：插件缺失时静默跳过，App 仍可在前台正常工作。
 */

interface NativePushPlugin {
  /** 返回 { token, provider, voip } */
  getToken(): Promise<{ token?: string; provider?: string; voip?: boolean }>
  addListener?: (
    event: 'tokenRefreshed',
    cb: (payload: { token?: string; provider?: string; voip?: boolean }) => void,
  ) => Promise<{ remove: () => void }> | { remove: () => void }
}

function nativePush(): NativePushPlugin | null {
  if (getNativeShell() === 'harmonyos') return harmonyPush()
  const plugins = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } })
    .Capacitor?.Plugins
  const p = plugins?.OmniPush as NativePushPlugin | undefined
  return p && typeof p.getToken === 'function' ? p : null
}

/**
 * 鸿蒙把 Push Kit 的 token 包成同一套接口。
 * Push Kit 的 getToken 是异步的，ArkTS 侧首帧可能还没拿到，
 * 所以先返回空 token，随后通过 pushTokenReady 事件补上。
 */
function harmonyPush(): NativePushPlugin | null {
  const native = harmonyNative()
  if (!native) return null
  return {
    getToken: async () => callHarmony<{ token?: string; provider?: string; voip?: boolean }>(
      () => native.pushToken(),
    ),
    addListener: (_event, cb) => {
      const off = onHarmonyEvent('pushTokenReady', (payload) => {
        cb(payload as { token?: string; provider?: string; voip?: boolean })
      })
      return { remove: off }
    },
  }
}

function defaultProvider(): PushProvider {
  if (getNativeShell() === 'harmonyos') return 'harmony'
  // iOS 来电必须走 PushKit VoIP，原生侧会在 payload 里显式标明 provider
  return 'fcm'
}

let lastToken = ''
let offRefresh: (() => void) | null = null

async function upload(payload: { token?: string; provider?: string; voip?: boolean }) {
  const token = String(payload.token ?? '').trim()
  if (!token || token === lastToken) return
  const provider = (['fcm', 'apns', 'harmony'] as PushProvider[])
    .find((p) => p === payload.provider) ?? defaultProvider()
  await registerPushDevice({
    provider,
    token,
    voip: payload.voip === true,
    platform: getNativeShell(),
  })
  lastToken = token
}

export async function syncPushDevice(): Promise<void> {
  if (!isMobileClient()) return
  const plugin = nativePush()
  if (!plugin) return
  try {
    await upload(await plugin.getToken())
  } catch (err) {
    console.warn('[push] token sync failed', (err as Error).message)
  }
  if (!offRefresh && typeof plugin.addListener === 'function') {
    const handle = plugin.addListener('tokenRefreshed', (payload) => {
      void upload(payload).catch(() => { /* ignore */ })
    })
    offRefresh = () => {
      void Promise.resolve(handle).then((h) => h.remove()).catch(() => { /* ignore */ })
    }
  }
}

/** 退出登录时注销，避免来电推给已经换人的设备。 */
export async function dropPushDevice(): Promise<void> {
  if (!lastToken) return
  const token = lastToken
  lastToken = ''
  offRefresh?.()
  offRefresh = null
  await unregisterPushDevice(token).catch(() => undefined)
}
