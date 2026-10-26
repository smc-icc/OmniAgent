<template>
  <div class="vom-panel">
    <div class="vom-toolbar">
      <el-input
        v-model="query"
        placeholder="主叫号码 / 转写内容"
        clearable
        size="small"
        class="vom-search"
        :prefix-icon="Search"
      />
      <el-select v-model="filterStatus" placeholder="状态" clearable size="small" style="width: 120px">
        <el-option label="待处理" value="new" />
        <el-option label="已听" value="listened" />
        <el-option label="已归档" value="archived" />
      </el-select>
      <el-button type="primary" size="small" :loading="loading" @click="load">刷新</el-button>
      <span class="vom-tip">
        语音留言来自 IVR 未接来电；列表为空说明当前 VDN 没有新的语音留言。
      </span>
    </div>

    <el-table
      v-loading="loading"
      :data="filtered"
      border
      stripe
      size="small"
      class="vom-mt-table"
      max-height="440"
      empty-text="暂无语音留言"
    >
      <el-table-column prop="id" label="留言单号" width="90" />
      <el-table-column label="渠道" width="130">
        <template #default>
          <span class="ch-icons-inline">
            <el-icon class="ch-phone" title="电话"><Phone /></el-icon>
          </span>
          <span class="ch-name">电话留言</span>
        </template>
      </el-table-column>
      <el-table-column prop="caller_number" label="主叫" min-width="120" show-overflow-tooltip />
      <el-table-column label="时长" width="80">
        <template #default="{ row }">{{ fmtDuration(row.duration_sec) }}</template>
      </el-table-column>
      <el-table-column label="留言原因" width="160">
        <template #default="{ row }">
          <el-tag v-if="row.reason" type="warning" size="small" effect="plain">{{ row.reason }}</el-tag>
          <span v-else class="ch-name">—</span>
        </template>
      </el-table-column>
      <el-table-column label="转写" min-width="180" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.transcription">{{ row.transcription }}</span>
          <span v-else class="ch-name">—</span>
        </template>
      </el-table-column>
      <el-table-column label="留言时间" width="160">
        <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="88">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" :disabled="!row.audio_url" @click="play(row)">
            试听
          </el-button>
          <el-button
            link
            type="primary"
            size="small"
            :disabled="row.status !== 'new'"
            @click="markRead(row)"
          >
            标记已听
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Phone, Search } from '@element-plus/icons-vue'
import { api } from '@/api/client'

interface VmRow {
  id: string
  caller_number: string
  duration_sec: number
  transcription: string
  reason?: string
  channel_type?: string | null
  channels?: string[]
  status: string
  created_at: string
  audio_url: string
}

const STATUS_LABEL: Record<string, string> = {
  new: '待处理',
  listened: '已听',
  archived: '已归档',
}

const loading = ref(false)
const rows = ref<VmRow[]>([])
const query = ref('')
const filterStatus = ref('')

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return rows.value.filter((r) => {
    if (filterStatus.value && r.status !== filterStatus.value) return false
    if (!q) return true
    return (
      String(r.caller_number || '').toLowerCase().includes(q)
      || String(r.transcription || '').toLowerCase().includes(q)
    )
  })
})

function statusLabel(s: string): string {
  return STATUS_LABEL[s] ?? s
}

function statusType(s: string): 'warning' | 'success' | 'info' {
  if (s === 'new') return 'warning'
  if (s === 'listened') return 'success'
  return 'info'
}

function fmtDuration(sec: number): string {
  const n = Number(sec) || 0
  const m = Math.floor(n / 60)
  const s = n % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function fmtTime(v?: string): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleString('zh-CN', { hour12: false })
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get<{ items: VmRow[] }>('/api/v1/voicemails')
    rows.value = data.items || []
  } catch {
    rows.value = []
    ElMessage.error('加载语音留言失败')
  } finally {
    loading.value = false
  }
}

function play(row: VmRow) {
  if (!row.audio_url) return
  const base = api.defaults.baseURL || ''
  window.open(`${base}${row.audio_url}`, '_blank')
}

async function markRead(row: VmRow) {
  try {
    await api.put(`/api/v1/voicemails/${row.id}/read`)
    ElMessage.success('已标记为已听')
    await load()
  } catch (e) {
    ElMessage.error(`操作失败：${(e as Error).message}`)
  }
}

onMounted(load)
</script>

<style scoped>
.vom-panel {
  min-height: 320px;
}
.vom-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.vom-search {
  width: 240px;
}
.vom-tip {
  font-size: 12px;
  color: var(--oa-muted, #909399);
}
/* 与全媒体客服一致的渠道图标样式 */
.ch-icons-inline {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-right: 6px;
  vertical-align: middle;
}
.ch-icons-inline .el-icon {
  font-size: 12px;
  width: 17px;
  height: 17px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}
.ch-icons-inline .ch-phone {
  background: #4d7c0f;
}
.ch-name {
  font-size: 12px;
  color: #606266;
}
</style>
