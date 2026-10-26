import { api } from './client'

function apiError(e: unknown, fallback: string) {
  const err = e as { response?: { data?: { error?: string } }; message?: string }
  return err.response?.data?.error || (e instanceof Error ? e.message : fallback)
}

export type WorkspaceSnatchAgent = {
  agentId: number
  workNo: string
  name: string
  callerNo: string
  logicNo: number
  ringStartTime: number
  conversationId?: number
  userId?: number
}

export type WorkspaceSnatchGroup = {
  id: number
  name: string
  agents: WorkspaceSnatchAgent[]
}

export type WorkspaceQueueCall = {
  logicNo: number
  callerNo: string
  groupId: number
  skillId: number
  startTime: number
  enterAcdTime: number
  vipLevel: number
  conversationId?: number
}

export type WorkspaceQueueGroup = {
  id: number
  name: string
  count: number
  calls: WorkspaceQueueCall[]
}

export type WorkspaceOnlineAgent = {
  agentId: number
  workNo: string
  name: string
  status: number
  extension?: string
  userId?: number
  mediaConversationId?: number
}

export type WorkspaceOnlineGroup = {
  id: number
  name: string
  count: number
  agents: WorkspaceOnlineAgent[]
}

export async function fetchSnatchTargets() {
  try {
    const { data } = await api.get<{ groups: WorkspaceSnatchGroup[] }>(
      '/api/agent/workspace/snatch-targets',
    )
    return data.groups ?? []
  } catch (e) {
    throw new Error(apiError(e, '加载振铃坐席失败'))
  }
}

export async function fetchQueueCalls() {
  try {
    const { data } = await api.get<{ groups: WorkspaceQueueGroup[] }>(
      '/api/agent/workspace/queue-calls',
    )
    return data.groups ?? []
  } catch (e) {
    throw new Error(apiError(e, '加载排队电话失败'))
  }
}

export async function takeQueuedCall(logicNo: number) {
  try {
    const { data } = await api.post<{ ok: boolean; logic_no: number }>(
      '/api/agent/workspace/queue-take',
      { logicNo },
    )
    return data
  } catch (e) {
    throw new Error(apiError(e, '分配排队电话失败'))
  }
}

export async function fetchOnlineAgents() {
  try {
    const { data } = await api.get<{ groups: WorkspaceOnlineGroup[] }>(
      '/api/agent/workspace/online-agents',
    )
    return data.groups ?? []
  } catch (e) {
    throw new Error(apiError(e, '加载在线坐席失败'))
  }
}

export type ForceMediaMode = 'media' | 'phone' | 'both'

export async function fetchMediaOnlineAgents() {
  try {
    const { data } = await api.get<{ groups: WorkspaceOnlineGroup[] }>(
      '/api/omnichannel/workspace/online-agents',
    )
    return data.groups ?? []
  } catch (e) {
    throw new Error(apiError(e, '加载多媒体在线坐席失败'))
  }
}

export async function fetchMediaSnatchTargets() {
  try {
    const { data } = await api.get<{ groups: WorkspaceSnatchGroup[] }>(
      '/api/omnichannel/workspace/snatch-targets',
    )
    return data.groups ?? []
  } catch (e) {
    throw new Error(apiError(e, '加载全媒体会话失败'))
  }
}

export async function snatchMediaSession(conversationId: number) {
  try {
    const { data } = await api.post<{ ok: boolean; conversation_id: number }>(
      '/api/omnichannel/workspace/snatch',
      { conversationId },
    )
    return data
  } catch (e) {
    throw new Error(apiError(e, '抢接会话失败'))
  }
}

export async function fetchMediaQueueSessions() {
  try {
    const { data } = await api.get<{ groups: WorkspaceQueueGroup[] }>(
      '/api/omnichannel/workspace/queue-sessions',
    )
    return data.groups ?? []
  } catch (e) {
    throw new Error(apiError(e, '加载排队会话失败'))
  }
}

export async function takeQueuedMediaSession(conversationId: number) {
  try {
    const { data } = await api.post<{ ok: boolean; conversation_id: number }>(
      '/api/omnichannel/workspace/queue-take',
      { conversationId },
    )
    return data
  } catch (e) {
    throw new Error(apiError(e, '接会话失败'))
  }
}

export async function mediaConference(body: {
  action: 'invite' | 'kick' | 'mode'
  conversationId: number
  agentIds?: number[]
  mode?: number
}) {
  try {
    const { data } = await api.post<{ ok: boolean }>('/api/omnichannel/workspace/conference', body)
    return data
  } catch (e) {
    throw new Error(apiError(e, '会议操作失败'))
  }
}

export async function mediaMonitor(body: {
  action: 'barge' | 'listen' | 'intercept' | 'end'
  agentId?: number
  conversationId?: number
}) {
  try {
    const { data } = await api.post<{ ok: boolean; conversation_id?: number }>(
      '/api/omnichannel/workspace/monitor',
      body,
    )
    return data
  } catch (e) {
    throw new Error(apiError(e, '监控操作失败'))
  }
}

export async function mediaImsForce(body: {
  action: 'idle' | 'busy' | 'block' | 'logout'
  agentId?: number
  agentIds?: number[]
}) {
  try {
    const { data } = await api.post<{ ok: boolean; results?: Array<{ ok: boolean; error?: string }> }>(
      '/api/omnichannel/workspace/ims-force',
      body,
    )
    return data
  } catch (e) {
    throw new Error(apiError(e, '强制状态失败'))
  }
}

/** 在线班长席（申请小休审批人）。 */
export async function fetchRestLeaders() {
  try {
    const { data } = await api.get<{ leaders: WorkspaceOnlineAgent[] }>(
      '/api/agent/workspace/rest-leaders',
    )
    return data.leaders ?? []
  } catch (e) {
    throw new Error(apiError(e, '加载班长席失败'))
  }
}
