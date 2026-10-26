import { api } from './client'
export interface Binding {
  extension: string
  version: number
  status: 'bound' | 'unbound'
  conflict: string | null
}
export interface BindingRequest {
  id: string
  user_id: number
  action: 'bind' | 'unbind' | 'replace'
  old_extension: string
  target_extension: string
  expected_version: number
  status: string
  reason: string
}
export interface BindingOperation {
  id: string
  phase: string
  error: string
}
export interface BindingSnapshot {
  binding: Binding
  request: BindingRequest | null
  operation: BindingOperation | null
  permissions: string[]
  voice: {
    state: 'unbound' | 'signing_in' | 'signed_in' | 'failed' | 'signed_out'
    error: string
    call_active?: boolean
  }
}
export interface Change {
  extension: string
  expected_version: number
  idempotency_key: string
}
export interface ChangeResult {
  status: string
  operation_id?: string
  message?: string
}
export const extensionApi = {
  snapshot: async () => (await api.get<BindingSnapshot>('/api/agent/extension-binding')).data,
  options: async () =>
    (
      await api.get<{ extensions: Array<{ num: string; description: string }> }>(
        '/api/agent/extension-options',
      )
    ).data.extensions,
  request: async (body: Change) =>
    (await api.post<BindingRequest>('/api/agent/extension-requests', body)).data,
  cancel: (id: string) => api.delete('/api/agent/extension-requests/' + encodeURIComponent(id)),
  change: async (body: Change) =>
    (
      await api.request<ChangeResult>({
        method: body.extension ? 'PUT' : 'DELETE',
        url: '/api/agent/extension-binding',
        data: body,
      })
    ).data,
  retry: async (id: string) =>
    (await api.post<ChangeResult>('/api/agent/extension-binding/retry', { operation_id: id })).data,
  signIn: async (version: number) =>
    (
      await api.post<{ state: string; agent_id: number; binding_version: number }>(
        '/api/agent/voice/sign-in',
        { binding_version: version },
      )
    ).data,
  startupFailure: (version: number) =>
    api.post('/api/agent/voice/startup-failure', { binding_version: version }),
  signOut: () => api.post('/api/agent/voice/sign-out', {}),
  requests: async () =>
    (await api.get<{ requests: BindingRequest[] }>('/api/access/extension-requests')).data.requests,
  approve: async (id: string) =>
    (
      await api.post<ChangeResult>(
        '/api/access/extension-requests/' + encodeURIComponent(id) + '/approve',
        {},
      )
    ).data,
  reject: (id: string, reason: string) =>
    api.post('/api/access/extension-requests/' + encodeURIComponent(id) + '/reject', { reason }),
  target: async (id: number) =>
    (
      await api.get<{
        binding: Binding
        extensions: Array<{ num: string; description: string }>
        operation: BindingOperation | null
      }>('/api/access/users/' + id + '/extension-binding')
    ).data,
  assign: async (id: number, body: Change) =>
    (
      await api.request<ChangeResult>({
        method: body.extension ? 'PUT' : 'DELETE',
        url: '/api/access/users/' + id + '/extension-binding',
        data: body,
      })
    ).data,
}
