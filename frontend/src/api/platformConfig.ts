import { api } from './client'

export interface PlatformOverview {
  intro: string
  domains: { id: string; title: string; summary: string }[]
  updated_hint: string
}

export interface SkillGroupRow {
  id: string
  name: string
  priority: number
  queues: string[]
  agent_count: number
  channels: string[]
}

export interface QueueConfigRow {
  queue_id: string
  name: string
  media: string
  overflow_target: string | null
  max_queue_depth: number
  music_on_hold: string | null
  recording: boolean
}

export interface BusinessHours {
  timezone: string
  weekday_open: string
  weekday_close: string
  saturday_open: string
  saturday_close: string
  sunday_mode: 'closed' | 'open'
  sunday_open: string
  sunday_close: string
  holiday_policy: string
  manual_holiday_dates: string[]
}

export interface InboundNumberRow {
  did: string
  label: string
  queue_id: string
  ivr_profile: string
  enabled: boolean
}

export interface IntegrationRow {
  id: string
  name: string
  vendor: string
  endpoint_masked: string
  auth: string
  last_sync: string
}

export interface RetentionPolicy {
  recording_retention_days: number
  screen_log_days: number
  cdr_days: number
  quality_sample_days: number
  mask_pii_in_popscreen: boolean
  allow_agent_export_recording: boolean
  dual_control_delete_recording: boolean
}

export interface DictTable {
  code: string
  name: string
  items: { value: string; label: string }[]
}

export interface SystemParamRow {
  key: string
  value: string
  category: string
  description: string
}

export async function fetchPlatformOverview() {
  const { data } = await api.get<PlatformOverview>('/api/platform-config/overview')
  return data
}

export async function fetchSkillGroups() {
  const { data } = await api.get<{ items: SkillGroupRow[] }>('/api/platform-config/skill-groups')
  return data.items
}

export async function fetchQueuesConfig() {
  const { data } = await api.get<{ items: QueueConfigRow[] }>('/api/platform-config/queues-config')
  return data.items
}

export async function fetchBusinessHours() {
  const { data } = await api.get<BusinessHours>('/api/platform-config/business-hours')
  return data
}

export async function putBusinessHours(body: BusinessHours) {
  const { data } = await api.put<{ ok: boolean; item: BusinessHours }>(
    '/api/platform-config/business-hours',
    body,
  )
  return data.item
}

export async function fetchInboundNumbers() {
  const { data } = await api.get<{ items: InboundNumberRow[] }>('/api/platform-config/inbound-numbers')
  return data.items
}

export async function fetchIntegrations() {
  const { data } = await api.get<{ items: IntegrationRow[] }>('/api/platform-config/integrations')
  return data.items
}

export async function updateIntegration(key: string, value: string) {
  const { data } = await api.put(`/api/platform-config/integrations/${key}`, { value })
  return data
}

export async function removeIntegration(key: string) {
  const { data } = await api.delete(`/api/platform-config/integrations/${key}`)
  return data
}

export async function fetchRetentionPolicy() {
  const { data } = await api.get<RetentionPolicy>('/api/platform-config/retention-policy')
  return data
}

export async function putRetentionPolicy(body: RetentionPolicy) {
  const { data } = await api.put<{ ok: boolean; item: RetentionPolicy }>(
    '/api/platform-config/retention-policy',
    body,
  )
  return data.item
}

export async function fetchDictionaries() {
  const { data } = await api.get<{ tables: DictTable[] }>('/api/platform-config/dictionaries')
  return data.tables
}

export async function fetchSystemParams() {
  const { data } = await api.get<{ items: SystemParamRow[] }>('/api/platform-config/system-params')
  return data.items
}

export async function patchSystemParam(key: string, value: string) {
  const { data } = await api.patch<{ ok: boolean; item: SystemParamRow }>(
    '/api/platform-config/system-param',
    { key, value },
  )
  return data.item
}
