import { api } from './client'

export type RestRequestStatus = 'pending' | 'approved' | 'rejected' | 'self_approved'

export type RestRequestItem = {
  id: number
  applicant_agent_id: number
  applicant_work_no: string
  applicant_name: string
  leader_agent_id: number | null
  leader_work_no: string
  leader_name: string
  content: string
  status: RestRequestStatus
  requested_at: string
  approved_at: string | null
  approve_opinion: string
  duration_sec: number
}

function apiError(e: unknown, fallback: string) {
  const err = e as { response?: { data?: { error?: string } }; message?: string }
  return err.response?.data?.error || (e instanceof Error ? e.message : fallback)
}

export async function fetchRestRequestMeta() {
  try {
    const { data } = await api.get<{ is_leader: boolean }>('/api/agent/rest-requests/meta')
    return data
  } catch {
    return { is_leader: false }
  }
}

export async function fetchMyRestRequests(limit = 100) {
  try {
    const { data } = await api.get<{ view: string; items: RestRequestItem[] }>(
      '/api/agent/rest-requests',
      { params: { view: 'mine', limit } },
    )
    return data.items ?? []
  } catch (e) {
    throw new Error(apiError(e, '加载小休记录失败'))
  }
}

export async function fetchApprovedRestRequests(limit = 100) {
  try {
    const { data } = await api.get<{ view: string; items: RestRequestItem[] }>(
      '/api/agent/rest-requests',
      { params: { view: 'approved', limit } },
    )
    return data.items ?? []
  } catch (e) {
    throw new Error(apiError(e, '加载审批记录失败'))
  }
}
