import { api } from './client'

export interface DashboardProfile {
  name: string
  work_no: string
  extension: string
  department: string
  title: string
  email?: string
}

export interface QuickLink {
  key: string
  label: string
  to: string
  query?: Record<string, string>
}

export interface MemoItem {
  id: string
  title: string
  content?: string
  done?: boolean
  time_label: string
  due_at?: string | null
}

export interface MetricBlock {
  title: string
  period?: string
  session_count?: number
  avg_response_sec: number | null
  avg_wait_sec: number | null
  avg_quality: number | null
  avg_satisfaction_pct: number | null
}

export interface ChannelVolumePack {
  dates: string[]
  series: Array<{ channel_name: string; data: number[] }>
}

export interface Announcement {
  id: string
  type: 'system' | 'exam' | 'training' | 'emergency'
  title: string
  body?: string
  time_label: string
  published_at?: string
  read?: boolean
}

export interface CalEvent {
  id?: string
  date: string
  kinds: string[]
  time?: string
  location?: string
  content?: string
  note?: string
}

export async function fetchDashboardProfile() {
  const { data } = await api.get<DashboardProfile>('/api/dashboard/profile')
  return data
}

export async function fetchQuickLinks() {
  const { data } = await api.get<{ items: QuickLink[] }>('/api/dashboard/quick-links')
  return data.items
}

export async function fetchMemos(includeDone = false) {
  const { data } = await api.get<{ items: MemoItem[] }>('/api/dashboard/memos', {
    params: includeDone ? { include_done: '1' } : undefined,
  })
  return data.items
}

export async function createMemo(payload: { title: string; content?: string; due_at?: string | null }) {
  const { data } = await api.post<MemoItem>('/api/dashboard/memos', payload)
  return data
}

export async function patchMemo(id: string, payload: Partial<MemoItem> & { done?: boolean }) {
  const { data } = await api.patch<MemoItem>(`/api/dashboard/memos/${id}`, payload)
  return data
}

export async function fetchMetrics(scope: 'personal' | 'team') {
  const { data } = await api.get<{ blocks: MetricBlock[] }>('/api/dashboard/metrics', {
    params: { scope },
  })
  return data.blocks
}

export async function fetchChannelVolume() {
  const { data } = await api.get<ChannelVolumePack>('/api/dashboard/channel-volume')
  if (Array.isArray((data as unknown as { dates?: string[] }).dates)) return data
  return { dates: [] as string[], series: [] }
}

export async function fetchAnnouncements(opts?: { unreadOnly?: boolean }) {
  return (await fetchAnnouncementPage(opts)).items
}
export async function fetchAnnouncementPage(opts?: { unreadOnly?: boolean; readOnly?: boolean; page?: number; limit?: number; query?: string }) {
  const { data } = await api.get<{ items: Announcement[]; total: number; unread_count: number; read_count: number }>('/api/dashboard/announcements', { params: { unread_only: opts?.unreadOnly ? '1' : '0', read_only: opts?.readOnly ? '1' : '0', page: opts?.page, limit: opts?.limit, query: opts?.query } })
  return data
}

export async function markAnnouncementRead(id: string) {
  await api.post(`/api/dashboard/announcements/${encodeURIComponent(id)}/read`)
}

export async function markAnnouncementUnread(id: string) {
  await api.post(`/api/dashboard/announcements/${encodeURIComponent(id)}/unread`)
}

export async function syncAnnouncementReads(ids: string[]) {
  if (!ids.length) return
  await api.post('/api/dashboard/announcements/read', { ids })
}

export async function fetchCalendarEvents(month?: string) {
  const { data } = await api.get<{ events: CalEvent[] }>('/api/dashboard/calendar-events', {
    params: month ? { month } : undefined,
  })
  return data.events
}

export async function createCalendarEvent(payload: {
  date: string
  time?: string
  location?: string
  content?: string
  note?: string
  kinds?: string[]
}) {
  const { data } = await api.post<CalEvent>('/api/dashboard/calendar-events', payload)
  return data
}

export async function patchCalendarEvent(
  id: string,
  payload: {
    date?: string
    time?: string
    location?: string
    content?: string
    note?: string
    kinds?: string[]
  },
) {
  const { data } = await api.patch<CalEvent>(`/api/dashboard/calendar-events/${id}`, payload)
  return data
}

export async function deleteCalendarEvent(id: string) {
  const { data } = await api.delete<{ ok: boolean }>(`/api/dashboard/calendar-events/${id}`)
  return data
}
