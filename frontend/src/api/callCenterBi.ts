import { api } from './client'
import { apiUrl } from './client'

export type BiPeriod = '7d' | '30d'

export interface BiKpi {
  key: string
  label: string
  value: string
  unit: string
  yoy: string
  status: string
}

export interface BiVolume {
  labels: string[]
  handled: number[]
  abandoned: number[]
}

export interface BiSla {
  labels: string[]
  sl_met_pct: number[]
}

export interface BiChannelSlice {
  name: string
  value: number
}

export interface BiQueueRow {
  queue_id: string
  name: string
  handled: number
  avg_wait_sec: number
  sl_met_pct: number
  aht_sec: number
}

export interface BiAgentRow {
  rank: number
  agent_id: string
  name: string
  handled: number
  csat_pct: number
  quality_avg: number
  aht_sec: number
}

export interface BiHeatmap {
  day_labels: string[]
  hour_labels: string[]
  matrix: number[][]
}

export interface BiQualityCsat {
  labels: string[]
  quality_avg: number[]
  csat_pct: number[]
}

export interface BiDataPack {
  period: BiPeriod
  generated_at: string
  kpi: BiKpi[]
  volume: BiVolume
  sla: BiSla
  channel_mix: BiChannelSlice[]
  queues: BiQueueRow[]
  agents: BiAgentRow[]
  heatmap: BiHeatmap
  quality_csat: BiQualityCsat
}

export interface BiCatalog {
  intro: string
  themes: { id: string; name: string; metrics: string[] }[]
}

export async function fetchBiCatalog() {
  const { data } = await api.get<BiCatalog>('/api/bi/catalog')
  return data
}

export async function fetchBiDataPack(period: BiPeriod) {
  const { data } = await api.get<BiDataPack>('/api/bi/data-pack', { params: { period } })
  return data
}

/** 浏览器下载汇总 CSV（走同源或 Vite 代理） */
export function biSummaryExportUrl(period: BiPeriod): string {
  return apiUrl(`/api/bi/export/summary?period=${encodeURIComponent(period)}`)
}
