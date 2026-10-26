import { api } from '@/api/client'

export interface CaptainAssistant {
  id: number
  name: string
  description?: string
}

export async function replySuggestion(conversationId: number, content?: string): Promise<string[]> {
  const { data } = await api.post<{ suggestions: string[] }>(
    '/api/v1/accounts/1/captain/tasks/reply_suggestion',
    {
      conversation_id: conversationId,
      content: content?.trim() || '请根据上下文给出回复建议',
    },
  )
  return data.suggestions ?? []
}

export async function listAssistants(): Promise<CaptainAssistant[]> {
  const { data } = await api.get<CaptainAssistant[]>('/api/v1/accounts/1/captain/assistants')
  return Array.isArray(data) ? data : []
}
