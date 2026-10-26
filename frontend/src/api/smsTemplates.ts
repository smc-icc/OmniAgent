import { api } from './client'

/** 模板变量定义（与后端 sms_templates.variables 对应） */
export interface SmsTemplateVariable {
  key: string
  label: string
  source:
    | 'manual'
    | 'contact.name'
    | 'contact.phone_number'
    | 'conversation.display_id'
    | 'agent.name'
    | 'date.today'
  required: boolean
  default?: string
}

export interface SmsTemplate {
  id: number
  account_id: number
  name: string
  category: 'notice' | 'followup' | 'marketing'
  signature: string
  body: string
  variables: SmsTemplateVariable[]
  provider: string | null
  provider_template_id: string | null
  status: 'draft' | 'pending' | 'approved' | 'disabled'
  updated_at?: string
}

export interface SmsSendContext {
  templates: SmsTemplate[]
  contact: { id: number; name: string; phone_number: string | null; email: string | null } | null
  conversation: { id: number; display_id: number } | null
  role: string
}

export async function fetchSmsSendContext(conversationId?: number | null): Promise<SmsSendContext> {
  const { data } = await api.get('/api/sms-templates/send-context', {
    params: conversationId ? { conversationId } : {},
  })
  return data
}

export async function fetchSmsTemplates(): Promise<{ items: SmsTemplate[]; role: string }> {
  const { data } = await api.get('/api/sms-templates')
  return data
}

export async function createSmsTemplate(payload: Partial<SmsTemplate>): Promise<SmsTemplate> {
  const { data } = await api.post('/api/sms-templates', payload)
  return data.data
}

export async function updateSmsTemplate(id: number, payload: Partial<SmsTemplate>): Promise<SmsTemplate> {
  const { data } = await api.put(`/api/sms-templates/${id}`, payload)
  return data.data
}

export async function deleteSmsTemplate(id: number): Promise<void> {
  await api.delete(`/api/sms-templates/${id}`)
}

export async function sendSmsFromTemplate(
  id: number,
  payload: { to: string; variables: Record<string, string>; conversationId?: number },
): Promise<{ text: string; messageId: number | null }> {
  const { data } = await api.post(`/api/sms-templates/${id}/send`, payload)
  return { text: data.text, messageId: data.messageId ?? null }
}
