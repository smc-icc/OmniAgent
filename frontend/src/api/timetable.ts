import { api } from './client'

export interface TimetableTerm {
  id: string
  label: string
  year_label?: string
}

export interface TimetableCampus {
  id: string
  name: string
}

export interface TimetableWeekOption {
  week_number: number
  start: string
  end: string
  label: string
}

export interface TimetableMeta {
  terms: TimetableTerm[]
  campuses: TimetableCampus[]
  current_term_id: string
  weeks: TimetableWeekOption[]
  default_user_id: string
}

export interface TimetableDayHeader {
  dow: number
  iso: string
  date_md: string
  label: string
}

export interface TimetablePeriodRow {
  id: string
  name: string
  start: string
  end: string
  sort: number
}

export interface TimetableCell {
  day: number
  period_id: string
  type: 'class' | 'meeting' | string
  class_name?: string
  subject_name?: string
  subject_display?: string
  location_name?: string
  color?: string
  label?: string
  user_id?: string
}

export interface TimetableGridResponse {
  week_number: number
  week_start: string
  week_end?: string
  days: TimetableDayHeader[]
  periods: TimetablePeriodRow[]
  cells: TimetableCell[]
}

export interface ClassTreeNode {
  id: string
  label: string
  is_class?: boolean
  children?: ClassTreeNode[]
}

export async function fetchTimetableMeta(termId?: string) {
  const { data } = await api.get<TimetableMeta>('/api/timetable/meta', {
    params: termId ? { term_id: termId } : undefined,
  })
  return data
}

export async function fetchTimetableClasses(campusId: string) {
  const { data } = await api.get<{ items: ClassTreeNode[] }>('/api/timetable/classes', {
    params: { campus_id: campusId },
  })
  return data.items
}

export async function fetchTimetablePeriods() {
  const { data } = await api.get<{ items: TimetablePeriodRow[] }>('/api/timetable/periods')
  return data.items
}

export async function fetchPersonalTimetable(params: {
  campus_id: string
  term_id: string
  week_number: number
  user_id?: string
}) {
  const { data } = await api.get<TimetableGridResponse>('/api/timetable/personal', { params })
  return data
}

/** 与后端别名一致，便于对接文档中的路径 */
export async function fetchMyScheduleAlias(params: {
  campus_id: string
  term_id: string
  week_number: number
  user_id?: string
}) {
  const { data } = await api.get<TimetableGridResponse>('/api/schedule/my-schedule', { params })
  return data
}

export async function fetchClassTimetable(params: {
  campus_id: string
  term_id: string
  week_number: number
  class_id: string
}) {
  const { data } = await api.get<TimetableGridResponse>('/api/timetable/class-schedule', { params })
  return data
}
