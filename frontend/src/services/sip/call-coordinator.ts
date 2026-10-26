import { onCcsEvt } from '@/services/ccs-agent'
import { getSipEngine, type SipCall, type SipCallOptions } from '@/services/sip'

/**
 * CCS 控制面与 PJSIP 媒体面的双腿关联状态机。
 *
 * 一通来电会同时到达两条腿：CCS 的 OnAgentOnCallOfferedEvt（带 CallID）与
 * SIP 的 INVITE（带 Call-ID）。应答必须是单点决策，否则会出现
 * 「CCS 代答 + App 应答」或「用户点两次接听」导致的重复应答。
 *
 * 本模块是那个唯一的决策点：UI 只调用 answerActiveCall / hangupActiveCall，
 * 不直接对任一条腿下手。
 */

/** 振铃超时：超过这个时间还没接就认为漏接，清理关联 */
const RING_TIMEOUT_MS = 30_000
/** CCS Offered 与 SIP INVITE 的最大到达间隔，超出则不认为是同一通 */
const CORRELATION_WINDOW_MS = 15_000

interface CcsLeg {
  callId: number
  callIdType: number
  offeredType: number
  mediaType: number
  caller: string
  called: string
  at: number
}

/** CallOfferedType=10 是本席外呼，自己发起的呼叫不需要再弹来电页 */
const OFFER_OUTBOUND = 10

interface Link {
  ccs?: CcsLeg
  sip?: SipCall
  /** SIP 腿到达时刻，做时间窗关联 */
  sipAt: number
  /** 已决策应答，避免重复下发 */
  answering: boolean
  answered: boolean
}

let link: Link = { sipAt: 0, answering: false, answered: false }
let ringTimer: ReturnType<typeof setTimeout> | null = null
let unsubs: Array<() => void> = []
let started = false

/**
 * 软件摘挂机（AgentHookMode=2）下，App 侧应答 SIP 之后是否仍需向 CCS 下发
 * DoAgentAnswerCall。不同 TAS 版本行为不一致，必须现场实测确认，
 * 因此做成开关而不是写死。默认不下发（TAS 会从 SIP 200 OK 推出摘机）。
 */
export function requireCcsAnswer(): boolean {
  try {
    return localStorage.getItem('omni_sip_require_ccs_answer') === '1'
  } catch {
    return false
  }
}

export function setRequireCcsAnswer(on: boolean): void {
  try {
    localStorage.setItem('omni_sip_require_ccs_answer', on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function digits(value: string): string {
  return (value || '').replace(/\D/g, '')
}

/** 号码尾号匹配：SBC 与 TAS 可能各自加前缀，尾 7 位一致即认为同一路 */
function sameNumber(a: string, b: string): boolean {
  const x = digits(a)
  const y = digits(b)
  if (!x || !y) return false
  const n = Math.min(7, x.length, y.length)
  return x.slice(-n) === y.slice(-n)
}

function clearRingTimer() {
  if (ringTimer) {
    clearTimeout(ringTimer)
    ringTimer = null
  }
}

function reset() {
  clearRingTimer()
  link = { sipAt: 0, answering: false, answered: false }
}

function armRingTimeout() {
  clearRingTimer()
  ringTimer = setTimeout(() => {
    ringTimer = null
    if (link.answered) return
    console.warn('[sip-coord] ring timeout, dropping correlation')
    reset()
  }, RING_TIMEOUT_MS)
}

/**
 * 两条腿都到齐、到达间隔在窗口内、主叫号码一致，才算关联成功。
 * SIP 腿拿不到主叫号（部分 SBC 会剥掉）时放宽为只看时间窗。
 */
function correlated(): boolean {
  const { ccs, sip, sipAt } = link
  if (!ccs || !sip) return false
  if (Math.abs(ccs.at - sipAt) > CORRELATION_WINDOW_MS) return false
  if (!digits(sip.remoteNumber)) return true
  return sameNumber(ccs.caller, sip.remoteNumber)
}

function onCcsOffered(payload: Record<string, unknown>) {
  const callId = Number(payload.CallID ?? 0)
  if (!callId) return
  link.ccs = {
    callId,
    callIdType: Number(payload.CallIDType ?? 0),
    offeredType: Number(payload.CallOfferedType ?? 0),
    mediaType: Number(payload.MediaType) === 1 ? 1 : 0,
    caller: String(payload.Caller ?? payload.sCallerNO ?? ''),
    called: String(payload.Called ?? ''),
    at: Date.now(),
  }
  link.answering = false
  link.answered = false
  armRingTimeout()
  console.log('[sip-coord] CCS leg offered', callId, link.ccs.caller, 'sipLeg=', Boolean(link.sip))
  maybeAutoAnswerOutbound()
}

/**
 * 外呼时 TAS 会先回呼坐席分机，这条 SIP 腿必须自动接起，
 * 否则坐席点了拨号还要在自己手机上再接一次自己的电话。
 */
function maybeAutoAnswerOutbound() {
  if (link.ccs?.offeredType !== OFFER_OUTBOUND) return
  if (!link.sip || link.sip.state !== 'incoming') return
  if (link.answering || link.answered) return
  void answerActiveCall().catch((e: unknown) => {
    console.warn('[sip-coord] auto answer outbound leg failed', (e as Error).message)
  })
}

function onCcsCallEnded() {
  const sip = link.sip
  reset()
  // CCS 先结束：SIP 腿还挂着就一定要收掉，否则会留下无主的通话与占用的分机
  if (sip) {
    void getSipEngine().hangup(sip.callId).catch(() => undefined)
  }
}

function onSipIncoming(call: SipCall) {
  link.sip = call
  link.sipAt = Date.now()
  armRingTimeout()
  console.log('[sip-coord] SIP leg incoming', call.sipCallId, call.remoteNumber, 'ccsLeg=', Boolean(link.ccs))
  maybeAutoAnswerOutbound()
}

function onSipStateChanged(call: SipCall) {
  if (link.sip && call.callId !== link.sip.callId) return
  link.sip = call
  if (call.state === 'confirmed') {
    link.answered = true
    clearRingTimer()
    return
  }
  if (call.state === 'disconnected') {
    const ccs = link.ccs
    const wasAnswered = link.answered
    reset()
    // SIP 先断（弱网、对端挂机）：已接通的通话要通知 CCS 释放，
    // 未接通的振铃则交给 CCS 自己的超时逻辑，避免把还在派单的呼叫误释放
    if (ccs && wasAnswered) {
      void import('@/stores/agent')
        .then(({ useAgentStore }) => useAgentStore().releaseCall())
        .catch(() => undefined)
    }
  }
}

/**
 * 应答当前来电。单点决策：
 *   1. 有 SIP 腿 → 只应答 SIP；按开关决定是否补发 DoAgentAnswerCall
 *   2. 没有 SIP 腿（PC 软电话或话机模式）→ 走 CCS 应答
 */
export async function answerActiveCall(options?: SipCallOptions): Promise<void> {
  if (link.answering || link.answered) return
  link.answering = true
  try {
    const sip = link.sip
    if (sip) {
      if (!correlated()) {
        console.warn('[sip-coord] answering SIP leg without confirmed correlation', sip.sipCallId)
      }
      const engine = getSipEngine()
      const requestedVideo = link.ccs?.mediaType === 1 && options?.video !== false
      if (requestedVideo && (engine.videoAvailable === false || engine.videoPermitted === false)) {
        throw new Error('当前移动设备不支持视频通话，未接听视频来电')
      }
      await engine.answer(sip.callId, { video: requestedVideo })
      if (link.ccs && link.ccs.offeredType !== OFFER_OUTBOUND && requireCcsAnswer()) {
        const { useAgentStore } = await import('@/stores/agent')
        await useAgentStore().answerCall()
      }
      return
    }
    const { useAgentStore } = await import('@/stores/agent')
    await useAgentStore().answerCall()
  } finally {
    link.answering = false
  }
}

/** 挂断：两条腿都要收，先收 SIP 再让 CCS 释放，顺序反了会短暂听到回铃。 */
export async function hangupActiveCall(): Promise<void> {
  const sip = link.sip
  if (sip) {
    await getSipEngine().hangup(sip.callId).catch(() => undefined)
  }
  const { useAgentStore } = await import('@/stores/agent')
  await useAgentStore().releaseCall()
  reset()
}

/**
 * 静音优先走 SIP（本机麦克风），没有原生引擎时回落到 CCS。
 * 本机静音比服务端静音更即时，也不影响服务端录音。
 */
export async function muteActiveCall(on: boolean): Promise<void> {
  const engine = getSipEngine()
  const { useAgentStore } = await import('@/stores/agent')
  if (engine.available && link.sip) {
    await engine.mute(on)
    useAgentStore().callMuted = on
    return
  }
  await useAgentStore().setCallMuted(on)
}

/** App 恢复前台时对齐：原生侧仍在的呼叫要回填进关联表。 */
export async function resyncCalls(): Promise<void> {
  const engine = getSipEngine()
  if (!engine.available) return
  const calls = await engine.calls().catch(() => [] as SipCall[])
  const active = calls.find((c) => c.state !== 'disconnected')
  if (active) {
    link.sip = active
    if (active.state === 'confirmed') link.answered = true
  } else if (link.sip) {
    link.sip = undefined
  }
}

export function startCallCoordinator(): void {
  if (started) return
  started = true

  unsubs.push(onCcsEvt('OnAgentOnCallOfferedEvt', onCcsOffered))
  unsubs.push(onCcsEvt('OnAgentOnCallEndEvt', onCcsCallEnded))
  unsubs.push(onCcsEvt('OnAgentOnInterceptedEvt', onCcsCallEnded))

  const engine = getSipEngine()
  if (engine.available) {
    unsubs.push(engine.on('incomingCall', onSipIncoming))
    unsubs.push(engine.on('callStateChanged', onSipStateChanged))
  }
}

export function stopCallCoordinator(): void {
  for (const off of unsubs) off()
  unsubs = []
  started = false
  reset()
}
