import { api } from './client'

export type CourseKind = 'subject' | 'extension'

export interface CourseMeta {
  school_name: string
  campuses: { id: string; name: string }[]
  grades: { id: string; label: string }[]
  grades_full_labels: { id: string; label: string; short_label: string }[]
  subject_categories: { id: string; label: string }[]
  tag_options: string[]
  extension_types: { id: string; label: string }[]
}

export interface CourseSubjectRow {
  id: string
  kind: 'subject'
  name: string
  subject_category: string
  grade_ids: string[]
  grades_display: string
  tags: string[]
  tags_display: string
}

export interface CourseExtensionRow {
  id: string
  kind: 'extension'
  name: string
  extension_type: string
  extension_type_label: string
  tags: string[]
  tags_display: string
}

export type CourseRow = CourseSubjectRow | CourseExtensionRow

export async function fetchCourseMeta() {
  const { data } = await api.get<CourseMeta>('/api/courses/meta')
  return data
}

export async function fetchCourses(kind: CourseKind) {
  const { data } = await api.get<{ items: CourseRow[] }>('/api/courses', { params: { kind } })
  return data.items
}

export async function postCourse(body: {
  kind: CourseKind
  name: string
  subject_category?: string
  grade_ids?: string[]
  tags?: string[]
  extension_type?: string
}) {
  const { data } = await api.post<{ ok: boolean; course: CourseRow }>('/api/courses', body)
  return data.course
}

export async function patchCourse(
  courseId: string,
  body: {
    name?: string
    subject_category?: string
    grade_ids?: string[]
    tags?: string[]
    extension_type?: string
  },
) {
  const { data } = await api.patch<{ ok: boolean; course: CourseRow }>(`/api/courses/${courseId}`, body)
  return data.course
}

export async function deleteCourse(courseId: string) {
  const { data } = await api.delete<{ ok: boolean }>(`/api/courses/${courseId}`)
  return data
}

export async function postCoursesBulkDelete(ids: string[]) {
  const { data } = await api.post<{ ok: boolean; removed: number }>('/api/courses/bulk-delete', { ids })
  return data
}

export async function postCourseBatchExport(kind: CourseKind) {
  const { data } = await api.post<{ ok: boolean; message: string }>('/api/courses/batch/export', {}, { params: { kind } })
  return data
}

export async function postCourseBatchImport(kind: CourseKind, campusId?: string) {
  const { data } = await api.post<{ ok: boolean; message: string }>('/api/courses/batch/import', {}, {
    params: { kind, campus_id: campusId || undefined },
  })
  return data
}

export async function getCourseBatchTemplate(kind: CourseKind) {
  const { data } = await api.get<{ ok: boolean; message: string }>('/api/courses/batch/template', {
    params: { kind },
  })
  return data
}
