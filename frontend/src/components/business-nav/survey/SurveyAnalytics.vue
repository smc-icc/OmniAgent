<template>
  <div class="sq-panel">
    <el-card shadow="never" class="sq-mb">
      <template #header>
        <span class="sq-card-title">满意度 vs 等待时长</span>
        <span class="sq-sub">用于排班与路由：观察等待超 60s 后满意度是否断崖下跌</span>
      </template>
      <div ref="scatterRef" class="sq-chart-scatter" />
    </el-card>

    <el-card shadow="never" class="sq-mb">
      <template #header>
        <span class="sq-card-title">坐席绩效佐证：问卷 vs 内部质检</span>
        <span class="sq-sub">质检分高但 CSAT 低 → 可能存在「合规但态度僵硬」</span>
      </template>
      <el-table :data="compareRows" border stripe size="small">
        <el-table-column prop="agent" label="坐席" width="100" />
        <el-table-column prop="qcScore" label="内部质检均分" width="120" align="center" />
        <el-table-column prop="csat" label="问卷满意度" width="120" align="center" />
        <el-table-column prop="gap" label="差值" width="88" align="center">
          <template #default="{ row }">
            <span :class="row.gap < -8 ? 'sq-warn' : ''">{{ row.gap > 0 ? '+' : '' }}{{ row.gap }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="diag" label="诊断提示" min-width="220" show-overflow-tooltip />
      </el-table>
    </el-card>

    <el-card shadow="never">
      <template #header><span class="sq-card-title">下钻说明</span></template>
      <p class="sq-p">
        管理端从仪表盘点击低分坐席或异常点，可穿透至「单次答卷详情 → 随卷标签 → 录音 ID →
        播放器」与开放题原文，支撑质检复核与坐席申诉全流程。
      </p>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, shallowRef, nextTick } from 'vue'
import * as echarts from 'echarts'

const scatterRef = ref<HTMLElement | null>(null)
const chartInst = shallowRef<echarts.ECharts | null>(null)

const compareRows = ref([
  { agent: '800201', qcScore: 93, csat: 91, gap: 2, diag: '一致性好' },
  { agent: '800312', qcScore: 90, csat: 62, gap: -28, diag: '建议复核态度与等待体验，安排话术辅导' },
  { agent: '800445', qcScore: 88, csat: 86, gap: -2, diag: '轻微偏离，关注个别录音' },
  { agent: '800512', qcScore: 82, csat: 84, gap: 2, diag: '客户感知略优于质检，可关注合规细节' },
])

function renderScatter() {
  const el = scatterRef.value
  if (!el || el.clientWidth === 0) return
  if (!chartInst.value) chartInst.value = echarts.init(el)
  const d: [number, number][] = []
  for (let i = 0; i < 80; i++) {
    const wait = Math.random() * 180
    let sat = 90 - wait * 0.15 + (Math.random() - 0.5) * 12
    if (wait > 60) sat -= 8 + Math.random() * 10
    sat = Math.max(40, Math.min(100, sat))
    d.push([Math.round(wait), Math.round(sat * 10) / 10])
  }
  chartInst.value.setOption({
    grid: { left: 52, right: 24, top: 28, bottom: 44 },
    tooltip: {
      formatter: (p: { value?: [number, number] }) => {
        const v = p.value ?? [0, 0]
        return `等待 ${v[0]}s<br/>满意度 ${v[1]}%`
      },
    },
    xAxis: { type: 'value', name: '等待秒', max: 180 },
    yAxis: { type: 'value', name: '满意度%', min: 40, max: 100 },
    series: [
      {
        type: 'scatter',
        symbolSize: 8,
        data: d,
        itemStyle: { color: 'rgba(64,158,255,0.75)' },
        markLine: {
          silent: true,
          data: [{ xAxis: 60, lineStyle: { type: 'dashed', color: '#f56c6c' } }],
        },
      },
    ],
  })
  chartInst.value.resize()
}

onMounted(() => {
  nextTick(() => requestAnimationFrame(renderScatter))
  window.addEventListener('resize', () => chartInst.value?.resize())
})

onBeforeUnmount(() => {
  chartInst.value?.dispose()
  chartInst.value = null
})
</script>

<style scoped>
.sq-mb {
  margin-bottom: 12px;
}
.sq-card-title {
  font-weight: 600;
  margin-right: 8px;
}
.sq-sub {
  font-size: 12px;
  color: #909399;
  font-weight: normal;
}
.sq-chart-scatter {
  height: 300px;
}
.sq-warn {
  color: #f56c6c;
  font-weight: 600;
}
.sq-p {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: #606266;
}
</style>
