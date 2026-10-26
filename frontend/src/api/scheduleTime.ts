import { api } from './client'

export interface ScheduleCampus {
  id: string
  name: string
}

export interface ScheduleGrade {
  id: string
  label: string
}

export interface ScheduleWeekday {
  value: number
  label: string
}

export interface ScheduleMeta {
  campuses: ScheduleCampus[]
  grades: ScheduleGrade[]
  weekdays: ScheduleWeekday[]
  period_types: string[]
  slot_labels: Record<string, string>
}

export interface ScheduleGroup {
  id: string
  campus_id: string
  name: string
  grade_ids: string[]
  sort: number
}

export interface SchedulePeriod {
  id: string
  group_id: string
  slot: string
  slot_label: string
  period_name: string
  period_name_display: string
  standard: boolean
  type: string
  days: number[]
  days_display: string
  start: string
  end: string
  sort: number
}

export interface ScheduleTemplate {
  id: string
  name: string
  slot: string
  type: string
  sort: number
}

export async function fetchScheduleMeta() {
  const { data } = await api.get<ScheduleMeta>('/api/schedule/meta')
  return data
}

export async function fetchScheduleGroups(campusId: string) {
  const { data } = await api.get<{ items: ScheduleGroup[] }>('/api/schedule/groups', { params: { campus_id: campusId } })
  return data.items
}

export async function postScheduleGroup(campusId: string, name: string) {
  const { data } = await api.post<{ ok: boolean; group: ScheduleGroup }>('/api/schedule/groups', {
    campus_id: campusId,
    name,
  })
  return data.group
}

export async function patchScheduleGroup(groupId: string, body: { name?: string; grade_ids?: string[] }) {
  const { data } = await api.patch<{ ok: boolean; group: ScheduleGroup }>(`/api/schedule/groups/${groupId}`, body)
  return data.group
}

export async function deleteScheduleGroup(groupId: string) {
  const { data } = await api.delete<{ ok: boolean }>(`/api/schedule/groups/${groupId}`)
  return data
}

export async function fetchSchedulePeriods(groupId: string) {
  const { data } = await api.get<{ items: SchedulePeriod[] }>('/api/schedule/periods', { params: { group_id: groupId } })
  return data.items
}

export async function postSchedulePeriod(body: {
  group_id: string
  period_name: string
  type?: string
  days: number[]
  start: string
  end: string
  slot?: string | null
}) {
  const { data } = await api.post<{ ok: boolean; period: SchedulePeriod }>('/api/schedule/periods', body)
  return data.period
}

export async function patchSchedulePeriod(
  periodId: string,
  body: {
    period_name?: string
    type?: string
    days?: number[]
    start?: string
    end?: string
    slot?: string
  },
) {
  const { data } = await api.patch<{ ok: boolean; period: SchedulePeriod }>(`/api/schedule/periods/${periodId}`, body)
  return data.period
}

export async function deleteSchedulePeriod(periodId: string) {
  const { data } = await api.delete<{ ok: boolean }>(`/api/schedule/periods/${periodId}`)
  return data
}

export async function fetchScheduleTemplates() {
  const { data } = await api.get<{ items: ScheduleTemplate[] }>('/api/schedule/templates')
  return data.items
}

export async function putScheduleTemplates(items: { id?: string; name: string; slot: string; type: string; sort: number }[]) {
  const { data } = await api.put<{ ok: boolean; items: ScheduleTemplate[] }>('/api/schedule/templates', { items })
  return data.items
}
