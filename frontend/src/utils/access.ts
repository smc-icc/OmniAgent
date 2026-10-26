import type { Directive } from 'vue'
import { watchEffect } from 'vue'
import { useAccessStore } from '@/stores/access'
import routes from '@/generated/access-routes.json'

const patterns = routes.map(r => ({ ...r, pattern: new RegExp('^' + r.path.split('/').map(part => part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/') + '$') }))
export function requestPermission(method: string, url: string) {
  const path = new URL(url, 'http://omni.local').pathname
  if (path === '/api/access/tenants') return undefined
  return patterns.find(r => r.method === method.toUpperCase() && r.pattern.test(path))?.policy?.permission
}
export const pagePermissions: Record<string, string> = {
  knowledge: 'knowledge.read',
  omnichannel: 'conversation.read', messages: 'voicemail.read', outbound: 'outbound.read', monitor: 'monitor.read',
  inspection: 'inspection.read', 'inspection-detail': 'inspection.read', 'inspection-manage': 'inspection.read',
  customers: 'customer.read', 'customer-profile': 'customer.read', opportunities: 'opportunity.read', 'access-management': 'access.manage', wallboard: 'report.read',
}
const stops = new WeakMap<HTMLElement, () => void>()
export const permissionDirective: Directive<HTMLElement, string> = {
  mounted(el, binding) {
    const access = useAccessStore()
    const initial = el.style.display
    stops.set(el, watchEffect(() => {
      const allowed = access.can(binding.value)
      el.style.display = allowed ? initial : 'none'
      el.setAttribute('aria-hidden', String(!allowed))
    }))
  },
  unmounted(el) { stops.get(el)?.(); stops.delete(el) },
}
