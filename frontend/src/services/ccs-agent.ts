import { useProductModulesStore } from '@/stores/product-modules'
import { cleanupVoiceMethods, voiceEventAllowed } from '@/utils/product-modules'
import { getSocket } from './socket'
import type { CcsSocketMessage } from '@/types/agent-ccs'

const CCS_EVENT = 'ccs.agent'
const DEFAULT_TIMEOUT_MS = 30000

const pending = new Map<
  string,
  { ackMethod: string; resolve: (p: Record<string, unknown>) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
>()

const evtHandlers = new Map<string, Set<(payload: Record<string, unknown>) => void>>()

const DO_TO_ACK: Record<string, string> = {
  DoAgentLoginEx: 'OnAgentLoginExAck',
  DoAgentLoggedOff: 'OnAgentLoggedOffAck',
  DoAgentSignInGroup: 'OnAgentSignInGroupAck',
  DoAgentSignOutGroup: 'OnAgentSignOutGroupAck',
  DoAgentSignInSkill: 'OnAgentSignInSkillAck',
  DoAgentSignOutSkill: 'OnAgentSignOutSkillAck',
  DoAgentAnswerCall: 'OnAgentAnswerCallAck',
  DoAgentReleaseCall: 'OnAgentReleaseCallAck',
  DoAgentHoldCall: 'OnAgentHoldCallAck',
  DoAgentRetrieveHold: 'OnAgentRetrieveHoldAck',
  DoAgentConnectHold: 'OnAgentConnectHoldAck',
  DoAgentCallOut: 'OnAgentCallOutAck',
  DoAgentConfCall: 'OnAgentConfCallAck',
  DoAgentTransferIVR: 'OnAgentTransferIVRAck',
  DoAgentTransferOut: 'OnAgentTransferOutAck',
  DoAgentTransferAgentGroup: 'OnAgentTransferAgentGroupAck',
  DoAgentTransferAgent: 'OnAgentTransferAgentAck',
  DoAgentCallAgent: 'OnAgentCallAgentAck',
  DoAgentSnatchCall: 'OnAgentSnatchCallAck',
  DoAgentInviteToConf: 'OnAgentInviteToConfAck',
  DoAgentKickOut: 'OnAgentKickOutAck',
  DoAgentChangeConfMode: 'OnAgentChangeConfModeAck',
  DoAgentPlayFile: 'OnAgentPlayFileAck',
  DoAgentStopPlayFile: 'OnAgentStopPlayFileAck',
  DoAgentReceiveDTMF: 'OnAgentReceiveDTMFAck',
  DoAgentEndReceiveDTMF: 'OnAgentEndReceiveDTMFAck',
  DoAgentForceInsert: 'OnAgentForceInsertAck',
  DoAgentForceRelease: 'OnAgentForceReleaseAck',
  DoAgentMonitor: 'OnAgentMonitorAck',
  DoAgentForceLogOut: 'OnAgentForceLogOutAck',
  DoAgentForceIdle: 'OnAgentForceIdleAck',
  DoAgentForceBusy: 'OnAgentForceBusyAck',
  DoAgentForceBlock: 'OnAgentForceBlockAck',
  DoAgentSetBusy: 'OnAgentSetBusyAck',
  DoAgentSetIdle: 'OnAgentSetIdleAck',
  DoAgentRequestRest: 'OnAgentRequestRestAck',
  DoAgentApproveRest: 'OnAgentApproveRestAck',
  DoAgentBeginMute: 'OnAgentBeginMuteAck',
  DoAgentEndMute: 'OnAgentEndMuteAck',
  DoAgentJoinToConfCall: 'OnAgentJoinToConfCallAck',
  DoAgentIntercept: 'OnAgentInterceptAck',
  DoAgentSetCallData: 'OnAgentSetCallDataAck',
  DoAgentQueryCallData: 'OnAgentQueryCallDataAck',
  DoAgentRequestTextProc: 'OnAgentRequestTextProcAck',
  DoAgentSendMsg: 'OnAgentSendMsgAck',
  DoAgentMonitorLogin: 'OnAgentMonitorLoginAck',
  DoMonitorAgentDesktop: 'OnMonitorAgentDesktopAck',
}

function uuid(): string {
  return crypto.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function handleMessage(msg: CcsSocketMessage) {
  if (!msg?.method) return
  if (msg.op === 'evt') {
    if (!voiceEventAllowed(msg.method, useProductModulesStore().enabled('icc'))) return
    const set = evtHandlers.get(msg.method)
    if (set) for (const fn of set) fn(msg.payload ?? {})
    window.dispatchEvent(new CustomEvent('ccs:evt', { detail: msg }))
    return
  }
  if (msg.op === 'ack') {
    let matched: { ackMethod: string; resolve: (p: Record<string, unknown>) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined
    if (msg.reqId) {
      const p = pending.get(msg.reqId)
      if (p && (p.ackMethod === msg.method || msg.method.startsWith('OnAgent'))) {
        matched = p
        pending.delete(msg.reqId)
      }
    }
    if (!matched) {
      for (const [id, p] of pending) {
        if (p.ackMethod === msg.method) {
          matched = p
          pending.delete(id)
          break
        }
      }
    }
    if (matched) {
      clearTimeout(matched.timer)
      matched.resolve(msg.payload ?? {})
    }
    // 无 reqId 的 Ack（如 Offhook Comp 后的 AnswerCallAck）也需驱动坐席状态
    const set = evtHandlers.get(msg.method)
    if (set) for (const fn of set) fn(msg.payload ?? {})
    window.dispatchEvent(new CustomEvent('ccs:evt', { detail: msg }))
  }
}

let attachedSocket: ReturnType<typeof getSocket> = null

export function wireCcsAgentSocket(): void {
  const attach = (socket: NonNullable<ReturnType<typeof getSocket>>) => {
    if (attachedSocket === socket) return
    if (attachedSocket) attachedSocket.off(CCS_EVENT, handleMessage)
    socket.on(CCS_EVENT, handleMessage)
    attachedSocket = socket
  }
  const s = getSocket()
  if (s) attach(s)
  else {
    const id = window.setInterval(() => {
      const sock = getSocket()
      if (sock) {
        clearInterval(id)
        attach(sock)
      }
    }, 200)
  }
}

export function onCcsEvt(method: string, handler: (payload: Record<string, unknown>) => void): () => void {
  if (!evtHandlers.has(method)) evtHandlers.set(method, new Set())
  evtHandlers.get(method)!.add(handler)
  return () => evtHandlers.get(method)?.delete(handler)
}

export async function invokeCcs(
  method: string,
  payload: Record<string, unknown> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const { default: policies } = await import('@/generated/access-ccs.json')
  const permission = (policies as Record<string, string>)[method]
  if (!permission) throw new Error('未登记的话务操作')
  if (!permission.startsWith('omni.') && !useProductModulesStore().enabled('icc') && !cleanupVoiceMethods.has(method)) throw new Error('ICC 话务模块未启用')
  if (permission !== 'session') {
    const { useAccessStore } = await import('@/stores/access')
    const access = useAccessStore()
    if (!access.loaded) await access.refresh()
    if (!access.can(permission)) throw new Error('没有此话务操作权限')
  }
  const socket = getSocket()
  if (!socket?.connected) return Promise.reject(new Error('Socket not connected'))

  const reqId = uuid()
  const ackMethod = DO_TO_ACK[method] ?? `${method.replace(/^Do/, 'On')}Ack`

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(reqId)
      reject(new Error(`Timeout waiting for ${ackMethod}`))
    }, timeoutMs)
    pending.set(reqId, { ackMethod, resolve, reject, timer })
    socket.emit(CCS_EVENT, { op: 'invoke', method, reqId, payload } satisfies CcsSocketMessage)
  })
}

export function registerCcsCredentials(creds: {
  workNO: string
  extension: string
  password: string
  vdnId?: number
}): Promise<void> {
  const socket = getSocket()
  if (!socket?.connected) return Promise.reject(new Error('Socket not connected'))
  const reqId = uuid()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(reqId)
      reject(new Error('Timeout registering CCS credentials'))
    }, DEFAULT_TIMEOUT_MS)
    pending.set(reqId, {
      ackMethod: 'ccs.registerCredentials',
      resolve: (p) => {
        if ((p.Result as number | undefined) !== 0) {
          reject(new Error(String(p.errMsg ?? 'register failed')))
        } else resolve()
      },
      reject,
      timer,
    })
    socket.emit(CCS_EVENT, {
      op: 'invoke',
      method: 'ccs.registerCredentials',
      reqId,
      payload: creds,
    } satisfies CcsSocketMessage)
  })
}
