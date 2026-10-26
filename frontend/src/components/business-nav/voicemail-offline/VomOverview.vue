<template>
  <div class="vom-panel">
    <el-alert
      title="留言与离线消息处理 · 能力说明"
      type="info"
      show-icon
      :closable="false"
      class="vom-mb"
      description="覆盖 IVR 语音留言、全渠道离线会话（在线客服断线留言、社媒私信等）、统一队列、指派与回电计划、处理轨迹与 SLA；以下为演示指标，可对接录音/ASR、工单与客户资料。"
    />
    <el-row :gutter="12">
      <el-col v-for="k in kpis" :key="k.key" :xs="24" :sm="12" :lg="6">
        <el-card shadow="hover" class="vom-kpi">
          <div class="vom-kpi-label">{{ k.label }}</div>
          <div class="vom-kpi-val">
            {{ k.value }}<span class="vom-kpi-unit">{{ k.unit }}</span>
          </div>
          <div class="vom-kpi-sub">{{ k.sub }}</div>
        </el-card>
      </el-col>
    </el-row>
    <el-row :gutter="12" class="vom-mt">
      <el-col :xs="24" :lg="12">
        <el-card shadow="never">
          <template #header><span class="vom-h">典型处理流程</span></template>
          <el-timeline>
            <el-timeline-item timestamp="入队" placement="top">
              客户挂机留言或离线渠道写入统一消息池，继承来电号码 / 会话 ID、技能组与优先级
            </el-timeline-item>
            <el-timeline-item timestamp="认领 / 指派" placement="top">
              班长指派或坐席抢单；可合并同一客户的重复留言
            </el-timeline-item>
            <el-timeline-item timestamp="回电 / 回复" placement="top">
              外呼回电或渠道内文字回复，填写处理小结与联络结果码
            </el-timeline-item>
            <el-timeline-item timestamp="闭环" placement="top">
              关联合单、满意度或质检抽样；超时自动升级与报表沉淀
            </el-timeline-item>
          </el-timeline>
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="12">
        <el-card shadow="never">
          <template #header><span class="vom-h">常用功能清单</span></template>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="语音留言">录音试听、下载、转写（可选）、留言分类与紧急标记</el-descriptions-item>
            <el-descriptions-item label="离线消息">会话上下文、多媒体附件、敏感词提示</el-descriptions-item>
            <el-descriptions-item label="队列与 SLA">技能路由、溢出、预约回电、临期与超期预警</el-descriptions-item>
            <el-descriptions-item label="质量与合规">全程轨迹、工单联动、审计与导出</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
const kpis = [
  { key: 'p', label: '待处理（全渠道）', value: '186', unit: '条', sub: '含语音 72 · 离线 114' },
  { key: 'o', label: 'SLA 临期（2h 内）', value: '23', unit: '条', sub: '需优先回电 / 回复' },
  { key: 't', label: '今日已闭环', value: '1,048', unit: '条', sub: '环比 +4.1%（演示）' },
  { key: 'c', label: '平均处理时长', value: '14', unit: '分', sub: '从入队到首次有效联络' },
]
</script>

<style scoped>
.vom-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.vom-mb {
  margin-bottom: 12px;
}
.vom-mt {
  margin-top: 12px;
}
.vom-kpi :deep(.el-card__body) {
  padding: 14px 16px;
}
.vom-kpi-label {
  font-size: 12px;
  color: #909399;
}
.vom-kpi-val {
  margin-top: 6px;
  font-size: 22px;
  font-weight: 700;
  color: var(--oa-primary, #0066b3);
}
.vom-kpi-unit {
  font-size: 13px;
  color: #909399;
  margin-left: 4px;
}
.vom-kpi-sub {
  margin-top: 6px;
  font-size: 12px;
  color: #a8abb2;
}
.vom-h {
  font-weight: 600;
  font-size: 14px;
}
</style>
