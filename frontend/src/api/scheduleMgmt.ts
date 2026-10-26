import { api, apiUrl } from './client'

export type ScheduleMgmtImportMethod = 'week' | 'day' | 'multi_week'

export interface ScheduleMgmtRow {
  id: string
  name: string
  campus_id: string
  campus_name: string
  semester_label: string
  latest_apply_display: string
  import_method: ScheduleMgmtImportMethod
  import_method_label: string
  status: string
  status_label: string
  application_count: number
  multi_week_count?: number | null
  imported_weeks?: number
}

export interface ScheduleMgmtMeta {
  campuses: { id: string; name: string }[]
  semester_label: string
  term_range_text: string
  import_period_options: { id: string; label: string }[]
}

export async function fetchScheduleMgmtMeta() {
  const { data } = await api.get<ScheduleMgmtMeta>('/api/schedule-mgmt/meta')
  return data
}

export async function fetchScheduleMgmtTimetables(params?: { campus_id?: string; semester?: string }) {
  const { data } = await api.get<{ items: ScheduleMgmtRow[] }>('/api/schedule-mgmt/timetables', { params })
  return data.items
}

export async function postScheduleMgmtTimetable(body: {
  name: string
  campus_id: string
  import_method: ScheduleMgmtImportMethod
  multi_week_count?: number | null
}) {
  const { data } = await api.post<{ ok: boolean; item: ScheduleMgmtRow }>('/api/schedule-mgmt/timetables', body)
  return data.item
}

export async function getScheduleMgmtTimetable(id: string) {
  const { data } = await api.get<{ item: ScheduleMgmtRow; term_range_text: string }>(
    `/api/schedule-mgmt/timetables/${id}`,
  )
  return data
}

export async function patchScheduleMgmtTimetable(
  id: string,
  body: {
    name?: string
    campus_id?: string
    import_method?: ScheduleMgmtImportMethod
    multi_week_count?: number | null
  },
) {
  const { data } = await api.patch<{ ok: boolean; item: ScheduleMgmtRow }>(
    `/api/schedule-mgmt/timetables/${id}`,
    body,
  )
  return data.item
}

export async function deleteScheduleMgmtTimetable(id: string) {
  const { data } = await api.delete<{ ok: boolean }>(`/api/schedule-mgmt/timetables/${id}`)
  return data
}

export async function fetchApplicationRecords(timetableId: string) {
  const { data } = await api.get<{
    items: { id: string; applied_at: string; summary: string; operator: string }[]
  }>(`/api/schedule-mgmt/timetables/${timetableId}/application-records`)
  return data.items
}

export async function fetchImportSession(timetableId: string) {
  const { data } = await api.get<{
    timetable_id: string
    step: number
    selected_period_ids: string[]
    schedule_uploaded: boolean
    teaching_uploaded: boolean
    term_range_text: string
    import_period_options: { id: string; label: string }[]
    imported_weeks: number
    timetable_name: string
  }>(`/api/schedule-mgmt/import/sessions/${timetableId}`)
  return data
}

export async function patchImportSession(
  timetableId: string,
  body: {
    step?: number
    selected_period_ids?: string[]
    schedule_uploaded?: boolean
    teaching_uploaded?: boolean
  },
) {
  const { data } = await api.patch<{ ok: boolean }>(`/api/schedule-mgmt/import/sessions/${timetableId}`, body)
  return data
}

export async function postUploadSchedule(timetableId: string) {
  const { data } = await api.post<{ ok: boolean; message: string }>(
    `/api/schedule-mgmt/import/sessions/${timetableId}/upload-schedule`,
  )
  return data
}

export async function postUploadTeaching(timetableId: string) {
  const { data } = await api.post<{ ok: boolean; message: string }>(
    `/api/schedule-mgmt/import/sessions/${timetableId}/upload-teaching`,
  )
  return data
}

export async function fetchImportClassGrid(timetableId: string, classId: string, weekNumber: number) {
  const { data } = await api.get<{
    title_suffix: string
    week_number: number
    days: { dow: number; label: string }[]
    periods: { id: string; name: string; start: string; end: string }[]
    cells: { day: number; period_id: string; subject: string; teacher: string; color: string }[]
  }>(`/api/schedule-mgmt/import/sessions/${timetableId}/class-grid`, {
    params: { class_id: classId, week_number: weekNumber },
  })
  return data
}

export async function fetchImportTeacherGrid(timetableId: string, teacherId: string, weekNumber: number) {
  const { data } = await api.get<{
    teacher_id: string
    teacher_name: string
    week_number: number
    days: { dow: number; label: string }[]
    periods: { id: string; name: string; start: string; end: string }[]
    cells: { day: number; period_id: string; class_name: string; subject: string }[]
  }>(`/api/schedule-mgmt/import/sessions/${timetableId}/teacher-grid`, {
    params: { teacher_id: teacherId, week_number: weekNumber },
  })
  return data
}

export async function fetchImportTeachers(q?: string) {
  const { data } = await api.get<{ items: { id: string; name: string }[] }>('/api/schedule-mgmt/import/teachers', {
    params: q ? { q } : undefined,
  })
  return data.items
}

export async function fetchApplyInfo(timetableId: string) {
  const { data } = await api.get<{
    imported_weeks: number
    imported_days: number
    summary_text: string
    week_options: { value: number; label: string }[]
    default_date_start: string
    default_date_end: string
    term_range_text: string
  }>(`/api/schedule-mgmt/application/sessions/${timetableId}/info`)
  return data
}

export async function postApplySubmit(
  timetableId: string,
  body: {
    start_week_index: number
    date_start: string
    date_end: string
    apply_all_classes: boolean
    class_ids?: string[]
    apply_all_periods: boolean
    period_ids?: string[]
    update_teacher: boolean
  },
) {
  const { data } = await api.post<{ ok: boolean; message: string; item: ScheduleMgmtRow }>(
    `/api/schedule-mgmt/application/sessions/${timetableId}/apply`,
    body,
  )
  return data
}

export async function postExportMaster(timetableId: string) {
  const { data } = await api.post<{ ok: boolean; message: string }>(
    `/api/schedule-mgmt/timetables/${timetableId}/export-master`,
  )
  return data
}

export async function fetchAnomalies(timetableId: string) {
  const { data } = await api.get<{ items: unknown[]; message: string }>(
    `/api/schedule-mgmt/timetables/${timetableId}/anomalies`,
  )
  return data
}

export function scheduleTemplateScheduleUrl() {
  return apiUrl('/api/schedule-mgmt/templates/schedule')
}

export function scheduleTemplateTeachingUrl() {
  return apiUrl('/api/schedule-mgmt/templates/teaching')
}
