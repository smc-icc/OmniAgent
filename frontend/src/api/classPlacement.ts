import { api } from './client'

export type ClassPlacementTaskRow = {
  id: string
  name: string
  semester: string
  campus_name: string
  grade: string
  status_code: string
  status_label: string
}

export async function fetchClassPlacementMeta() {
  const { data } = await api.get<{
    campuses: { id: string; name: string }[]
    terms: { id: string; label: string }[]
    grades: { id: string; label: string }[]
  }>('/api/class-placement/meta')
  return data
}

export async function fetchClassPlacementTasks(params: { campus_id: string; page: number; page_size: number }) {
  const { data } = await api.get<{
    items: ClassPlacementTaskRow[]
    total: number
    page: number
    page_size: number
  }>('/api/class-placement/tasks', { params })
  return data
}

export async function postClassPlacementTask(body: {
  campus_id: string
  name: string
  term_id: string
  grade: string
}) {
  const { data } = await api.post<{ ok: boolean; task: ClassPlacementTaskRow }>('/api/class-placement/tasks', body)
  return data
}

export async function putClassPlacementTask(
  taskId: string,
  body: { name?: string; grade?: string },
) {
  const { data } = await api.put<{ ok: boolean; message: string }>(`/api/class-placement/tasks/${taskId}`, body)
  return data
}

export async function deleteClassPlacementTasks(ids: string[]) {
  const { data } = await api.delete<{ ok: boolean; deleted: number }>('/api/class-placement/tasks', {
    data: { ids },
  })
  return data
}

export type ClassPlacementDetail = {
  id: string
  name: string
  campus_id: string
  campus_name: string
  term_id: string
  term_label: string
  grade: string
  status_code: string
  status_label: string
  step: number
  placement_done: boolean
  class_count: number
  group_mode: string
  rules: { id: string; label: string }[]
  admin_classes: { id: string; name: string; student_count: number }[]
  student_total: number
  evaluation: null | {
    grouping_tab: string
    class_labels: string[]
    rows: { rule: string; cells: string[]; check_result: string }[]
  }
  result_classes: {
    id: string
    name: string
    display_name: string
    student_count: number
    male: number
    female: number
    ratio_label: string
    group_name: string
  }[]
}

export async function fetchClassPlacementTaskDetail(taskId: string) {
  const { data } = await api.get<ClassPlacementDetail>(`/api/class-placement/tasks/${taskId}`)
  return data
}

export async function fetchClassPlacementStudents(
  taskId: string,
  params: Record<string, string | number>,
) {
  const { data } = await api.get<{
    items: {
      id: string
      class_id: string
      class_name: string
      student_name: string
      student_no: string
      gender: string
      tag: string
      school: string
      group: string
    }[]
    total: number
    page: number
    page_size: number
  }>(`/api/class-placement/tasks/${taskId}/students`, { params })
  return data
}

export async function fetchClassPlacementFilterOptions(taskId: string) {
  const { data } = await api.get<{
    class_groups: { id: string; label: string }[]
    classes: { id: string; label: string }[]
    genders: { id: string; label: string }[]
    tags: { id: string; label: string }[]
    schools: { id: string; label: string }[]
  }>(`/api/class-placement/tasks/${taskId}/filter-options`)
  return data
}

export async function fetchClassPlacementSubjects(taskId: string) {
  const { data } = await api.get<{ items: { id: string; label: string }[] }>(
    `/api/class-placement/tasks/${taskId}/subjects`,
  )
  return data
}

export async function postClassPlacementAdminClass(taskId: string, name: string) {
  const { data } = await api.post<{ ok: boolean; item: { id: string; name: string; student_count: number } }>(
    `/api/class-placement/tasks/${taskId}/admin-classes`,
    { name },
  )
  return data
}

export async function postClassPlacementMoveStudents(taskId: string, student_ids: string[], target_class_id: string) {
  const { data } = await api.post<{ ok: boolean; message: string }>(
    `/api/class-placement/tasks/${taskId}/move-students`,
    { student_ids, target_class_id },
  )
  return data
}

export async function postClassPlacementSubjectTotal(
  taskId: string,
  subject_ids: string[],
  kind: 'score' | 'rank',
) {
  const { data } = await api.post<{ ok: boolean; message: string }>(
    `/api/class-placement/tasks/${taskId}/subject-total`,
    { subject_ids, kind },
  )
  return data
}

export async function postClassPlacementRules(
  taskId: string,
  body: { class_count: number; rules: { id: string; label: string }[] },
) {
  const { data } = await api.post<{ ok: boolean; message: string }>(
    `/api/class-placement/tasks/${taskId}/rules`,
    body,
  )
  return data
}

export async function postClassPlacementStep(taskId: string, step: number) {
  const { data } = await api.post<{ ok: boolean; step: number }>(`/api/class-placement/tasks/${taskId}/step`, {
    step,
  })
  return data
}

export async function postClassPlacementStart(taskId: string) {
  const { data } = await api.post<{ ok: boolean; message: string }>(
    `/api/class-placement/tasks/${taskId}/start-placement`,
    {},
  )
  return data
}

export async function postClassPlacementRecalc(taskId: string) {
  const { data } = await api.post<{ ok: boolean; message: string }>(
    `/api/class-placement/tasks/${taskId}/recalculate-evaluation`,
    {},
  )
  return data
}

export async function postClassPlacementApply(taskId: string) {
  const { data } = await api.post<{ ok: boolean; message: string }>(`/api/class-placement/tasks/${taskId}/apply`, {})
  return data
}

export async function postClassPlacementNotifyParents(taskId: string) {
  const { data } = await api.post<{ ok: boolean; message: string }>(
    `/api/class-placement/tasks/${taskId}/notify-parents`,
    {},
  )
  return data
}

export async function fetchClassPlacementNotifyCheck(taskId: string) {
  const { data } = await api.get<{
    total_missing: number
    items: { index: number; class_name: string; student_name: string; student_no: string }[]
  }>(`/api/class-placement/tasks/${taskId}/notify-check`)
  return data
}

export async function postClassPlacementExport(taskId: string) {
  const { data } = await api.post<{ ok: boolean; message: string }>(
    `/api/class-placement/tasks/${taskId}/export`,
    {},
  )
  return data
}
