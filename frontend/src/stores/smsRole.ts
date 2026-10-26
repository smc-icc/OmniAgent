import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { fetchSmsTemplates } from '@/api/smsTemplates'

/**
 * 当前坐席在账号下的角色（administrator | agent）。
 *
 * 来源说明：auth 插件只填 currentUser，`accounts` 数组从未填充，
 * 所以前端拿不到角色。这里复用 GET /api/sms-templates 返回的 role 字段
 * （agent 也能读该接口，只会看到 approved 模板）。
 *
 * 仅用于「显示/隐藏入口」这类 UI 决策；真正的写权限由后端 403 兜底。
 */
export const useSmsRoleStore = defineStore('smsRole', () => {
  const role = ref('agent')
  const loaded = ref(false)
  let inflight: Promise<void> | null = null

  const isAdministrator = computed(() => role.value === 'administrator')

  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const res = await fetchSmsTemplates()
        role.value = res?.role === 'administrator' ? 'administrator' : 'agent'
      } catch {
        // 拉取失败按最小权限处理：不显示管理入口
        role.value = 'agent'
      } finally {
        loaded.value = true
        inflight = null
      }
    })()
    return inflight
  }

  function reset() {
    role.value = 'agent'
    loaded.value = false
    inflight = null
  }

  return { role, loaded, isAdministrator, load, reset }
})
