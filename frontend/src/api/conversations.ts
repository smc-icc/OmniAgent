import { api } from './client'

const ACCOUNT_ID = 1
const base = `/api/v1/accounts/${ACCOUNT_ID}/conversations`

export type ConversationStatus = 'open' | 'resolved' | 'pending' | 'snoozed'
export type ConversationPriority = 'low' | 'medium' | 'high' | 'urgent'

export async function toggleConversationStatus(
  id: number,
  status: ConversationStatus,
): Promise<void> {
  await api.post(`${base}/${id}/toggle_status`, { status })
}

export async function markConversationUnread(id: number): Promise<void> {
  await api.post(`${base}/${id}/unread`)
}

export async function updateConversationLastSeen(id: number): Promise<void> {
  await api.post(`${base}/${id}/update_last_seen`)
}

export async function muteConversation(id: number): Promise<void> {
  await api.post(`${base}/${id}/mute`)
}

export async function addConversationLabels(id: number, labels: string[]): Promise<void> {
  await api.post(`${base}/${id}/labels`, { labels })
}

export async function toggleConversationPriority(
  id: number,
  priority: ConversationPriority,
): Promise<void> {
  await api.post(`${base}/${id}/toggle_priority`, { priority })
}

export async function endOmniSession(id: string | number): Promise<void> {
  const sid = typeof id === 'number' ? `c${id}` : id
  await api.post(`/api/omnichannel/sessions/${sid}/end`)
}
