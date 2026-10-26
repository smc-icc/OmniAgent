import { UA, WebSocketInterface } from 'jssip'
import type { AudioRoute, SipCall, SipCallOptions, SipConfig, SipEngine, SipEvent, SipEventHandler, SipEventPayloads, SipRegistrationState } from './SipEngine'

type Session = ReturnType<UA['call']>
interface Active { session: Session; call: SipCall; local: MediaStream | null; remote: MediaStream | null }

export class JsSipEngine implements SipEngine {
  readonly name = 'jssip-webrtc'
  readonly available = typeof window !== 'undefined' && window.isSecureContext
    && typeof window.RTCPeerConnection !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
  readonly videoAvailable = this.available
  get videoPermitted() { return this.cfg?.allowVideo !== false }
  private ua: UA | null = null
  private cfg: SipConfig | null = null
  private state: SipRegistrationState = 'unregistered'
  private listeners = new Map<SipEvent, Set<(payload: never) => void>>()
  private active = new Map<string, Active>()
  private cancelRegistration: (() => void) | null = null
  private muted = false
  private generation = 0

  on<E extends SipEvent>(event: E, handler: SipEventHandler<E>) {
    const handlers = this.listeners.get(event) ?? new Set()
    handlers.add(handler as (payload: never) => void)
    this.listeners.set(event, handlers)
    return () => { handlers.delete(handler as (payload: never) => void) }
  }
  private emit<E extends SipEvent>(event: E, payload: SipEventPayloads[E]) {
    for (const cb of this.listeners.get(event) ?? []) cb(payload as never)
  }
  private registration(state: SipRegistrationState, code?: number) {
    this.state = state
    this.emit('registrationChanged', { state, code })
  }
  registrationState() { return this.state }

  async register(cfg: SipConfig): Promise<void> {
    if (!this.available) throw new Error('WebRTC requires HTTPS and media permissions')
    let endpoint: URL
    try { endpoint = new URL(cfg.wssUrl ?? '') } catch { throw new Error('WSS endpoint is not configured') }
    if (endpoint.protocol !== 'wss:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error('Invalid WSS endpoint')
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(cfg.username) || !/^[a-zA-Z0-9_.-]+$/.test(cfg.realm)) throw new Error('Invalid SIP identity')
    // Do not interrupt an established call when the HTTP credential refresh expires.
    if (this.active.size) throw new Error('Cannot replace SIP registration during a call')
    const generation = this.generation + 1
    await this.unregister()
    if (generation !== this.generation) throw new Error('SIP registration cancelled')
    this.cfg = cfg
    const ua = new UA({ sockets: [new WebSocketInterface(endpoint.toString())], uri: `sip:${cfg.username}@${cfg.realm}`,
      password: cfg.password, display_name: cfg.displayName ?? cfg.username,
      register: true, register_expires: Math.max(60, cfg.registerExpiresS), session_timers: false })
    this.ua = ua
    this.registration('registering')
    ua.on('newRTCSession', ({ session, request }: { session: Session; request: { call_id?: string; body?: string } }) => {
      if (session.direction === 'incoming' && this.active.size) { session.terminate({ status_code: 486 }); return }
      if (this.ua === ua) this.attach(session, request)
    })
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.cancelRegistration = null
        error ? reject(error) : resolve()
      }
      const timer = setTimeout(() => { this.registration('failed'); finish(new Error('SIP registration timeout')); ua.stop() }, 15000)
      this.cancelRegistration = () => finish(new Error('SIP registration cancelled'))
      ua.on('registered', () => { if (this.ua !== ua) return; this.registration('registered'); finish() })
      ua.on('unregistered', () => { if (this.ua === ua) this.registration('unregistered') })
      ua.on('registrationFailed', event => {
        if (this.ua !== ua) return
        const code = event.response?.status_code
        this.registration('failed', code)
        finish(new Error(`SIP registration failed${code ? ' (' + code + ')' : ''}`))
      })
      ua.on('disconnected', () => {
        if (this.ua !== ua) return
        this.registration('failed')
        finish(new Error('SIP transport disconnected'))
        for (const item of [...this.active.values()]) this.cleanup(item)
      })
      ua.start()
    })
  }

  cancelPendingRegistration(): void { this.cancelRegistration?.() }

  async unregister(): Promise<void> {
    this.generation++
    this.cancelRegistration?.()
    this.cancelRegistration = null
    const old = this.ua
    this.ua = null
    for (const item of [...this.active.values()]) {
      try { item.session.terminate() } finally { this.cleanup(item) }
    }
    old?.stop()
    this.cfg = null
    this.registration('unregistered')
  }
  private options(options?: SipCallOptions) {
    const video = options?.video === true
    if (video && !this.videoPermitted) throw new Error('当前坐席未开启此客户端的视频功能')
    return { mediaConstraints: { audio: true, video },
      rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: video },
      pcConfig: { iceServers: this.cfg?.iceServers ?? (this.cfg?.stunServer ? [{ urls: this.cfg.stunServer }] : []) } }
  }
  async call(number: string, options?: SipCallOptions): Promise<SipCall> {
    if (!this.ua || this.state !== 'registered') throw new Error('SIP is not registered')
    if (this.active.size) throw new Error('An active call already exists')
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(number)) throw new Error('Invalid call destination')
    const session = this.ua.call(`sip:${number}@${this.cfg!.realm}`, this.options(options))
    const item = this.active.get(session.id) ?? this.attach(session)
    item.call.videoOffered = options?.video === true
    return { ...item.call }
  }
  private attach(session: Session, request?: { call_id?: string; body?: string }): Active {
    const existing = this.active.get(session.id)
    if (existing) return existing
    if (session.direction === 'incoming' && this.active.size) {
      session.terminate({ status_code: 486 })
      throw new Error('An active call already exists')
    }
    // Missing SDP is unknown. Video intent comes from the original CCS call,
    // never from the fact that this leg is inbound or the endpoint supports video.
    const parseVideoOffered = (sdp: string | undefined | null): boolean | null => {
      if (!sdp) return null
      const m = /^m=video\s+(\d+)/m.exec(sdp)
      return m ? m[1] !== '0' : false
    }
    const sdpVideo = parseVideoOffered(request?.body)
    // 诊断日志：坐席端收不到画面的排查全靠这一段。
    // FS↔SBC↔浏览器 全是 TLS，抓包看不到 SDP；fsctl loglevel 被重置也拿不到 siptrace，
    // 所以只能在前端把 INVITE 里的 SDP 打出来，确认 m=video 的端口到底是 0 还是非 0。
    try {
      // eslint-disable-next-line no-console
      console.log('[SIP][diag] inbound direction=%s sdpVideo=%s bodyLen=%d',
        session.direction, String(sdpVideo), (request?.body ?? '').length)
      const vid = /^m=video[^\r\n]*/m.exec(request?.body ?? '')
      // eslint-disable-next-line no-console
      console.log('[SIP][diag] m=video line:', vid ? vid[0] : '(none)')
      const aud = /^m=audio[^\r\n]*/m.exec(request?.body ?? '')
      // eslint-disable-next-line no-console
      console.log('[SIP][diag] m=audio line:', aud ? aud[0] : '(none)')
    } catch { /* 诊断失败不影响通话 */ }
    const call: SipCall = { callId: session.id, sipCallId: request?.call_id ?? session.id,
      remoteNumber: session.remote_identity?.uri?.user ?? '', remoteDisplayName: session.remote_identity?.display_name,
      direction: session.direction === 'incoming' ? 'inbound' : 'outbound',
      state: session.direction === 'incoming' ? 'incoming' : 'calling', connectedAt: 0,
      videoOffered: sdpVideo ?? undefined, hasVideo: false }
    const item: Active = { session, call, local: null, remote: null }
    this.active.set(session.id, item)
    const setState = (state: SipCall['state']) => {
      call.state = state
      if (state === 'confirmed' && !call.connectedAt) call.connectedAt = Date.now()
      this.emit('callStateChanged', { ...call })
      this.refreshMedia(item)
    }
    const bindConnection = (pc: RTCPeerConnection) => {
      pc.addEventListener('track', () => this.refreshMedia(item))
      // Update unknown SDP only after a real remote description is available.
      pc.addEventListener('signalingstatechange', () => {
        const late = parseVideoOffered(pc.remoteDescription?.sdp)
        if (late != null && late !== item.call.videoOffered) {
          item.call.videoOffered = late
          this.emit('callStateChanged', { ...item.call })
        }
      })
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'failed') {
          this.emit('error', { code: 'MEDIA_CONNECTION_FAILED', message: 'Media connection failed', callId: session.id })
          session.terminate()
          this.cleanup(item)
        }
        this.refreshMedia(item)
      })
    }
    if (session.connection) bindConnection(session.connection)
    session.on('peerconnection', ({ peerconnection }) => bindConnection(peerconnection))
    session.on('progress', () => setState('early'))
    session.on('accepted', () => setState('connecting'))
    session.on('confirmed', () => setState('confirmed'))
    session.on('hold', () => setState('held'))
    session.on('unhold', () => setState('confirmed'))
    session.on('ended', () => this.cleanup(item))
    session.on('failed', () => {
      this.emit('error', { code: 'CALL_FAILED', message: 'Call failed', callId: session.id })
      this.cleanup(item)
    })
    this.emit(session.direction === 'incoming' ? 'incomingCall' : 'callStateChanged', { ...call })
    return item
  }
  private refreshMedia(item: Active) {
    if (!this.active.has(item.call.callId)) return
    const pc = item.session.connection
    if (!pc) return
    const local = pc.getSenders().map(s => s.track).filter((t): t is MediaStreamTrack => Boolean(t))
    const remote = pc.getReceivers().map(r => r.track).filter((t): t is MediaStreamTrack => Boolean(t))
    item.local = new MediaStream(local)
    item.remote = new MediaStream(remote)
    item.call.hasVideo = remote.some(t => t.kind === 'video' && t.readyState === 'live')
    this.emit('mediaStateChanged', { callId: item.call.callId, localAudio: local.some(t => t.kind === 'audio'),
      remoteAudio: remote.some(t => t.kind === 'audio'), localVideo: local.some(t => t.kind === 'video' && t.enabled),
      remoteVideo: item.call.hasVideo, route: 'speaker', muted: this.muted })
  }
  private cleanup(item: Active) {
    if (!this.active.delete(item.call.callId)) return
    for (const track of item.local?.getTracks() ?? []) track.stop()
    for (const sender of item.session.connection?.getSenders() ?? []) sender.track?.stop()
    item.local = item.remote = null
    item.call.state = 'disconnected'
    this.emit('callStateChanged', { ...item.call })
  }
  private get(callId: string) {
    const item = this.active.get(callId)
    if (!item) throw new Error('Call does not exist')
    return item
  }
  async answer(callId: string, options?: SipCallOptions) {
    const item = this.get(callId)
    const video = options?.video === true && item.call.videoOffered !== false
    item.session.answer(this.options({ video }))
    item.call.videoOffered = video
    this.emit('callStateChanged', { ...item.call })
  }
  async hangup(callId: string) {
    const item = this.active.get(callId)
    if (!item) return
    try { item.session.terminate() } finally { this.cleanup(item) }
  }
  async hold(callId: string, on: boolean) { const s = this.get(callId).session; on ? s.hold() : s.unhold() }
  async mute(on: boolean) {
    this.muted = on
    for (const item of this.active.values()) {
      on ? item.session.mute({ audio: true }) : item.session.unmute({ audio: true })
      this.refreshMedia(item)
    }
  }
  async setVideo(callId: string, on: boolean) {
    if (on && !this.videoPermitted) throw new Error('当前坐席未开启此客户端的视频功能')
    const item = this.get(callId)
    const video = item.session.connection?.getSenders().filter(s => s.track?.kind === 'video') ?? []
    if (!video.length && on) throw new Error('Video was not negotiated for this call')
    for (const sender of video) if (sender.track) sender.track.enabled = on
    this.refreshMedia(item)
  }
  async sendDtmf(digits: string, callId?: string) {
    if (!/^[0-9*#A-D]{1,32}$/.test(digits)) throw new Error('Invalid DTMF')
    const item = callId ? this.get(callId) : [...this.active.values()][0]
    if (!item) throw new Error('No active call')
    item.session.sendDTMF(digits)
  }
  async setAudioRoute(route: AudioRoute) { if (route !== 'speaker') throw new Error('Browser audio output uses system device selection') }
  async calls() { return [...this.active.values()].map(item => ({ ...item.call })) }
  mediaStreams(callId: string) {
    const item = this.active.get(callId)
    return { local: item?.local ?? null, remote: item?.remote ?? null }
  }
}
