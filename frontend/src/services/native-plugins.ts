import { getNativeShell } from '@/utils/platform'

/**
 * 把原生插件挂到 window.Capacitor.Plugins 上。
 *
 * Capacitor 7 只有调用过 registerPlugin 的插件才会出现在 Capacitor.Plugins，
 * 原生 bridge 自己不会注入。业务侧统一从全局取插件（见 services/sip、services/mobile-push），
 * 所以在 App 启动时先注册一次；Web 与 Tauri 下直接跳过，不引入 @capacitor/core。
 */

const NATIVE_PLUGINS = ['OmniSip', 'OmniPush', 'OmniAuth'] as const

export async function registerNativePlugins(): Promise<void> {
  if (getNativeShell() !== 'capacitor') return
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core')
    for (const name of NATIVE_PLUGINS) {
      // 未随包编译进来的插件不注册：registerPlugin 会生成一个调用即抛错的代理，
      // 反而让「是否有原生语音能力」的判断失真
      if (!Capacitor.isPluginAvailable(name)) continue
      registerPlugin(name)
    }
  } catch (err) {
    console.warn('[native] plugin registration skipped', (err as Error).message)
  }
}
