import { api } from './client'

export interface ScheduleDiaryCampus {
  id: string
  name: string
}

export interface ScheduleDiaryWeekOption {
  week_number: number
  start: string
  end: string
  label: string
}

export interface ScheduleDiaryMeta {
  campuses: ScheduleDiaryCampus[]
  weeks: ScheduleDiaryWeekOption[]
  repeat_options: { value: string; label: string }[]
  period_options: { id: string; label: string }[]
}

export interface ScheduleDiaryDayHeader {
  dow: number
  iso: string
  date_md: string
  label: string
}

export interface ScheduleDiaryPeriodRow {
  id: string
  name: string
  start?: string
  end?: string
  sort?: number
}

export interface ScheduleDiaryBlock {
  id: string
  day: number
  period_start: string
  period_end: string
  title: string
  count: number
}

export interface ScheduleDiaryGrid {
  days: ScheduleDiaryDayHeader[]
  periods: ScheduleDiaryPeriodRow[]
  blocks: ScheduleDiaryBlock[]
}

export interface ScheduleDiaryTreeNode {
  id: string
  label: string
  children?: ScheduleDiaryTreeNode[]
  is_teacher?: boolean
}

export async function fetchScheduleDiaryMeta() {
  const { data } = await api.get<ScheduleDiaryMeta>('/api/schedule-diary/meta')
  return data
}

export async function fetchScheduleDiaryTeacherTree(campusId: string) {
  const { data } = await api.get<{ items: ScheduleDiaryTreeNode[] }>(
    '/api/schedule-diary/teacher-tree',
    { params: { campus_id: campusId } },
  )
  return data.items
}

export async function fetchScheduleDiaryGrid(
  campusId: string,
  weekNumber: number,
  teacherIds: string[],
) {
  const { data } = await api.get<ScheduleDiaryGrid>('/api/schedule-diary/grid', {
    params: {
      campus_id: campusId,
      week_number: weekNumber,
      ...(teacherIds.length ? { teacher_ids: teacherIds.join(',') } : {}),
    },
  })
  return data
}

export interface ScheduleDiaryEventCreate {
  campus_id: string
  title: string
  description?: string
  location?: string
  day: number
  period_start: string
  period_end: string
  repeat?: string
  teacher_ids: string[]
}

export async function postScheduleDiaryEvent(body: ScheduleDiaryEventCreate) {
  const { data } = await api.post<{ ok: boolean; event: Record<string, unknown> }>(
    '/api/schedule-diary/events',
    body,
  )
  return data
}

export interface ScheduleDiaryWeekEventRow {
  id: string
  title: string
  day: number
  period_start: string
  period_end: string
  count: number
}

export async function fetchScheduleDiaryEventsForWeek(campusId: string, weekNumber: number) {
  const { data } = await api.get<{ items: ScheduleDiaryWeekEventRow[] }>(
    '/api/schedule-diary/events-for-week',
    { params: { campus_id: campusId, week_number: weekNumber } },
  )
  return data.items
}

export async function postScheduleDiaryBatchDelete(ids: string[]) {
  const { data } = await api.post<{ ok: boolean; removed: number }>(
    '/api/schedule-diary/events/batch-delete',
    { ids },
  )
  return data
}
