<template>
  <div class="sat-panel">
    <el-alert
      title="呼叫中心满意度管理 · 能力概览"
      type="info"
      show-icon
      :closable="false"
      class="sat-mb"
      description="覆盖餐后（挂机）调研、短信/链接回访、CSAT/NPS 指标、按队列与坐席下钻、低分预警与二次回访闭环；下为演示指标，可对接 CTI、工单与 BI。"
    />
    <el-row :gutter="12">
      <el-col v-for="k in kpis" :key="k.key" :xs="24" :sm="12" :lg="6">
        <el-card shadow="hover" class="sat-kpi">
          <div class="sat-kpi-label">{{ k.label }}</div>
          <div class="sat-kpi-val">{{ k.value }}<span class="sat-kpi-unit">{{ k.unit }}</span></div>
          <div class="sat-kpi-sub">{{ k.sub }}</div>
        </el-card>
      </el-col>
    </el-row>
    <el-row :gutter="12" class="sat-mt">
      <el-col :xs="24" :lg="14">
        <el-card shadow="never">
          <template #header><span class="sat-h">典型场景</span></template>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="挂机 IVR 评分">通话结束按键 1–5 星或 NPS 0–10，实时写入录音与工单</el-descriptions-item>
            <el-descriptions-item label="短信/短链问卷">挂机异步下发 H5，支持防刷、频控与模板审核</el-descriptions-item>
            <el-descriptions-item label="工单闭环回访">工单「已解决」后 T+24h 触发，对比多渠道触达效果</el-descriptions-item>
            <el-descriptions-item label="低分治理">低于阈值自动建预警单、班长复核、录音抽查与辅导任务</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="10">
        <el-card shadow="never">
          <template #header><span class="sat-h">指标口径（演示）</span></template>
          <ul class="sat-list">
            <li><strong>CSAT</strong>：满意及以上占比（4–5 星或「满意」选项）</li>
            <li><strong>回收率</strong>：有效问卷数 ÷ 派发样本量</li>
            <li><strong>FCR 关联</strong>：可与服务请求一次性解决率交叉分析</li>
            <li><strong>NPS</strong>：推荐者% − 贬损者%（需独立 NPS 题）</li>
          </ul>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
const kpis = [
  { key: 'csat', label: '本月 CSAT', value: '91.2', unit: '%', sub: '环比 +0.8pt' },
  { key: 'nps', label: '滚动 NPS', value: '+42', unit: '', sub: '近 30 天' },
  { key: 'rr', label: '问卷回收率', value: '24.6', unit: '%', sub: '短信链路偏高' },
  { key: 'al', label: '待处理低分单', value: '37', unit: '单', sub: '需班长 / 质检跟进' },
]
</script>

<style scoped>
.sat-panel {
  display: flex;
  flex-direction: column;
}
.sat-mb {
  margin-bottom: 12px;
}
.sat-mt {
  margin-top: 12px;
}
.sat-kpi :deep(.el-card__body) {
  padding: 14px 16px;
}
.sat-kpi-label {
  font-size: 12px;
  color: #909399;
}
.sat-kpi-val {
  margin-top: 6px;
  font-size: 22px;
  font-weight: 700;
  color: var(--oa-primary, #0066b3);
}
.sat-kpi-unit {
  font-size: 13px;
  color: #909399;
  margin-left: 4px;
}
.sat-kpi-sub {
  margin-top: 6px;
  font-size: 12px;
  color: #a8abb2;
}
.sat-h {
  font-weight: 600;
  font-size: 14px;
}
.sat-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.75;
  color: #606266;
}
</style>
