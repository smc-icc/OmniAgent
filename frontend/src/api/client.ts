import axios from 'axios'
import { resolveApiBaseUrl } from '@/utils/platform'

const baseURL = resolveApiBaseUrl()

export const api = axios.create({
  baseURL: baseURL || undefined,
  timeout: 15000,
})

api.interceptors.request.use(async config => {
  // A selected tenant is only a selector; the backend revalidates mapping/membership on every request.
  const selected = sessionStorage.getItem('omni.selected-account');
  if (selected && /^[1-9]\d*$/.test(selected) && !String(config.url || '').startsWith('/auth/sign_in')) config.headers.set('X-Account-Id', selected);
  const { requestPermission } = await import('@/utils/access')
  const permission = requestPermission(config.method || 'GET', config.url || '')
  if (!permission) return config
  const { useAccessStore } = await import('@/stores/access')
  const access = useAccessStore()
  if (!access.loaded) await access.refresh()
  if (!access.can(permission)) {
    throw new axios.AxiosError('没有此操作权限', 'ERR_ACCESS_DENIED', config, undefined, { status: 403, statusText: 'Forbidden', headers: {}, config, data: { error: '没有此操作权限', error_code: 'access_denied' } })
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const code = err?.response?.data?.error_code
    if (err?.response?.status === 401 && code === 'session_replaced') {
      const url = String(err?.config?.url ?? '')
      if (!url.includes('/auth/sign_out') && !url.includes('/auth/sign_in')) {
        void import('@/stores/auth').then(({ useAuthStore }) =>
          useAuthStore().forceLogoutToLogin(),
        ).catch(() => { /* ignore */ })
      }
    }
    return Promise.reject(err)
  },
)

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const root = resolveApiBaseUrl()
  return `${root}${p}`
}
