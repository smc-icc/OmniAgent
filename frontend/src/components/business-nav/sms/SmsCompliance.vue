<template>
  <div class="sms-panel">
    <el-card shadow="never" class="sms-mb">
      <template #header><span class="sms-h">退订与用户许可</span></template>
      <el-row :gutter="12">
        <el-col :xs="24" :md="12">
          <p class="sms-p">营销类须带「回 T 退订」等固定话术；系统维护全局退订号码库，发送前过滤。</p>
          <el-statistic title="退订库号码量" :value="12840" />
        </el-col>
        <el-col :xs="24" :md="12">
          <el-table :data="optoutSample" size="small" border max-height="180">
            <el-table-column prop="mask" label="号码" width="120" />
            <el-table-column prop="channel" label="渠道" width="88" />
            <el-table-column prop="time" label="退订时间" width="160" />
          </el-table>
        </el-col>
      </el-row>
    </el-card>

    <el-card shadow="never" class="sms-mb">
      <template #header><span class="sms-h">频控与黑名单</span></template>
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item label="同号 OTP 间隔">≥ 60 秒；同号日累计 ≤ 10 条（可配）</el-descriptions-item>
        <el-descriptions-item label="营销频控">同一用户自然周 ≤ 3 条营销短信</el-descriptions-item>
        <el-descriptions-item label="名单联动">与「红黑名单管理」打通：黑名单默认不发营销；红名单可走专用通道配额</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card shadow="never">
      <template #header><span class="sms-h">敏感词与合规审计</span></template>
      <el-input v-model="keywords" type="textarea" :rows="2" placeholder="命中敏感词的模板/任务将被拦截复核，如：金融收益率承诺、绝对化用语…" />
      <el-button class="sms-mt" type="primary" size="small" @click="ElMessage.success('策略已更新（演示）')">保存关键词策略</el-button>
      <el-table :data="auditLogs" class="sms-mt" border size="small" stripe>
        <el-table-column prop="time" label="时间" width="160" />
        <el-table-column prop="op" label="操作" width="120" />
        <el-table-column prop="who" label="操作人" width="100" />
        <el-table-column prop="detail" label="说明" min-width="220" show-overflow-tooltip />
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const optoutSample = ref([
  { mask: '138****0001', channel: '上行 T', time: '2026-03-28 19:02:00' },
  { mask: '159****7720', channel: '400 登记', time: '2026-03-27 11:30:00' },
])

const keywords = ref('绝对化用语, 保本保息, 零风险')

const auditLogs = ref([
  { time: '2026-03-30 08:10:00', op: '修改频控', who: '运维-李', detail: 'OTP 同号间隔 45s → 60s' },
  { time: '2026-03-29 15:22:00', op: '导入退订', who: '合规-王', detail: '批次 CSV 1200 条' },
])
</script>

<style scoped>
.sms-mb {
  margin-bottom: 12px;
}
.sms-h {
  font-weight: 600;
  font-size: 14px;
}
.sms-p {
  font-size: 13px;
  color: #606266;
  line-height: 1.6;
  margin: 0 0 12px;
}
.sms-mt {
  margin-top: 12px;
}
</style>
