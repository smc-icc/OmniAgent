<template>
  <div class="vom-online">
    <div class="vom-toolbar">
      <el-button type="primary" size="small" :loading="loading" @click="load">刷新</el-button>
      <el-tag v-if="pendingCount > 0" type="danger" size="small" effect="dark">
        待认领 {{ pendingCount }}
      </el-tag>
      <el-tag v-else type="info" size="small">全部已认领</el-tag>
      <span class="vom-tip">
        访客在非工作时间或排队溢出时留言，在此认领后进入全媒体客服处理。
      </span>
    </div>

    <el-table
      v-loading="loading"
      :data="items"
      border
      stripe
      size="small"
      empty-text="暂无在线留言"
      max-height="440"
    >
      <el-table-column prop="conversationId" label="会话号" width="100">
        <template #default="{ row }">#{{ row.conversationId }}</template>
      </el-table-column>
      <el-table-column label="渠道" width="120">
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
          <span class="ch-name">{{ row.inboxName || row.channelType || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="content" label="留言内容" min-width="220" show-overflow-tooltip />
      <el-table-column label="留言原因" width="150">
        <template #default="{ row }">
          <el-tag v-if="row.reason" type="warning" size="small" effect="plain">{{ row.reason }}</el-tag>
          <span v-else class="ch-name">—</span>
        </template>
      </el-table-column>
      <el-table-column label="留言时间" width="180">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="row.status === 'open' ? 'warning' : 'success'" size="small">
            {{ STATUS_LABEL[row.status] ?? row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="row.status === 'open'"
            type="primary"
            link
            size="small"
            @click="claim(row)"
          >
            认领并接入
          </el-button>
          <el-button v-else type="primary" link size="small" @click="openInWorkspace(row)">
            查看会话
          </el-button>
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
  Share,
} from '@element-plus/icons-vue'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'

interface LeaveItem {
  id: string
  conversationId: number
  content: string
  createdAt: string
  status: string
  assigneeId?: number
  /** 留言原因（ITR 上报，可能为空） */
  reason?: string
  /** 以下三项由后端按会话所属 inbox 反查填充 */
  channelType?: string | null
  inboxName?: string | null
  channels?: string[]
}

const STATUS_LABEL: Record<string, string> = {
  open: '待认领',
  claimed: '已认领',
  closed: '已关闭',
}

const router = useRouter()
const authStore = useAuthStore()

const loading = ref(false)
const items = ref<LeaveItem[]>([])

const pendingCount = computed(() => items.value.filter((i) => i.status === 'open').length)

function fmtTime(v?: string): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleString('zh-CN', { hour12: false })
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get<{ items: LeaveItem[] }>('/api/itr/leave-messages')
    items.value = data.items || []
  } catch {
    items.value = []
    ElMessage.error('加载在线留言失败')
  } finally {
    loading.value = false
  }
}

/** 认领后提示去全媒体客服处理：本页是留言中心，不承载会话对话 */
async function claim(row: LeaveItem) {
  const assigneeId = authStore.user?.id
  if (!assigneeId) {
    ElMessage.warning('未登录，无法认领')
    return
  }
  try {
    await api.post(`/api/itr/leave-messages/${row.id}/claim`, { assigneeId })
    ElMessage.success('已认领，正在打开会话…')
    await load()
    openInWorkspace(row)
  } catch (e) {
    ElMessage.error(`认领失败：${(e as Error).message}`)
  }
}

function openInWorkspace(row: LeaveItem) {
  // 参数名必须是 conv —— OmnichannelService 读的是 route.query.conv
  router.push({ path: '/omnichannel', query: { conv: String(row.conversationId) } })
}

onMounted(load)
</script>

<style scoped>
.vom-online {
  min-height: 320px;
}
.vom-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.vom-tip {
  font-size: 12px;
  color: var(--oa-muted, #909399);
}
/* 渠道图标：与全媒体客服会话列表用同一套品牌色，便于跨页辨认 */
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
.ch-name {
  font-size: 12px;
  color: #606266;
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
</style>
