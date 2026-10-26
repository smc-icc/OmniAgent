<template>
  <el-card shadow="never" class="md-root">
    <template #header>
      <div class="md-head-row">
        <div>
          <span class="md-title">业务监控与调度</span>
          <span class="md-sub">
            实时监控队列、SLA、坐席状态与多渠道负载；告警确认与调度策略下发（演示，接口
            <code class="md-code">/api/monitoring-dispatch/*</code>）。
          </span>
        </div>
        <div class="md-head-actions">
          <el-switch v-model="autoRefresh" active-text="自动刷新" inactive-text="手动" />
          <el-button type="primary" :loading="refreshing" @click="refreshAll">立即刷新</el-button>
        </div>
      </div>
    </template>

    <div v-if="pageError" class="md-block">
      <el-alert type="error" :title="pageError" show-icon :closable="false" />
    </div>

    <template v-else>
      <div class="md-layout">
        <aside class="md-aside">
          <el-menu :default-active="active" class="md-menu" @select="onMenuSelect">
            <el-menu-item index="overview">监控总览</el-menu-item>
            <el-menu-item index="queues">队列与 SLA</el-menu-item>
            <el-menu-item index="agents">坐席状态</el-menu-item>
            <el-menu-item index="alerts">告警事件</el-menu-item>
            <el-menu-item index="dispatch">调度指令</el-menu-item>
          </el-menu>
        </aside>
        <main class="md-main">
          <p v-if="lastSync" class="md-sync">数据刷新时间：{{ lastSync }}</p>

          <section v-show="active === 'overview'" class="md-panel">
            <p class="md-intro">{{ overview?.intro }}</p>
            <el-row :gutter="12" class="md-kpis">
              <el-col v-for="k in overview?.kpis ?? []" :key="k.key" :xs="12" :sm="8" :md="6" :lg="4">
                <el-card shadow="hover" class="md-kpi-card">
                  <div class="md-kpi-label">{{ k.label }}</div>
                  <div class="md-kpi-value">
                    {{ k.value }}<span v-if="k.unit" class="md-kpi-unit">{{ k.unit }}</span>
                  </div>
                  <div class="md-kpi-meta">
                    <el-tag size="small" :type="trendTag(k.trend)">{{ trendText(k.trend) }}</el-tag>
                    <span class="md-kpi-hint">{{ k.hint }}</span>
                  </div>
                </el-card>
              </el-col>
            </el-row>
            <h4 class="md-section-title">渠道结构（当日累计处理量占比 · 演示）</h4>
            <div class="md-mix">
              <div v-for="c in overview?.channel_mix ?? []" :key="c.channel" class="md-mix-row">
                <span class="md-mix-name">{{ c.channel }}</span>
                <el-progress :percentage="c.share_pct" :stroke-width="14" class="md-mix-bar" />
                <span class="md-mix-num">{{ c.handled_hr }} 通/件</span>
              </div>
            </div>
          </section>

          <section v-show="active === 'queues'" class="md-panel">
            <el-table :data="queues?.items ?? []" stripe border size="small">
              <el-table-column prop="name" label="队列" min-width="120" show-overflow-tooltip />
              <el-table-column prop="channel" label="渠道" width="88" />
              <el-table-column prop="waiting" label="排队" width="72" />
              <el-table-column label="最长等待" width="100">
                <template #default="{ row }">{{ row.longest_wait_sec }}s</template>
              </el-table-column>
              <el-table-column label="SLA 达成" width="92">
                <template #default="{ row }">{{ row.sla_met_pct?.toFixed(1) }}%</template>
              </el-table-column>
              <el-table-column label="就绪/忙/话后" min-width="120">
                <template #default="{ row }">{{ row.ready }}/{{ row.busy }}/{{ row.acw }}</template>
              </el-table-column>
              <el-table-column label="风险" width="100">
                <template #default="{ row }">
                  <el-tag size="small" :type="riskTag(row.risk)">{{ riskText(row.risk) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="action_hint" label="调度建议" min-width="200" show-overflow-tooltip />
            </el-table>
          </section>

          <section v-show="active === 'agents'" class="md-panel">
            <el-table :data="agents?.items ?? []" stripe border size="small">
              <el-table-column prop="agent_id" label="工号" width="90" />
              <el-table-column prop="name" label="姓名" width="88" />
              <el-table-column prop="skill_group" label="技能组" width="100" />
              <el-table-column label="状态" width="100">
                <template #default="{ row }">
                  <el-tag size="small" :type="statusTag(row.status)">{{ statusText(row.status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="当前队列" width="110" show-overflow-tooltip>
                <template #default="{ row }">{{ row.current_queue || '—' }}</template>
              </el-table-column>
              <el-table-column label="状态持续" width="100">
                <template #default="{ row }">{{ formatDuration(row.state_sec) }}</template>
              </el-table-column>
              <el-table-column prop="handled_today" label="今日处理" width="92" />
            </el-table>
          </section>

          <section v-show="active === 'alerts'" class="md-panel">
            <el-table :data="alerts" stripe border size="small">
              <el-table-column prop="since" label="时间" width="72" />
              <el-table-column label="级别" width="88">
                <template #default="{ row }">
                  <el-tag size="small" :type="levelTag(row.level)">{{ levelText(row.level) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="title" label="标题" min-width="160" show-overflow-tooltip />
              <el-table-column prop="queue_name" label="队列" width="110" />
              <el-table-column prop="detail" label="详情" min-width="200" show-overflow-tooltip />
              <el-table-column label="状态" width="100">
                <template #default="{ row }">
                  <el-tag v-if="row.acknowledged" type="info" size="small">已确认</el-tag>
                  <el-tag v-else type="danger" size="small">待确认</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="100" fixed="right">
                <template #default="{ row }">
                  <el-button
                    v-if="!row.acknowledged"
                    link
                    type="primary"
                    size="small"
                    :loading="ackingId === row.id"
                    @click="onAck(row)"
                  >
                    确认
                  </el-button>
                  <span v-else class="md-muted">{{ row.acked_at || '—' }}</span>
                </template>
              </el-table-column>
            </el-table>
          </section>

          <section v-show="active === 'dispatch'" class="md-panel">
            <p class="md-hint">
              以下为常见<strong>调度动作</strong>演示：与真实 ACD/路由/外呼平台对接时，可在此扩展为真实 API 调用并写审计日志。
            </p>
            <el-form label-width="120px" class="md-dispatch-form">
              <el-form-item label="调度动作">
                <el-select v-model="dispatchForm.action_type" placeholder="选择" style="width: 100%; max-width: 420px">
                  <el-option
                    v-for="t in actionTypes"
                    :key="t.type"
                    :label="t.label"
                    :value="t.type"
                  />
                </el-select>
                <div v-if="selectedActionDesc" class="md-action-desc">{{ selectedActionDesc }}</div>
              </el-form-item>
              <el-form-item label="目标队列">
                <el-select
                  v-model="dispatchForm.queue_id"
                  clearable
                  placeholder="可选，默认可不指定"
                  style="width: 100%; max-width: 420px"
                >
                  <el-option
                    v-for="q in queueOptions"
                    :key="q.queue_id"
                    :label="`${q.name} (${q.queue_id})`"
                    :value="q.queue_id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="备注">
                <el-input
                  v-model="dispatchForm.note"
                  type="textarea"
                  :rows="2"
                  maxlength="200"
                  show-word-limit
                  placeholder="如：班长已同意、预计 15 分钟内到位"
                  style="max-width: 520px"
                />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :loading="dispatching" @click="submitDispatch">下发（演示）</el-button>
              </el-form-item>
            </el-form>
            <el-alert
              v-if="dispatchResult"
              :title="dispatchResult.message"
              type="success"
              show-icon
              class="md-result"
              :closable="false"
            >
              <template #default>
                <div>记录时间：{{ dispatchResult.recorded_at }}</div>
              </template>
            </el-alert>
          </section>
        </main>
      </div>
    </template>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type {
  AlertRow,
  AgentsResponse,
  MonitoringOverview,
  QueuesResponse,
  DispatchActionType,
  DispatchActionTypeKey,
} from '@/api/monitoringDispatch'
import {
  fetchMonitoringOverview,
  fetchMonitoringQueues,
  fetchMonitoringAgents,
  fetchMonitoringAlerts,
  ackMonitoringAlert,
  fetchDispatchActionTypes,
  postDispatchAction,
} from '@/api/monitoringDispatch'

type MenuKey = 'overview' | 'queues' | 'agents' | 'alerts' | 'dispatch'

const active = ref<MenuKey>('overview')
const autoRefresh = ref(true)
const refreshing = ref(false)
const pageError = ref('')
const lastSync = ref('')

const overview = ref<MonitoringOverview | null>(null)
const queues = ref<QueuesResponse | null>(null)
const agents = ref<AgentsResponse | null>(null)
const alerts = ref<AlertRow[]>([])
const actionTypes = ref<DispatchActionType[]>([])

const ackingId = ref('')
const dispatching = ref(false)
const dispatchResult = ref<{ message: string; recorded_at: string } | null>(null)
const dispatchForm = ref<{
  action_type: DispatchActionTypeKey | ''
  queue_id: string
  note: string
}>({
  action_type: '',
  queue_id: '',
  note: '',
})

const queueOptions = ref<{ queue_id: string; name: string }[]>([])

const selectedActionDesc = computed(() => {
  const t = actionTypes.value.find((x) => x.type === dispatchForm.value.action_type)
  return t?.desc ?? ''
})

let timer: ReturnType<typeof setInterval> | null = null

function trendTag(t: string) {
  if (t === 'up') return 'success'
  if (t === 'down') return 'warning'
  return 'info'
}

function trendText(t: string) {
  if (t === 'up') return '升'
  if (t === 'down') return '降'
  return '平'
}

function riskTag(r: string) {
  if (r === 'critical' || r === 'high') return 'danger'
  if (r === 'medium') return 'warning'
  return 'success'
}

function riskText(r: string) {
  const m: Record<string, string> = {
    critical: '紧急',
    high: '高',
    medium: '中',
    low: '低',
  }
  return m[r] ?? r
}

function statusTag(s: string) {
  if (s === 'ready') return 'success'
  if (s === 'busy') return 'danger'
  if (s === 'acw') return 'warning'
  if (s === 'break') return 'info'
  return 'info'
}

function statusText(s: string) {
  const m: Record<string, string> = {
    ready: '就绪',
    busy: '通话/会话中',
    acw: '话后处理',
    break: '小休',
    offline: '离线',
  }
  return m[s] ?? s
}

function levelTag(l: string) {
  if (l === 'critical') return 'danger'
  if (l === 'warning') return 'warning'
  return 'info'
}

function levelText(l: string) {
  const m: Record<string, string> = { critical: '严重', warning: '警告', info: '提示' }
  return m[l] ?? l
}

function formatDuration(sec: number) {
  if (!sec) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function onMenuSelect(index: string) {
  const k = index as MenuKey
  if (k === 'overview' || k === 'queues' || k === 'agents' || k === 'alerts' || k === 'dispatch') {
    active.value = k
  }
}

async function refreshAll() {
  pageError.value = ''
  refreshing.value = true
  try {
    const [ov, qu, ag, al] = await Promise.all([
      fetchMonitoringOverview(),
      fetchMonitoringQueues(),
      fetchMonitoringAgents(),
      fetchMonitoringAlerts(),
    ])
    overview.value = ov
    queues.value = qu
    agents.value = ag
    alerts.value = al
    if (!actionTypes.value.length) {
      actionTypes.value = await fetchDispatchActionTypes()
    }
    queueOptions.value = qu.items.map((x) => ({ queue_id: x.queue_id, name: x.name }))
    lastSync.value = ov.updated_at
    if (!dispatchForm.value.action_type && actionTypes.value.length) {
      dispatchForm.value.action_type = actionTypes.value[0].type as DispatchActionTypeKey
    }
  } catch (e) {
    pageError.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    refreshing.value = false
  }
}

async function onAck(row: AlertRow) {
  ackingId.value = row.id
  try {
    await ackMonitoringAlert(row.id)
    ElMessage.success('已确认')
    alerts.value = await fetchMonitoringAlerts()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '操作失败')
  } finally {
    ackingId.value = ''
  }
}

async function submitDispatch() {
  if (!dispatchForm.value.action_type) {
    ElMessage.warning('请选择调度动作')
    return
  }
  dispatching.value = true
  dispatchResult.value = null
  try {
    const res = await postDispatchAction({
      action_type: dispatchForm.value.action_type as DispatchActionTypeKey,
      queue_id: dispatchForm.value.queue_id || undefined,
      note: dispatchForm.value.note || undefined,
    })
    dispatchResult.value = { message: res.message, recorded_at: res.recorded_at }
    ElMessage.success('已记录')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '下发失败')
  } finally {
    dispatching.value = false
  }
}

onMounted(() => {
  void refreshAll()
  timer = setInterval(() => {
    if (autoRefresh.value) void refreshAll()
  }, 25000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<style scoped>
.md-root :deep(.el-card__header) {
  padding: 14px 18px;
}
.md-root :deep(.el-card__body) {
  padding: 12px 16px 18px;
}
.md-head-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.md-title {
  font-weight: 700;
  font-size: 16px;
  color: var(--oa-text, #303133);
}
.md-sub {
  display: block;
  font-size: 12px;
  color: var(--oa-muted, #909399);
  margin-top: 6px;
  line-height: 1.55;
  max-width: 720px;
  font-weight: normal;
}
.md-code {
  font-size: 11px;
  padding: 1px 6px;
  background: #f4f4f5;
  border-radius: 3px;
}
.md-head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.md-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  min-height: 480px;
}
.md-aside {
  width: 200px;
  flex-shrink: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
}
.md-menu {
  border-right: none;
}
.md-main {
  flex: 1;
  min-width: 0;
}
.md-sync {
  font-size: 12px;
  color: #909399;
  margin: 0 0 12px;
}
.md-intro {
  font-size: 13px;
  color: #606266;
  line-height: 1.65;
  margin: 0 0 16px;
}
.md-kpis {
  margin-bottom: 8px;
}
.md-kpi-card :deep(.el-card__body) {
  padding: 12px 14px;
}
.md-kpi-label {
  font-size: 12px;
  color: #909399;
}
.md-kpi-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--oa-text, #303133);
  margin: 6px 0;
}
.md-kpi-unit {
  font-size: 13px;
  font-weight: 500;
  margin-left: 2px;
  color: #909399;
}
.md-kpi-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.md-kpi-hint {
  font-size: 11px;
  color: #c0c4cc;
}
.md-section-title {
  margin: 20px 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}
.md-mix {
  max-width: 560px;
}
.md-mix-row {
  display: grid;
  grid-template-columns: 72px 1fr 100px;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.md-mix-name {
  font-size: 13px;
  color: #606266;
}
.md-mix-num {
  font-size: 12px;
  color: #909399;
  text-align: right;
}
.md-panel {
  width: 100%;
}
.md-hint {
  font-size: 13px;
  color: #606266;
  line-height: 1.6;
  margin: 0 0 16px;
}
.md-dispatch-form {
  max-width: 640px;
}
.md-result {
  margin-top: 16px;
  max-width: 640px;
}
.md-muted {
  font-size: 12px;
  color: #c0c4cc;
}
.md-action-desc {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  margin-top: 8px;
  max-width: 520px;
}
.md-block {
  margin-bottom: 12px;
}
</style>
