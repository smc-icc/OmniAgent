<template>
  <div class="sq-panel">
    <el-row :gutter="12">
      <el-col :xs="24" :lg="10">
        <el-card shadow="never" class="sq-mb">
          <template #header><span class="sq-card-title">情绪识别（IVR / 语音留言）</span></template>
          <p class="sq-p">通过声纹能量与语义模型识别愤怒 / 平和 / 愉悦，用于识别「因系统卡顿、重复播报导致的非理性低分」并打标签降权。</p>
          <div ref="emoRef" class="sq-chart-emotion" />
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="14">
        <el-card shadow="never" class="sq-mb">
          <template #header><span class="sq-card-title">防刷与数据清洗</span></template>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="同号短时重复">15 分钟内同一主叫仅计 1 次有效问卷</el-descriptions-item>
            <el-descriptions-item label="空评 / 乱码">开放题长度过短或重复字符剔除</el-descriptions-item>
            <el-descriptions-item label="无效联系方式">外呼回拨空号、黑名单号码不入统计池</el-descriptions-item>
            <el-descriptions-item label="系统异常时段">识别 IVR 超时时长区段，批量标记可疑样本</el-descriptions-item>
          </el-descriptions>
          <el-row :gutter="10" class="sq-stat-row">
            <el-col :span="8">
              <div class="sq-stat"><span class="sq-stat-num">{{ clean.rejected }}</span><span>剔除样本</span></div>
            </el-col>
            <el-col :span="8">
              <div class="sq-stat"><span class="sq-stat-num">{{ clean.suspect }}</span><span>可疑降权</span></div>
            </el-col>
            <el-col :span="8">
              <div class="sq-stat"><span class="sq-stat-num">{{ clean.valid }}</span><span>有效样本</span></div>
            </el-col>
          </el-row>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <template #header>
        <span class="sq-card-title">开放题 NLP 归类</span>
        <span class="sq-sub">自动打标后可生成词云与报表下钻</span>
      </template>
      <div class="sq-tags">
        <el-tag
          v-for="t in nlpTags"
          :key="t.word"
          :type="t.type"
          effect="dark"
          class="sq-tag-cloud"
          :style="{ fontSize: `${12 + t.weight}px` }"
        >
          {{ t.word }} · {{ t.cnt }}
        </el-tag>
      </div>
      <p class="sq-p sq-p-foot">演示标签：响应慢、业务能力差、设备故障、反复转接、态度生硬、等待过长…… 实际可对接自研或第三方 NLP。</p>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, shallowRef, nextTick } from 'vue'
import * as echarts from 'echarts'

const clean = ref({
  rejected: 128,
  suspect: 34,
  valid: 18412,
})

const nlpTags = [
  { word: '等待过长', cnt: 420, weight: 8, type: 'danger' },
  { word: '业务不熟', cnt: 312, weight: 6, type: 'warning' },
  { word: '响应慢', cnt: 288, weight: 5, type: 'warning' },
  { word: '态度问题', cnt: 210, weight: 5, type: 'danger' },
  { word: '设备故障', cnt: 156, weight: 4, type: 'info' },
  { word: '转接太多', cnt: 134, weight: 3, type: 'info' },
  { word: '非常满意', cnt: 890, weight: 2, type: 'success' },
]

const emoRef = ref<HTMLElement | null>(null)
const emoChart = shallowRef<echarts.ECharts | null>(null)

function renderEmo() {
  const el = emoRef.value
  if (!el || el.clientWidth === 0) return
  if (!emoChart.value) emoChart.value = echarts.init(el)
  emoChart.value.setOption({
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [
      {
        type: 'pie',
        radius: ['40%', '68%'],
        data: [
          { value: 62, name: '平和' },
          { value: 18, name: '愉悦' },
          { value: 14, name: '愤怒/焦躁' },
          { value: 6, name: '无法识别' },
        ],
      },
    ],
  })
  emoChart.value.resize()
}

onMounted(() => {
  nextTick(() => {
    requestAnimationFrame(renderEmo)
  })
  window.addEventListener('resize', () => emoChart.value?.resize())
})

onBeforeUnmount(() => {
  emoChart.value?.dispose()
  emoChart.value = null
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
.sq-p {
  font-size: 13px;
  color: #606266;
  margin: 0 0 10px;
  line-height: 1.6;
}
.sq-chart-emotion {
  height: 220px;
}
.sq-stat-row {
  margin-top: 14px;
}
.sq-stat {
  text-align: center;
  padding: 10px;
  background: #f5f7fa;
  border-radius: 6px;
  font-size: 12px;
  color: #606266;
}
.sq-stat-num {
  display: block;
  font-size: 20px;
  font-weight: 700;
  color: var(--oa-primary, #0066b3);
}
.sq-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.sq-tag-cloud {
  margin: 0;
}
.sq-p-foot {
  margin-top: 14px;
  margin-bottom: 0;
}
</style>
