/**
 * 各平台原生 SIP 栈（Android / iOS / 鸿蒙 的 PJSIP 封装）的统一接口。
 *
 * 约定：Vue 层只依赖本文件的类型，不出现任何平台判断与 PJSIP 概念。
 * 这样后续若把 PJSIP 换成商业 SDK，业务层无需改动。
 */

export type SipTransport = 'tls' | 'tcp' | 'udp'
export type SipSrtpMode = 'required' | 'optional' | 'disabled'
export type AudioRoute = 'earpiece' | 'speaker' | 'bluetooth' | 'wired'

export interface SipCallOptions {
  video?: boolean
}

export interface SipConfig {
  /** Per-agent/per-client server policy. This is separate from hardware video support. */
  allowVideo?: boolean
  username: string
  password: string
  realm: string
  proxyHost: string
  proxyPort: number
  transport: SipTransport
  srtp: SipSrtpMode
  /** 按优先级排列，例如 ['opus', 'PCMA', 'PCMU'] */
  codecs: string[]
  registerExpiresS: number
  stunServer?: string
  iceEnabled?: boolean
  /** Enable only after the native network profile is certified. Defaults to legacy behavior. */
  nativeNetworkRecovery?: boolean
  /** 显示名，落到 From 头 */
  displayName?: string
  /** Browser transport is distinct from a native SIP-TLS socket. */
  wssUrl?: string
  iceServers?: RTCIceServer[]
}

export type SipRegistrationState =
  | 'unregistered'
  | 'registering'
  | 'registered'
  | 'failed'

export type SipCallState =
  | 'incoming'
  | 'calling'
  | 'early'
  | 'connecting'
  | 'confirmed'
  | 'held'
  | 'disconnected'

export interface SipCall {
  /** Parsed v2 SIP correlation; the native runtime must still verify current offer ownership. */
  offerId?: string
  attemptId?: string
  /** 引擎内部的呼叫句柄，所有控制方法都用它 */
  callId: string
  /** SIP Call-ID，用于与 CCS 的 CallID 做双腿关联 */
  sipCallId: string
  remoteNumber: string
  remoteDisplayName?: string
  direction: 'inbound' | 'outbound'
  state: SipCallState
  /** 建立时刻，用于计时；未接通为 0 */
  connectedAt: number
  videoOffered?: boolean
  hasVideo?: boolean
}

export interface SipEventPayloads {
  registrationChanged: {
    state: SipRegistrationState
    registrationId?: string
    /** SIP 响应码，失败时用于区分鉴权失败与网络不可达 */
    code?: number
    reason?: string
  }
  incomingCall: SipCall
  callStateChanged: SipCall
  mediaStateChanged: {
    callId: string
    /** 本地/远端是否有音频流；单通排查看这两个字段 */
    localAudio: boolean
    remoteAudio: boolean
    /** Absent until the native output route is confirmed. */
    route?: AudioRoute
    muted: boolean
    localVideo?: boolean
    remoteVideo?: boolean
  }
  qualityChanged: {
    callId: string
    /** 0–5，MOS 估值 */
    mos?: number
    lossPercent?: number
    jitterMs?: number
    rttMs?: number
  }
  error: {
    /** 稳定的错误码，便于埋点聚合；文案走 message */
    code: string
    message: string
    callId?: string
  }
}

export type SipEvent = keyof SipEventPayloads

export type SipEventHandler<E extends SipEvent> = (payload: SipEventPayloads[E]) => void

/** 取消订阅 */
export type SipUnsubscribe = () => void

export interface SipEngine {
  /** 当前实现名，日志与灰度开关用 */
  readonly name: string
  /** Whether this platform provides a usable SIP media implementation. */
  readonly available: boolean
  readonly videoAvailable?: boolean
  readonly videoPermitted?: boolean

  register(cfg: SipConfig): Promise<void>
  unregister(): Promise<void>
  cancelPendingRegistration?(): void
  /** 当前注册态快照，供 UI 首帧渲染，不用等事件 */
  registrationState(): SipRegistrationState

  call(number: string, options?: SipCallOptions): Promise<SipCall>
  answer(callId: string, options?: SipCallOptions): Promise<void>
  setVideo?(callId: string, on: boolean): Promise<void>
  showVideo?(callId: string): Promise<void>
  hangup(callId: string): Promise<void>
  hold(callId: string, on: boolean): Promise<void>
  mute(on: boolean): Promise<void>
  sendDtmf(digits: string, callId?: string): Promise<void>
  setAudioRoute(route: AudioRoute): Promise<void>
  /** 活动呼叫列表，用于 App 恢复前台时对齐 UI */
  calls(): Promise<SipCall[]>
  mediaStreams?(callId: string): { local: MediaStream | null; remote: MediaStream | null }

  on<E extends SipEvent>(evt: E, cb: SipEventHandler<E>): SipUnsubscribe
}

/** Web / 未接入原生插件时的空实现：明确报错，不静默失败。 */
export class UnsupportedSipEngine implements SipEngine {
  readonly name = 'unsupported'
  readonly available = false

  private fail(): never {
    throw new Error('当前平台未接入原生 SIP 语音能力')
  }

  register(): Promise<void> {
    return this.fail()
  }

  unregister(): Promise<void> {
    return Promise.resolve()
  }

  registrationState(): SipRegistrationState {
    return 'unregistered'
  }

  call(): Promise<SipCall> {
    return this.fail()
  }

  answer(): Promise<void> {
    return this.fail()
  }

  hangup(): Promise<void> {
    return this.fail()
  }

  hold(): Promise<void> {
    return this.fail()
  }

  mute(): Promise<void> {
    return this.fail()
  }

  sendDtmf(): Promise<void> {
    return this.fail()
  }

  setAudioRoute(): Promise<void> {
    return this.fail()
  }

  calls(): Promise<SipCall[]> {
    return Promise.resolve([])
  }

  on(): SipUnsubscribe {
    return () => {}
  }
}
