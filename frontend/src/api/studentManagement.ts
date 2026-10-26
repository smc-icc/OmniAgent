import { api } from './client'

export interface TreeNode {
  id: string
  label: string
  children?: TreeNode[]
}

export interface AdminClassRow {
  id: string
  display_name: string
  student_count: number
  group_name: string
  teacher_name: string
}

export interface GradeSummary {
  grade_id: string
  grade_label: string
  title: string
  class_count: number
  student_total: number
  sections: { group_name: string; classes: AdminClassRow[] }[]
}

export interface StudentRow {
  id: string
  name: string
  student_no: string
  gender: string
  class_label: string
  care_session: string
  rotating_data: string
  card_no: string
  parents: string
  level?: string
  /** 兼容旧列「托管/参与」 */
  participate?: string
}

export interface ClassRosterResponse {
  class: AdminClassRow & { id: string; group_display?: string }
  class_label_full?: string
  students: StudentRow[]
}

export interface StudentMetaOptions {
  care_sessions: string[]
  rotating_options: string[]
}

export interface StudentCreatePayload {
  class_id: string
  name: string
  student_no?: string
  gender?: string
  care_session?: string
  rotating_data?: string
  card_no?: string
  parents?: string
  level?: string
}

export type StudentPatchPayload = Partial<Omit<StudentCreatePayload, 'class_id'>>

export interface DingTalkSyncResult {
  summary: { campuses: number; grades: number; classes: number; students: number }
  unmatched: { id: string; campus: string; segment: string; grade: string; class_name: string }[]
  message?: string
}

export interface ClassOption {
  value: string
  label: string
}

export interface NonadminItem {
  id: string
  name: string
  student_count: number
}

export async function fetchStudentTree(kind: 'admin' | 'nonadmin') {
  const { data } = await api.get<{ nodes: TreeNode[] }>('/api/students/tree', { params: { kind } })
  return data.nodes
}

export async function fetchGradeSummary(gradeId: string) {
  const { data } = await api.get<GradeSummary>('/api/students/grade-summary', { params: { grade_id: gradeId } })
  return data
}

export async function fetchClassRoster(classId: string) {
  const { data } = await api.get<ClassRosterResponse>('/api/students/class-roster', { params: { class_id: classId } })
  return data
}

export async function fetchStudentMetaOptions() {
  const { data } = await api.get<StudentMetaOptions>('/api/students/meta-options')
  return data
}

export async function postStudent(body: StudentCreatePayload) {
  const { data } = await api.post<{ ok: boolean; student: StudentRow }>('/api/students', body)
  return data.student
}

export async function patchStudent(studentId: string, body: StudentPatchPayload) {
  const { data } = await api.patch<{ ok: boolean; student: StudentRow }>(`/api/students/${studentId}`, body)
  return data.student
}

export async function postStudentsBulkDelete(classId: string, studentIds: string[]) {
  const { data } = await api.post<{ ok: boolean; removed: number }>('/api/students/bulk-delete', {
    class_id: classId,
    student_ids: studentIds,
  })
  return data
}

export async function fetchSystemClassOptions() {
  const { data } = await api.get<{ options: ClassOption[] }>('/api/students/system-class-options')
  return data.options
}

export async function postDingTalkSync() {
  const { data } = await api.post<DingTalkSyncResult>('/api/students/dingtalk-sync')
  return data
}

export async function postDingTalkConfirm(mappings: { unmatched_id: string; system_class_id: string }[]) {
  const { data } = await api.post<{ ok: boolean; applied: number }>('/api/students/dingtalk-sync/confirm', {
    mappings,
  })
  return data
}

export async function patchStudentClass(
  classId: string,
  body: { display_name?: string; group_name?: string; teacher_name?: string },
) {
  const { data } = await api.patch<{ ok: boolean; class: AdminClassRow }>(`/api/students/classes/${classId}`, body)
  return data.class
}

export async function postBatchExport() {
  return api.post('/api/students/batch-export')
}

export async function postBatchImport(kind: 'admin' | 'nonadmin') {
  return api.post('/api/students/batch-import', {}, { params: { kind } })
}

export async function fetchNonadminSummary(nodeId: string) {
  const { data } = await api.get<{
    title: string
    class_count: number
    student_total: number
    items: NonadminItem[]
  }>('/api/students/nonadmin-summary', { params: { node_id: nodeId } })
  return data
}
