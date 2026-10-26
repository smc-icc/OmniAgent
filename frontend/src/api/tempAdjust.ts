import { api } from './client'

export interface TempAdjustMeta {
  campuses: { id: string; name: string }[]
  weeks: { week_number: number; start: string; end: string; label: string }[]
  teacher_options: { id: string; name: string }[]
  apply_type_options: { value: string; label: string }[]
  reason_options: { value: string; label: string }[]
  status_options: { value: string; label: string }[]
}

export interface TempAdjustRecord {
  id: string
  campus_id: string
  created_at: string
  applicant_id: string
  applicant_name: string
  apply_type: string
  reason_type: string
  target_period: string
  detail: string
  status: string
  status_label: string
}

export async function fetchTempAdjustMeta() {
  const { data } = await api.get<TempAdjustMeta>('/api/temp-adjust/meta')
  return data
}

export async function fetchTempAdjustRecords(params: {
  campus_id: string
  status?: string
  q_teacher?: string
  apply_type?: string
}) {
  const { data } = await api.get<{ items: TempAdjustRecord[] }>('/api/temp-adjust/records', { params })
  return data.items
}

export async function fetchTempAdjustStats(campusId: string) {
  const { data } = await api.get<{ total: number; pending: number; approved: number; rejected: number }>(
    '/api/temp-adjust/stats',
    { params: { campus_id: campusId } },
  )
  return data
}

export async function fetchTempAdjustRecordDetail(recordId: string) {
  const { data } = await api.get<{
    id: string
    applicant_name: string
    reason_type: string
    remark: string
    status_label: string
    changes: string[]
    flows: { step: string; user: string; action: string; at: string }[]
  }>(`/api/temp-adjust/records/${recordId}`)
  return data
}

export async function fetchTempAdjustCreateGrid(teacherId: string, weekNumber: number) {
  const { data } = await api.get<{
    teacher_name: string
    days: { dow: number; iso: string; date_md: string; label: string }[]
    periods: { id: string; name: string; start: string; end: string }[]
    own_cells: { day: number; period_id: string; line: string }[]
    same_subject_cells: { day: number; period_id: string; line: string }[]
    other_cells: { day: number; period_id: string; line: string }[]
  }>('/api/temp-adjust/create-grid', { params: { teacher_id: teacherId, week_number: weekNumber } })
  return data
}

export async function postTempAdjustRecord(body: {
  campus_id: string
  applicant_id: string
  date: string
  apply_type: string
  reason_type: string
  remark: string
  week_number: number
  selected_cells: { day: number; period_id: string }[]
}) {
  const { data } = await api.post<{ ok: boolean; item: TempAdjustRecord }>('/api/temp-adjust/records', body)
  return data
}

export async function fetchTempAdjustApprovalSettings() {
  const { data } = await api.get<{
    campus_id: string
    approval_type: string
    notify_change_to: string[]
    notify_remind_at: string[]
    ack_roles: string[]
    allow_view_others_timetable: boolean
    reason_options: { value: string; label: string }[]
    approval_rules: { scope_labels: string[]; teachers: string[] }[]
    cc_rules: { scope_labels: string[]; teachers: string[] }[]
  }>('/api/temp-adjust/approval-settings')
  return data
}

export async function putTempAdjustApprovalSettings(body: {
  approval_type: string
  notify_change_to: string[]
  notify_remind_at: string[]
  ack_roles: string[]
  allow_view_others_timetable: boolean
  reason_options: { value: string; label: string }[]
}) {
  const { data } = await api.put<{ ok: boolean }>('/api/temp-adjust/approval-settings', body)
  return data
}
