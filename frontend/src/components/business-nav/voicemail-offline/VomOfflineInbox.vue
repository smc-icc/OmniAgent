<template>
  <div class="vom-panel">
    <div class="vom-toolbar">
      <el-input
        v-model="query"
        placeholder="会话 ID / 访客 / 关键字"
        clearable
        size="small"
        class="vom-search"
        :prefix-icon="Search"
      />
      <el-select v-model="filterChannel" placeholder="渠道" clearable size="small" style="width: 140px">
        <el-option v-for="c in channelOptions" :key="c.value" :label="c.label" :value="c.value" />
      </el-select>
      <el-select v-model="filterStatus" placeholder="状态" clearable size="small" style="width: 120px">
        <el-option label="已解决" value="resolved" />
        <el-option label="挂起" value="pending" />
      </el-select>
      <el-button type="primary" size="small" :loading="loading" @click="load">刷新</el-button>
      <span class="vom-tip">离线消息 = 已结束或挂起、但客户留下过消息的会话，供事后跟进。</span>
    </div>

    <el-table
      v-loading="loading"
      :data="filtered"
      border
      stripe
      size="small"
      class="vom-mt-table"
      max-height="440"
      empty-text="暂无离线消息"
    >
      <el-table-column label="会话号" width="100">
        <template #default="{ row }">#{{ row.conversationId }}</template>
      </el-table-column>
      <el-table-column label="渠道" width="130">
        <template #default="{ row }">
          <span class="ch-icons-inline">
            <el-icon v-if="row.channels?.includes('wechat')" class="ch-wechat" title="微信公众号"><ChatDotRound /></el-icon>
            <el-icon v-if="row.channels?.includes('wecom')" class="ch-wecom" title="企业微信"><OfficeBuilding /></el-icon>
            <el-icon v-if="row.channels?.includes('miniprogram')" class="ch-miniprogram" title="小程序"><Grid /></el-icon>
            <el-icon v-if="row.channels?.includes('web')" class="ch-web" title="网站 Widget"><Monitor /></el-icon>
            <el-icon v-if="row.channels?.includes('weibo')" class="ch-weibo" title="微博"><Share /></el-icon>
            <el-icon v-if="row.channels?.includes('email')" class="ch-email" title="邮件"><Message /></el-icon>
            <el-icon v-if="row.channels?.includes('sms')" class="ch-sms" title="短信"><Cellphone /></el-icon>
            <el-icon v-if="row.channels?.includes('api')" class="ch-api" title="API / APP"><Connection /></el-icon>
            <el-icon v-if="row.channels?.includes('social')" class="ch-social" title="社媒"><ChatLineRound /></el-icon>
            <el-icon v-if="row.channels?.includes('phone')" class="ch-phone" title="电话"><Phone /></el-icon>
          </span>
          <span class="ch-name">{{ row.inboxName || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="visitor" label="访客" width="110" show-overflow-tooltip />
      <el-table-column prop="lastMsg" label="最后一条消息" min-width="200" show-overflow-tooltip />
      <el-table-column label="离线原因" width="170">
        <template #default="{ row }">
          <el-tag v-if="row.reason" type="warning" size="small" effect="plain">{{ row.reason }}</el-tag>
          <span v-else class="ch-name">—</span>
        </template>
      </el-table-column>
      <el-table-column label="离线时间" width="160">
        <template #default="{ row }">{{ fmtTime(row.offlineTime) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="96">
        <template #default="{ row }">
          <el-tag :type="row.status === 'resolved' ? 'success' : 'info'" size="small">
            {{ row.status === 'resolved' ? '已解决' : '挂起' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="110" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openInWorkspace(row)">查看会话</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import {
  Cellphone,
  ChatDotRound,
  ChatLineRound,
  Connection,
  Grid,
  Message,
  Monitor,
  OfficeBuilding,
  Phone,
  Search,
  Share,
} from '@element-plus/icons-vue'
import { api } from '@/api/client'

interface OffRow {
  id: string
  conversationId: number
  visitor: string
  lastMsg: string
  offlineTime: string | null
  status: string
  reason?: string
  channelType?: string | null
  inboxName?: string | null
  channels?: string[]
}

const CHANNEL_LABEL: Record<string, string> = {
  wechat: '微信',
  wecom: '企业微信',
  miniprogram: '小程序',
  web: '网站',
  weibo: '微博',
  email: '邮件',
  sms: '短信',
  api: 'API',
  social: '社媒',
  phone: '电话',
}

const router = useRouter()
const loading = ref(false)
const rows = ref<OffRow[]>([])
const query = ref('')
const filterChannel = ref('')
const filterStatus = ref('')

const channelOptions = computed(() => {
  const seen = new Set<string>()
  for (const r of rows.value) for (const c of r.channels ?? []) seen.add(c)
  return [...seen].map((v) => ({ value: v, label: CHANNEL_LABEL[v] ?? v }))
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return rows.value.filter((r) => {
    if (filterStatus.value && r.status !== filterStatus.value) return false
    if (filterChannel.value && !(r.channels ?? []).includes(filterChannel.value)) return false
    if (!q) return true
    return (
      String(r.conversationId).includes(q)
      || String(r.visitor || '').toLowerCase().includes(q)
      || String(r.lastMsg || '').toLowerCase().includes(q)
    )
  })
})

function fmtTime(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleString('zh-CN', { hour12: false })
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get<{ items: OffRow[] }>('/api/itr/offline-messages')
    rows.value = data.items || []
  } catch {
    rows.value = []
    ElMessage.error('加载离线消息失败')
  } finally {
    loading.value = false
  }
}

function openInWorkspace(row: OffRow) {
  router.push({ path: '/omnichannel', query: { conv: String(row.conversationId) } })
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
  width: 220px;
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
.ch-icons-inline .ch-weibo { background: #dc2626; }
.ch-icons-inline .ch-email { background: #ea580c; }
.ch-icons-inline .ch-phone { background: #4d7c0f; }
.ch-icons-inline .ch-wechat { background: #16a34a; }
.ch-icons-inline .ch-sms { background: #0d9488; }
.ch-icons-inline .ch-web { background: #0284c7; }
.ch-icons-inline .ch-api { background: #1a3be6; }
.ch-icons-inline .ch-wecom { background: #7c3aed; }
.ch-icons-inline .ch-miniprogram { background: #c026d3; }
.ch-icons-inline .ch-social { background: #db2777; }
.ch-name {
  font-size: 12px;
  color: #606266;
}
</style>
