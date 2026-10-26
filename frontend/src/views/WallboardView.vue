<template>
  <div class="wb-root">
    <header class="wb-top">
      <div class="wb-brand">
        <span class="wb-dot" />
        <h1 class="wb-title">全媒体数据大屏</h1>
        <span class="wb-sub">实时监控 · 每 {{ refreshSec }}s 刷新</span>
      </div>
      <div class="wb-clock">
        <span class="wb-time">{{ clock }}</span>
        <span class="wb-sync">{{ syncHint }}</span>
      </div>
    </header>

    <section class="wb-kpis">
      <div v-for="k in kpiCards" :key="k.key" class="wb-kpi">
        <div class="wb-kpi-value" :style="{ color: k.color }">{{ k.value }}</div>
        <div class="wb-kpi-label">{{ k.label }}</div>
      </div>
    </section>

    <section class="wb-grid">
      <div class="wb-panel">
        <h2 class="wb-panel-title">队列状态</h2>
        <div v-if="!queues.length" class="wb-empty">暂无队列数据</div>
        <div v-for="q in queues" :key="q.queue_name" class="wb-queue">
          <div class="wb-queue-head">
            <span class="wb-queue-name">{{ q.queue_name }}</span>
            <span class="wb-queue-sla" :style="{ color: slaColor(q.sla_pct) }">{{ fmtPct(q.sla_pct) }}</span>
          </div>
          <div class="wb-queue-nums">
            <div>
              <b :class="{ hot: q.waiting > 0 }">{{ q.waiting }}</b>
              <span>排队</span>
            </div>
            <div>
              <b>{{ q.active }}</b>
              <span>通话中</span>
            </div>
          </div>
        </div>
      </div>

      <div class="wb-panel">
        <h2 class="wb-panel-title">坐席状态</h2>
        <div class="wb-agent-strip">
          <div v-for="s in agentSummary" :key="s.key" class="wb-agent-chip">
            <b :style="{ color: s.color }">{{ s.value }}</b>
            <span>{{ s.label }}</span>
          </div>
        </div>
        <div v-if="!agents.length" class="wb-empty">暂无坐席数据</div>
        <div class="wb-agent-list">
          <div v-for="a in agents" :key="a.user_id" class="wb-agent-row">
            <span class="wb-agent-status" :style="{ background: statusColor(a.status) }" />
            <span class="wb-agent-name">{{ a.name }}</span>
            <span class="wb-agent-team">{{ a.team }}</span>
            <span class="wb-agent-status-text">{{ statusText(a.status) }}</span>
            <span class="wb-agent-handled">{{ a.handled_today }}</span>
          </div>
        </div>
      </div>

      <div class="wb-panel">
        <h2 class="wb-panel-title">渠道分布<span class="wb-panel-note">（进行中会话）</span></h2>
        <div ref="pieEl" class="wb-pie" />
        <div v-if="!channelPie.length" class="wb-empty">暂无进行中会话</div>
      </div>
    </section>

    <section class="wb-panel wb-live">
      <h2 class="wb-panel-title">进行中会话</h2>
      <div class="wb-live-head">
        <span>会话</span>
        <span>访客</span>
        <span>渠道</span>
        <span>状态</span>
        <span>最近活动</span>
      </div>
      <div v-if="!liveSessions.length" class="wb-empty">暂无进行中会话</div>
      <div v-for="s in liveSessions" :key="s.conversation_id" class="wb-live-row">
        <span>#{{ s.conversation_id }}</span>
        <span class="wb-ellipsis">{{ s.visitor_name }}</span>
        <span class="wb-ellipsis">{{ s.channel }}</span>
        <span>
          <span class="wb-tag" :class="s.queued ? 'wb-tag-warn' : 'wb-tag-ok'">
            {{ s.queued ? '排队中' : '进行中' }}
          </span>
        </span>
        <span class="wb-live-time">{{ fmtTs(s.last_activity_at) }}</span>
      </div>
    </section>

    <footer class="wb-foot">
      数据源 /api/v1/monitor/overview · 只读投屏，无需登录
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import * as echarts from 'echarts'
import {
  fetchMonitorOverview,
  type AgentStatusRow,
  type MonitorOverview,
  type QueueStats,
} from '@/api/monitor'

const refreshSec = 5
const REFRESH_MS = refreshSec * 1000
/** 投屏模式下后端偶发抖动不应清空整屏数据 */
const MAX_STALE_MS = 60 * 1000

const agents = ref<AgentStatusRow[]>([])
const queues = ref<QueueStats[]>([])
const liveSessions = ref<NonNullable<MonitorOverview['live_sessions']>>([])
const kpis = ref<NonNullable<MonitorOverview['session_kpis']>>({
  sessions: 0,
  queued: 0,
  avg_wait_sec: 0,
  avg_talk_sec: 0,
  csat_pct: null,
  csat_count: 0,
})
const counts = ref({ online: 0, ready: 0, busy: 0, break: 0 })

const clock = ref('')
const syncHint = ref('等待数据…')
const lastOkAt = ref(0)

const pieEl = ref<HTMLElement | null>(null)
let pie: echarts.ECharts | null = null
let refreshTimer: ReturnType<typeof setInterval> | null = null
let clockTimer: ReturnType<typeof setInterval> | null = null

const kpiCards = computed(() => [
  { key: 'sessions', label: '今日进线', value: kpis.value.sessions, color: '#4da3ff' },
  { key: 'queued', label: '排队中', value: kpis.value.queued, color: '#ffb03a' },
  { key: 'online', label: '在线坐席', value: counts.value.online, color: '#37d67a' },
  { key: 'busy', label: '通话中', value: counts.value.busy, color: '#ff8f5a' },
  { key: 'wait', label: '平均等待(s)', value: kpis.value.avg_wait_sec, color: '#8f7bff' },
  { key: 'talk', label: '平均通话(s)', value: kpis.value.avg_talk_sec, color: '#61d4d4' },
  {
    key: 'csat',
    label: 'CSAT%',
    value: kpis.value.csat_pct === null ? '—' : kpis.value.csat_pct,
    color: '#ff6b8b',
  },
])

const agentSummary = computed(() => [
  { key: 'online', label: '在线', value: counts.value.online, color: '#37d67a' },
  { key: 'ready', label: '就绪', value: counts.value.ready, color: '#4da3ff' },
  { key: 'busy', label: '通话中', value: counts.value.busy, color: '#ff8f5a' },
  { key: 'break', label: '小休', value: counts.value.break, color: '#ff6b8b' },
])

/** 免密模式下没有 by_channel，退化为按进行中会话聚合渠道分布 */
const channelPie = computed(() => {
  const map = new Map<string, number>()
  for (const s of liveSessions.value) {
    const key = s.channel || '未知'
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map.entries()].map(([name, value]) => ({ name, value }))
})

function statusColor(s: AgentStatusRow['status']): string {
  return (
    { ready: '#37d67a', busy: '#ff8f5a', break: '#ff6b8b', offline: '#5a6480' } as Record<string, string>
  )[s] ?? '#5a6480'
}

function statusText(s: AgentStatusRow['status']): string {
  return (
    { ready: '就绪', busy: '通话中', break: '小休', offline: '离线' } as Record<string, string>
  )[s] ?? s
}

function slaColor(pct: number): string {
  if (pct >= 90) return '#37d67a'
  if (pct >= 70) return '#ffb03a'
  return '#ff6b8b'
}

function fmtPct(pct: number): string {
  return Number.isFinite(pct) ? `${pct.toFixed(1)}%` : '—'
}

function fmtTs(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('zh-CN')
}

function tickClock() {
  clock.value = new Date().toLocaleString('zh-CN', { hour12: false })
}

function renderPie() {
  if (!pie) return
  const data = channelPie.value
  pie.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: {
      bottom: 0,
      textStyle: { color: '#b9c6e6', fontSize: 13 },
      itemWidth: 12,
      itemHeight: 12,
    },
    series: [
      {
        type: 'pie',
        radius: ['48%', '72%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        label: { color: '#e6ecff', fontSize: 13, formatter: '{b}\n{c}' },
        labelLine: { lineStyle: { color: '#4a5578' } },
        itemStyle: { borderColor: '#0b1020', borderWidth: 2 },
        data,
      },
    ],
  })
  pie.resize()
}

async function load() {
  try {
    const res = await fetchMonitorOverview()
    agents.value = res.agents ?? []
    queues.value = res.queues ?? []
    liveSessions.value = res.live_sessions ?? []
    counts.value = {
      online: res.online_agents ?? 0,
      ready: res.ready_agents ?? 0,
      busy: res.busy_agents ?? 0,
      break: res.break_agents ?? 0,
    }
    if (res.session_kpis) kpis.value = { ...kpis.value, ...res.session_kpis }
    lastOkAt.value = Date.now()
    syncHint.value = `更新于 ${new Date().toLocaleTimeString('zh-CN')}`
    renderPie()
  } catch {
    // 投屏场景：短时失败保留上一屏数据，只在超时后提示
    const stale = Date.now() - lastOkAt.value
    if (!lastOkAt.value || stale > MAX_STALE_MS) {
      syncHint.value = '数据获取失败，重试中…'
    } else {
      syncHint.value = `数据延迟 ${Math.round(stale / 1000)}s`
    }
  }
}

function onResize() {
  pie?.resize()
}

onMounted(() => {
  tickClock()
  clockTimer = setInterval(tickClock, 1000)
  if (pieEl.value) pie = echarts.init(pieEl.value)
  void load()
  refreshTimer = setInterval(() => void load(), REFRESH_MS)
  window.addEventListener('resize', onResize)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  if (clockTimer) clearInterval(clockTimer)
  window.removeEventListener('resize', onResize)
  pie?.dispose()
  pie = null
})
</script>

<style scoped>
.wb-root {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 20px 24px 12px;
  background: radial-gradient(circle at 20% 0%, #16203a 0%, #0b1020 55%, #070a14 100%);
  color: #e6ecff;
  font-family: inherit;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.wb-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #1e2a45;
  padding-bottom: 12px;
}
.wb-brand { display: flex; align-items: baseline; gap: 12px; }
.wb-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: #37d67a; box-shadow: 0 0 10px #37d67a;
  align-self: center;
}
.wb-title { margin: 0; font-size: 26px; letter-spacing: 2px; }
.wb-sub { color: #7b88a8; font-size: 13px; }
.wb-clock { display: flex; flex-direction: column; align-items: flex-end; }
.wb-time { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
.wb-sync { color: #7b88a8; font-size: 12px; }

.wb-kpis {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 12px;
}
.wb-kpi {
  background: linear-gradient(180deg, #141c33 0%, #101728 100%);
  border: 1px solid #1e2a45;
  border-radius: 10px;
  padding: 14px 10px;
  text-align: center;
}
.wb-kpi-value { font-size: 32px; font-weight: 700; font-variant-numeric: tabular-nums; }
.wb-kpi-label { margin-top: 4px; color: #8b98b8; font-size: 13px; }

.wb-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 14px;
  flex: 1;
  min-height: 260px;
}
.wb-panel {
  background: #101728;
  border: 1px solid #1e2a45;
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.wb-panel-title {
  margin: 0 0 10px;
  font-size: 16px;
  letter-spacing: 1px;
  color: #cfe0ff;
}
.wb-panel-note { color: #6b7796; font-size: 12px; font-weight: 400; margin-left: 6px; }
.wb-empty { color: #5f6b8a; font-size: 14px; padding: 8px 0; }

.wb-queue { margin-bottom: 12px; }
.wb-queue-head { display: flex; justify-content: space-between; align-items: baseline; }
.wb-queue-name { font-size: 15px; color: #d7e3ff; }
.wb-queue-sla { font-size: 18px; font-weight: 700; }
.wb-queue-nums { display: flex; gap: 24px; margin-top: 6px; }
.wb-queue-nums b { font-size: 24px; font-variant-numeric: tabular-nums; }
.wb-queue-nums b.hot { color: #ffb03a; }
.wb-queue-nums span { display: block; color: #7b88a8; font-size: 12px; }

.wb-agent-strip { display: flex; gap: 16px; margin-bottom: 10px; }
.wb-agent-chip { text-align: center; flex: 1; }
.wb-agent-chip b { font-size: 22px; font-variant-numeric: tabular-nums; }
.wb-agent-chip span { display: block; color: #7b88a8; font-size: 12px; }

.wb-agent-list { overflow: auto; flex: 1; min-height: 0; }
.wb-agent-row {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) minmax(0, 1fr) 62px 42px;
  align-items: center;
  gap: 8px;
  padding: 6px 2px;
  border-bottom: 1px solid #17203a;
  font-size: 14px;
}
.wb-agent-status { width: 8px; height: 8px; border-radius: 50%; }
.wb-agent-name { color: #dfe8ff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-agent-team { color: #7b88a8; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-agent-status-text { color: #9fb0d6; font-size: 13px; }
.wb-agent-handled { text-align: right; color: #8f7bff; font-variant-numeric: tabular-nums; }

.wb-pie { flex: 1; min-height: 200px; }

.wb-live { min-height: 180px; }
.wb-live-head,
.wb-live-row {
  display: grid;
  grid-template-columns: 90px minmax(0, 1.2fr) minmax(0, 1.4fr) 100px 130px;
  gap: 10px;
  align-items: center;
  font-size: 14px;
}
.wb-live-head { color: #6b7796; font-size: 12px; padding-bottom: 6px; border-bottom: 1px solid #17203a; }
.wb-live-row { padding: 6px 0; border-bottom: 1px solid #141c30; }
.wb-live-time { color: #8b98b8; font-variant-numeric: tabular-nums; }
.wb-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-tag { padding: 2px 8px; border-radius: 10px; font-size: 12px; }
.wb-tag-warn { background: rgba(255, 176, 58, 0.16); color: #ffb03a; }
.wb-tag-ok { background: rgba(55, 214, 122, 0.16); color: #37d67a; }

.wb-foot { text-align: center; color: #4f5a78; font-size: 12px; padding-top: 4px; }

@media (max-width: 1400px) {
  .wb-kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .wb-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
}
</style>
