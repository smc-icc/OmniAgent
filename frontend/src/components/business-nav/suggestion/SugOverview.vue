<template>
  <div class="sug-panel">
    <el-alert
      title="呼叫中心建议管理 · 能力说明"
      type="info"
      show-icon
      :closable="false"
      class="sug-mb"
      description="汇聚客户之声（VOC）：全渠道建议采集、智能分拣、跨部门流转、限时答复与闭环跟踪；可对接工单、质检与产品需求池（演示数据）。"
    />
    <el-row :gutter="12">
      <el-col v-for="k in kpis" :key="k.key" :xs="24" :sm="12" :lg="6">
        <el-card shadow="hover" class="sug-kpi">
          <div class="sug-kpi-label">{{ k.label }}</div>
          <div class="sug-kpi-val">{{ k.value }}<span class="sug-kpi-unit">{{ k.unit }}</span></div>
          <div class="sug-kpi-sub">{{ k.sub }}</div>
        </el-card>
      </el-col>
    </el-row>
    <el-row :gutter="12" class="sug-mt">
      <el-col :xs="24" :lg="14">
        <el-card shadow="never">
          <template #header><span class="sug-h">常见业务内容</span></template>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="采集入口">挂机问卷开放题、官网/APP 表单、在线客服小结、一线坐席代录、邮件与社媒工单回流</el-descriptions-item>
            <el-descriptions-item label="分类体系">产品功能 / 服务质量 / 流程政策 / 价格资费 / 其他；支持二级标签与敏感词提示</el-descriptions-item>
            <el-descriptions-item label="流转处置">自动派至责任部门、升级班长、限期答复、采纳公示与驳回说明</el-descriptions-item>
            <el-descriptions-item label="价值闭环">高频主题聚类、需求池拉通、满意度与投诉联动分析</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="10">
        <el-card shadow="never">
          <template #header><span class="sug-h">状态机（示例）</span></template>
          <el-steps :active="3" align-center finish-status="success">
            <el-step title="已登记" description="去重合并" />
            <el-step title="评审中" description="部门认领" />
            <el-step title="已答复" description="客户可见" />
            <el-step title="已采纳/归档" description="闭环统计" />
          </el-steps>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
const kpis = [
  { key: 'n', label: '本月新增建议', value: '1,286', unit: '条', sub: '环比 +5.4%' },
  { key: 'p', label: '待处置', value: '214', unit: '条', sub: '超期 12 条（演示）' },
  { key: 'a', label: '采纳率（滚动）', value: '18.6', unit: '%', sub: '含部分采纳' },
  { key: 't', label: '平均闭环时长', value: '3.2', unit: '天', sub: '工作日' },
]
</script>

<style scoped>
.sug-panel {
  display: flex;
  flex-direction: column;
}
.sug-mb {
  margin-bottom: 12px;
}
.sug-mt {
  margin-top: 12px;
}
.sug-kpi :deep(.el-card__body) {
  padding: 14px 16px;
}
.sug-kpi-label {
  font-size: 12px;
  color: #909399;
}
.sug-kpi-val {
  margin-top: 6px;
  font-size: 22px;
  font-weight: 700;
  color: var(--oa-primary, #0066b3);
}
.sug-kpi-unit {
  font-size: 13px;
  color: #909399;
  margin-left: 4px;
}
.sug-kpi-sub {
  margin-top: 6px;
  font-size: 12px;
  color: #a8abb2;
}
.sug-h {
  font-weight: 600;
  font-size: 14px;
}
</style>
