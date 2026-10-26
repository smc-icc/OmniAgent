import { api } from './client'

export interface MonitoringKpi {
  key: string
  label: string
  value: string
  unit: string
  trend: string
  hint: string
}

export interface ChannelMixRow {
  channel: string
  share_pct: number
  handled_hr: number
}

export interface MonitoringOverview {
  intro: string
  updated_at: string
  kpis: MonitoringKpi[]
  channel_mix: ChannelMixRow[]
}

export interface QueueMonitorRow {
  queue_id: string
  name: string
  channel: string
  waiting: number
  longest_wait_sec: number
  sla_target_sec: number
  sla_met_pct: number
  staffed: number
  ready: number
  busy: number
  acw: number
  risk: 'low' | 'medium' | 'high' | 'critical'
  recommended_action: string
  action_hint: string
}

export interface QueuesResponse {
  updated_at: string
  items: QueueMonitorRow[]
}

export type AgentUiStatus = 'ready' | 'busy' | 'acw' | 'break' | 'offline'

export interface AgentMonitorRow {
  agent_id: string
  name: string
  skill_group: string
  status: AgentUiStatus
  current_queue: string | null
  state_sec: number
  handled_today: number
}

export interface AgentsResponse {
  updated_at: string
  items: AgentMonitorRow[]
}

export interface AlertRow {
  id: string
  level: string
  title: string
  queue_id: string
  queue_name: string
  since: string
  detail: string
  acknowledged: boolean
  acked_at?: string
}

export interface DispatchActionType {
  type: string
  label: string
  desc: string
}

export async function fetchMonitoringOverview() {
  const { data } = await api.get<MonitoringOverview>('/api/monitoring-dispatch/overview')
  return data
}

export async function fetchMonitoringQueues() {
  const { data } = await api.get<QueuesResponse>('/api/monitoring-dispatch/queues')
  return data
}

export async function fetchMonitoringAgents() {
  const { data } = await api.get<AgentsResponse>('/api/monitoring-dispatch/agents')
  return data
}

export async function fetchMonitoringAlerts() {
  const { data } = await api.get<{ items: AlertRow[] }>('/api/monitoring-dispatch/alerts')
  return data.items
}

export async function ackMonitoringAlert(alertId: string) {
  const { data } = await api.post<{ ok: boolean; item: AlertRow; message?: string }>(
    `/api/monitoring-dispatch/alerts/${encodeURIComponent(alertId)}/ack`,
  )
  return data
}

export async function fetchDispatchActionTypes() {
  const { data } = await api.get<{ items: DispatchActionType[] }>(
    '/api/monitoring-dispatch/dispatch-action-types',
  )
  return data.items
}

export type DispatchActionTypeKey =
  | 'overflow_partner'
  | 'enable_callback'
  | 'boost_priority'
  | 'request_staff'
  | 'pause_marketing_dialer'

export async function postDispatchAction(body: {
  action_type: DispatchActionTypeKey
  queue_id?: string
  note?: string
}) {
  const { data } = await api.post<{
    ok: boolean
    message: string
    recorded_at: string
    payload: Record<string, unknown>
  }>('/api/monitoring-dispatch/dispatch-actions', body)
  return data
}
