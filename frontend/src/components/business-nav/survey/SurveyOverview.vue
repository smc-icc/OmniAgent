<template>
  <div class="sq-panel">
    <el-row :gutter="12" class="sq-kpi-row">
      <el-col v-for="k in kpis" :key="k.key" :xs="24" :sm="12" :lg="6">
        <el-card shadow="hover" class="sq-kpi-card">
          <div class="sq-kpi-label">{{ k.label }}</div>
          <div class="sq-kpi-val">{{ k.value }}<span class="sq-kpi-unit">{{ k.unit }}</span></div>
          <div class="sq-kpi-sub">{{ k.sub }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="12" class="sq-chart-row">
      <el-col :xs="24" :lg="14">
        <el-card shadow="never">
          <template #header><span class="sq-card-title">近 7 日回收趋势</span></template>
          <div ref="trendRef" class="sq-chart" />
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="10">
        <el-card shadow="never">
          <template #header><span class="sq-card-title">今日差评 TOP3 坐席</span></template>
          <el-table :data="badTop" size="small" stripe>
            <el-table-column type="index" label="#" width="48" />
            <el-table-column prop="agent" label="坐席工号" width="100" />
            <el-table-column prop="score" label="今日满意度" width="100">
              <template #default="{ row }">
                <el-tag :type="row.score < 70 ? 'danger' : 'warning'" size="small">{{ row.score }}%</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="cnt" label="差评条数" width="88" />
            <el-table-column label="操作" width="88">
              <template #default>
                <el-button link type="primary" size="small" @click="ElMessage.info('可下钻至录音与明细')">下钻</el-button>
              </template>
            </el-table-column>
          </el-table>
          <p class="sq-hint">点击下钻可穿透至该坐席当日问卷、关联通话录音与客户留言（演示）</p>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="sq-perf-hint">
      <template #header><span class="sq-card-title">问卷数据如何服务坐席绩效</span></template>
      <ul class="sq-list">
        <li><strong>满意度评分：</strong>问卷 CSAT 通常作为主观绩效权最高的输入，与质检、生产力指标组合考核。</li>
        <li><strong>不满意归因：</strong>多级选项与 NLP 标签可汇总为「业务不熟 / 态度 / 等待」等维度，驱动专项复训。</li>
        <li><strong>录音佐证：</strong>低分答卷自动关联当通录音，质检可一键复核；若属客户非理性反馈支持绩效申诉。</li>
      </ul>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, shallowRef, nextTick } from 'vue'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'

const kpis = [
  { key: 'csat', label: '当前满意度均值', value: '87.6', unit: '%', sub: '全渠道加权，含 IVR / 短信 / APP' },
  { key: 'recv', label: '问卷回收率', value: '14.2', unit: '%', sub: '较启用激励前 +9pt（演示）' },
  { key: 'today', label: '今日回收量', value: '1,842', unit: '份', sub: '峰值控制下自动节流中' },
  { key: 'alert', label: '待干预差评', value: '6', unit: '条', sub: '30 分钟内未闭环将升级' },
]

const badTop = [
  { agent: '800312', score: 62, cnt: 4 },
  { agent: '800105', score: 68, cnt: 3 },
  { agent: '800891', score: 71, cnt: 3 },
]

const trendRef = ref<HTMLElement | null>(null)
const chartInst = shallowRef<echarts.ECharts | null>(null)

function renderTrend() {
  const el = trendRef.value
  if (!el || el.clientWidth === 0) return
  if (!chartInst.value) chartInst.value = echarts.init(el)
  chartInst.value.setOption({
    grid: { left: 48, right: 20, top: 28, bottom: 32 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: ['D-6', 'D-5', 'D-4', 'D-3', 'D-2', 'D-1', '今日'] },
    yAxis: { type: 'value', name: '份' },
    series: [
      {
        type: 'line',
        smooth: true,
        data: [1200, 1320, 1180, 1450, 1510, 1690, 1842],
        areaStyle: { color: 'rgba(64,158,255,0.12)' },
        itemStyle: { color: '#409eff' },
      },
    ],
  })
  chartInst.value.resize()
}

function schedule() {
  nextTick(() => requestAnimationFrame(renderTrend))
}

onMounted(() => {
  schedule()
  window.addEventListener('resize', () => chartInst.value?.resize())
})

onBeforeUnmount(() => {
  chartInst.value?.dispose()
  chartInst.value = null
})
</script>

<style scoped>
.sq-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sq-kpi-row {
  margin-bottom: 0 !important;
}
.sq-kpi-card :deep(.el-card__body) {
  padding: 14px 16px;
}
.sq-kpi-label {
  font-size: 12px;
  color: #909399;
}
.sq-kpi-val {
  margin-top: 6px;
  font-size: 22px;
  font-weight: 700;
  color: var(--oa-primary, #0066b3);
}
.sq-kpi-unit {
  font-size: 13px;
  font-weight: 500;
  color: #909399;
  margin-left: 4px;
}
.sq-kpi-sub {
  margin-top: 6px;
  font-size: 12px;
  color: #a8abb2;
}
.sq-chart {
  height: 260px;
  width: 100%;
}
.sq-chart-row {
  margin-bottom: 0 !important;
}
.sq-card-title {
  font-weight: 600;
  font-size: 14px;
}
.sq-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: #909399;
}
.sq-perf-hint :deep(.el-card__body) {
  padding: 12px 16px 16px;
}
.sq-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.75;
  color: #606266;
}
</style>
