import { api } from './client'
export interface Operator { id: number; name: string; work_no: string }
export interface RecipientGroup { id: number; name: string; operator_ids: number[] }
export interface RecipientCatalog { operators: Operator[]; categories: Record<string, RecipientGroup[]> }
export interface AnnouncementInput {
  title: string; body: string; type: 'system' | 'exam' | 'training' | 'emergency'
  status: 'draft' | 'published'; audience_mode: 'all' | 'selected'; recipient_ids: number[]
  starts_at: string; ends_at: string | null
}
export interface ManagedAnnouncement extends AnnouncementInput { id: string; published_at: string }
export async function fetchRecipients() { return (await api.get<RecipientCatalog>('/api/announcements/recipients')).data }
export async function fetchManagedAnnouncements(page: number, limit = 20) {
  return (await api.get<{ items: ManagedAnnouncement[]; total: number }>('/api/announcements/manage', { params: { page, limit } })).data
}
export async function saveAnnouncement(input: AnnouncementInput, id?: string) {
  return id ? api.put(`/api/announcements/manage/${id}`, input) : api.post('/api/announcements/manage', input)
}
export async function deleteAnnouncement(id: string) { return api.delete(`/api/announcements/manage/${id}`) }
export async function saveRecipientGroup(input: { name: string; operator_ids: number[] }, id?: number) {
  return id ? api.put(`/api/announcements/groups/${id}`, input) : api.post('/api/announcements/groups', input)
}
export async function deleteRecipientGroup(id: number) { return api.delete(`/api/announcements/groups/${id}`) }
