import { getNativeShell } from '@/utils/platform'
import { UnsupportedSipEngine, type SipEngine } from './SipEngine'
import { CapacitorSipEngine, capacitorSipAvailable } from './capacitor-sip-engine'
import { HarmonySipEngine } from './harmony-sip-engine'
import { harmonyNative } from './harmony-bridge'
import { JsSipEngine } from './jssip-engine'

export * from './SipEngine'

let engine: SipEngine | null = null

/**
 * 取当前平台的 SIP 引擎。
 * Android / iOS 走 Capacitor 插件，鸿蒙走 ArkTS JSBridge；
 * 普通 Web 工作台使用外部话机，不实例化浏览器 SIP。独立视频页自持媒体引擎。
 */
export function getSipEngine(): SipEngine {
  if (engine) return engine
  const shell = getNativeShell()
  if (shell === 'capacitor' && capacitorSipAvailable()) {
    engine = new CapacitorSipEngine()
  } else if (shell === 'harmonyos' && harmonyNative()) {
    // 桥在但 so 未就位时 available 为 false，界面降级为「本机无语音能力」
    engine = new HarmonySipEngine()
  } else if (shell === 'tauri') {
    const browser = new JsSipEngine()
    engine = browser.available ? browser : new UnsupportedSipEngine()
  } else {
    engine = new UnsupportedSipEngine()
  }
  return engine
}

/** 测试与灰度切换用 */
export function setSipEngine(next: SipEngine | null): void {
  engine = next
}
