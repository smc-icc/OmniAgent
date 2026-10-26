import { api } from './client'

export interface ScheduleViewMeta {
  terms: { id: string; label: string; year_label?: string }[]
  campuses: { id: string; name: string }[]
  current_term_id: string
  weeks: { week_number: number; start: string; end: string; label: string }[]
}

export async function fetchScheduleViewMeta(termId?: string) {
  const { data } = await api.get<ScheduleViewMeta>('/api/schedule-view/meta', {
    params: termId ? { term_id: termId } : undefined,
  })
  return data
}

export async function fetchScheduleViewClassTree(campusId: string) {
  const { data } = await api.get<{ items: unknown[] }>('/api/schedule-view/tree/class', {
    params: { campus_id: campusId },
  })
  return data.items
}

export async function fetchScheduleViewTeacherTree(campusId: string) {
  const { data } = await api.get<{ items: unknown[] }>('/api/schedule-view/tree/teacher', {
    params: { campus_id: campusId },
  })
  return data.items
}

export async function fetchScheduleViewClassrooms(campusId: string, q?: string) {
  const { data } = await api.get<{ items: { id: string; name: string }[] }>('/api/schedule-view/classrooms', {
    params: { campus_id: campusId, q: q || undefined },
  })
  return data.items
}

export interface DayHeader {
  dow: number
  iso: string
  date_md: string
  label: string
}

export interface PeriodRow {
  id: string
  name: string
  start: string
  end: string
  sort?: number
}

export async function fetchGridClass(params: {
  campus_id: string
  term_id: string
  week_number: number
  class_id: string
  class_scope?: string
}) {
  const { data } = await api.get<{
    days: DayHeader[]
    periods: PeriodRow[]
    cells: { day: number; period_id: string; subject: string; teacher: string; color: string }[]
  }>('/api/schedule-view/grid/class', { params })
  return data
}

export async function fetchGridTeacher(params: {
  campus_id: string
  term_id: string
  week_number: number
  teacher_id: string
}) {
  const { data } = await api.get<{
    teacher_name: string
    days: DayHeader[]
    periods: PeriodRow[]
    cells: { day: number; period_id: string; line: string }[]
  }>('/api/schedule-view/grid/teacher', { params })
  return data
}

export async function fetchGridClassroom(params: {
  campus_id: string
  term_id: string
  week_number: number
  room_id: string
}) {
  const { data } = await api.get<{
    room_name: string
    days: DayHeader[]
    periods: PeriodRow[]
    cells: { day: number; period_id: string; subject: string; teacher: string; class_name: string }[]
  }>('/api/schedule-view/grid/classroom', { params })
  return data
}

export async function fetchGridMaster(params: {
  campus_id: string
  term_id: string
  week_number: number
}) {
  const { data } = await api.get<{
    class_columns: { id: string; label: string }[]
    period_rows: { id: string; week_label: string; name: string; time: string; star?: boolean }[]
    cells: { row_id: string; class_id: string; subject: string; teacher: string }[]
  }>('/api/schedule-view/grid/master', { params })
  return data
}

export async function fetchCalendarSettings() {
  const { data } = await api.get<{
    auto_create_next_week: boolean
    campus_id: string
    authorized_teacher_count: number
    unauthorized_teacher_count: number
  }>('/api/schedule-view/calendar-settings')
  return data
}

export async function putCalendarSettings(body: { auto_create_next_week?: boolean; campus_id?: string }) {
  const { data } = await api.put<{ ok: boolean; settings: Record<string, unknown> }>(
    '/api/schedule-view/calendar-settings',
    body,
  )
  return data
}

export async function fetchHolidayRecords(params?: { term_id?: string; campus_id?: string }) {
  const { data } = await api.get<{
    items: { id: string; detail: string; remark: string; operated_at: string; operator: string }[]
  }>('/api/schedule-view/holiday-records', { params })
  return data.items
}

export async function postHoliday(body: {
  campus_id: string
  scope: 'grade' | 'class'
  grade_ids: string[]
  date_start: string
  date_end: string
  remark: string
}) {
  const { data } = await api.post<{ ok: boolean }>('/api/schedule-view/holidays', body)
  return data
}

export async function postScheduleViewExport(body: {
  export_type: 'master' | 'class' | 'teacher' | 'classroom'
  layout: 'classes_as_rows' | 'periods_as_rows'
  sheet_mode: 'per_grade' | 'single_sheet'
}) {
  const { data } = await api.post<{ ok: boolean; message: string }>('/api/schedule-view/export', body)
  return data
}

export async function postDeleteSchedule(campusId: string, termId: string) {
  const { data } = await api.post<{ ok: boolean; message: string }>(
    '/api/schedule-view/delete-schedule',
    {},
    { params: { campus_id: campusId, term_id: termId } },
  )
  return data
}
