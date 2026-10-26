import { api } from './client'

export interface RoleSummary {
  id: string
  scope: 'school' | 'campus'
  name: string
  description: string
  campus_id: string | null
  campus_name: string | null
  member_preview: { id: string; label: string }[]
  member_count: number
}

export interface RoleDetail extends RoleSummary {
  permission_pc_ids: string[]
  permission_mobile_ids: string[]
}

export interface RoleOverview {
  demo_campus_name: string
  school_section: { title: string; roles: RoleSummary[] }
  campus_sections: { campus_id: string; campus_name: string; roles: RoleSummary[] }[]
}

export interface PermNode {
  id: string
  label: string
  children?: PermNode[]
}

export interface MobilePerm {
  id: string
  label: string
}

export async function fetchRolesOverview() {
  const { data } = await api.get<RoleOverview>('/api/roles/overview')
  return data
}

export async function fetchPermissionsCatalog() {
  const { data } = await api.get<{ pc_tree: PermNode[]; mobile: MobilePerm[] }>('/api/roles/permissions/catalog')
  return data
}

export async function fetchRoleDetail(roleId: string) {
  const { data } = await api.get<{ role: RoleDetail }>(`/api/roles/${roleId}`)
  return data.role
}

export async function postRole(body: {
  name: string
  description: string
  campus_id?: string
  permission_pc_ids?: string[]
  permission_mobile_ids?: string[]
}) {
  const { data } = await api.post<{ ok: boolean; role: RoleDetail }>('/api/roles', body)
  return data.role
}

export async function patchRole(
  roleId: string,
  body: {
    name?: string
    description?: string
    permission_pc_ids?: string[]
    permission_mobile_ids?: string[]
  },
) {
  const { data } = await api.patch<{ ok: boolean; role: RoleDetail }>(`/api/roles/${roleId}`, body)
  return data.role
}

export async function deleteRole(roleId: string) {
  const { data } = await api.delete<{ ok: boolean }>(`/api/roles/${roleId}`)
  return data
}

export async function fetchRoleMembers(roleId: string, keyword?: string) {
  const { data } = await api.get<{ items: { id: string; name: string }[] }>(`/api/roles/${roleId}/members`, {
    params: { keyword: keyword || undefined },
  })
  return data.items
}

export async function postRoleMembers(roleId: string, teacherIds: string[]) {
  const { data } = await api.post<{ ok: boolean; count: number }>(`/api/roles/${roleId}/members`, {
    teacher_ids: teacherIds,
  })
  return data
}

export async function deleteRoleMember(roleId: string, teacherId: string) {
  const { data } = await api.delete<{ ok: boolean }>(`/api/roles/${roleId}/members/${teacherId}`)
  return data
}

export async function fetchAssignableTeacherPool(roleId: string, keyword?: string) {
  const { data } = await api.get<{ items: { key: string; label: string }[] }>('/api/roles/assign-teachers/pool', {
    params: { role_id: roleId, keyword: keyword || undefined },
  })
  return data.items
}

export async function fetchAllocationCampuses() {
  const { data } = await api.get<{ items: { id: string; name: string }[] }>('/api/roles/allocation/campuses')
  return data.items
}

export async function fetchAllocationTeachers(params: {
  campus_id?: string
  keyword?: string
  page?: number
  page_size?: number
}) {
  const { data } = await api.get<{
    items: {
      id: string
      display_name: string
      account_masked: string
      account_plain: string
      campus_id: string
      campus_name: string
    }[]
    total: number
    page: number
    page_size: number
  }>('/api/roles/allocation/teachers', { params })
  return data
}

export async function patchAllocationTeacher(teacherId: string, campusId: string) {
  const { data } = await api.patch<{ ok: boolean }>(`/api/roles/allocation/teachers/${teacherId}`, {
    campus_id: campusId,
  })
  return data
}

export async function postAllocationSync() {
  const { data } = await api.post<{ ok: boolean; message: string }>('/api/roles/allocation/sync-contacts')
  return data
}

export async function postAllocationExportTemplate() {
  return api.post('/api/roles/allocation/export-template')
}

export async function postAllocationExportData() {
  return api.post('/api/roles/allocation/export-data')
}
