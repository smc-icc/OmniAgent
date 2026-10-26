import { useProductModulesStore } from './product-modules'
import { ref, computed } from 'vue'
import type { VideoAgentConfig } from '@/api/mobile'
import { useExtensionBindingStore } from './extension-binding'
import { defineStore } from 'pinia'
import { getNativeShell } from '@/utils/platform'
import { api } from '@/api/client'
import { invokeCcs, onCcsEvt } from '@/services/ccs-agent'
import type { CcsCallPhase, StAgentOnCallOfferedEvt, StAgentSelfStatusUpdateEvt } from '@/types/agent-ccs'
import { CCS_AS, CCS_OFFER, isSupervisorOffer, supervisorOfferLabel } from '@/types/agent-ccs'
import { formatCcsError } from '@/utils/ccs-errors'

/** 对照 Focus：咨询/代答回振(12) 不另开会话；外呼(10) 要振铃摇摆 */
function shouldSkipOfferedPopup(p: StAgentOnCallOfferedEvt): boolean {
  const t = Number(p.CallOfferedType ?? 0)
  return t === CCS_OFFER.TelAgent || isSupervisorOffer(t)
}

function isAgentCallOffered(p: StAgentOnCallOfferedEvt): boolean {
  return Number(p.CallOfferedType ?? 0) === 2 || String(p.CallData ?? '').startsWith('agent_')
}

function isAgentCallCaller(p: StAgentOnCallOfferedEvt): boolean {
  return isAgentCallOffered(p) && String(p.CallData ?? '') === 'agent_caller'
}

/**
 * CCS SelfStatusUpdate.AgentStatus[0] = AgentLegacyVoiceStatus（Idle=0x20 / Talking=0x100 …）
 * AgentStatus[1] 是静音标志（0/1），不是话务相位；勿优先取 [1]。
 */
/** 通话相位（振铃/呼出/通话/保持）不是示忙/示闲，不得写进状态下拉 */
function isCcsCallVoice(st: number): boolean {
  return st === CCS_AS.Ring || st === CCS_AS.CallOut || st === CCS_AS.Talking
    || st === CCS_AS.Hold || st === CCS_AS.InspectStatus
}

function asVoiceStatus(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function pickCcsAgentStatus(p: StAgentSelfStatusUpdateEvt): number | undefined {
  const raw = p.AgentStatus ?? (p as { Status?: unknown }).Status
  const direct = asVoiceStatus(raw)
  if (direct != null) return direct
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { value?: unknown }).value)
      ? (raw as { value: unknown[] }).value
      : null
  if (!arr || arr.length === 0) return undefined
  return asVoiceStatus(arr[0])
}
import { fetchRestLeaders } from '@/api/workspace'
import {
  clearCcsHealthMarks,
  clearCcsSignInMark,
  decideCcsHealthAction,
  isOnLoginPage,
  lastCcsHealth,
  markCcsSignedIn,
  noteCcsHealth,
  rememberCcsHealth,
  readSignedCcsHealth,
  shouldKickMissingCcsSession,
  tabHadCcsSignIn,
  type CcsHealthPayload,
} from '@/utils/ccs-health'

export type AgentUiStatus =
  | 'offline'
  | 'ready'
  | 'break'
  | 'busy'
  | 'blocked'
  | 'acw'
  | 'ext_unregistered'
  | 'ext_unavailable'
  | 'ext_not_exist'

export interface AgentProfile {
  video_config?: VideoAgentConfig
  id: string
  work_no: string
  name: string
  extension: string
  team?: string
  department?: string
  title?: string
  email?: string
  phone?: string
  avatar?: string
  ccs_logged_in?: boolean
  ccs_status?: string
}

export type LiveCaptionRole = 'agent' | 'customer'

export interface LiveCaption {
  role: LiveCaptionRole
  text: string
  ts: number
}

function parseLiveCaption(raw: string): LiveCaption | null {
  let role: LiveCaptionRole = 'customer'
  let text = raw
  if (raw.startsWith('[坐席]')) {
    role = 'agent'
    text = raw.replace(/^\[坐席\]\s*/, '')
  } else if (raw.startsWith('[客户]')) {
    role = 'customer'
    text = raw.replace(/^\[客户\]\s*/, '')
  }
  text = text.trim()
  if (!text) return null
  return { role, text, ts: Date.now() }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

export const useAgentStore = defineStore('agent', () => {
  const uiStatus = ref<AgentUiStatus>('offline')
  const restPending = ref(false)
  /** 小休剩余秒数；>0 时顶栏/状态下拉显示倒计时 */
  const restRemainSec = ref(0)
  /** 文书处理剩余秒数；>0 时顶栏/状态下拉显示倒计时 */
  const acwRemainSec = ref(0)
  const onlineSeconds = ref(0)
  const agentId = ref<number | null>(null)
  const callPhase = ref<CcsCallPhase>('idle')
  const callMuted = ref(false)
  const currentCall = ref<StAgentOnCallOfferedEvt | null>(null)
  const liveCaptions = ref<LiveCaption[]>([])
  const LIVE_CAPTIONS_HIDDEN_KEY = 'omni.liveCaptionsHidden'
  const liveCaptionsHidden = ref(
    typeof localStorage !== 'undefined' && localStorage.getItem(LIVE_CAPTIONS_HIDDEN_KEY) === '1',
  )

  function setLiveCaptionsHidden(hidden: boolean) {
    liveCaptionsHidden.value = hidden
    try {
      localStorage.setItem(LIVE_CAPTIONS_HIDDEN_KEY, hidden ? '1' : '0')
    } catch {
      /* ignore */
    }
  }
  /** 振铃截止 Unix 秒；与 CCS NoAnswer 默认 30s 对齐 */
  const ringDeadlineSec = ref(0)
  const ringRemainSec = ref(0)
  const RING_TIMEOUT_SEC = 30
  const profile = ref<AgentProfile>({
    id: '',
    work_no: '',
    name: '坐席',
    extension: '',
  })
  let tick: ReturnType<typeof setInterval> | null = null
  let evtUnsub: Array<() => void> = []
  let presenceTimer: ReturnType<typeof setInterval> | null = null
  let presenceVisHandler: (() => void) | null = null
  let hydrateInFlight: Promise<void> | null = null
  /** 班长强制/CCS 推送世代：示忙 invoke 返回后若已变化，不得把 UI 写回示忙 */
  let workEpoch = 0
  let hydrateSeq = 0

  function noteCcsWorkChange() {
    workEpoch += 1
  }

  function clearCallUi() {
    currentCall.value = null
    callPhase.value = 'idle'
    callMuted.value = false
    ringDeadlineSec.value = 0
    ringRemainSec.value = 0
    liveCaptions.value = []
  }

  function appendLiveCaption(raw: unknown) {
    const parsed = parseLiveCaption(String(raw ?? ''))
    if (!parsed) return
    const list = liveCaptions.value
    // 双腿转写事件按角色交错到达，须找「该角色」最近的气泡而非全局最后一条，
    // 否则句内累积 partial 无法就地更新，表现为文字无限叠加。
    let idx = -1
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === parsed.role) {
        idx = i
        break
      }
    }
    if (idx >= 0) {
      const cur = list[idx]
      if (parsed.text.startsWith(cur.text) || cur.text.startsWith(parsed.text)) {
        // 同一句的流式 partial：就地更新为较长者
        cur.text = parsed.text.length >= cur.text.length ? parsed.text : cur.text
        cur.ts = parsed.ts
        liveCaptions.value = [...list]
        return
      }
      // 句终二遍修正：与当前气泡公共前缀足够长视为同一句的修正版，就地替换
      const n = Math.min(cur.text.length, parsed.text.length)
      let common = 0
      while (common < n && cur.text[common] === parsed.text[common]) common++
      if (n > 0 && common >= Math.max(2, Math.floor(n * 0.4))) {
        cur.text = parsed.text
        cur.ts = parsed.ts
        liveCaptions.value = [...list]
        return
      }
    }
    list.push(parsed)
    if (list.length > 80) list.splice(0, list.length - 80)
  }

  function beginRingCountdown() {
    const now = Math.floor(Date.now() / 1000)
    ringDeadlineSec.value = now + RING_TIMEOUT_SEC
    ringRemainSec.value = RING_TIMEOUT_SEC
  }

  function refreshRingRemain() {
    if (callPhase.value !== 'ringing' || ringDeadlineSec.value <= 0) {
      ringRemainSec.value = 0
      return
    }
    const now = Math.floor(Date.now() / 1000)
    ringRemainSec.value = Math.max(0, ringDeadlineSec.value - now)
  }

  const ringCountdownText = computed(() => {
    if (callPhase.value !== 'ringing') return ''
    const sec = ringRemainSec.value
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  })

  const statusLabel = computed(() => {
    const offer = Number(currentCall.value?.CallOfferedType ?? 0)
    const sup = supervisorOfferLabel(offer)
    // 顶栏：通话相位单独展示；示忙/示闲只反映手动工作态
    if (sup) {
      if (callPhase.value === 'talking') return sup
      if (callPhase.value === 'ringing') {
        return ringCountdownText.value ? `${sup} ${ringCountdownText.value}` : `${sup}振铃`
      }
    }
    if (callPhase.value === 'talking') return '通话'
    if (callPhase.value === 'ringing') {
      return ringCountdownText.value ? `振铃 ${ringCountdownText.value}` : '振铃'
    }
    if (callPhase.value === 'held') return '保持'
    switch (uiStatus.value) {
      case 'ready':
        return '示闲'
      case 'break':
        return restPending.value ? '申请中' : '小休'
      case 'busy':
        return '示忙'
      case 'blocked':
        return '闭塞'
      case 'acw':
        return acwRemainSec.value > 0
          ? `文书处理 ${formatCountdown(acwRemainSec.value)}`
          : '文书处理'
      case 'ext_unregistered':
        return '分机未注册'
      case 'ext_unavailable':
        return '分机临时失效'
      case 'ext_not_exist':
        return '分机不存在'
      default:
        return '未签入'
    }
  })

  const durationText = computed(() => formatDuration(onlineSeconds.value))

  function formatCountdown(seconds: number) {
    const sec = Math.max(0, Math.floor(seconds))
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  function startRestCountdown(sec: number) {
    const n = Math.max(0, Math.floor(Number(sec) || 0))
    restRemainSec.value = n
    if (n > 0) startTick()
  }

  function clearRestCountdown() {
    restRemainSec.value = 0
  }

  function startAcwCountdown(sec: number) {
    const n = Math.max(0, Math.floor(Number(sec) || 0))
    acwRemainSec.value = n
    if (n > 0) startTick()
  }

  function clearAcwCountdown() {
    acwRemainSec.value = 0
  }

  const avatarText = computed(() => {
    const ch = profile.value.name?.trim().charAt(0)
    return ch || '坐'
  })

  const headerCaption = computed(() => {
    const { name, work_no } = profile.value
    if (name && work_no) return `${name} · ${work_no}`
    return name || work_no || '坐席'
  })

  function startTick() {
    if (tick) return
    tick = setInterval(() => {
      // 登录累计时长：示闲/示忙/小休/文书均继续计
      if (uiStatus.value !== 'offline' && agentId.value) {
        onlineSeconds.value += 1
      }
      if (restRemainSec.value > 0) {
        restRemainSec.value = Math.max(0, restRemainSec.value - 1)
      }
      if (acwRemainSec.value > 0) {
        acwRemainSec.value = Math.max(0, acwRemainSec.value - 1)
      }
      refreshRingRemain()
    }, 1000)
  }

  function stopTick() {
    if (tick) {
      clearInterval(tick)
      tick = null
    }
  }

  function bindCcsEvents() {
    if (evtUnsub.length > 0) return
    evtUnsub = [
      // 对照 Focus agentOnCallOfferedEvt：先振铃+弹屏，AutoAnswer 不挡弹屏
      onCcsEvt('OnAgentOnCallOfferedEvt', (p) => {
        const evt = p as StAgentOnCallOfferedEvt
        const offeredType = Number(evt.CallOfferedType ?? 0)
        const alreadyAgent =
          (callPhase.value === 'ringing' || callPhase.value === 'talking')
          && currentCall.value
          && isAgentCallOffered(currentCall.value)
        if (alreadyAgent && !isAgentCallOffered(evt)) {
          // 互呼分机会议腿：忽略，避免再开「来电」会话/弹框
          return
        }
        const alreadySupervisor =
          (callPhase.value === 'ringing' || callPhase.value === 'talking')
          && currentCall.value
          && isSupervisorOffer(Number(currentCall.value.CallOfferedType ?? 0))
        if (alreadySupervisor && currentCall.value && !isSupervisorOffer(offeredType)) {
          const cur = currentCall.value
          currentCall.value = {
            ...cur,
            CallID: (evt.CallID as number) || cur.CallID,
            CallIDType: (evt.CallIDType as number) ?? cur.CallIDType,
          }
          return
        }
        if (alreadySupervisor && currentCall.value) {
          currentCall.value = {
            ...currentCall.value,
            ...evt,
            CallOfferedType: Number(currentCall.value.CallOfferedType) || offeredType,
            CallData: currentCall.value.CallData || evt.CallData,
            Called: (currentCall.value.Called || evt.Called) as string,
            Caller: (currentCall.value.Caller || evt.Caller) as string,
            JsonPrivateInfo: (evt.JsonPrivateInfo || currentCall.value.JsonPrivateInfo) as string,
          }
          window.dispatchEvent(new CustomEvent('ccs:phone-offered', { detail: currentCall.value }))
          return
        }
        const alreadyAgentCaller =
          alreadyAgent
          && isAgentCallCaller(currentCall.value!)
          && isAgentCallOffered(evt)
        const alreadyOutbound =
          (callPhase.value === 'ringing' || callPhase.value === 'talking')
          && Number(currentCall.value?.CallOfferedType) === 10
          && offeredType === 10
        if ((alreadyAgentCaller || alreadyOutbound) && currentCall.value) {
          currentCall.value = {
            ...currentCall.value,
            ...evt,
            CallOfferedType: alreadyAgentCaller ? 2 : 10,
            CallData: currentCall.value.CallData || evt.CallData,
            Called: (evt.Called || currentCall.value.Called) as string,
            Caller: (currentCall.value.Caller || evt.Caller) as string,
            JsonPrivateInfo: (evt.JsonPrivateInfo || currentCall.value.JsonPrivateInfo) as string,
          }
          if (!shouldSkipOfferedPopup(evt)) {
            window.dispatchEvent(new CustomEvent('ccs:phone-offered', { detail: currentCall.value }))
          }
          return
        }
        currentCall.value = evt
        const callIdType = Number(evt.CallIDType ?? -1)
        if (callIdType === 0 && offeredType === 12) {
          void answerCall()
          return
        }
        callPhase.value = 'ringing'
        beginRingCountdown()
        startTick()
        if (!shouldSkipOfferedPopup(evt)) {
          window.dispatchEvent(new CustomEvent('ccs:phone-offered', { detail: evt }))
        }
      }),
      onCcsEvt('OnAgentOnCallEndEvt', (p) => {
        clearCallUi()
        // 不改示闲/示忙下拉；文书由 SelfStatusUpdate(AfterCallWork) 驱动
        window.dispatchEvent(new CustomEvent('ccs:phone-ended', { detail: p }))
      }),
      onCcsEvt('OnAgentOnInterceptedEvt', (p) => {
        clearCallUi()
        window.dispatchEvent(new CustomEvent('ccs:phone-ended', { detail: p }))
        void import('element-plus').then(({ ElMessage }) => {
          ElMessage.warning('通话已被拦截')
        }).catch(() => { /* ignore */ })
      }),
      onCcsEvt('OnAgentCallOutAck', (p) => {
        const err = typeof p.errMsg === 'string' ? p.errMsg : ''
        if (/timeout/i.test(err)) return
        const st = Number(p.Status ?? p.Result ?? 0)
        if (st !== 0) {
          if (Number(currentCall.value?.CallOfferedType) === 10) {
            clearCallUi()
          }
          return
        }
        if (currentCall.value) {
          currentCall.value = {
            ...currentCall.value,
            CallID: (p.CallID as number) || currentCall.value.CallID,
            CallIDType: (p.CallIDType as number) ?? currentCall.value.CallIDType,
          }
        }
        callPhase.value = 'ringing'
        beginRingCountdown()
        startTick()
      }),
      onCcsEvt('OnAgentOnAnsweredEvt', () => {
        callPhase.value = 'talking'
        ringDeadlineSec.value = 0
        ringRemainSec.value = 0
      }),
      onCcsEvt('OnAgentReceiveRealTimeSpeechRecognitionTextEvt', (p) => {
        appendLiveCaption(p.Text ?? p.text ?? p.szText)
      }),
      onCcsEvt('OnAgentAnswerCallAck', (p) => {
        const st = (p.Status as number | undefined) ?? (p.Result as number | undefined)
        if (st === 0 || st == null) {
          callPhase.value = 'talking'
          ringDeadlineSec.value = 0
          ringRemainSec.value = 0
        }
      }),
      onCcsEvt('OnAgentOnHeldEvt', () => {
        callPhase.value = 'held'
      }),
      onCcsEvt('OnAgentOnRetrievedEvt', () => {
        callPhase.value = 'talking'
        void import('element-plus').then(({ ElMessage }) => {
          ElMessage.success('呼叫已返回，通话已恢复')
        }).catch(() => { /* ignore */ })
      }),
      onCcsEvt('OnAgentCallComeBackEvt', (p) => {
        callPhase.value = 'talking'
        const data = String(p.CallData ?? '')
        const msg = data === 'holdout_timeout'
          ? '外线超时未接，请恢复通话'
          : data === 'holdout_end'
            ? '呼转外线结束，会话已转回本席'
            : '呼叫已转回'
        void import('element-plus').then(({ ElMessage }) => {
          ElMessage.success(msg)
        }).catch(() => { /* ignore */ })
      }),
      onCcsEvt('OnAgentOnForceLogOutEvt', () => {
        void import('element-plus').then(({ ElMessage }) => {
          ElMessage.warning('账号已被强制下线')
        }).catch(() => { /* ignore */ })
        void import('./auth').then(({ useAuthStore }) =>
          useAuthStore().forceLogoutToLogin('force_logout'),
        ).catch(() => { /* ignore */ })
      }),
      onCcsEvt('OnAgentOnForceBusyEvt', () => {
        noteCcsWorkChange()
        uiStatus.value = 'busy'
        clearAcwCountdown()
        void import('element-plus').then(({ ElMessage }) => {
          ElMessage.warning('班长已将你强制示忙')
        }).catch(() => { /* ignore */ })
      }),
      onCcsEvt('OnAgentOnForceIdleEvt', () => {
        noteCcsWorkChange()
        uiStatus.value = 'ready'
        clearAcwCountdown()
        void import('element-plus').then(({ ElMessage }) => {
          ElMessage.warning('班长已将你强制示闲')
        }).catch(() => { /* ignore */ })
      }),
      onCcsEvt('OnAgentOnForceBlockEvt', () => {
        noteCcsWorkChange()
        uiStatus.value = 'blocked'
        clearAcwCountdown()
        void import('element-plus').then(({ ElMessage }) => {
          ElMessage.warning('班长已将你强制闭塞')
        }).catch(() => { /* ignore */ })
      }),
      // SoftAgent 对齐：转 IVR Ack 失败 → 提示回转坐席
      onCcsEvt('OnAgentTransferIVRAck', (p) => {
        const st = Number(p.Status ?? p.Result ?? 0)
        if (st === 0) return
        void import('element-plus').then(({ ElMessageBox }) => {
          ElMessageBox.alert('转IVR失败，回转坐席！', '提示', {
            type: 'warning',
            confirmButtonText: '确定',
          })
        }).catch(() => { /* ignore */ })
      }),
      // 对照 Focus AgentSelfStatusUpdateEvt → changeAgentStatus
      onCcsEvt('OnAgentSelfStatusUpdateEvt', (p) => {
        const st = pickCcsAgentStatus(p as StAgentSelfStatusUpdateEvt)
        if (st == null) return
        if (st === CCS_AS.OffLine) {
          uiStatus.value = 'offline'
          clearCallUi()
          return
        }
        // 分机异常态（与 Idle 等互斥，CCS 直接写 status[0]）
        if (st === CCS_AS.ExtUnregistered) {
          uiStatus.value = 'ext_unregistered'
          clearRestCountdown()
          clearAcwCountdown()
          if (callPhase.value !== 'talking' && callPhase.value !== 'held') clearCallUi()
          return
        }
        if (st === CCS_AS.ExtTemporarilyUnavailable) {
          uiStatus.value = 'ext_unavailable'
          clearRestCountdown()
          clearAcwCountdown()
          if (callPhase.value !== 'talking' && callPhase.value !== 'held') clearCallUi()
          return
        }
        if (st === CCS_AS.ExtNotExist) {
          uiStatus.value = 'ext_not_exist'
          clearRestCountdown()
          clearAcwCountdown()
          if (callPhase.value !== 'talking' && callPhase.value !== 'held') clearCallUi()
          return
        }
        if (st === CCS_AS.Idle) {
          // Idle 以 CCS 为准：强制示闲 / 自己示闲必须切走示忙；文书、闭塞、分机恢复同样回示闲
          if (
            uiStatus.value === 'acw'
            || uiStatus.value === 'offline'
            || uiStatus.value === 'busy'
            || uiStatus.value === 'blocked'
            || uiStatus.value === 'ext_unregistered'
            || uiStatus.value === 'ext_unavailable'
            || uiStatus.value === 'ext_not_exist'
          ) {
            noteCcsWorkChange()
            uiStatus.value = 'ready'
          }
          clearAcwCountdown()
          if (callPhase.value === 'talking' || callPhase.value === 'held') return
          clearCallUi()
          return
        }
        if (st === CCS_AS.Available) {
          if (uiStatus.value === 'acw' || uiStatus.value === 'offline' || uiStatus.value === 'busy' || uiStatus.value === 'blocked') {
            noteCcsWorkChange()
            uiStatus.value = 'ready'
          }
          clearAcwCountdown()
          if (callPhase.value === 'ringing') {
            ringDeadlineSec.value = 0
            ringRemainSec.value = 0
          }
          return
        }
        if (st === CCS_AS.SetBusy) {
          noteCcsWorkChange()
          uiStatus.value = 'busy'
          clearAcwCountdown()
          return
        }
        if (st === CCS_AS.Block) {
          uiStatus.value = 'blocked'
          clearAcwCountdown()
          return
        }
        if (st === CCS_AS.AUX) {
          restPending.value = false
          uiStatus.value = 'break'
          clearAcwCountdown()
          return
        }
        if (st === CCS_AS.AfterCallWork) {
          uiStatus.value = 'acw'
          clearCallUi()
          const acwSec = Math.max(0, Math.floor(Number((p as StAgentSelfStatusUpdateEvt).AcwTime ?? 0) || 0))
          if (acwSec > 0) startAcwCountdown(acwSec)
          else startTick()
          return
        }
        if (isCcsCallVoice(st)) {
          if (st === CCS_AS.Ring || st === CCS_AS.CallOut) {
            callPhase.value = 'ringing'
            if (ringDeadlineSec.value <= 0) beginRingCountdown()
            startTick()
          } else if (st === CCS_AS.Talking || st === CCS_AS.InspectStatus) {
            callPhase.value = 'talking'
            ringDeadlineSec.value = 0
            ringRemainSec.value = 0
            if (!currentCall.value) void hydrateStatus()
          } else {
            callPhase.value = 'held'
          }
        }
      }),
      onCcsEvt('OnAgentLoginExAck', (p) => {
        if (p.Result === 0 && p.AgentID != null) {
          agentId.value = p.AgentID as number
        }
      }),
      onCcsEvt('OnAgentOnStartRestEvt', (p) => {
        restPending.value = false
        uiStatus.value = 'break'
        const timeSec = Math.max(0, Math.floor(Number(p.Time ?? 0) || 0))
        if (timeSec > 0) startRestCountdown(timeSec)
        else clearRestCountdown()
        // 小休期间仍累计登录时长
        startTick()
      }),
      onCcsEvt('OnAgentOnNotAgreeRestEvt', () => {
        restPending.value = false
        clearRestCountdown()
        if (uiStatus.value === 'break') uiStatus.value = 'ready'
        startTick()
      }),
      onCcsEvt('OnAgentOnRestTimeOverEvt', () => {
        restPending.value = false
        clearRestCountdown()
        uiStatus.value = 'ready'
        startTick()
        void api.put('/api/agent/status', { ui_status: 'ready' }).catch(() => undefined)
      }),
    ]
  }

  async function pickLeaderAgent(): Promise<{
    agentId: number
    workNo: string
    name: string
  } | null> {
    try {
      const leaders = await fetchRestLeaders()
      const self = agentId.value
      const hit = leaders.find((a) => a.agentId && a.agentId !== self)
      if (hit?.agentId) {
        return {
          agentId: hit.agentId,
          workNo: hit.workNo || String(hit.agentId),
          name: hit.name || hit.workNo || String(hit.agentId),
        }
      }
    } catch {
      /* 无在线班长则自己批 */
    }
    return null
  }

  async function recordRestRequest(input: {
    content: string
    leaderAgentId: number
    leaderWorkNo?: string
    leaderName?: string
    durationSec?: number
    auxCode?: number
  }) {
    try {
      await api.post('/api/agent/rest-requests', {
        content: input.content,
        leaderAgentId: input.leaderAgentId,
        leaderWorkNo: input.leaderWorkNo || '',
        leaderName: input.leaderName || '',
        durationSec: input.durationSec ?? 0,
        auxCode: input.auxCode ?? 0,
      })
    } catch {
      /* ignore persist errors */
    }
  }

  async function ccsSignIn() {
    const { useExtensionBindingStore } = await import('./extension-binding')
    const { extensionApi } = await import('@/api/extension-binding')
    const binding = useExtensionBindingStore()
    await binding.refresh()
    if (!binding.binding.extension) throw new Error('当前未绑定分机，请先申请绑定')
    if (binding.binding.conflict) throw new Error(binding.binding.conflict)
    profile.value.extension = binding.binding.extension
    bindCcsEvents()
    if (getNativeShell() !== 'web') {
      const { ensureSipRegistered } = await import('@/services/sip/registration')
      await ensureSipRegistered({ displayName: profile.value.work_no })
    }
    const result = await extensionApi.signIn(binding.binding.version)
    const ack = { AgentID: result.agent_id }
    await binding.refresh()
    agentId.value = (ack.AgentID as number | undefined) ?? agentId.value
    markCcsSignedIn()
    const signedHealth = lastCcsHealth()
    if (signedHealth) {
      rememberCcsHealth(signedHealth)
    } else {
      try {
        const { data } = await api.get<{
          ccs_up?: boolean
          ccs_generation?: number
          ccs_boot_id?: string
        }>('/api/agent/ccs-session')
        rememberCcsHealth({
          up: data.ccs_up === true,
          generation: typeof data.ccs_generation === 'number' ? data.ccs_generation : 0,
          bootId: data.ccs_boot_id || undefined,
          logged_in: true,
        })
      } catch {
        /* 下一次 ccs.health 再记 baseline */
      }
    }
    await invokeCcs('DoAgentSetIdle', { AgentID: agentId.value })
    // SelfStatusUpdate 会带上真实语音态（含分机未注册）；仅在尚未收到时兜底示闲
    if (uiStatus.value === 'offline') uiStatus.value = 'ready'
    startTick()
    // 后端登录后会签入 AutoCheckIn 的 IMS 组；此处只刷新工具栏，勿 signOutAll（会把刚入队的组 12 清掉）
    void (async () => {
      try {
        const { fetchAgentSkillGroups } = await import('@/api/skillGroups')
        await Promise.race([
          fetchAgentSkillGroups().catch(() => undefined),
          new Promise((r) => setTimeout(r, 5000)),
        ])
      } catch {
        /* 工具栏稍后重试 */
      } finally {
        window.dispatchEvent(new CustomEvent('omni:skill-groups-changed'))
      }
    })()
  }

  function currentHadCcs(): boolean {
    return tabHadCcsSignIn({
      agentId: agentId.value,
      callActive: callPhase.value !== 'idle',
    })
  }

  async function setStatus(
    next: AgentUiStatus,
    opts?: { restReason?: string; restMinutes?: number; acwMinutes?: number },
  ) {
    if (next === 'offline') {
      const {extensionApi}=await import('@/api/extension-binding')
      await extensionApi.signOut()
      const {unregisterSip}=await import('@/services/sip/registration')
      resetSession()
      await unregisterSip()
      const {useExtensionBindingStore}=await import('./extension-binding')
      await useExtensionBindingStore().refresh()
      window.dispatchEvent(new CustomEvent('omni:skill-groups-changed'))
      return
    }
    if (!agentId.value) {
      /* 未话务签入时仅更新 UI */
      uiStatus.value = next
      return
    }
    const epoch = workEpoch
    try {
      if (next === 'ready') {
        restPending.value = false
        clearRestCountdown()
        clearAcwCountdown()
        await invokeCcs('DoAgentSetIdle', { AgentID: agentId.value! })
      } else if (next === 'busy') {
        restPending.value = false
        clearRestCountdown()
        clearAcwCountdown()
        await invokeCcs('DoAgentSetBusy', { AgentID: agentId.value! })
      } else if (next === 'acw') {
        restPending.value = false
        clearRestCountdown()
        const minutes = Math.min(240, Math.max(1, Math.floor(Number(opts?.acwMinutes) || 5)))
        const durationSec = minutes * 60
        await invokeCcs('DoAgentRequestTextProc', {
          AgentID: agentId.value!,
          // 对照 Focus RequestTextProc.Time：文书倒计时秒数
          Time: durationSec,
        })
        startAcwCountdown(durationSec)
      } else if (next === 'break') {
        if (restPending.value || uiStatus.value === 'break') {
          throw new Error(restPending.value ? '小休申请审批中' : '当前已在小休')
        }
        const leader = await pickLeaderAgent()
        const reason = (opts?.restReason ?? '').trim() || '申请小休'
        const minutes = Math.min(240, Math.max(1, Math.floor(Number(opts?.restMinutes) || 15)))
        const durationSec = minutes * 60
        const leaderId = leader?.agentId ?? 0
        const content = `${reason}（${minutes}分钟）`
        await invokeCcs('DoAgentRequestRest', {
          AgentID: agentId.value!,
          LeaderAgentID: leaderId,
          // Omni：AUXCode=申请分钟数（RequestRest 无 Time 字段）
          AUXCode: minutes,
          Describe: reason,
        })
        await recordRestRequest({
          content,
          leaderAgentId: leaderId,
          leaderWorkNo: leader?.workNo,
          leaderName: leader?.name,
          durationSec,
          auxCode: minutes,
        })
        if (leaderId !== 0 && leaderId !== agentId.value) {
          restPending.value = true
          clearRestCountdown()
          uiStatus.value = 'break'
          startTick()
          try {
            await api.put('/api/agent/status', { ui_status: next })
          } catch {
            /* ignore */
          }
          return
        }
        restPending.value = false
        startRestCountdown(durationSec)
      }
    } catch {
      /* 工作态会由后续 CCS 回调同步。 */
    }
    if (epoch !== workEpoch) return
    uiStatus.value = next
    if (next === 'acw') {
      startTick()
    } else if (next === 'break') {
      startTick()
    } else if (next === 'ready' || next === 'busy') {
      startTick()
    }
    try {
      await api.put('/api/agent/status', { ui_status: next })
    } catch {
      /* ignore */
    }
  }

  function resetSession() {
    stopTick()
    for (const off of evtUnsub) off()
    evtUnsub = []
    agentId.value = null
    uiStatus.value = 'offline'
    restPending.value = false
    clearRestCountdown()
    clearAcwCountdown()
    onlineSeconds.value = 0
    clearCallUi()
    clearCcsSignInMark()
    clearCcsHealthMarks()
  }

  function applyCcsHealth(payload: CcsHealthPayload) {
    noteCcsHealth(payload)
    if(useExtensionBindingStore().snapshot?.operation)return
    // 登录页 startSocket 时 CCS 尚未签入，连上快照 logged_in=false 是正常的
    if (isOnLoginPage()) {
      return
    }
    const hadCcs = currentHadCcs()
    const action = decideCcsHealthAction(hadCcs, readSignedCcsHealth(), payload)
    if (action === 'kick') {
      void import('./auth').then(({ useAuthStore }) =>
        useAuthStore().forceLogoutToLogin('ccs_health'),
      ).catch(() => { /* ignore */ })
      return
    }
    if (hadCcs && (action === 'baseline' || payload.up)) {
      rememberCcsHealth(payload)
    }
  }

  async function answerCall() {
    if (!agentId.value || !currentCall.value) return
    await invokeCcs('DoAgentAnswerCall', {
      AgentID: agentId.value,
      CallID: currentCall.value.CallID ?? -1,
      CallIDType: currentCall.value.CallIDType ?? 0,
    })
    callPhase.value = 'talking'
  }

  async function releaseCall() {
    if (!agentId.value) return
    const offerType = Number(currentCall.value?.CallOfferedType ?? 0)
    const inspectLeave = offerType === CCS_OFFER.Monitor || offerType === CCS_OFFER.Insert
    const payload = {
      AgentID: agentId.value,
      CallID: currentCall.value?.CallID ?? -1,
      CallIDType: currentCall.value?.CallIDType ?? 0,
    }
    // 监听/强插释放只退本席；先清 UI，避免等 CCS Ack 时工具栏无反馈。
    if (inspectLeave) clearCallUi()
    try {
      await invokeCcs('DoAgentReleaseCall', payload)
    } catch (e) {
      if (!inspectLeave) throw e
    }
    if (!inspectLeave) clearCallUi()
  }

  async function setCallMuted(next: boolean) {
    if (!agentId.value) throw new Error('未话务签入')
    if (callMuted.value === next) return
    await invokeCcs(next ? 'DoAgentBeginMute' : 'DoAgentEndMute', { AgentID: agentId.value })
    callMuted.value = next
  }

  async function holdCall() {
    if (!agentId.value || !currentCall.value) return
    await invokeCcs('DoAgentHoldCall', {
      AgentID: agentId.value,
      CallID: currentCall.value.CallID ?? -1,
      CallIDType: currentCall.value.CallIDType ?? 0,
      NoMusic: 0,
    })
    callPhase.value = 'held'
  }

  async function retrieveCall() {
    if (!agentId.value || !currentCall.value) return
    await invokeCcs('DoAgentRetrieveHold', {
      AgentID: agentId.value,
      CallID: currentCall.value.CallID ?? -1,
      CallIDType: currentCall.value.CallIDType ?? 0,
    })
    callPhase.value = 'talking'
  }

  async function callOut(callee: string, callerNo?: string, mediaType: 0 | 1 = 0) {
    if (!agentId.value) throw new Error('未话务签入')
    const caller = (callerNo || profile.value.extension || '').trim()
    const offered: StAgentOnCallOfferedEvt = {
      Caller: caller,
      Called: callee,
      CallOfferedType: 10,
      CallIDType: 0,
      MediaType: mediaType,
    }
    currentCall.value = offered
    callPhase.value = 'ringing'
    beginRingCountdown()
    startTick()
    window.dispatchEvent(new CustomEvent('ccs:phone-offered', { detail: offered }))
    let ack: Record<string, unknown>
    try {
      ack = await invokeCcs('DoAgentCallOut', {
        AgentID: agentId.value,
        szPhoneNo: callee,
        szCallerNO: caller,
        AgentCallType: 4,
        MediaType: mediaType,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/timeout/i.test(msg)) {
        return { Result: 0, errMsg: msg }
      }
      clearCallUi()
      throw e instanceof Error ? e : new Error(msg)
    }
    const rc = Number(ack.Result ?? ack.Status ?? 0)
    const msg = typeof ack.errMsg === 'string' ? ack.errMsg : ''
    if (rc !== 0) {
      if (/timeout/i.test(msg)) return ack
      clearCallUi()
      throw new Error(formatCcsError(rc, msg))
    }
    if (currentCall.value) {
      currentCall.value = {
        ...currentCall.value,
        CallID: (ack.CallID as number) || currentCall.value.CallID,
        CallIDType: (ack.CallIDType as number) ?? currentCall.value.CallIDType,
      }
    }
    return ack
  }

  async function callAgent(target: { agentId: number; workNo: string; extension?: string; name?: string }) {
    if (!agentId.value) throw new Error('未话务签入')
    const calledWork = (target.workNo || '').trim()
    if (!calledWork) throw new Error('对端工号未知')
    const caller = (profile.value.work_no || '').trim()
    const offered: StAgentOnCallOfferedEvt = {
      Caller: caller,
      Called: calledWork,
      CallOfferedType: 2,
      CallIDType: 0,
      CallData: 'agent_caller',
      JsonPrivateInfo: JSON.stringify({ role: 'caller', peerName: target.name || calledWork }),
    }
    currentCall.value = offered
    callPhase.value = 'ringing'
    beginRingCountdown()
    startTick()
    window.dispatchEvent(new CustomEvent('ccs:phone-offered', { detail: offered }))
    let ack: Record<string, unknown>
    try {
      ack = await invokeCcs('DoAgentCallAgent', {
        AgentID: agentId.value,
        CalledAgentID: target.agentId,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/timeout/i.test(msg)) {
        return { Result: 0, errMsg: msg }
      }
      clearCallUi()
      throw e instanceof Error ? e : new Error(msg)
    }
    const rc = Number(ack.Result ?? ack.Status ?? 0)
    const msg = typeof ack.errMsg === 'string' ? ack.errMsg : ''
    if (rc !== 0) {
      if (/timeout/i.test(msg)) return ack
      clearCallUi()
      throw new Error(formatCcsError(rc, msg))
    }
    if (currentCall.value) {
      currentCall.value = {
        ...currentCall.value,
        CallID: (ack.CallID as number) || currentCall.value.CallID,
        CallIDType: (ack.CallIDType as number) ?? currentCall.value.CallIDType,
      }
    }
    return ack
  }

  function beginSupervisorSession(input: {
    offeredType: number
    workNo: string
    name?: string
  }) {
    const kind = supervisorOfferLabel(input.offeredType) || '质检'
    const offered: StAgentOnCallOfferedEvt = {
      Caller: input.workNo,
      Called: (profile.value.extension || '').trim(),
      CallOfferedType: input.offeredType,
      CallIDType: 0,
      CallData: kind,
      JsonPrivateInfo: JSON.stringify({ peerName: input.name || input.workNo, kind }),
    }
    currentCall.value = offered
    callPhase.value = 'ringing'
    beginRingCountdown()
    startTick()
    window.dispatchEvent(new CustomEvent('ccs:phone-offered', { detail: offered }))
  }

  function confirmSupervisorConnected() {
    callPhase.value = 'talking'
    ringDeadlineSec.value = 0
    ringRemainSec.value = 0
  }

  async function invokeAgent(method: string, payload: Record<string, unknown> = {}) {
    if (!agentId.value) throw new Error('未话务签入')
    return invokeCcs(method, { AgentID: agentId.value, ...payload })
  }

  type CcsSessionSnap = {
    logged_in: boolean
    agent_id: number | null
    status: string
    current_call: StAgentOnCallOfferedEvt | null
    ccs_up?: boolean
    ccs_generation?: number
    ccs_boot_id?: string
  }

  async function fetchCcsSession(retries = 2): Promise<CcsSessionSnap> {
    let lastErr: unknown
    for (let i = 0; i <= retries; i++) {
      try {
        const { data } = await api.get<CcsSessionSnap>('/api/agent/ccs-session')
        return data
      } catch (e) {
        lastErr = e
        if (i < retries) {
          await new Promise((r) => setTimeout(r, 400 * (i + 1)))
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('ccs-session failed')
  }

  async function doHydrateStatus() {
    // 登录页尚未签入：不要用 logged_in=false 清掉正在进行的 ccsSignIn
    if (isOnLoginPage()) return

    let data: CcsSessionSnap
    try {
      data = await fetchCcsSession()
    } catch {
      // 瞬时失败不踢、不改通话相位（避免「通话 + 00:00:00」残留）
      return
    }

    if (!data.logged_in && useExtensionBindingStore().snapshot?.operation) return
    if (!data.logged_in) {
      const hadCcs = currentHadCcs()
      agentId.value = null
      callPhase.value = 'idle'
      callMuted.value = false
      currentCall.value = null
      uiStatus.value = 'offline'
      stopTick()
      if (shouldKickMissingCcsSession(hadCcs, isOnLoginPage(), false)) {
        const { useAuthStore } = await import('./auth')
        await useAuthStore().forceLogoutToLogin('session_expired')
      }
      return
    }

    if (data.agent_id) agentId.value = data.agent_id
    bindCcsEvents()
    rememberCcsHealth({
      up: data.ccs_up !== false,
      generation: typeof data.ccs_generation === 'number' ? data.ccs_generation : 0,
      bootId: data.ccs_boot_id || undefined,
      logged_in: true,
    })
    if (data.status === 'ringing') {
      callPhase.value = 'ringing'
      if (data.current_call) currentCall.value = data.current_call
      if (data.current_call) {
        window.dispatchEvent(new CustomEvent('ccs:phone-offered', { detail: data.current_call }))
      }
    } else if (data.status === 'talking') {
      callPhase.value = 'talking'
      if (data.current_call) currentCall.value = data.current_call
    } else if (data.status === 'hold') {
      callPhase.value = 'held'
      if (data.current_call) currentCall.value = data.current_call
    } else if (data.status === 'idle' || data.status === 'offline') {
      callPhase.value = 'idle'
      callMuted.value = false
      if (data.status === 'idle') currentCall.value = null
    }

    try {
      const seq = ++hydrateSeq
      const { data: st } = await api.get<{ ui_status: AgentUiStatus; online_seconds: number; agent_id?: number }>(
        '/api/agent/status',
      )
      if (seq !== hydrateSeq) return
      // 轮询不得把班长强制示闲冲回示忙；busy→ready 则必须跟上
      if (!(st.ui_status === 'busy' && uiStatus.value === 'ready')) {
        uiStatus.value = st.ui_status
      }
      onlineSeconds.value = st.online_seconds
      if (st.agent_id) agentId.value = st.agent_id
      if (st.ui_status === 'ready' || st.ui_status === 'busy' || st.ui_status === 'blocked') startTick()
    } catch {
      /* ignore */
    }
  }

  async function hydrateStatus() {
    if (!useProductModulesStore().enabled('icc')) return
    const p = doHydrateStatus().finally(() => {
      if (hydrateInFlight === p) hydrateInFlight = null
    })
    hydrateInFlight = p
    return p
  }

  function startCcsPresenceWatch() {
    stopCcsPresenceWatch()
    const check = () => {
      if (isOnLoginPage()) return
      if (!currentHadCcs()) return
      void import('./auth').then(({ useAuthStore }) =>
        useAuthStore().ensureCcsSessionAlive(),
      ).catch(() => { /* ignore */ })
    }
    presenceTimer = setInterval(() => {
      check()
      if (agentId.value) void hydrateStatus()
    }, 5_000)
    presenceVisHandler = () => {
      if (document.visibilityState === 'visible') {
        check()
        if (agentId.value) void hydrateStatus()
      }
    }
    document.addEventListener('visibilitychange', presenceVisHandler)
  }

  function stopCcsPresenceWatch() {
    if (presenceTimer) {
      clearInterval(presenceTimer)
      presenceTimer = null
    }
    if (presenceVisHandler) {
      document.removeEventListener('visibilitychange', presenceVisHandler)
      presenceVisHandler = null
    }
  }

  async function hydrateProfile() {
    if (!useProductModulesStore().enabled('icc')) return
    try {
      const { data } = await api.get<AgentProfile>('/api/agent/profile')
      profile.value = { ...profile.value, ...data }
      if (data.ccs_logged_in) bindCcsEvents()
    } catch {
      /* ignore */
    }
  }

  async function hydrate() {
    if (!useProductModulesStore().enabled('icc')) return
    bindCcsEvents()
    await Promise.all([hydrateStatus(), hydrateProfile()])
  }

  return {
    uiStatus,
    restPending,
    restRemainSec,
    acwRemainSec,
    onlineSeconds,
    agentId,
    callPhase,
    callMuted,
    currentCall,
    liveCaptions,
    liveCaptionsHidden,
    setLiveCaptionsHidden,
    ringRemainSec,
    ringCountdownText,
    profile,
    statusLabel,
    durationText,
    avatarText,
    headerCaption,
    setStatus,
    ccsSignIn,
    answerCall,
    releaseCall,
    holdCall,
    retrieveCall,
    setCallMuted,
    callOut,
    callAgent,
    beginSupervisorSession,
    confirmSupervisorConnected,
    clearCallUi,
    invokeAgent,
    hydrate,
    hydrateStatus,
    hydrateProfile,
    resetSession,
    applyCcsHealth,
    startCcsPresenceWatch,
    stopCcsPresenceWatch,
    formatDuration,
  }
})
