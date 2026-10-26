import { defineStore } from 'pinia'
import { ref } from 'vue'
import { accessApi } from '@/api/access'

export const useAccessStore = defineStore('access', () => {
  const permissions = ref<string[]>([])
  const loaded = ref(false)
  const agentId = ref(0)
  const accountId = ref(1)
  const administrator = ref(false)
  const systemSuperuser = ref(false)
  const vdnId = ref<number | null>(null)
  const scopes = ref<Record<string, string[]>>({})
  let inflight: Promise<void> | undefined
  async function refresh() {
    if (inflight) return inflight
    inflight = (async () => {
      try { const result = await accessApi.me(); accountId.value = result.accountId; administrator.value = result.administrator === true; systemSuperuser.value = result.systemSuperuser === true; agentId.value = result.agentId; vdnId.value = result.vdnId; permissions.value = result.permissions; scopes.value = result.scopes; loaded.value = true }
      catch { permissions.value = []; scopes.value = {}; loaded.value = false }
    })()
    try { await inflight } finally { inflight = undefined }
  }
  function can(code: string) { return permissions.value.includes(code) }
  function reset() { agentId.value = 0; accountId.value = 1; administrator.value = false; systemSuperuser.value = false; vdnId.value = null; permissions.value = []; scopes.value = {}; loaded.value = false }
  return { accountId, agentId, vdnId, administrator, systemSuperuser, permissions, scopes, loaded, refresh, can, reset }
})
