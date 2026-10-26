import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/api/client'

export type MobileSessionTab = 'active' | 'queue' | 'history'

/** 与 /api/omnichannel/contacts 的返回结构一致，移动端只取列表展示需要的字段。 */
export interface MobileSession {
  id: string
  conversation_id?: number
  name: string
  code: string
  last_message: string
  time_label: string
  unread: number
  channel_group?: string
  channel_type?: string | null
  channels: string[]
  tags: string[]
  omni_lifecycle?: 'active' | 'ended'
  queued?: boolean
  queue_position?: number | null
}

interface ContactsResponse {
  items: MobileSession[]
  channel_summary?: Array<{ channel_group: string; unread: number }>
}

/**
 * 移动端会话列表。与桌面全媒体页共用后端接口，但独立持有状态，
 * 这样既不用改动 OmnichannelService.vue，也能让「恢复前台」统一刷新入口。
 */
export const useMobileSessionsStore = defineStore('mobileSessions', () => {
  const items = ref<MobileSession[]>([])
  const tab = ref<MobileSessionTab>('active')
  const keyword = ref('')
  const loading = ref(false)
  const error = ref('')
  const loadedAt = ref(0)

  const totalUnread = computed(() =>
    items.value.reduce((sum, it) => sum + (Number(it.unread) || 0), 0),
  )

  let seq = 0

  async function refresh(opts?: { silent?: boolean }) {
    const mySeq = ++seq
    if (!opts?.silent) loading.value = true
    error.value = ''
    try {
      const { data } = await api.get<ContactsResponse>('/api/omnichannel/contacts', {
        params: {
          tab: tab.value,
          q: keyword.value.trim() || undefined,
        },
      })
      // 慢请求返回时用户可能已切了 tab，丢弃过期结果
      if (mySeq !== seq) return
      items.value = Array.isArray(data.items) ? data.items : []
      loadedAt.value = Date.now()
    } catch (e) {
      if (mySeq !== seq) return
      error.value = e instanceof Error ? e.message : '加载会话失败'
    } finally {
      if (mySeq === seq) loading.value = false
    }
  }

  async function setTab(next: MobileSessionTab) {
    if (tab.value === next) return
    tab.value = next
    await refresh()
  }

  async function search(q: string) {
    keyword.value = q
    await refresh()
  }

  function find(id: string): MobileSession | undefined {
    return items.value.find((it) => it.id === id)
  }

  function markRead(id: string) {
    const target = items.value.find((it) => it.id === id)
    if (target) target.unread = 0
  }

  return {
    items,
    tab,
    keyword,
    loading,
    error,
    loadedAt,
    totalUnread,
    refresh,
    setTab,
    search,
    find,
    markRead,
  }
})
