<template>
  <div class="rb-panel">
    <el-alert
      title="名单总览"
      type="info"
      show-icon
      :closable="false"
      description="黑名单是盾牌：降低骚扰与无效话务，稳定 AHT 与接通率。红名单是引擎：保障高价值客户体验与一次性解决率。灰名单用于观察期策略。"
      class="rb-mb"
    />
    <el-row :gutter="12">
      <el-col v-for="k in kpis" :key="k.key" :xs="24" :sm="12" :lg="6">
        <el-card shadow="hover" class="rb-kpi">
          <div class="rb-kpi-label">{{ k.label }}</div>
          <div class="rb-kpi-val">{{ k.value }}<span v-if="k.unit" class="rb-kpi-unit">{{ k.unit }}</span></div>
          <div class="rb-kpi-sub">{{ k.sub }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="12" class="rb-mt">
      <el-col :xs="24" :lg="12">
        <el-card shadow="never">
          <template #header><span class="rb-h">拦截成效（本月）</span></template>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="黑名单 IVR 拦截通数">{{ stats.blockedCalls }}</el-descriptions-item>
            <el-descriptions-item label="预估节省坐席工时">{{ stats.savedHours }} 人时（演示推算）</el-descriptions-item>
            <el-descriptions-item label="红名单零等待进线">{{ stats.vipZeroWait }} 次</el-descriptions-item>
            <el-descriptions-item label="灰名单提示覆盖">{{ stats.grayHints }} 次</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="12">
        <el-card shadow="never">
          <template #header><span class="rb-h">红名单流失预警（演示）</span></template>
          <el-table :data="vipAlerts" size="small" stripe max-height="200">
            <el-table-column prop="mask" label="号码" width="120" />
            <el-table-column prop="level" label="等级" width="100" />
            <el-table-column prop="signal" label="信号" min-width="180" show-overflow-tooltip />
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const kpis = [
  { key: 'b', label: '有效黑名单条目', value: '2,842', unit: '条', sub: '含临时 + 永久' },
  { key: 'r', label: '红名单在册', value: '516', unit: '条', sub: 'VIP / 关怀 / 内部' },
  { key: 'g', label: '灰名单观察', value: '189', unit: '条', sub: '不拦截，弹屏提示' },
  { key: 'i', label: '今日拦截率', value: '3.8', unit: '%', sub: '占全量呼入比（演示）' },
]

const stats = ref({
  blockedCalls: '18,420',
  savedHours: '412',
  vipZeroWait: '1,256',
  grayHints: '892',
})

const vipAlerts = ref([
  { mask: '139****7781', level: '钻石 VIP', signal: '近 30 天进线频次下降 62%' },
  { mask: '186****2200', level: '政企 keyman', signal: '问卷 NLP 出现负面词频上升' },
])
</script>

<style scoped>
.rb-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.rb-mb {
  margin-bottom: 12px;
}
.rb-mt {
  margin-top: 12px;
}
.rb-kpi :deep(.el-card__body) {
  padding: 14px 16px;
}
.rb-kpi-label {
  font-size: 12px;
  color: #909399;
}
.rb-kpi-val {
  margin-top: 6px;
  font-size: 22px;
  font-weight: 700;
  color: var(--oa-primary, #0066b3);
}
.rb-kpi-unit {
  font-size: 13px;
  color: #909399;
  margin-left: 4px;
}
.rb-kpi-sub {
  margin-top: 6px;
  font-size: 12px;
  color: #a8abb2;
}
.rb-h {
  font-weight: 600;
  font-size: 14px;
}
</style>
