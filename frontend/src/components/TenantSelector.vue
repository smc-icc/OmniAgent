<template>
  <el-select v-if="tenants.length" :model-value="access.accountId" aria-label="当前 VDN" size="small"
    style="width: 190px" :disabled="!systemSuperuser || tenants.length < 2" @change="switchTenant">
    <el-option v-for="t in tenants" :key="t.account_id" :value="t.account_id" :label="`VDN ${t.vdn_id} · ${t.name}`" />
  </el-select>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '@/api/client'
import { useAccessStore } from '@/stores/access'
import { disconnectSocket } from '@/services/socket'
const access = useAccessStore()
const tenants = ref<Array<{ vdn_id: number; account_id: number; name: string }>>([])
const systemSuperuser = ref(false)
onMounted(async () => {
  try {
    const { data } = await api.get('/api/access/tenants')
    tenants.value = data.tenants; systemSuperuser.value = data.system_superuser === true
  } catch { /* Legacy deployments have no managed tenant selector. Backend still fails closed. */ }
})
function switchTenant(accountId: number) {
  if (!systemSuperuser.value || !tenants.value.some(t => t.account_id === accountId)) return
  sessionStorage.setItem('omni.selected-account', String(accountId))
  disconnectSocket(); access.reset()
  // Full reload intentionally clears all per-tenant store/keep-alive caches before the next read/write.
  window.location.assign('/access-management')
}
</script>
