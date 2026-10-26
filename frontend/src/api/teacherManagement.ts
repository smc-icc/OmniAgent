import { api } from './client'

export interface TeacherTreeNode {
  id: string
  label: string
  children?: TeacherTreeNode[]
}

export interface TeacherRow {
  id: string
  name: string
  phone: string
  card_no: string
  groups: string[]
  groups_display: string
  teaching_assignments: string[]
  teaching_display: string
}

export interface TeacherListResponse {
  items: TeacherRow[]
  total: number
  page: number
  page_size: number
}

export interface DingTalkTeacherSyncResult {
  ok: boolean
  imported: number
  updated_names: number
  message: string
  tips?: string[]
}

export async function fetchTeacherTree() {
  const { data } = await api.get<{ nodes: TeacherTreeNode[] }>('/api/teachers/tree')
  return data.nodes
}

export async function fetchTeacherGroupOptions() {
  const { data } = await api.get<{ options: string[] }>('/api/teachers/group-options')
  return data.options
}

export async function fetchTeachers(params: {
  node_id?: string
  keyword?: string
  page?: number
  page_size?: number
}) {
  const { data } = await api.get<TeacherListResponse>('/api/teachers', { params })
  return data
}

export async function postTeacher(body: {
  name: string
  phone?: string
  card_no?: string
  groups?: string[]
}) {
  const { data } = await api.post<{ ok: boolean; teacher: TeacherRow }>('/api/teachers', body)
  return data.teacher
}

export async function patchTeacher(
  teacherId: string,
  body: { name?: string; phone?: string; card_no?: string; groups?: string[] },
) {
  const { data } = await api.patch<{ ok: boolean; teacher: TeacherRow }>(`/api/teachers/${teacherId}`, body)
  return data.teacher
}

export async function deleteTeacher(teacherId: string) {
  const { data } = await api.delete<{ ok: boolean }>(`/api/teachers/${teacherId}`)
  return data
}

export async function postTeachersBulkDelete(ids: string[]) {
  const { data } = await api.post<{ ok: boolean; removed: number }>('/api/teachers/bulk-delete', { ids })
  return data
}

export async function postTeacherDingTalkSync() {
  const { data } = await api.post<DingTalkTeacherSyncResult>('/api/teachers/dingtalk-sync')
  return data
}

export async function postTeacherBatchExport() {
  return api.post('/api/teachers/batch-export')
}

export async function postTeacherBatchImport() {
  return api.post('/api/teachers/batch-import')
}
