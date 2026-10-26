<template>
  <div class="mc-wrap">
    <header class="mc-head">
      <el-button text class="mc-back" @click="back">
        <el-icon :size="18"><ArrowLeft /></el-icon>
      </el-button>
      <div class="mc-title">
        <span class="mc-name">{{ title }}</span>
        <span v-if="subtitle" class="mc-sub">{{ subtitle }}</span>
      </div>
      <el-button text class="mc-profile" :disabled="!customerId" @click="openCustomer">
        <el-icon :size="18"><User /></el-icon>
      </el-button>
    </header>

    <div ref="scroller" class="mc-thread oa-scroll">
      <el-skeleton v-if="loading && thread.length === 0" :rows="5" animated />
      <el-empty v-else-if="thread.length === 0" description="暂无消息" />
      <div
        v-for="msg in thread"
        v-else
        :key="msg.id"
        class="mc-row"
        :class="msg.from === 'agent' ? 'is-agent' : 'is-customer'"
      >
        <div class="mc-bubble">
          <span v-if="msg.text" class="mc-text">{{ msg.text }}</span>
          <img
            v-else-if="msg.kind === 'image' && msg.file_url"
            :src="msg.file_url"
            class="mc-image"
            alt="图片消息"
          />
          <a v-else-if="msg.file_url" :href="msg.file_url" target="_blank" class="mc-file">
            {{ msg.file_name || '附件' }}
          </a>
          <span v-else class="mc-text mc-text--muted">[{{ msg.kind }}]</span>
        </div>
        <span class="mc-time">{{ msg.time }}</span>
      </div>
    </div>

    <footer class="mc-composer">
      <el-input
        v-model="draft"
        type="textarea"
        :rows="1"
        :autosize="{ minRows: 1, maxRows: 4 }"
        placeholder="输入消息"
        resize="none"
        @keyup.enter.exact="send"
      />
      <el-button
        type="primary"
        :loading="sending"
        :disabled="!canSend"
        class="mc-send"
        @click="send"
      >
        发送
      </el-button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, User } from '@element-plus/icons-vue'
import { api } from '@/api/client'
import { messages as socketMessages } from '@/services/socket'
import { useMobileSessionsStore } from '@/stores/mobileSessions'
import { channelLabel } from '@/utils/channel'
import type { ThreadMsg } from '@/types/thread-message'

defineOptions({ name: 'MobileChat' })

const route = useRoute()
const router = useRouter()
const store = useMobileSessionsStore()

const sessionId = computed(() => String(route.params.id ?? ''))
const conversationId = computed(() => {
  const fromQuery = Number(route.query.conv)
  if (Number.isFinite(fromQuery) && fromQuery > 0) return fromQuery
  return Number(store.find(sessionId.value)?.conversation_id ?? 0)
})

const session = computed(() => store.find(sessionId.value))
const title = computed(() => session.value?.name || session.value?.code || '会话')
/** code 是后端的展示字段，取不到手机号/邮箱时会回落成「未知」，此时没有可查的客户标识。 */
const customerId = computed(() => {
  const code = session.value?.code ?? ''
  return code === '未知' ? '' : code
})

const subtitle = computed(() => {
  if (!session.value) return ''
  return [customerId.value, channelLabel(session.value.channel_type)].filter(Boolean).join(' · ')
})

const thread = ref<ThreadMsg[]>([])
const loading = ref(false)
const draft = ref('')
const sending = ref(false)
const scroller = ref<HTMLElement | null>(null)

const canSend = computed(() => draft.value.trim().length > 0 && conversationId.value > 0)

async function scrollToBottom() {
  await nextTick()
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

async function load() {
  if (!sessionId.value) return
  loading.value = true
  try {
    const { data } = await api.get<{ messages: ThreadMsg[] }>(
      `/api/omnichannel/sessions/${sessionId.value}/messages`,
    )
    thread.value = Array.isArray(data.messages) ? data.messages : []
    await scrollToBottom()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载消息失败')
  } finally {
    loading.value = false
  }
}

async function send() {
  const text = draft.value.trim()
  if (!text) return
  if (conversationId.value <= 0) {
    ElMessage.warning('该会话不支持发送消息')
    return
  }
  sending.value = true
  try {
    await api.post(`/api/v1/accounts/1/conversations/${conversationId.value}/messages`, {
      content: text,
      message_type: 'outgoing',
      private: false,
    })
    draft.value = ''
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '发送失败')
  } finally {
    sending.value = false
  }
}

function back() {
  void router.push('/m/sessions')
}

function openCustomer() {
  if (!customerId.value) return
  void router.push({ name: 'm-customer', params: { id: customerId.value } })
}

// 实时消息：socket.ts 已把 message.created 收进共享数组，这里只挑本会话的增量
const seen = new Set<string>()
watch(
  () => socketMessages.value.length,
  () => {
    const latest = socketMessages.value[socketMessages.value.length - 1]
    if (!latest || Number(latest.conversation_id) !== conversationId.value) return
    const key = String(latest.id)
    if (seen.has(key)) return
    seen.add(key)
    void load()
  },
)

watch(sessionId, () => {
  seen.clear()
  void load()
})

function onVisible() {
  if (document.visibilityState === 'visible') void load()
}

onMounted(() => {
  void load()
  document.addEventListener('visibilitychange', onVisible)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisible)
})
</script>

<style scoped>
.mc-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--oa-bg);
}

.mc-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 44px;
  padding: 0 4px;
  background: var(--oa-card);
  border-bottom: 1px solid #e4e7ed;
}
.mc-back,
.mc-profile {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
}
.mc-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.mc-name {
  font-size: 15px;
  font-weight: 600;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mc-sub {
  font-size: 11px;
  color: var(--oa-muted);
}

.mc-thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mc-row {
  display: flex;
  flex-direction: column;
  max-width: 78%;
}
.mc-row.is-agent {
  align-self: flex-end;
  align-items: flex-end;
}
.mc-row.is-customer {
  align-self: flex-start;
  align-items: flex-start;
}

.mc-bubble {
  padding: 8px 11px;
  border-radius: 10px;
  background: var(--oa-card);
  font-size: 14px;
  line-height: 1.45;
  word-break: break-word;
}
.mc-row.is-agent .mc-bubble {
  background: var(--oa-primary);
  color: #fff;
}

.mc-text--muted {
  color: var(--oa-muted);
}

.mc-image {
  display: block;
  max-width: 200px;
  border-radius: 6px;
}

.mc-file {
  color: inherit;
  text-decoration: underline;
}

.mc-time {
  margin-top: 2px;
  font-size: 10px;
  color: var(--oa-muted);
}

.mc-composer {
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px calc(8px + var(--oa-safe-right)) 8px calc(8px + var(--oa-safe-left));
  background: var(--oa-card);
  border-top: 1px solid #e4e7ed;
}
.mc-send {
  flex-shrink: 0;
  height: 36px;
}
</style>
