<template>
  <div class="vm-root">
    <div class="vm-header">
      <h3 class="vm-title">📞 语音留言</h3>
      <span class="vm-count">未读 {{ unreadCount }} 条</span>
    </div>

    <el-input v-model="search" placeholder="搜索来电号码或内容..." clearable class="vm-search" />

    <el-table :data="filteredItems" stripe border size="small" v-loading="loading" class="vm-table" @row-click="onRowClick">
      <el-table-column label="状态" width="72">
        <template #default="{ row }">
          <el-tag v-if="row.status === 'new'" type="danger" size="small" effect="dark">● 未读</el-tag>
          <el-tag v-else-if="row.status === 'listened'" type="info" size="small">已听</el-tag>
          <el-tag v-else size="small">已归档</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="caller_number" label="来电号码" width="140" />
      <el-table-column prop="caller_name" label="姓名" width="100" />
      <el-table-column label="时长" width="80">
        <template #default="{ row }">{{ fmtDuration(row.duration_sec) }}</template>
      </el-table-column>
      <el-table-column prop="transcription" label="语音转写" min-width="280" show-overflow-tooltip />
      <el-table-column label="时间" width="160">
        <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.audio_url" size="small" type="primary" link @click.stop="playAudio(row)">▶ 播放</el-button>
          <el-button size="small" link @click.stop="markRead(row)">已读</el-button>
          <el-button size="small" type="danger" link @click.stop="removeItem(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="playerVisible" title="语音播放" width="400px" :close-on-click-modal="true">
      <audio v-if="currentAudio" controls autoplay class="vm-audio">
        <source :src="currentAudio" type="audio/wav" />
      </audio>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import { fetchVoicemails, markVoicemailRead, deleteVoicemail, type VoicemailItem } from '@/api/voicemail'

const items = ref<VoicemailItem[]>([])
const loading = ref(false)
const search = ref('')
const unreadCount = computed(() => items.value.filter(i => i.status === 'new').length)
const playerVisible = ref(false)
const currentAudio = ref('')

const filteredItems = computed(() => {
  if (!search.value) return items.value
  const q = search.value.toLowerCase()
  return items.value.filter(i => i.caller_number.includes(q) || i.transcription?.toLowerCase().includes(q) || i.caller_name?.toLowerCase().includes(q))
})

async function load() {
  loading.value = true
  try {
    const res = await fetchVoicemails()
    items.value = res.items ?? []
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
}

function onRowClick(row: VoicemailItem) {
  if (row.status === 'new') markRead(row)
}

async function markRead(row: VoicemailItem) {
  row.status = 'listened'
  try { await markVoicemailRead(row.id) } catch { /* ignore */ }
  ElMessage.success('已标记为已读')
}

async function removeItem(row: VoicemailItem) {
  await ElMessageBox.confirm('确定删除该留言吗？', '确认删除', { type: 'warning' })
  try { await deleteVoicemail(row.id) } catch { /* ignore */ }
  items.value = items.value.filter(i => i.id !== row.id)
  ElMessage.success('已删除')
}

function playAudio(row: VoicemailItem) {
  currentAudio.value = row.audio_url ?? ''
  playerVisible.value = true
}

function fmtDuration(s: number) {
  const m = Math.floor(s / 60), sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(() => {
  void load()
  window.addEventListener('omni:voicemail-created', onCreated)
})
onUnmounted(() => {
  window.removeEventListener('omni:voicemail-created', onCreated)
})

function onCreated(ev: Event) {
  const detail = (ev as CustomEvent).detail as { callerNumber?: string } | undefined
  ElNotification({
    title: '新语音留言',
    message: detail?.callerNumber ? `来电 ${detail.callerNumber}` : '收到一条新留言',
    type: 'info',
  })
  void load()
}
</script>

<style scoped>
.vm-root { padding: 16px; background: var(--oa-card, #fff); border-radius: 8px; min-height: 360px; }
.vm-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.vm-title { margin: 0; font-size: 18px; }
.vm-count { color: var(--el-color-danger); font-weight: 600; }
.vm-search { max-width: 360px; margin-bottom: 12px; }
.vm-table { cursor: pointer; }
.vm-audio { width: 100%; margin-top: 8px; }
</style>
