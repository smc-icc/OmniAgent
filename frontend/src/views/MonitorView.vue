<template>
  <div class="mo-root">
    <div class="mo-header">
      <h3 class="mo-title">坐席监控</h3>
      <div class="mo-header-actions">
        <el-tooltip :content="viewMode === 'list' ? '切换到地图模式' : '切换到列表模式'">
          <el-button circle :icon="viewMode === 'list' ? MapLocation : List" @click="toggleView" />
        </el-tooltip>
        <template v-if="viewMode === 'map'">
          <el-tooltip content="最大化地图">
            <el-button circle :icon="FullScreen" @click="toggleFullscreen" />
          </el-tooltip>
          <el-tooltip :content="settingMode ? '退出设置模式' : '进入设置模式'">
            <el-button circle :type="settingMode ? 'primary' : 'default'" :icon="Setting" @click="settingMode = !settingMode" />
          </el-tooltip>
        </template>
      </div>
    </div>

    <template v-if="viewMode === 'list'">
    <el-row :gutter="12" class="mo-stats">
      <el-col v-for="s in statCards" :key="s.key" :xs="12" :sm="6">
        <el-card shadow="hover" class="mo-stat-card">
          <div class="mo-stat-label">{{ s.label }}</div>
          <div class="mo-stat-value" :style="{ color: s.color }">{{ s.value }}</div>
        </el-card>
      </el-col>
    </el-row>

    <h4 class="mo-section">队列状态</h4>
    <el-table :data="queues" stripe border size="small" class="mo-table">
      <el-table-column prop="queue_name" label="队列" width="120" />
      <el-table-column label="排队" width="72">
        <template #default="{ row }">
          <el-tag :type="row.waiting > 5 ? 'danger' : row.waiting > 0 ? 'warning' : 'success'" size="small">{{ row.waiting }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="active" label="通话中" width="80" />
      <el-table-column label="SLA" width="80">
        <template #default="{ row }">{{ row.sla_pct?.toFixed(1) }}%</template>
      </el-table-column>
    </el-table>

    <h4 class="mo-section">坐席状态</h4>
    <el-table :data="agents" stripe border size="small" max-height="400">
      <el-table-column prop="name" label="姓名" width="100" />
      <el-table-column prop="team" label="团队" width="120" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="agentStatusTag(row.status)" size="small" effect="dark">{{ agentStatusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="current_call" label="当前通话" min-width="140" show-overflow-tooltip />
      <el-table-column label="持续" width="90">
        <template #default="{ row }">{{ fmtDuration(row.duration_sec) }}</template>
      </el-table-column>
      <el-table-column label="今日处理" width="80">
        <template #default="{ row }">{{ row.handled_today }}</template>
      </el-table-column>
    </el-table>

    <p v-if="lastSync" class="mo-sync">数据更新时间：{{ lastSync }}</p>

    <h4 class="mo-section">全媒体会话报表（今日）</h4>
    <el-row :gutter="12" class="mo-stats">
      <el-col v-for="s in reportCards" :key="s.key" :xs="12" :sm="6" :md="4">
        <el-card shadow="hover" class="mo-stat-card">
          <div class="mo-stat-label">{{ s.label }}</div>
          <div class="mo-stat-value" :style="{ color: s.color }">{{ s.value }}</div>
        </el-card>
      </el-col>
    </el-row>
    <el-table :data="reportRows" stripe border size="small" class="mo-table" max-height="280">
      <el-table-column prop="created_at" label="开始" min-width="160" />
      <el-table-column prop="visitor_name" label="访客" width="100" show-overflow-tooltip />
      <el-table-column prop="channel" label="渠道" width="80" />
      <el-table-column prop="method" label="方式" width="90" />
      <el-table-column prop="wait_sec" label="等待(s)" width="80" />
      <el-table-column prop="talk_sec" label="通话(s)" width="80" />
      <el-table-column prop="assignee" label="坐席" width="100" show-overflow-tooltip />
    </el-table>

    <h4 class="mo-section">按渠道 / 坐席</h4>
    <el-row :gutter="12">
      <el-col :xs="24" :md="12">
        <el-table :data="byChannel" stripe border size="small" max-height="200">
          <el-table-column prop="channel" label="渠道" />
          <el-table-column prop="sessions" label="会话" width="72" />
          <el-table-column prop="avg_wait_sec" label="均等待" width="80" />
        </el-table>
      </el-col>
      <el-col :xs="24" :md="12">
        <el-table :data="byAgent" stripe border size="small" max-height="200">
          <el-table-column prop="agent" label="坐席" />
          <el-table-column prop="sessions" label="会话" width="72" />
        </el-table>
      </el-col>
    </el-row>

    <h4 class="mo-section">进行中会话</h4>
    <el-table :data="liveSessions" stripe border size="small" max-height="240" class="mo-table">
      <el-table-column prop="conversation_id" label="会话" width="80" />
      <el-table-column prop="visitor_name" label="访客" width="100" show-overflow-tooltip />
      <el-table-column prop="channel" label="渠道" min-width="120" show-overflow-tooltip />
      <el-table-column label="排队" width="72">
        <template #default="{ row }">
          <el-tag :type="row.queued ? 'warning' : 'success'" size="small">{{ row.queued ? '排队' : '进行中' }}</el-tag>
        </template>
      </el-table-column>
    </el-table>

    <h4 class="mo-section">ITR 流程观察</h4>
    <p class="mo-sync">辅助 WebSocket 推送（TARS/HTTP 仍是业务通道）。{{ itrHint }}</p>
    <el-table :data="itrEvents" stripe border size="small" max-height="260" class="mo-table">
      <el-table-column label="时间" width="96">
        <template #default="{ row }">{{ fmtTs(row.ts) }}</template>
      </el-table-column>
      <el-table-column prop="event" label="事件" width="88" />
      <el-table-column prop="conversationId" label="会话" width="80" />
      <el-table-column prop="flowId" label="流程" width="72" />
      <el-table-column prop="nodeId" label="节点" min-width="90" show-overflow-tooltip />
      <el-table-column prop="state" label="状态" width="80" />
      <el-table-column prop="preview" label="摘要" min-width="160" show-overflow-tooltip />
    </el-table>
    </template>

    <AgentMapView
      v-else
      :agents="agents"
      :setting-mode="settingMode"
      :last-refresh="lastSync"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { FullScreen, List, MapLocation, Setting } from '@element-plus/icons-vue'
import AgentMapView from '@/components/monitor/AgentMapView.vue'
import { fetchAgentStatusList, fetchMonitorOverview, fetchOmniSessionReports, fetchItrObserveRecent, type AgentStatusRow, type ItrObserveEvent, type MonitorOverview, type OmniSessionReportRow, type QueueStats } from '@/api/monitor'
import { getSocket } from '@/services/socket'

const viewMode = ref<'list' | 'map'>('list')
const settingMode = ref(false)
const agents = ref<AgentStatusRow[]>([])
const queues = ref<QueueStats[]>([])
const reportRows = ref<OmniSessionReportRow[]>([])
const byChannel = ref<Array<{ channel: string; sessions: number; avg_wait_sec: number; avg_talk_sec: number }>>([])
const byAgent = ref<Array<{ agent: string; sessions: number }>>([])
const liveSessions = ref<NonNullable<MonitorOverview['live_sessions']>>([])
const itrEvents = ref<ItrObserveEvent[]>([])
const itrHint = ref('等待事件…')
const kpis = ref({ sessions: 0, queued: 0, avg_wait_sec: 0, avg_talk_sec: 0, csat_pct: null as number | null, csat_count: 0 })
const refreshing = ref(false)
const lastSync = ref('')
const totalOnline = ref(0)
const totalReady = ref(0)
const totalBusy = ref(0)
const totalBreak = ref(0)
let agentRefreshTimer: ReturnType<typeof setInterval> | null = null

const statCards = computed(() => [
  { key: 'online', label: '在线坐席', value: totalOnline.value, color: '#67c23a' },
  { key: 'ready', label: '就绪', value: totalReady.value, color: '#409eff' },
  { key: 'busy', label: '通话中', value: totalBusy.value, color: '#e6a23c' },
  { key: 'break', label: '小休', value: totalBreak.value, color: '#f56c6c' },
])

const reportCards = computed(() => [
  { key: 'sess', label: '今日会话', value: kpis.value.sessions, color: '#409eff' },
  { key: 'q', label: '排队中', value: kpis.value.queued, color: '#e6a23c' },
  { key: 'wait', label: '均等待(s)', value: kpis.value.avg_wait_sec, color: '#67c23a' },
  { key: 'talk', label: '均通话(s)', value: kpis.value.avg_talk_sec, color: '#909399' },
  { key: 'csat', label: 'CSAT%', value: kpis.value.csat_pct ?? '—', color: '#f56c6c' },
])

function agentStatusTag(s: string) {
  return ({ ready: 'success', busy: 'warning', break: 'danger', offline: 'info' } as Record<string, string>)[s] ?? 'info'
}
function agentStatusText(s: string) {
  return ({ ready: '就绪', busy: '通话中', break: '小休', offline: '离线' } as Record<string, string>)[s] ?? s
}

function toggleView() {
  viewMode.value = viewMode.value === 'list' ? 'map' : 'list'
  if (viewMode.value === 'list') settingMode.value = false
}

async function toggleFullscreen() {
  const root = document.querySelector('.mo-root') as HTMLElement | null
  if (!root) return
  if (document.fullscreenElement) await document.exitFullscreen()
  else await root.requestFullscreen()
}

async function refreshAgentStates() {
  if (viewMode.value !== 'map') return
  try {
    agents.value = await fetchAgentStatusList()
    lastSync.value = new Date().toLocaleTimeString('zh-CN')
  } catch {
    // 保留上次状态，短暂网络抖动不清空地图
  }
}

async function load() {
  refreshing.value = true
  try {
    const [res, report] = await Promise.all([fetchMonitorOverview(), fetchOmniSessionReports(1)])
    agents.value = res.agents ?? []
    queues.value = res.queues ?? []
    totalOnline.value = res.online_agents
    totalReady.value = res.ready_agents
    totalBusy.value = res.busy_agents
    totalBreak.value = res.break_agents
    lastSync.value = new Date(res.updated_at).toLocaleTimeString('zh-CN')
    if (res.session_kpis) {
      kpis.value = { ...kpis.value, ...res.session_kpis }
    }
    if (report?.kpis) {
      kpis.value = {
        sessions: report.kpis.sessions,
        queued: report.kpis.queued,
        avg_wait_sec: report.kpis.avg_wait_sec,
        avg_talk_sec: report.kpis.avg_talk_sec,
        csat_pct: report.kpis.csat_pct,
        csat_count: report.kpis.csat_count,
      }
    }
    reportRows.value = (report?.recent ?? []).map((r) => ({
      ...r,
      created_at: r.created_at ? r.created_at.replace('T', ' ').slice(0, 19) : '',
    }))
    byChannel.value = report?.by_channel ?? []
    byAgent.value = report?.by_agent ?? []
    liveSessions.value = res.live_sessions ?? []
    try {
      const obs = await fetchItrObserveRecent()
      if (Array.isArray(obs?.events) && obs.events.length) {
        itrEvents.value = obs.events.slice(-80).reverse()
        itrHint.value = `已加载 ${itrEvents.value.length} 条`
      }
    } catch {
      /* ignore */
    }
  } catch {
    agents.value = []
    queues.value = []
    reportRows.value = []
    totalOnline.value = 0
    totalReady.value = 0
    totalBusy.value = 0
    totalBreak.value = 0
    lastSync.value = new Date().toLocaleTimeString('zh-CN')
  } finally {
    refreshing.value = false
  }
}

function fmtDuration(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h${m}m` : `${m}m${s % 60}s`
}

function fmtTs(ts?: number) {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleTimeString('zh-CN')
  } catch {
    return ''
  }
}

function onItrObserve(evt: ItrObserveEvent) {
  if (!evt?.event) return
  itrEvents.value = [evt, ...itrEvents.value].slice(0, 80)
  if (evt.event === 'hello') itrHint.value = '观察通道已连接'
  else if (evt.event === 'error') itrHint.value = evt.message || '观察通道拒绝业务指令'
  else itrHint.value = '实时推送中'
}

onMounted(() => {
  void load()
  agentRefreshTimer = setInterval(() => void refreshAgentStates(), 5000)
  const s = getSocket()
  s?.on('itr.observe', onItrObserve)
})

onUnmounted(() => {
  if (agentRefreshTimer) clearInterval(agentRefreshTimer)
  getSocket()?.off('itr.observe', onItrObserve)
})
</script>

<style scoped>
.mo-root { padding: 16px; background: var(--oa-card, #fff); border-radius: 8px; min-height: 360px; }
.mo-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.mo-header-actions { display: flex; align-items: center; gap: 6px; }
.mo-title { margin: 0; font-size: 18px; }
.mo-stats { margin-bottom: 16px; }
.mo-stat-card { text-align: center; }
.mo-stat-label { color: #909399; font-size: 13px; }
.mo-stat-value { font-size: 28px; font-weight: 700; }
.mo-section { margin: 16px 0 8px; font-size: 15px; }
.mo-sync { color: #c0c4cc; font-size: 12px; margin-top: 12px; }
</style>
