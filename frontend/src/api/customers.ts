import { api } from './client'

export interface CrmLabel {
  id: number
  title: string
  color: string
  description?: string
}

export interface CustomerListItem {
  id: number
  name: string
  phone: string
  email: string
  location: string
  last_activity_at: string | null
  last_note_at?: string | null
  labels?: CrmLabel[]
}

export interface CustomerNote {
  id: number
  content: string
  user_id: number | null
  user_name: string
  created_at: string
}

export interface CustomerDetail {
  id: number
  name: string
  phone: string
  email: string
  location: string
  gender: string
  customer_type: string
  level: string
  id_number?: string
  ethnicity?: string
  company_id?: number | null
  company?: { id: number; name: string; domain: string; description: string } | null
  company_contacts?: Array<{
    id: number
    name: string
    phone: string
    email: string
    last_activity_at: string | null
  }>
  custom_attributes: Record<string, unknown>
  labels: CrmLabel[]
  notes: CustomerNote[]
  opportunities: Array<{
    id: number
    title: string
    stage: string
    amount: number | null
    currency: string
    status: string
    expected_close: string | null
    updated_at: string
  }>
  conversations: Array<{
    id: string
    status: number
    created_at: string | null
    last_activity_at: string | null
    inbox_id: number
    assignee_id: number | null
  }>
  call_records: Array<{
    begin_time: string
    end_time: string
    caller: string
    called: string
    talk_sec: number
    work_no: string
    satisficing: number | null
  }>
}

export interface TimelineItem {
  id: string
  type: 'conversation' | 'call' | 'note'
  at: string
  title: string
  summary?: string
  meta?: Record<string, unknown>
}

export async function fetchCustomers(params?: { q?: string; page?: number; page_size?: number }) {
  const { data } = await api.get<{
    total: number
    page: number
    page_size: number
    items: CustomerListItem[]
  }>('/api/customers', { params })
  return data
}

export async function fetchCustomer(id: number | string) {
  const { data } = await api.get<CustomerDetail>(`/api/customers/${id}`)
  return data
}

export async function patchCustomer(
  id: number | string,
  payload: Partial<{
    name: string
    phone: string
    email: string | null
    location: string
    gender: string
    customer_type: string
    level: string
    id_number: string
    ethnicity: string
    company_id: number | null
    custom_attributes: Record<string, unknown>
  }>,
) {
  const { data } = await api.patch<CustomerDetail>(`/api/customers/${id}`, payload)
  return data
}

export async function fetchCustomerTimeline(id: number | string, limit = 50) {
  const { data } = await api.get<{ items: TimelineItem[] }>(`/api/customers/${id}/timeline`, {
    params: { limit },
  })
  return data.items
}

export async function createCustomerNote(id: number | string, content: string) {
  const { data } = await api.post<CustomerNote>(`/api/customers/${id}/notes`, { content })
  return data
}

export async function deleteCustomerNote(id: number | string, noteId: number) {
  await api.delete(`/api/customers/${id}/notes/${noteId}`)
}

export async function putCustomerLabels(id: number | string, labelIds: number[]) {
  const { data } = await api.put<{ items: CrmLabel[] }>(`/api/customers/${id}/labels`, {
    label_ids: labelIds,
  })
  return data.items
}

export async function fetchCrmLabels() {
  const { data } = await api.get<{ items: CrmLabel[] }>('/api/crm/labels')
  return data.items
}

export async function fetchCompanies(q?: string) {
  const { data } = await api.get<{
    items: Array<{ id: number; name: string; domain: string; description: string }>
  }>('/api/companies', { params: q ? { q } : undefined })
  return data.items
}

export async function createCompany(payload: { name: string; domain?: string; description?: string }) {
  const { data } = await api.post<{ id: number; name: string; domain: string; description: string }>(
    '/api/companies',
    payload,
  )
  return data
}

export async function patchCompany(
  id: number,
  payload: Partial<{ name: string; domain: string | null; description: string | null }>,
) {
  const { data } = await api.patch<{ id: number; name: string; domain: string; description: string }>(
    `/api/companies/${id}`,
    payload,
  )
  return data
}

export async function deleteCompany(id: number) {
  await api.delete(`/api/companies/${id}`)
}

export async function fetchOpportunities(params?: { contact_id?: number; company_id?: number }) {
  const { data } = await api.get<{
    items: Array<{
      id: number
      title: string
      stage: string
      amount: number | null
      currency: string
      status: string
      contact_id: number | null
      company_id: number | null
      contact_name?: string
      company_name?: string
      expected_close: string | null
      updated_at: string
    }>
  }>('/api/opportunities', { params })
  return data.items
}

export async function createOpportunity(payload: {
  title: string
  stage?: string
  amount?: number | null
  contact_id?: number | null
  company_id?: number | null
  expected_close?: string | null
}) {
  const { data } = await api.post('/api/opportunities', payload)
  return data
}

export async function patchOpportunity(
  id: number,
  payload: Partial<{
    title: string
    stage: string
    amount: number | null
    status: string
    expected_close: string | null
  }>,
) {
  const { data } = await api.patch(`/api/opportunities/${id}`, payload)
  return data
}

export async function deleteOpportunity(id: number) {
  await api.delete(`/api/opportunities/${id}`)
}
