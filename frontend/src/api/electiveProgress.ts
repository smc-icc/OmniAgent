import { api } from './client'

export async function fetchElectiveProgressMeta(campusId: string, termId: string) {
  const { data } = await api.get('/api/elective-progress/meta', {
    params: { campus_id: campusId, term_id: termId },
  })
  return data as {
    grade_options: { id: string; label: string }[]
    class_options: { id: string; label: string }[]
    progress_options: { value: string; label: string }[]
    student_status_options: { value: string; label: string }[]
    course_result_options: { value: string; label: string }[]
    course_type_options: { value: string; label: string }[]
    period_options: { value: string; label: string }[]
    tasks: { id: string; name: string }[]
  }
}

export async function fetchElectiveProgressClasses(params: Record<string, string | number>) {
  const { data } = await api.get<{
    items: {
      id: string
      grade: string
      class_name: string
      head_count: number
      selected_count: number
      progress_pct: number
    }[]
    total: number
    page: number
    page_size: number
  }>('/api/elective-progress/classes', { params })
  return data
}

export async function fetchElectiveProgressStudents(params: Record<string, string | number>) {
  const { data } = await api.get<{
    items: {
      id: string
      class_name: string
      student_name: string
      student_no: string
      gender: string
      status: string
      course_names: string
      source: string
    }[]
    total: number
    page: number
    page_size: number
  }>('/api/elective-progress/students', { params })
  return data
}

export async function fetchElectiveProgressCourses(params: Record<string, string | number>) {
  const { data } = await api.get<{
    items: {
      id: string
      course_name: string
      course_code: string
      course_type: string
      topic_name: string
      grade: string
      teacher_name: string
      place: string
      max_students: number
      selected_count: number
    }[]
    total: number
    page: number
    page_size: number
  }>('/api/elective-progress/courses', { params })
  return data
}

export async function postElectiveCheckAccounts(taskId: string) {
  const { data } = await api.post<{ ok: boolean; message: string }>(
    '/api/elective-progress/actions/check-accounts',
    {},
    { params: { task_id: taskId } },
  )
  return data
}

export async function postElectiveUpdateStudents(taskId: string) {
  const { data } = await api.post<{ ok: boolean; message: string }>(
    '/api/elective-progress/actions/update-students',
    {},
    { params: { task_id: taskId } },
  )
  return data
}

export async function postElectiveNotify(taskId: string) {
  const { data } = await api.post<{ ok: boolean; message: string }>(
    '/api/elective-progress/actions/notify',
    {},
    { params: { task_id: taskId } },
  )
  return data
}

export async function postElectiveEnable(taskId: string) {
  const { data } = await api.post<{ ok: boolean; message: string }>(
    '/api/elective-progress/actions/enable',
    {},
    { params: { task_id: taskId } },
  )
  return data
}

export async function fetchElectiveApplyRows(taskId: string) {
  const { data } = await api.get<{
    items: {
      id: string
      topic_name: string
      course_name: string
      course_type: string
      teacher_name: string
      classroom: string
      class_time: string
      selected_count: number
      schedule_grade: string
      match_status: string
    }[]
  }>('/api/elective-progress/apply-rows', { params: { task_id: taskId } })
  return data.items
}

export async function postElectiveApplyClass(taskId: string, rowIds: string[]) {
  const { data } = await api.post<{ ok: boolean; message: string }>('/api/elective-progress/apply-class', {
    task_id: taskId,
    row_ids: rowIds,
  })
  return data
}

export async function postElectiveApplyTimetable(
  taskId: string,
  rowIds: string[],
  dateStart: string,
  dateEnd: string,
) {
  const { data } = await api.post<{ ok: boolean; message: string }>('/api/elective-progress/apply-timetable', {
    task_id: taskId,
    row_ids: rowIds,
    date_start: dateStart,
    date_end: dateEnd,
  })
  return data
}

export async function getElectiveProgressExport(taskId: string, kind: string) {
  const { data } = await api.get<{ ok: boolean; message: string }>('/api/elective-progress/export', {
    params: { task_id: taskId, kind },
  })
  return data
}

export async function postElectiveImportPreselect(taskId: string) {
  const { data } = await api.post<{ ok: boolean; message: string }>(
    '/api/elective-progress/import-preselect',
    {},
    { params: { task_id: taskId } },
  )
  return data
}

export async function postElectiveValidateAnomalies(taskId: string) {
  const { data } = await api.post<{ ok: boolean; message: string }>(
    '/api/elective-progress/validate-anomalies',
    {},
    { params: { task_id: taskId } },
  )
  return data
}
