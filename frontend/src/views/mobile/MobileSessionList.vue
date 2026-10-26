<template>
  <div class="ms-wrap">
    <div class="ms-toolbar">
      <el-input
        v-model="keyword"
        placeholder="搜索客户 / 号码"
        clearable
        size="large"
        :prefix-icon="Search"
        @keyup.enter="onSearch"
        @clear="onSearch"
      />
      <el-segmented v-model="tab" :options="tabOptions" size="large" @change="onTab" />
    </div>

    <el-skeleton v-if="store.loading && store.items.length === 0" :rows="6" animated class="ms-skeleton" />

    <el-alert v-else-if="store.error" type="error" :closable="false" :title="store.error" show-icon>
      <el-button size="small" @click="reload">重试</el-button>
    </el-alert>

    <el-empty v-else-if="store.items.length === 0" description="暂无会话" />

    <ul v-else class="ms-list">
      <li
        v-for="item in store.items"
        :key="item.id"
        class="ms-item"
        @click="open(item)"
      >
        <div class="ms-avatar" :class="`ch-${item.channel_group || 'other'}`">
          {{ avatarText(item.name) }}
        </div>
        <div class="ms-body">
          <div class="ms-line1">
            <span class="ms-name">{{ item.name || item.code || '未知客户' }}</span>
            <span class="ms-time">{{ item.time_label }}</span>
          </div>
          <div class="ms-line2">
            <span class="ms-last">{{ item.last_message || '（暂无消息）' }}</span>
            <span v-if="item.unread > 0" class="ms-unread">
              {{ item.unread > 99 ? '99+' : item.unread }}
            </span>
          </div>
          <div v-if="item.queued" class="ms-line3">
            排队中<template v-if="item.queue_position"> · 第 {{ item.queue_position }} 位</template>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Search } from '@element-plus/icons-vue'
import { useMobileSessionsStore, type MobileSession, type MobileSessionTab } from '@/stores/mobileSessions'
import { onMobileHydrate } from '@/services/mobile-foreground'

defineOptions({ name: 'MobileSessionList' })

const store = useMobileSessionsStore()
const router = useRouter()

const keyword = ref(store.keyword)
const tab = ref<MobileSessionTab>(store.tab)

const tabOptions = [
  { label: '进行中', value: 'active' },
  { label: '排队', value: 'queue' },
  { label: '历史', value: 'history' },
]

function avatarText(name: string): string {
  const trimmed = (name || '').trim()
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : '?'
}

function reload() {
  void store.refresh()
}

function onSearch() {
  void store.search(keyword.value)
}

function onTab(value: string | number | boolean) {
  void store.setTab(value as MobileSessionTab)
}

function open(item: MobileSession) {
  store.markRead(item.id)
  void router.push({
    name: 'm-chat',
    params: { id: item.id },
    query: item.conversation_id ? { conv: String(item.conversation_id) } : undefined,
  })
}

let offHydrate: (() => void) | null = null
let offMessage: (() => void) | null = null

function onNewMessage() {
  void store.refresh({ silent: true })
}

onMounted(() => {
  // keep-alive 复用时不重复拉取，超过 30 秒才刷新
  if (store.items.length === 0 || Date.now() - store.loadedAt > 30_000) reload()
  offHydrate = onMobileHydrate(() => reload())
  window.addEventListener('omni:unread-changed', onNewMessage)
  window.addEventListener('omni:conversation-lifecycle-changed', onNewMessage)
  offMessage = () => {
    window.removeEventListener('omni:unread-changed', onNewMessage)
    window.removeEventListener('omni:conversation-lifecycle-changed', onNewMessage)
  }
})

onUnmounted(() => {
  offHydrate?.()
  offMessage?.()
})
</script>

<style scoped>
.ms-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ms-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ms-skeleton {
  padding: 12px;
  background: var(--oa-card);
  border-radius: 8px;
}

.ms-list {
  list-style: none;
  margin: 0;
  padding: 0;
  background: var(--oa-card);
  border-radius: 8px;
  overflow: hidden;
}

.ms-item {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid #f0f2f5;
  /* 列表项整行可点，触控高度不低于 56px */
  min-height: 56px;
  align-items: center;
}
.ms-item:last-child {
  border-bottom: none;
}
.ms-item:active {
  background: #f5f7fa;
}

.ms-avatar {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 600;
  background: var(--oa-primary);
}
.ms-avatar.ch-wechat {
  background: #07c160;
}
.ms-avatar.ch-phone {
  background: #ff9f1c;
}
.ms-avatar.ch-email {
  background: #7a5af8;
}

.ms-body {
  flex: 1;
  min-width: 0;
}

.ms-line1,
.ms-line2 {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ms-name {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ms-time {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--oa-muted);
}

.ms-last {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--oa-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ms-unread {
  flex-shrink: 0;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  box-sizing: border-box;
  border-radius: 9px;
  background: #f56c6c;
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

.ms-line3 {
  margin-top: 2px;
  font-size: 11px;
  color: #e6a23c;
}
</style>
