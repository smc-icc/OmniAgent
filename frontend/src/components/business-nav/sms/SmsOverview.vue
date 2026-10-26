<template>
  <div class="sms-panel">
    <el-alert
      title="呼叫中心短信能力概览"
      type="info"
      show-icon
      :closable="false"
      class="sms-mb"
      description="涵盖模板报备、变量填充、群发/定时、状态回执、签名子端口、余额账单，以及与挂机、问卷、工单等场景的联动；以下为演示指标。"
    />
    <el-row :gutter="12">
      <el-col v-for="k in kpis" :key="k.key" :xs="24" :sm="12" :lg="6">
        <el-card shadow="hover" class="sms-kpi">
          <div class="sms-kpi-label">{{ k.label }}</div>
          <div class="sms-kpi-val">{{ k.value }}<span class="sms-kpi-unit">{{ k.unit }}</span></div>
          <div class="sms-kpi-sub">{{ k.sub }}</div>
        </el-card>
      </el-col>
    </el-row>
    <el-card shadow="never" class="sms-mt">
      <template #header><span class="sms-h">常见业务场景</span></template>
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item label="挂机短信">通话结束后由 CTI 触发，下发评价链接、工单号、验证码等（需模板审核通过）</el-descriptions-item>
        <el-descriptions-item label="告警通知">质检差评、系统故障、排队溢出等内部通知</el-descriptions-item>
        <el-descriptions-item label="客户关怀">预约提醒、账单到期、活动邀约（需营销类签名与退订说明）</el-descriptions-item>
        <el-descriptions-item label="安全核验">登录 / 支付 OTP，高频限流与防刷</el-descriptions-item>
      </el-descriptions>
    </el-card>
  </div>
</template>

<script setup lang="ts">
const kpis = [
  { key: 't', label: '已审核模板', value: '42', unit: '条', sub: '含通知 / 营销 / 验证码' },
  { key: 's', label: '今日发送量', value: '28,640', unit: '条', sub: '同比 +6.2%（演示）' },
  { key: 'r', label: '到达率', value: '97.1', unit: '%', sub: '近 24h 滚动' },
  { key: 'b', label: '账户余额（条）', value: '1,258,900', unit: '', sub: '预付费池 · 多网关加权' },
]
</script>

<style scoped>
.sms-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.sms-mb {
  margin-bottom: 12px;
}
.sms-mt {
  margin-top: 12px;
}
.sms-kpi :deep(.el-card__body) {
  padding: 14px 16px;
}
.sms-kpi-label {
  font-size: 12px;
  color: #909399;
}
.sms-kpi-val {
  margin-top: 6px;
  font-size: 22px;
  font-weight: 700;
  color: var(--oa-primary, #0066b3);
}
.sms-kpi-unit {
  font-size: 13px;
  color: #909399;
  margin-left: 4px;
}
.sms-kpi-sub {
  margin-top: 6px;
  font-size: 12px;
  color: #a8abb2;
}
.sms-h {
  font-weight: 600;
  font-size: 14px;
}
</style>
