import { ref, watch, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '@/api/client'
import { listAssistants, type CaptainAssistant } from '@/api/captain'

export function useSessionAi(sessionId: Ref<string | null>) {
  const autoReply = ref(false)
  const assistantId = ref<number | null>(null)
  const assistants = ref<CaptainAssistant[]>([])
  const loading = ref(false)

  async function loadAssistants() {
    try {
      assistants.value = await listAssistants()
      if (!assistantId.value && assistants.value[0]) {
        assistantId.value = assistants.value[0].id
      }
    } catch {
      assistants.value = []
    }
  }

  async function loadAiState() {
    if (!sessionId.value) {
      autoReply.value = false
      assistantId.value = null
      return
    }
    try {
      const { data } = await api.get<{ auto_reply: boolean; assistant_id: number | null }>(
        `/api/omnichannel/sessions/${sessionId.value}/ai`,
      )
      autoReply.value = !!data.auto_reply
      if (data.assistant_id) assistantId.value = data.assistant_id
    } catch {
      autoReply.value = false
    }
  }

  async function enableAutoReply(id?: number) {
    if (!sessionId.value) return
    loading.value = true
    try {
      const aid = id ?? assistantId.value ?? assistants.value[0]?.id ?? null
      await api.put(`/api/omnichannel/sessions/${sessionId.value}/ai`, {
        auto_reply: true,
        assistant_id: aid,
      })
      autoReply.value = true
      if (aid) assistantId.value = aid
      ElMessage.success('已开启 AI 自动回复托管')
    } catch {
      ElMessage.error('开启自动回复失败')
    } finally {
      loading.value = false
    }
  }

  async function disableAutoReply() {
    if (!sessionId.value) return
    loading.value = true
    try {
      await api.put(`/api/omnichannel/sessions/${sessionId.value}/ai`, { auto_reply: false })
      autoReply.value = false
      ElMessage.success('已停止 AI 自动回复')
    } catch {
      ElMessage.error('停止自动回复失败')
    } finally {
      loading.value = false
    }
  }

  watch(sessionId, () => {
    loadAiState()
  })

  return {
    autoReply,
    assistantId,
    assistants,
    loading,
    loadAssistants,
    loadAiState,
    enableAutoReply,
    disableAutoReply,
  }
}
