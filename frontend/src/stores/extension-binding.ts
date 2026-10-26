import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { extensionApi, type BindingSnapshot } from '@/api/extension-binding'
export const useExtensionBindingStore = defineStore('extension-binding', () => {
  const snapshot = ref<BindingSnapshot | null>(null),
    error = ref(''),
    panelOpen = ref(false)
  const binding = computed(
    () =>
      snapshot.value?.binding ?? {
        extension: '',
        version: 0,
        status: 'unbound' as const,
        conflict: null,
      },
  )
  let epoch = 0
  async function refresh() {
    const attempt = epoch
    try {
      const next = await extensionApi.snapshot()
      if (attempt !== epoch) return
      snapshot.value = next
      error.value = ''
    } catch (e) {
      if (attempt === epoch) error.value = '无法读取分机绑定，请稍后重试'
      throw e
    }
  }
  function reset() {
    epoch++
    snapshot.value = null
    error.value = ''
    panelOpen.value = false
  }
  return { snapshot, binding, error, panelOpen, refresh, reset }
})
