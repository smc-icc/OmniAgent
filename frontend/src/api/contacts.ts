import { api } from './client'

export interface ContactEntry {
  id: string
  name: string
  phone: string
  extension?: string
  department: string
  position: string
  email?: string
  avatar?: string
  status: 'online' | 'offline' | 'busy'
}

export interface ContactGroup {
  name: string
  items: ContactEntry[]
}

export interface ContactsResponse {
  groups: ContactGroup[]
  total: number
}

export async function fetchContacts(params?: { q?: string; department?: string }): Promise<ContactsResponse> {
  const { data } = await api.get('/api/v1/contacts/directory', { params })
  return data
}

export async function searchContacts(query: string): Promise<ContactEntry[]> {
  const { data } = await api.get('/api/v1/contacts/directory/search', { params: { q: query } })
  return data.items ?? data
}
