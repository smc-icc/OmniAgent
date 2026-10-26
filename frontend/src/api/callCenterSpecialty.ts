import { api } from './client'

export interface SpecialtyPillar {
  id: string
  title: string
  summary: string
  stat_label: string
  stat_value: string
}

export interface SpecialtyOverview {
  intro: string
  pillars: SpecialtyPillar[]
}

export interface QualityTaskRow {
  id: string
  name: string
  queue: string
  pending: number
  sla_hours: number
  owner: string
}

export interface KnowledgeArticleRow {
  id: string
  title: string
  category: string
  updated_at: string
  status: string
}

export interface OutboundCampaignRow {
  id: string
  name: string
  channel: string
  daily_cap: number
  status: string
}

export interface RecordingSampleRow {
  id: string
  agent: string
  queue: string
  duration_sec: number
  flag: string
  date: string
}

export interface ScriptRow {
  id: string
  name: string
  version: string
  owner: string
  status: string
}

export interface ComplianceCheckRow {
  id: string
  topic: string
  scope: string
  last_run: string
  result: string
}

export interface AnnouncementRow {
  id: string
  title: string
  date: string
  priority: string
}

export async function fetchSpecialtyOverview() {
  const { data } = await api.get<SpecialtyOverview>('/api/call-center/specialty/overview')
  return data
}

export async function fetchQualityTasks() {
  const { data } = await api.get<{ items: QualityTaskRow[] }>('/api/call-center/specialty/quality-tasks')
  return data.items
}

export async function fetchKnowledgeArticles() {
  const { data } = await api.get<{ items: KnowledgeArticleRow[] }>(
    '/api/call-center/specialty/knowledge-articles',
  )
  return data.items
}

export async function fetchOutboundCampaigns() {
  const { data } = await api.get<{ items: OutboundCampaignRow[] }>(
    '/api/call-center/specialty/outbound-campaigns',
  )
  return data.items
}

export async function fetchRecordingSamples() {
  const { data } = await api.get<{ items: RecordingSampleRow[] }>(
    '/api/call-center/specialty/recordings-samples',
  )
  return data.items
}

export async function fetchSpecialtyScripts() {
  const { data } = await api.get<{ items: ScriptRow[] }>('/api/call-center/specialty/scripts')
  return data.items
}

export async function fetchComplianceChecks() {
  const { data } = await api.get<{ items: ComplianceCheckRow[] }>(
    '/api/call-center/specialty/compliance-checks',
  )
  return data.items
}

export async function fetchSpecialtyAnnouncements() {
  const { data } = await api.get<{ items: AnnouncementRow[] }>(
    '/api/call-center/specialty/announcements',
  )
  return data.items
}
