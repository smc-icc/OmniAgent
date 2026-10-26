import { NativeSipRegistration } from './native-registration'
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
 * Capacitor 原生插件（Android Kotlin / iOS Swift）的桥接实现。
 *
 * 插件名固定为 OmniSip，方法与事件名与 SipEngine 一一对应，
 * 原生侧只做 PJSIP 调用与系统集成，不含业务判断。
 */

interface PluginListenerHandle {
  remove: () => Promise<void> | void
}

interface OmniSipPlugin {
  register(cfg: Record<string, unknown>): Promise<void>
  unregister(options?: { registrationId: string }): Promise<void>
  registrationState(): Promise<{ state: SipRegistrationState }>
  call(options: { number: string; video: boolean }): Promise<SipCall>
  answer(options: { callId: string; video: boolean }): Promise<void>
  setVideo(options: { callId: string; on: boolean }): Promise<void>
  showVideo(options: { callId: string }): Promise<void>
  hangup(options: { callId: string }): Promise<void>
  hold(options: { callId: string; on: boolean }): Promise<void>
  mute(options: { on: boolean }): Promise<void>
  sendDtmf(options: { digits: string; callId?: string }): Promise<void>
  setAudioRoute(options: { route: AudioRoute }): Promise<void>
  calls(): Promise<{ calls: SipCall[] }>
  addListener(
    event: SipEvent,
    cb: (payload: unknown) => void,
  ): Promise<PluginListenerHandle> | PluginListenerHandle
}

function plugin(): OmniSipPlugin | null {
  const plugins = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } })
    .Capacitor?.Plugins
  const p = plugins?.OmniSip as OmniSipPlugin | undefined
  return p && typeof p.register === 'function' ? p : null
}

export function capacitorSipAvailable(): boolean {
  return plugin() !== null
}

export class CapacitorSipEngine implements SipEngine {
  readonly name = 'capacitor-pjsip'
  private videoAllowed = true
  get videoPermitted() { return this.videoAllowed }

  /** 注册态本地镜像：UI 首帧不必等原生事件 */
  private state: SipRegistrationState = 'unregistered'
  private readonly registration = new NativeSipRegistration()

  get available(): boolean {
    return capacitorSipAvailable()
  }

  get videoAvailable(): boolean {
    const capacitor = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor
    return this.available && capacitor?.getPlatform?.() === 'android'
  }

  private requireVideo(): void {
    if (!this.videoAllowed) throw new Error('当前坐席未开启移动端视频功能')
    if (!this.videoAvailable) throw new Error('当前平台未接入 SIP 视频能力')
  }

  private required(): OmniSipPlugin {
    const p = plugin()
    if (!p) throw new Error('OmniSip 原生插件未加载')
    return p
  }

  register(cfg: SipConfig): Promise<void> {
    this.videoAllowed = cfg.allowVideo !== false
    const native = this.required()
    return this.registration.register({
      subscribe: async handler => {
        const handle = await native.addListener('registrationChanged', payload => handler(payload as SipEventPayloads['registrationChanged']))
        return () => { void Promise.resolve(handle.remove()).catch(() => undefined) }
      },
      send: registrationId => native.register({ ...cfg, registrationId }),
      stop: registrationId => native.unregister({ registrationId }),
      state: state => { this.state = state },
    })
  }

  cancelPendingRegistration(): void { this.registration.cancel() }

  async unregister(): Promise<void> {
    try { await this.registration.unregister(() => this.required().unregister())
      this.state = 'unregistered'
    } catch (error) { this.state = 'failed'; throw error }
  }

  registrationState(): SipRegistrationState {
    return this.state
  }

  async call(number: string, options?: SipCallOptions): Promise<SipCall> {
    if (options?.video) this.requireVideo()
    return this.required().call({ number, video: options?.video ?? false })
  }

  async answer(callId: string, options?: SipCallOptions): Promise<void> {
    if (options?.video) this.requireVideo()
    await this.required().answer({ callId, video: options?.video ?? false })
  }

  async setVideo(callId: string, on: boolean): Promise<void> {
    this.requireVideo()
    await this.required().setVideo({ callId, on })
  }

  async showVideo(callId: string): Promise<void> {
    this.requireVideo()
    await this.required().showVideo({ callId })
  }

  async hangup(callId: string): Promise<void> {
    await this.required().hangup({ callId })
  }

  async hold(callId: string, on: boolean): Promise<void> {
    await this.required().hold({ callId, on })
  }

  async mute(on: boolean): Promise<void> {
    await this.required().mute({ on })
  }

  async sendDtmf(digits: string, callId?: string): Promise<void> {
    await this.required().sendDtmf(callId ? { digits, callId } : { digits })
  }

  async setAudioRoute(route: AudioRoute): Promise<void> {
    await this.required().setAudioRoute({ route })
  }

  async calls(): Promise<SipCall[]> {
    const { calls } = await this.required().calls()
    return Array.isArray(calls) ? calls : []
  }

  on<E extends SipEvent>(evt: E, cb: SipEventHandler<E>): SipUnsubscribe {
    const p = plugin()
    if (!p) return () => {}
    const handle = p.addListener(evt, (payload) => {
      if (evt === 'registrationChanged') {
        if (!this.registration.accepts(payload as SipEventPayloads['registrationChanged'])) return
        const next = (payload as SipEventPayloads['registrationChanged']).state
        if (next) this.state = next
      }
      cb(payload as SipEventPayloads[E])
    })
    return () => {
      void Promise.resolve(handle).then((h) => h.remove()).catch(() => { /* ignore */ })
    }
  }
}
