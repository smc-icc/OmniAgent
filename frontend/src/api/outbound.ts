import { api } from './client'

export interface OutboundTask {
  id: string
  campaign_name: string
  target_count: number
  completed_count: number
  status: 'pending' | 'running' | 'paused' | 'completed'
  created_at: string
  completed_at?: string
}

export interface OutboundListResponse {
  items: OutboundTask[]
  total: number
}

export async function fetchOutboundTasks(params?: { status?: string }): Promise<OutboundListResponse> {
  const { data } = await api.get('/api/v1/outbound/tasks', { params })
  return data
}

export async function startOutboundTask(id: string): Promise<void> {
  await api.post(`/api/v1/outbound/tasks/${id}/start`)
}

export async function pauseOutboundTask(id: string): Promise<void> {
  await api.post(`/api/v1/outbound/tasks/${id}/pause`)
}
