import { api } from './client'

export interface AgentStatusRow {
  user_id: number
  agent_id: string
  work_no: string
  extension: string
  name: string
  team: string
  status: 'ready' | 'busy' | 'break' | 'offline'
  current_call?: string
  media_status: {
    voice: string
    multimedia: string
  }
  duration_sec: number
  handled_today: number
}

export interface MonitorMapPlacement {
  agent_id: string
  x: number
  y: number
}

export interface MonitorMapRegion {
  id: string
  name: string
  background: string
  placements: MonitorMapPlacement[]
}

export interface MonitorMapConfig {
  version: 1
  active_region_id: string
  regions: MonitorMapRegion[]
}

export interface QueueStats {
  queue_name: string
  waiting: number
  active: number
  sla_pct: number
}

export interface MonitorOverview {
  total_agents: number
  online_agents: number
  ready_agents: number
  busy_agents: number
  break_agents: number
  queues: QueueStats[]
  agents: AgentStatusRow[]
  session_kpis?: {
    sessions: number
    queued: number
    avg_wait_sec: number
    avg_talk_sec: number
    csat_pct: number | null
    csat_count: number
  }
  live_sessions?: Array<{
    conversation_id: number
    visitor_name: string
    channel: string
    assignee_id: number | null
    queued: boolean
    last_activity_at: string
  }>
  updated_at: string
}

export async function fetchMonitorOverview(): Promise<MonitorOverview> {
  const { data } = await api.get('/api/v1/monitor/overview')
  return data
}

export async function fetchAgentStatusList(): Promise<AgentStatusRow[]> {
  const { data } = await api.get('/api/v1/monitor/agents')
  return data
}

export async function fetchMonitorMapConfig(): Promise<MonitorMapConfig> {
  const { data } = await api.get('/api/v1/monitor/map-config')
  return data
}

export async function saveMonitorMapConfig(config: MonitorMapConfig): Promise<MonitorMapConfig> {
  const { data } = await api.put('/api/v1/monitor/map-config', config)
  return data
}

export interface OmniSessionReportRow {
  id: number
  conversation_id: number
  visitor_name: string
  channel: string
  method: string
  wait_sec: number
  talk_sec: number
  assignee: string
  created_at: string
  ended_at: string
}

export interface ItrObserveEvent {
  ts?: number
  event: string
  conversationId?: string
  flowId?: number
  nodeId?: string
  nodeType?: string
  state?: string
  preview?: string
  message?: string
  code?: string
  role?: string
}

export async function fetchItrObserveRecent() {
  const { data } = await api.get<{ events: ItrObserveEvent[] }>('/api/itr/observe/recent')
  return data
}

export async function fetchOmniSessionReports(days = 1) {
  const { data } = await api.get<{
    days: number
    kpis: NonNullable<MonitorOverview['session_kpis']> & { assigned: number; ended: number }
    recent: OmniSessionReportRow[]
    by_channel?: Array<{ channel: string; sessions: number; avg_wait_sec: number; avg_talk_sec: number }>
    by_agent?: Array<{ agent: string; sessions: number }>
  }>('/api/omnichannel/reports/sessions', { params: { days } })
  return data
}
