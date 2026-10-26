<template>
  <el-card shadow="never" class="bi-root">
    <template #header>
      <div class="bi-head">
        <div>
          <span class="bi-title">呼叫中心 BI 与报表</span>
          <span class="bi-sub">
            管理驾驶舱：话务、SLA、队列、坐席、时段热力、体验与 CSAT；数据来自
            <code class="bi-code">/api/bi/*</code>（omni_session_records / csat_survey_responses）。
          </span>
        </div>
        <div class="bi-toolbar">
          <el-radio-group v-model="period" size="default">
            <el-radio-button value="7d">近 7 日</el-radio-button>
            <el-radio-button value="30d">近 30 日</el-radio-button>
          </el-radio-group>
          <el-button type="primary" :loading="loading" @click="loadPack">刷新数据</el-button>
        </div>
      </div>
    </template>

    <div v-if="errorMsg" class="bi-block">
      <el-alert type="error" :title="errorMsg" show-icon :closable="false" />
    </div>

    <template v-else>
      <p v-if="pack" class="bi-meta">数据集生成时间：{{ pack.generated_at }} · 窗口 {{ pack.period }}</p>

      <el-tabs v-model="mainTab" class="bi-tabs" @tab-change="onTabChange">
        <el-tab-pane label="管理驾驶舱" name="exec" lazy>
          <div v-if="pack" class="bi-pane">
            <el-row :gutter="12" class="bi-kpi-row">
              <el-col v-for="k in pack.kpi" :key="k.key" :xs="24" :sm="12" :lg="8" :xl="4">
                <el-card shadow="hover" class="bi-kpi-card">
                  <div class="bi-kpi-label">{{ k.label }}</div>
                  <div class="bi-kpi-val">
                    {{ k.value }}<span class="bi-kpi-unit">{{ k.unit }}</span>
                  </div>
                  <div class="bi-kpi-foot">
                    <el-tag size="small" :type="kpiTag(k.status)">{{ k.yoy }}</el-tag>
                    <span class="bi-kpi-hint">环比上期</span>
                  </div>
                </el-card>
              </el-col>
            </el-row>
            <el-row :gutter="12" class="bi-chart-row">
              <el-col :xs="24" :lg="14">
                <el-card shadow="never">
                  <template #header><span class="bi-card-t">进线与放弃趋势</span></template>
                  <div ref="refVolume" class="bi-chart" />
                </el-card>
              </el-col>
              <el-col :xs="24" :lg="10">
                <el-card shadow="never">
                  <template #header><span class="bi-card-t">渠道结构（处理量）</span></template>
                  <div ref="refPie" class="bi-chart bi-chart--pie" />
                </el-card>
              </el-col>
            </el-row>
            <el-row :gutter="12" class="bi-chart-row">
              <el-col :span="24">
                <el-card shadow="never">
                  <template #header><span class="bi-card-t">服务水平(SLA) 达成趋势</span></template>
                  <div ref="refSla" class="bi-chart bi-chart--wide" />
                </el-card>
              </el-col>
            </el-row>
          </div>
        </el-tab-pane>

        <el-tab-pane label="话务与接通" name="traffic" lazy>
          <div v-if="pack" class="bi-pane">
            <el-card shadow="never">
              <template #header><span class="bi-card-t">处理量 vs 放弃量（堆叠对比）</span></template>
              <div ref="refStack" class="bi-chart bi-chart--tall" />
            </el-card>
            <el-table :data="volumeTableRows" stripe border size="small" class="bi-table">
              <el-table-column prop="date" label="日期" width="100" />
              <el-table-column prop="handled" label="处理量" width="100" />
              <el-table-column prop="abandoned" label="放弃" width="88" />
              <el-table-column prop="ab_rate" label="放弃占比" width="100">
                <template #default="{ row }">{{ row.ab_rate }}%</template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <el-tab-pane label="队列服务" name="queue" lazy>
          <div v-if="pack" class="bi-pane">
            <el-row :gutter="12">
              <el-col :xs="24" :lg="12">
                <el-card shadow="never">
                  <template #header><span class="bi-card-t">各队列处理量</span></template>
                  <div ref="refQueueBar" class="bi-chart bi-chart--mid" />
                </el-card>
              </el-col>
              <el-col :xs="24" :lg="12">
                <el-card shadow="never">
                  <template #header><span class="bi-card-t">队列 SLA 达成</span></template>
                  <div ref="refQueueSla" class="bi-chart bi-chart--mid" />
                </el-card>
              </el-col>
            </el-row>
            <el-table :data="pack.queues" stripe border size="small" class="bi-table">
              <el-table-column prop="name" label="队列" width="100" />
              <el-table-column prop="queue_id" label="编码" width="110" />
              <el-table-column prop="handled" label="处理量" width="100" />
              <el-table-column prop="avg_wait_sec" label="平均等待(s)" width="120" />
              <el-table-column prop="sl_met_pct" label="SLA%" width="88">
                <template #default="{ row }">{{ row.sl_met_pct.toFixed(1) }}</template>
              </el-table-column>
              <el-table-column prop="aht_sec" label="AHT(s)" width="88" />
            </el-table>
          </div>
        </el-tab-pane>

        <el-tab-pane label="坐席绩效" name="agent" lazy>
          <div v-if="pack" class="bi-pane">
            <el-card shadow="never">
              <template #header><span class="bi-card-t">处理量 TOP（演示样本）</span></template>
              <div ref="refAgentBar" class="bi-chart bi-chart--mid" />
            </el-card>
            <el-table :data="pack.agents" stripe border size="small" class="bi-table">
              <el-table-column prop="rank" label="#" width="52" />
              <el-table-column prop="agent_id" label="工号" width="100" />
              <el-table-column prop="name" label="姓名" width="88" />
              <el-table-column prop="handled" label="处理量" width="92" />
              <el-table-column prop="csat_pct" label="CSAT%" width="88" />
              <el-table-column prop="quality_avg" label="质检均分" width="92" />
              <el-table-column prop="aht_sec" label="AHT(s)" width="88" />
            </el-table>
          </div>
        </el-tab-pane>

        <el-tab-pane label="进线热力" name="heatmap" lazy>
          <div v-if="pack" class="bi-pane">
            <el-card shadow="never">
              <template #header>
                <span class="bi-card-t">星期 × 小时 进线强度（演示矩阵，可对接排班吻合分析）</span>
              </template>
              <div ref="refHeat" class="bi-chart bi-chart--heat" />
            </el-card>
          </div>
        </el-tab-pane>

        <el-tab-pane label="体验与质检" name="quality" lazy>
          <div v-if="pack" class="bi-pane">
            <el-card shadow="never">
              <template #header><span class="bi-card-t">质检均分 vs CSAT（抽样趋势）</span></template>
              <div ref="refQc" class="bi-chart bi-chart--wide" />
            </el-card>
          </div>
        </el-tab-pane>

        <el-tab-pane label="报表目录与导出" name="catalog" lazy>
          <div class="bi-pane">
            <p class="bi-catalog-intro">{{ catalog?.intro }}</p>
            <el-table :data="catalog?.themes ?? []" stripe border size="small" class="bi-table">
              <el-table-column prop="name" label="分析主题" width="160" />
              <el-table-column prop="id" label="标识" width="100" />
              <el-table-column label="典型指标" min-width="280">
                <template #default="{ row }">{{ row.metrics.join('、') }}</template>
              </el-table-column>
            </el-table>
            <div class="bi-export">
              <span class="bi-export-label">导出当前窗口汇总（CSV）</span>
              <el-button type="primary" @click="openCsvExport">下载 callcenter_bi_{{ period }}.csv</el-button>
              <p class="bi-export-hint">新标签页触发下载；生产环境若需鉴权可改为 Blob + Token。</p>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </template>
  </el-card>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as echarts from 'echarts'
import type { BiDataPack, BiPeriod } from '@/api/callCenterBi'
import { fetchBiCatalog, fetchBiDataPack, biSummaryExportUrl } from '@/api/callCenterBi'

const period = ref<BiPeriod>('7d')
const mainTab = ref('exec')
const loading = ref(false)
const errorMsg = ref('')
const pack = ref<BiDataPack | null>(null)
const catalog = ref<Awaited<ReturnType<typeof fetchBiCatalog>> | null>(null)

const refVolume = ref<HTMLElement | null>(null)
const refPie = ref<HTMLElement | null>(null)
const refSla = ref<HTMLElement | null>(null)
const refStack = ref<HTMLElement | null>(null)
const refQueueBar = ref<HTMLElement | null>(null)
const refQueueSla = ref<HTMLElement | null>(null)
const refAgentBar = ref<HTMLElement | null>(null)
const refHeat = ref<HTMLElement | null>(null)
const refQc = ref<HTMLElement | null>(null)

const chVolume = shallowRef<echarts.ECharts | null>(null)
const chPie = shallowRef<echarts.ECharts | null>(null)
const chSla = shallowRef<echarts.ECharts | null>(null)
const chStack = shallowRef<echarts.ECharts | null>(null)
const chQueueBar = shallowRef<echarts.ECharts | null>(null)
const chQueueSla = shallowRef<echarts.ECharts | null>(null)
const chAgentBar = shallowRef<echarts.ECharts | null>(null)
const chHeat = shallowRef<echarts.ECharts | null>(null)
const chQc = shallowRef<echarts.ECharts | null>(null)

function openCsvExport() {
  window.open(biSummaryExportUrl(period.value), '_blank', 'noopener,noreferrer')
}

const volumeTableRows = computed(() => {
  const p = pack.value
  if (!p) return []
  return p.volume.labels.map((date, i) => {
    const h = p.volume.handled[i]
    const a = p.volume.abandoned[i]
    const ab = h + a > 0 ? ((100 * a) / (h + a)).toFixed(2) : '0'
    return { date, handled: h, abandoned: a, ab_rate: ab }
  })
})

function kpiTag(s: string) {
  if (s === 'up' || s === 'good') return 'success'
  if (s === 'warn') return 'warning'
  return 'info'
}

function disposeAll() {
  const list = [chVolume, chPie, chSla, chStack, chQueueBar, chQueueSla, chAgentBar, chHeat, chQc]
  list.forEach((r) => {
    r.value?.dispose()
    r.value = null
  })
}

function ensure(el: HTMLElement | null, refCh: typeof chVolume) {
  if (!el || el.clientWidth === 0) return null
  if (!refCh.value) refCh.value = echarts.init(el)
  return refCh.value
}

function renderExec() {
  const p = pack.value
  if (!p) return
  const v = ensure(refVolume.value, chVolume)
  if (v) {
    v.setOption({
      color: ['#409eff', '#e6a23c'],
      grid: { left: 48, right: 20, top: 28, bottom: 32 },
      tooltip: { trigger: 'axis' },
      legend: { data: ['处理量', '放弃量'], top: 0 },
      xAxis: { type: 'category', data: p.volume.labels },
      yAxis: { type: 'value', name: '通/件' },
      series: [
        { name: '处理量', type: 'line', smooth: true, data: p.volume.handled, areaStyle: { opacity: 0.08 } },
        { name: '放弃量', type: 'line', smooth: true, data: p.volume.abandoned },
      ],
    })
    v.resize()
  }
  const s = ensure(refSla.value, chSla)
  if (s) {
    s.setOption({
      grid: { left: 52, right: 20, top: 28, bottom: 32 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: p.sla.labels },
      yAxis: { type: 'value', name: '%', min: 70, max: 100 },
      series: [
        {
          type: 'line',
          smooth: true,
          data: p.sla.sl_met_pct,
          areaStyle: { color: 'rgba(103,194,58,0.15)' },
          itemStyle: { color: '#67c23a' },
        },
      ],
    })
    s.resize()
  }
  const pie = ensure(refPie.value, chPie)
  if (pie) {
    pie.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      series: [
        {
          type: 'pie',
          radius: ['40%', '68%'],
          data: p.channel_mix.map((x) => ({ name: x.name, value: x.value })),
          label: { formatter: '{b}\n{d}%' },
        },
      ],
    })
    pie.resize()
  }
}

function renderTraffic() {
  const p = pack.value
  if (!p) return
  const c = ensure(refStack.value, chStack)
  if (c) {
    c.setOption({
      grid: { left: 48, right: 20, top: 36, bottom: 32 },
      tooltip: { trigger: 'axis' },
      legend: { data: ['处理量', '放弃量'] },
      xAxis: { type: 'category', data: p.volume.labels },
      yAxis: { type: 'value' },
      series: [
        { name: '处理量', type: 'bar', stack: 't', data: p.volume.handled, itemStyle: { color: '#409eff' } },
        { name: '放弃量', type: 'bar', stack: 't', data: p.volume.abandoned, itemStyle: { color: '#f56c6c' } },
      ],
    })
    c.resize()
  }
}

function renderQueue() {
  const p = pack.value
  if (!p) return
  const names = p.queues.map((q) => q.name)
  const b = ensure(refQueueBar.value, chQueueBar)
  if (b) {
    b.setOption({
      grid: { left: 48, right: 20, top: 24, bottom: 48 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: names, axisLabel: { rotate: 20 } },
      yAxis: { type: 'value', name: '处理量' },
      series: [{ type: 'bar', data: p.queues.map((q) => q.handled), itemStyle: { color: '#409eff' } }],
    })
    b.resize()
  }
  const s = ensure(refQueueSla.value, chQueueSla)
  if (s) {
    s.setOption({
      grid: { left: 48, right: 20, top: 24, bottom: 48 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: names, axisLabel: { rotate: 20 } },
      yAxis: { type: 'value', name: '%', min: 60, max: 100 },
      series: [{ type: 'bar', data: p.queues.map((q) => q.sl_met_pct), itemStyle: { color: '#67c23a' } }],
    })
    s.resize()
  }
}

function renderAgent() {
  const p = pack.value
  if (!p) return
  const c = ensure(refAgentBar.value, chAgentBar)
  if (c) {
    c.setOption({
      grid: { left: 72, right: 20, top: 24, bottom: 24 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'value', name: '处理量' },
      yAxis: { type: 'category', data: p.agents.map((a) => a.name).reverse() },
      series: [
        {
          type: 'bar',
          data: p.agents.map((a) => a.handled).reverse(),
          itemStyle: { color: '#909399' },
        },
      ],
    })
    c.resize()
  }
}

function renderHeat() {
  const p = pack.value
  if (!p) return
  const h = ensure(refHeat.value, chHeat)
  if (!h) return
  const { matrix, day_labels, hour_labels } = p.heatmap
  const flat: [number, number, number][] = []
  let vmax = 1
  matrix.forEach((row, j) => {
    row.forEach((v, i) => {
      flat.push([i, j, v])
      vmax = Math.max(vmax, v)
    })
  })
  h.setOption({
    tooltip: {
      position: 'top',
      formatter: (p: { data?: [number, number, number] }) => {
        const v = p.data
        if (!v || v.length < 3) return ''
        return `${day_labels[v[1]]} ${hour_labels[v[0]]}<br/>强度 ${v[2]}`
      },
    },
    grid: { height: '62%', top: '10%', left: 80, right: 24 },
    xAxis: { type: 'category', data: hour_labels, splitArea: { show: true } },
    yAxis: { type: 'category', data: day_labels, splitArea: { show: true } },
    visualMap: {
      min: 0,
      max: vmax,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: '2%',
      inRange: { color: ['#ecf5ff', '#409eff', '#1d39c4'] },
    },
    series: [
      {
        type: 'heatmap',
        data: flat,
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.25)' } },
      },
    ],
  })
  h.resize()
}

function renderQuality() {
  const p = pack.value
  if (!p) return
  const c = ensure(refQc.value, chQc)
  if (c) {
    c.setOption({
      grid: { left: 52, right: 52, top: 36, bottom: 32 },
      tooltip: { trigger: 'axis' },
      legend: { data: ['质检均分(5分制)', 'CSAT%'] },
      xAxis: { type: 'category', data: p.quality_csat.labels },
      yAxis: [
        { type: 'value', name: '分', min: 3.5, max: 5 },
        { type: 'value', name: '%', min: 80, max: 95 },
      ],
      series: [
        { name: '质检均分(5分制)', type: 'line', smooth: true, data: p.quality_csat.quality_avg },
        {
          name: 'CSAT%',
          type: 'line',
          smooth: true,
          yAxisIndex: 1,
          data: p.quality_csat.csat_pct,
          itemStyle: { color: '#e6a23c' },
        },
      ],
    })
    c.resize()
  }
}

function renderForTab(tab: string) {
  nextTick(() => {
    requestAnimationFrame(() => {
      if (tab === 'exec') renderExec()
      else if (tab === 'traffic') renderTraffic()
      else if (tab === 'queue') renderQueue()
      else if (tab === 'agent') renderAgent()
      else if (tab === 'heatmap') renderHeat()
      else if (tab === 'quality') renderQuality()
    })
  })
}

function onTabChange(name: string | number) {
  renderForTab(String(name))
}

async function loadPack() {
  loading.value = true
  errorMsg.value = ''
  try {
    pack.value = await fetchBiDataPack(period.value)
    disposeAll()
    renderForTab(mainTab.value)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

watch(period, () => {
  void loadPack()
})

onMounted(async () => {
  try {
    catalog.value = await fetchBiCatalog()
  } catch {
    /* 目录失败不阻断 */
  }
  await loadPack()
  window.addEventListener('resize', onResize)
})

function onResize() {
  ;[
    chVolume,
    chPie,
    chSla,
    chStack,
    chQueueBar,
    chQueueSla,
    chAgentBar,
    chHeat,
    chQc,
  ].forEach((c) => c.value?.resize())
}

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  disposeAll()
})
</script>

<style scoped>
.bi-root :deep(.el-card__header) {
  padding: 14px 18px;
}
.bi-root :deep(.el-card__body) {
  padding: 12px 16px 18px;
}
.bi-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.bi-title {
  font-weight: 700;
  font-size: 16px;
  color: var(--oa-text, #303133);
}
.bi-sub {
  display: block;
  font-size: 12px;
  color: var(--oa-muted, #909399);
  margin-top: 6px;
  line-height: 1.55;
  max-width: 760px;
  font-weight: normal;
}
.bi-code {
  font-size: 11px;
  padding: 1px 6px;
  background: #f4f4f5;
  border-radius: 3px;
}
.bi-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.bi-meta {
  font-size: 12px;
  color: #909399;
  margin: 0 0 12px;
}
.bi-block {
  margin-bottom: 12px;
}
.bi-tabs :deep(.el-tabs__content) {
  padding-top: 8px;
}
.bi-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.bi-kpi-row {
  margin-bottom: 0 !important;
}
.bi-kpi-card :deep(.el-card__body) {
  padding: 12px 14px;
}
.bi-kpi-label {
  font-size: 12px;
  color: #909399;
}
.bi-kpi-val {
  font-size: 20px;
  font-weight: 700;
  color: #303133;
  margin: 6px 0;
}
.bi-kpi-unit {
  font-size: 12px;
  font-weight: 500;
  color: #909399;
  margin-left: 2px;
}
.bi-kpi-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bi-kpi-hint {
  font-size: 11px;
  color: #c0c4cc;
}
.bi-chart-row {
  margin-bottom: 0 !important;
}
.bi-card-t {
  font-weight: 600;
  font-size: 14px;
}
.bi-chart {
  width: 100%;
  height: 280px;
}
.bi-chart--pie {
  height: 300px;
}
.bi-chart--wide {
  height: 300px;
}
.bi-chart--tall {
  height: 360px;
}
.bi-chart--mid {
  height: 320px;
}
.bi-chart--heat {
  height: 420px;
}
.bi-table {
  width: 100%;
}
.bi-catalog-intro {
  font-size: 13px;
  color: #606266;
  line-height: 1.65;
  margin: 0 0 12px;
}
.bi-export {
  margin-top: 16px;
  padding: 14px;
  background: #fafafa;
  border-radius: 6px;
  border: 1px solid #ebeef5;
}
.bi-export-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
  color: #303133;
}
.bi-export-hint {
  font-size: 12px;
  color: #909399;
  margin: 10px 0 0;
}
</style>
