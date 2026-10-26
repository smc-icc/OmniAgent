import { api } from './client'

export type EntityKind = 'departments' | 'roles' | 'groups' | 'skills'
export interface Entity { id: number; name: string; parent_id?: number; system?: number; media_type_id?: number; business_type_id?: number; skill_element_id?: number }
export interface Operator {
  id: number; work_no: string; name: string; email: string; login_email: string; extension: string; called_tel: string; mobile: string
  enabled: number; default_group: number; sync_pending: number; client_release_mode: number; agent_release_mode: number
  auto_answer: number; not_play_work_no: number; hook_mode: number; use_tel_agent: number; tel_extension: string; auto_dial: number; auto_dial_no: string
}
export type DataScope = 'self' | 'group' | 'department' | 'account'
export interface Permission { id: number; name: string; value: number; subsystem: number; category: string; moduleName?: string; operation?: string; scopes?: DataScope[] }
export interface EffectivePermission extends Permission { source: 'role' | 'department' | 'direct'; owner_id: number }
export interface Extension { num: string; device: number; channel_group: string; channel: number; description: string; agent_mode: number }
export interface Bootstrap {
  vdn_id: number; users: Operator[]; departments: Entity[]; roles: Entity[]; groups: Entity[]; skills: Entity[]
  permissions: Permission[]; extensions: Extension[]; channel_groups: Entity[]; media_types: Entity[]; business_types: Entity[]; skill_elements: Entity[]
}
export const accessApi = {
  loginCodes: async (id: number) => (await api.get<{ codes: LoginCodeMetadata[] }>(`/api/access/users/${id}/login-codes`)).data,
  issueLoginCode: async (id: number) => (await api.post<IssuedLoginCode>(`/api/access/users/${id}/login-codes`, {})).data,
  revokeLoginCode: (id: number, codeId: string) => api.delete(`/api/access/users/${id}/login-codes/${encodeURIComponent(codeId)}`),
  me: async () => (await api.get<{ accountId: number; vdnId: number; systemSuperuser?: boolean; permissions: string[]; agentId: number; administrator: boolean; scopes: Record<string, DataScope[]> }>('/api/access/me')).data,
  extensionBootstrap: async () => (await api.get<Bootstrap>('/api/access/extension-management')).data,
  bootstrap: async () => (await api.get<Bootstrap>('/api/access/bootstrap')).data,
  assignments: async (kind: EntityKind, id: number) => (await api.get<{ member_ids: number[]; permission_ids: number[]; scopes: Record<number, DataScope> }>(`/api/access/entities/${kind}/${id}/assignments`)).data,
  userPermissions: async (id: number) => (await api.get<{ own_ids: number[]; effective: EffectivePermission[]; scopes: Record<number, DataScope> }>(`/api/access/users/${id}/permissions`)).data,
  saveUser: async (id: number | undefined, body: unknown) => (await api.request<{ sync_pending: boolean; message?: string }>({ method: id ? 'PUT' : 'POST', url: `/api/access/users${id ? `/${id}` : ''}`, data: body })).data,
  syncUser: async (id: number) => (await api.post<{ sync_pending: boolean }>(`/api/access/users/${id}/sync`)).data,
  saveEntity: async (kind: EntityKind, id: number | undefined, body: unknown) => (await api.request<{ id: number }>({ method: id ? 'PUT' : 'POST', url: `/api/access/entities/${kind}${id ? `/${id}` : ''}`, data: body })).data,
  deleteEntity: (kind: EntityKind, id: number) => api.delete(`/api/access/entities/${kind}/${id}`),
  members: (kind: EntityKind, id: number, action: 'add' | 'remove', user_ids: number[]) => api.patch(`/api/access/entities/${kind}/${id}/members`, { action, user_ids }),
  permission: (kind: EntityKind | 'users', id: number, permission_id: number, granted: boolean, data_scope?: DataScope) => api.patch(`/api/access/${kind === 'users' ? 'users' : `entities/${kind}`}/${id}/permissions`, { permission_id, granted, data_scope }),
  saveExtension: (original: string | undefined, body: Extension) => api.request({ method: original ? 'PUT' : 'POST', url: `/api/access/extensions${original ? `/${encodeURIComponent(original)}` : ''}`, data: body }),
  deleteExtension: (num: string) => api.delete(`/api/access/extensions/${encodeURIComponent(num)}`),
}
export interface LoginCodeMetadata { id: string; issuerId: number; issuedAt: number; expiresAt: number }
export interface IssuedLoginCode extends LoginCodeMetadata { code: string }
export function accessError(error: unknown): string {
  const response = (error as { response?: { data?: { error?: string; errors?: string[] } } })?.response?.data
  return response?.errors?.join('；') || response?.error || '请求失败，请检查服务连接后重试'
}
