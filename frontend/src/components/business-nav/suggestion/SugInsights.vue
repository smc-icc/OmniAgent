<template>
  <div class="sug-panel">
    <div class="sug-toolbar">
      <el-date-picker
        v-model="range"
        type="month"
        placeholder="统计月份"
        size="small"
        value-format="YYYY-MM"
      />
      <el-button type="primary" size="small" @click="ElMessage.success('已刷新洞察（演示）')">刷新</el-button>
    </div>

    <el-row :gutter="12" class="sug-mt">
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header><span class="sug-h">主题 Top（演示词频）</span></template>
          <el-table :data="topics" border size="small" stripe>
            <el-table-column type="index" label="#" width="48" />
            <el-table-column prop="word" label="主题词" width="120" />
            <el-table-column prop="count" label="提及量" width="88" />
            <el-table-column prop="trend" label="环比" width="80">
              <template #default="{ row }">
                <span :class="row.trend.startsWith('+') ? 'sug-up' : 'sug-down'">{{ row.trend }}</span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header><span class="sug-h">类别占比（演示）</span></template>
          <div v-for="c in share" :key="c.name" class="sug-bar">
            <div class="sug-bar-label">{{ c.name }}</div>
            <el-progress :percentage="c.pct" :stroke-width="14" :color="c.color" />
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="sug-mt">
      <template #header><span class="sug-h">跨模块联动（说明）</span></template>
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item label="满意度 / NPS">低分开放题可一键转建议单，避免重复录入</el-descriptions-item>
        <el-descriptions-item label="投诉工单">重大投诉中的「改进建议」子类可并入本模块统计</el-descriptions-item>
        <el-descriptions-item label="产品需求">采纳项可推送至需求管理工具（Jira / TAPD 等）</el-descriptions-item>
      </el-descriptions>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const range = ref('2026-03')

const topics = ref([
  { word: '报修进度', count: 428, trend: '+12%' },
  { word: '排队等待', count: 316, trend: '-4%' },
  { word: '发票材料', count: 205, trend: '+3%' },
  { word: '以旧换新', count: 188, trend: '+8%' },
])

const share = ref([
  { name: '产品功能', pct: 38, color: '#409eff' },
  { name: '服务质量', pct: 31, color: '#67c23a' },
  { name: '流程政策', pct: 21, color: '#e6a23c' },
  { name: '其他', pct: 10, color: '#909399' },
])
</script>

<style scoped>
.sug-panel {
  min-height: 360px;
}
.sug-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.sug-mt {
  margin-top: 12px;
}
.sug-h {
  font-weight: 600;
  font-size: 14px;
}
.sug-bar {
  margin-bottom: 14px;
}
.sug-bar:last-child {
  margin-bottom: 0;
}
.sug-bar-label {
  font-size: 12px;
  color: #606266;
  margin-bottom: 6px;
}
.sug-up {
  color: #67c23a;
}
.sug-down {
  color: #f56c6c;
}
</style>
