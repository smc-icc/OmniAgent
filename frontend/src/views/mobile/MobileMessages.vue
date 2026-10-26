<template>
  <div class="mm-wrap">
    <el-segmented v-model="status" :options="statusOptions" size="large" @change="reload" />

    <el-skeleton v-if="loading && items.length === 0" :rows="5" animated class="mm-skeleton" />
    <el-empty v-else-if="items.length === 0" description="暂无留言" />

    <ul v-else class="mm-list">
      <li v-for="item in items" :key="item.id" class="mm-item">
        <div class="mm-head">
          <span class="mm-caller">{{ item.caller_name || item.caller_number }}</span>
          <span class="mm-time">{{ formatTime(item.created_at) }}</span>
        </div>
        <p v-if="item.transcription" class="mm-text">{{ item.transcription }}</p>
        <div class="mm-foot">
          <span class="mm-dur">{{ formatDuration(item.duration_sec) }}</span>
          <el-tag v-if="item.status === 'new'" size="small" type="danger" effect="plain">未听</el-tag>
          <div class="mm-ops">
            <el-button
              v-if="item.audio_url"
              size="small"
              text
              type="primary"
              @click="play(item)"
            >
              播放
            </el-button>
            <el-button size="small" text @click="callBack(item)">回电</el-button>
          </div>
        </div>
        <audio
          v-if="playingId === item.id && item.audio_url"
          :src="item.audio_url"
          controls
          autoplay
          class="mm-audio"
        />
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fetchVoicemails, markVoicemailRead, type VoicemailItem } from '@/api/voicemail'
import { onMobileHydrate } from '@/services/mobile-foreground'

defineOptions({ name: 'MobileMessages' })

const router = useRouter()

const items = ref<VoicemailItem[]>([])
const loading = ref(false)
const status = ref('new')
const playingId = ref('')

const statusOptions = [
  { label: '未听', value: 'new' },
  { label: '已听', value: 'listened' },
  { label: '全部', value: '' },
]

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} `
    + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(Number(sec) || 0))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

async function reload() {
  loading.value = true
  try {
    const data = await fetchVoicemails(status.value ? { status: status.value } : undefined)
    items.value = Array.isArray(data.items) ? data.items : []
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载留言失败')
  } finally {
    loading.value = false
  }
}

async function play(item: VoicemailItem) {
  playingId.value = item.id
  if (item.status !== 'new') return
  try {
    await markVoicemailRead(item.id)
    item.status = 'listened'
  } catch {
    /* 标记失败不影响播放 */
  }
}

/** 回电走话务页，复用同一套外呼链路 */
function callBack(item: VoicemailItem) {
  const number = (item.caller_number || '').trim()
  if (!number) {
    ElMessage.warning('该留言没有回电号码')
    return
  }
  void router.push({ path: '/m/dialer', query: { callee: number } })
}

let offHydrate: (() => void) | null = null
let offCreated: (() => void) | null = null

onMounted(() => {
  void reload()
  offHydrate = onMobileHydrate(() => void reload())
  const onCreated = () => void reload()
  window.addEventListener('omni:voicemail-created', onCreated)
  offCreated = () => window.removeEventListener('omni:voicemail-created', onCreated)
})

onUnmounted(() => {
  offHydrate?.()
  offCreated?.()
})
</script>

<style scoped>
.mm-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mm-skeleton {
  padding: 12px;
  background: var(--oa-card);
  border-radius: 8px;
}

.mm-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mm-item {
  background: var(--oa-card);
  border-radius: 8px;
  padding: 10px 12px;
}

.mm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.mm-caller {
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.mm-time {
  font-size: 11px;
  color: var(--oa-muted);
}

.mm-text {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.45;
  color: #606266;
}

.mm-foot {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.mm-dur {
  font-size: 12px;
  color: var(--oa-muted);
  font-variant-numeric: tabular-nums;
}
.mm-ops {
  margin-left: auto;
  display: flex;
  gap: 4px;
}

.mm-audio {
  margin-top: 8px;
  width: 100%;
}
</style>
