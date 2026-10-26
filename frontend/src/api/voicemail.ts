import { api } from './client'

export interface VoicemailItem {
  id: string
  caller_number: string
  caller_name?: string
  duration_sec: number
  transcription: string
  status: 'new' | 'listened' | 'archived'
  created_at: string
  audio_url?: string
}

export interface VoicemailListResponse {
  items: VoicemailItem[]
  total: number
  unread_count: number
}

export async function fetchVoicemails(params?: { status?: string; page?: number }): Promise<VoicemailListResponse> {
  const { data } = await api.get('/api/v1/voicemails', { params })
  return data
}

export async function markVoicemailRead(id: string): Promise<void> {
  await api.put(`/api/v1/voicemails/${id}/read`)
}

export async function deleteVoicemail(id: string): Promise<void> {
  await api.delete(`/api/v1/voicemails/${id}`)
}
