import { api } from './client'

export interface ClassroomCampus {
  id: string
  name: string
}

export interface CourseOption {
  id: string
  label: string
}

export interface ClassroomMeta {
  campuses: ClassroomCampus[]
  course_options: CourseOption[]
}

export interface ClassroomRow {
  id: string
  name: string
  campus_id: string
  campus_name: string
  course_ids: string[]
  courses_display: string
  capacity: number | null | undefined
}

export async function fetchClassroomMeta() {
  const { data } = await api.get<ClassroomMeta>('/api/classrooms/meta')
  return data
}

export async function fetchClassrooms(campusId?: string) {
  const { data } = await api.get<{ items: ClassroomRow[] }>('/api/classrooms', {
    params: campusId ? { campus_id: campusId } : {},
  })
  return data.items
}

export async function postClassroom(body: {
  name: string
  campus_id: string
  course_ids?: string[]
  capacity?: number | null
}) {
  const { data } = await api.post<{ ok: boolean; classroom: ClassroomRow }>('/api/classrooms', body)
  return data.classroom
}

export async function patchClassroom(
  roomId: string,
  body: {
    name?: string
    campus_id?: string
    course_ids?: string[]
    capacity?: number | null
  },
) {
  const { data } = await api.patch<{ ok: boolean; classroom: ClassroomRow }>(`/api/classrooms/${roomId}`, body)
  return data.classroom
}

export async function postClassroomsBulkDelete(ids: string[]) {
  const { data } = await api.post<{ ok: boolean; removed: number }>('/api/classrooms/bulk-delete', { ids })
  return data
}

export async function postClassroomBatchExport() {
  const { data } = await api.post<{ ok: boolean; message: string }>('/api/classrooms/batch/export', {})
  return data
}

export async function postClassroomBatchImport() {
  const { data } = await api.post<{ ok: boolean; message: string }>('/api/classrooms/batch/import', {})
  return data
}

export async function getClassroomBatchTemplate() {
  const { data } = await api.get<{ ok: boolean; message: string }>('/api/classrooms/batch/template')
  return data
}
