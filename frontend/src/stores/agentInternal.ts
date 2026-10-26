import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ElNotification } from 'element-plus'
import { api } from '@/api/client'
import { invokeCcs, onCcsEvt } from '@/services/ccs-agent'
import { useAgentStore } from '@/stores/agent'

export type InternalKind = 'im' | 'rest_request'

export type InternalMedia = {
  kind: 'image' | 'video' | 'file'
  file_url: string
  file_name?: string
  content_type?: string
  byte_size?: number
}

export type InternalMsg = {
  id: string
  fromAgentId: number
  text: string
  ts: number
  kind: InternalKind
  restStatus?: 'pending' | 'approved' | 'rejected'
  restMinutes?: number
  media?: InternalMedia
}

export type InternalThread = {
  peerAgentId: number
  workNo: string
  name: string
  kind: InternalKind
  last: string
  unread: number
  messages: InternalMsg[]
}

function fmtTime(ts: number) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const useAgentInternalStore = defineStore('agentInternal', () => {
  const threads = ref<InternalThread[]>([])
  const activePeerId = ref<number | null>(null)
  const draft = ref('')
  let wired = false

  const active = computed(() => threads.value.find((t) => t.peerAgentId === activePeerId.value) ?? null)
  const unreadTotal = computed(() => threads.value.reduce((n, t) => n + (t.unread || 0), 0))
  const pendingRestCount = computed(() =>
    threads.value.filter((t) =>
      t.messages.some((m) => m.kind === 'rest_request' && m.restStatus === 'pending'),
    ).length,
  )

  function upsertLocal(th: InternalThread) {
    const i = threads.value.findIndex((t) => t.peerAgentId === th.peerAgentId)
    if (i >= 0) threads.value[i] = th
    else threads.value = [th, ...threads.value]
  }

  async function refresh() {
    try {
      const { data } = await api.get<{ items: InternalThread[] }>('/api/agent/internal-chats')
      threads.value = data.items ?? []
    } catch {
      /* ignore */
    }
  }

  function pendingRestMinutes(peerAgentId: number): number {
    const th = threads.value.find((t) => t.peerAgentId === peerAgentId)
    if (!th) return 15
    for (let i = th.messages.length - 1; i >= 0; i--) {
      const m = th.messages[i]
      if (m.kind === 'rest_request' && m.restStatus === 'pending') {
        if (m.restMinutes && m.restMinutes > 0) return m.restMinutes
        const hit = /（(\d+)分钟）/.exec(m.text)
        if (hit) return Number(hit[1]) || 15
      }
    }
    return 15
  }

  function notifyRestRequest(p: Record<string, unknown>) {
    const src = Number(p.SrcAgentID ?? 0)
    const desc = String(p.Describe ?? '申请小休').trim() || '申请小休'
    const minutes = Number(p.AUXCode ?? 0)
    const th = threads.value.find((t) => t.peerAgentId === src)
    const who = th?.name || th?.workNo || `坐席${src}`
    const msg = minutes > 0 ? `${who}：${desc}（${minutes}分钟）` : `${who}：${desc}`
    ElNotification({
      title: '小休申请',
      message: msg,
      type: 'warning',
      duration: 0,
      position: 'top-right',
      onClick: () => {
        window.dispatchEvent(
          new CustomEvent('omni:rest-request', {
            detail: { srcAgentId: src, describe: desc, workNo: th?.workNo, name: th?.name },
          }),
        )
      },
    })
    window.dispatchEvent(
      new CustomEvent('omni:rest-request', {
        detail: { srcAgentId: src, describe: desc, workNo: th?.workNo, name: th?.name },
      }),
    )
  }

  /** 申请席收到班长同意/拒绝（CCS OnAgentOnStartRestEvt / OnAgentOnNotAgreeRestEvt） */
  function notifyRestDecision(p: Record<string, unknown>, agreed: boolean) {
    const leaderId = Number(p.SrcAgentID ?? 0)
    const mine = useAgentStore().agentId
    // 自己批通过也会推 StartRest，无需再弹「班长已同意」
    if (agreed && (!leaderId || leaderId === mine)) return
    const th = threads.value.find((t) => t.peerAgentId === leaderId)
    const who = th?.name || th?.workNo || (leaderId ? `班长${leaderId}` : '班长')
    const timeSec = Number(p.Time ?? 0)
    const timeHint = agreed && timeSec > 0 ? `，时长 ${Math.round(timeSec / 60)} 分钟` : ''
    ElNotification({
      title: agreed ? '小休已同意' : '小休已拒绝',
      message: agreed
        ? `${who}已同意您的小休申请${timeHint}`
        : `${who}已拒绝您的小休申请`,
      type: agreed ? 'success' : 'error',
      duration: 8000,
      position: 'top-right',
      onClick: () => {
        window.dispatchEvent(new CustomEvent('omni:rest-decision', { detail: { agreed, leaderId } }))
      },
    })
  }

  function notifyRestTimeOver() {
    ElNotification({
      title: '小休结束',
      message: '小休时长已到，已自动示闲',
      type: 'info',
      duration: 8000,
      position: 'top-right',
    })
  }

  function wireEvents() {
    if (wired) return
    wired = true
    onCcsEvt('OnAgentMsgEvt', (p) => {
      const src = Number(p.SrcAgentID ?? 0)
      const text = String(p.MsgData ?? '')
      if (!src || !text) return
      const mine = useAgentStore().agentId
      if (src === mine) return
      void refresh()
    })
    onCcsEvt('OnAgentOnRequestRestEvt', (p) => {
      const src = Number(p.SrcAgentID ?? 0)
      if (!src) return
      void refresh().then(() => notifyRestRequest(p))
    })
    onCcsEvt('OnAgentOnStartRestEvt', (p) => {
      void refresh().then(() => notifyRestDecision(p, true))
    })
    onCcsEvt('OnAgentOnNotAgreeRestEvt', (p) => {
      void refresh().then(() => notifyRestDecision(p, false))
    })
    onCcsEvt('OnAgentOnRestTimeOverEvt', () => {
      notifyRestTimeOver()
      void refresh()
    })
  }

  async function openPeer(peer: { agentId: number; workNo: string; name: string }) {
    const { data } = await api.post<InternalThread>('/api/agent/internal-chats', peer)
    upsertLocal(data)
    activePeerId.value = peer.agentId
    await api.post(`/api/agent/internal-chats/${peer.agentId}/read`).catch(() => undefined)
    await refresh()
  }

  async function send(
    text: string,
    opts?: { displayText?: string; media?: InternalMedia },
  ) {
    const peerId = activePeerId.value
    const agent = useAgentStore()
    if (!peerId || !agent.agentId) throw new Error('未选择坐席')
    const body = text.trim()
    if (!body && !opts?.media) return
    const wire = body || opts?.displayText || '[消息]'
    await invokeCcs('DoAgentSendMsg', {
      AgentID: agent.agentId,
      DstAgentID: peerId,
      DstGroupID: -1,
      MsgDataLen: wire.length,
      MsgData: wire,
    })
    await api.post(`/api/agent/internal-chats/${peerId}/messages`, {
      text: opts?.displayText || body,
      media: opts?.media,
    })
    draft.value = ''
    await refresh()
  }

  async function approveRest(
    peerAgentId: number,
    status: 0 | 1,
    opinion = '',
    /** 同意时生效时长（秒） */
    durationSec = 0,
  ) {
    const agent = useAgentStore()
    if (!agent.agentId) throw new Error('未话务签入')
    await invokeCcs('DoAgentApproveRest', {
      AgentID: agent.agentId,
      SrcAgentID: peerAgentId,
      Status: status,
      Time: status === 0 ? Math.max(0, Math.floor(durationSec)) : 0,
    })
    await api.post(`/api/agent/internal-chats/${peerAgentId}/approve-rest`, {
      status,
      opinion: opinion || (status === 0 ? '同意' : '拒绝'),
      durationSec: status === 0 ? Math.max(0, Math.floor(durationSec)) : 0,
    })
    await refresh()
  }

  return {
    threads,
    activePeerId,
    active,
    draft,
    unreadTotal,
    pendingRestCount,
    fmtTime,
    pendingRestMinutes,
    refresh,
    wireEvents,
    openPeer,
    send,
    approveRest,
    markRead: (id: number) => {
      activePeerId.value = id
      void api.post(`/api/agent/internal-chats/${id}/read`).catch(() => undefined)
    },
  }
})
