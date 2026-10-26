import { api } from './client'

export interface PerformanceOverview {
  period: string
  center_avg_score: number
  active_agents: number
  teams_count: number
  kpis: { key: string; label: string; value: string; unit: string; trend: string }[]
  highlights: string[]
}

export interface KpiDefinition {
  id: string
  name: string
  category: string
  weight_pct: number
  unit: string
  formula_hint: string
  source_system: string
}

export interface TeamScoreRow {
  team_id: string
  team_name: string
  headcount: number
  composite_score: number
  csat_pct: number
  fcr_pct: number
  aht_sec: number
  quality_avg: number
  utilization_pct: number
}

export interface AgentScoreRow {
  agent_id: string
  name: string
  team_name: string
  composite_score: number
  csat_pct: number
  handled: number
  aht_sec: number
  quality_avg: number
  adherence_pct: number
}

export interface TrendPoint {
  day: string
  value: number
}

export interface CalibrationItem {
  id: string
  agent_name: string
  team_name: string
  metric: string
  raw_value: string
  dispute_reason: string
  status: string
  created_at: string
}

export interface PerformanceGoal {
  id: string
  period: string
  agent_id: string
  agent_name: string
  kpi_id: string
  kpi_name: string
  target_value: string
  owner: string
}

export interface AssessmentPeriod {
  id: string
  label: string
  start: string
  end: string
  status: string
}

export interface PersonalPerformance {
  period: string
  period_key: string
  agent: {
    id: number
    name: string
    uid: string
    email: string
    role: string
    team: string
  }
  handled: number
  inbound: number
  aht_sec: number
  wait_sec_avg: number
  csat_pct: number | null
  csat_count: number
  dsat_pct: number | null
  quality_rate: number | null
  fcr_pct: number | null
  attendance_pct: number | null
  utilization_pct: number | null
  aux_min: number | null
  nps: number | null
  exam_pass: number | null
  high_risk: { flag: boolean; detail: string }
  source: string
}

export async function fetchPersonalPerformance(period?: string) {
  const { data } = await api.get<PersonalPerformance>('/api/performance/me', {
    params: period ? { period } : {},
  })
  return data
}

export async function fetchPerformanceOverview(period?: string) {
  const { data } = await api.get<PerformanceOverview>('/api/performance/overview', {
    params: period ? { period } : {},
  })
  return data
}

export async function fetchKpiDefinitions() {
  const { data } = await api.get<{ items: KpiDefinition[] }>('/api/performance/kpi-definitions')
  return data.items
}

export async function fetchTeamScores(period?: string) {
  const { data } = await api.get<{ items: TeamScoreRow[] }>('/api/performance/team-scores', {
    params: period ? { period } : {},
  })
  return data.items
}

export async function fetchAgentScores(period?: string, teamId?: string) {
  const { data } = await api.get<{ items: AgentScoreRow[] }>('/api/performance/agent-scores', {
    params: { ...(period ? { period } : {}), ...(teamId ? { team_id: teamId } : {}) },
  })
  return data.items
}

export async function fetchPerformanceTrend(metric: string, period?: string) {
  const { data } = await api.get<{ metric: string; unit: string; points: TrendPoint[] }>(
    '/api/performance/trend',
    { params: { metric, ...(period ? { period } : {}) } },
  )
  return data
}

export async function fetchCalibrationQueue() {
  const { data } = await api.get<{ items: CalibrationItem[] }>('/api/performance/calibration-queue')
  return data.items
}

export async function fetchPerformanceGoals(period?: string) {
  const { data } = await api.get<{ items: PerformanceGoal[] }>('/api/performance/goals', {
    params: period ? { period } : {},
  })
  return data.items
}

export async function fetchAssessmentPeriods() {
  const { data } = await api.get<{ items: AssessmentPeriod[] }>('/api/performance/periods')
  return data.items
}

export interface GoalCreateBody {
  period: string
  agent_id: string
  kpi_id: string
  target_value: string
  owner?: string
}

export async function createPerformanceGoal(body: GoalCreateBody) {
  const { data } = await api.post<{ ok: boolean; item: PerformanceGoal }>('/api/performance/goals', body)
  return data.item
}
