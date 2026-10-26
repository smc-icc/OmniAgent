import { api } from './client'

export async function fetchElectiveTaskMeta() {
  const { data } = await api.get('/api/elective-tasks/meta')
  return data as {
    campuses: { id: string; name: string }[]
    terms: { id: string; label: string }[]
    grade_options: { id: string; label: string }[]
    course_type_options: { value: string; label: string }[]
    gender_options: { value: string; label: string }[]
    status_options: { value: string; label: string }[]
  }
}

export async function fetchElectiveTasks(campusId: string, termId: string) {
  const { data } = await api.get<{ items: any[] }>('/api/elective-tasks', {
    params: { campus_id: campusId, term_id: termId },
  })
  return data.items
}

export async function postElectiveTask(body: Record<string, unknown>) {
  const { data } = await api.post<{ ok: boolean; item: any }>('/api/elective-tasks', body)
  return data.item
}

export async function fetchElectiveTaskDetail(taskId: string) {
  const { data } = await api.get<{ item: any }>(`/api/elective-tasks/${taskId}`)
  return data.item
}

export async function patchElectiveTask(taskId: string, body: Record<string, unknown>) {
  const { data } = await api.patch<{ ok: boolean; item: any }>(`/api/elective-tasks/${taskId}`, body)
  return data.item
}

export async function fetchElectiveCourses(taskId: string, params?: Record<string, string>) {
  const { data } = await api.get<{ items: any[] }>(`/api/elective-tasks/${taskId}/courses`, { params })
  return data.items
}

export async function postElectiveCourse(taskId: string, body: Record<string, unknown>) {
  const { data } = await api.post<{ ok: boolean; item: any }>(`/api/elective-tasks/${taskId}/courses`, body)
  return data.item
}

export async function getElectiveExport(taskId: string, exportType: string) {
  const { data } = await api.get<{ ok: boolean; message: string }>(`/api/elective-tasks/${taskId}/export`, {
    params: { export_type: exportType },
  })
  return data
}
