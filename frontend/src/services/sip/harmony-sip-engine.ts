import { NativeSipRegistration } from './native-registration'
import {
  callHarmony,
  harmonyNative,
  harmonySipAvailable,
  onHarmonyEvent,
  requestHarmonyVideoPermission,
} from './harmony-bridge'
import type {
  AudioRoute,
  SipCall,
  SipCallOptions,
  SipConfig,
  SipEngine,
  SipEvent,
  SipEventHandler,
  SipEventPayloads,
  SipRegistrationState,
  SipUnsubscribe,
} from './SipEngine'

/**
 * 鸿蒙实现。方法与事件名和 Android / iOS 完全一致，差别只在传输方式
 * （ArkWeb JSBridge 而不是 Capacitor）。
 *
 * 过渡版本：libomnisip.so 未就位时 available 为 false，话务页显示
 * 「本机无语音能力」，多媒体会话不受影响。
 */
export class HarmonySipEngine implements SipEngine {
  readonly name = 'harmony-pjsip'
  private videoAllowed = true
  get videoPermitted() { return this.videoAllowed }

  private state: SipRegistrationState = 'unregistered'
  private readonly registration = new NativeSipRegistration()

  get available(): boolean {
    return harmonySipAvailable()
  }

  get videoAvailable(): boolean {
    return this.available && typeof harmonyNative()?.sipSetVideo === 'function'
  }

  private async requireVideoPermission(): Promise<void> {
    if (!this.videoAllowed) throw new Error('当前坐席未开启移动端视频功能')
    if (!this.videoAvailable) throw new Error('当前鸿蒙版本未接入视频能力')
    if (!await requestHarmonyVideoPermission()) throw new Error('未授予摄像头或麦克风权限')
  }

  private required() {
    const native = harmonyNative()
    if (!native) throw new Error('鸿蒙原生桥未加载')
    return native
  }

  register(cfg: SipConfig): Promise<void> {
    this.videoAllowed = cfg.allowVideo !== false
    const native = this.required()
    return this.registration.register({
      subscribe: handler => onHarmonyEvent('registrationChanged', payload => handler(payload as SipEventPayloads['registrationChanged'])),
      send: registrationId => callHarmony(() => native.sipRegister(JSON.stringify({ ...cfg, registrationId }))),
      stop: registrationId => callHarmony(() => native.sipUnregister(registrationId)),
      state: state => { this.state = state },
    })
  }

  cancelPendingRegistration(): void { this.registration.cancel() }

  async unregister(): Promise<void> {
    try { await this.registration.unregister(() => callHarmony(() => this.required().sipUnregister()))
      this.state = 'unregistered'
    } catch (error) { this.state = 'failed'; throw error }
  }

  registrationState(): SipRegistrationState {
    return this.state
  }

  async call(number: string, options?: SipCallOptions): Promise<SipCall> {
    if (options?.video) await this.requireVideoPermission()
    return callHarmony<SipCall>(() => this.required().sipCall(number, options?.video ?? false))
  }

  async answer(callId: string, options?: SipCallOptions): Promise<void> {
    if (options?.video && !this.videoAllowed) throw new Error('当前坐席未开启移动端视频功能')
    const video = options?.video ? await requestHarmonyVideoPermission() : false
    callHarmony(() => this.required().sipAnswer(callId, video))
  }

  async setVideo(callId: string, on: boolean): Promise<void> {
    if (on) await this.requireVideoPermission()
    callHarmony(() => this.required().sipSetVideo(callId, on))
  }

  async showVideo(callId: string): Promise<void> {
    callHarmony(() => this.required().sipShowVideo(callId))
  }

  async hangup(callId: string): Promise<void> {
    callHarmony(() => this.required().sipHangup(callId))
  }

  async hold(callId: string, on: boolean): Promise<void> {
    callHarmony(() => this.required().sipHold(callId, on))
  }

  async mute(on: boolean): Promise<void> {
    callHarmony(() => this.required().sipMute(on))
  }

  async sendDtmf(digits: string, callId?: string): Promise<void> {
    callHarmony(() => this.required().sipSendDtmf(digits, callId ?? ''))
  }

  async setAudioRoute(route: AudioRoute): Promise<void> {
    callHarmony(() => this.required().sipSetAudioRoute(route))
  }

  async calls(): Promise<SipCall[]> {
    const { calls } = callHarmony<{ calls: SipCall[] }>(() => this.required().sipCalls())
    return Array.isArray(calls) ? calls : []
  }

  on<E extends SipEvent>(evt: E, cb: SipEventHandler<E>): SipUnsubscribe {
    return onHarmonyEvent(evt, (payload) => {
      if (evt === 'registrationChanged') {
        if (!this.registration.accepts(payload as SipEventPayloads['registrationChanged'])) return
        const next = (payload as SipEventPayloads['registrationChanged']).state
        if (next) this.state = next
      }
      cb(payload as SipEventPayloads[E])
    })
  }
}
