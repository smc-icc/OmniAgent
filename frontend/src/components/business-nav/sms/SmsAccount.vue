<template>
  <div class="sms-panel">
    <el-row :gutter="12">
      <el-col :xs="24" :lg="12">
        <el-card shadow="never">
          <template #header><span class="sms-h">签名与子端口</span></template>
          <el-table :data="signatures" border size="small">
            <el-table-column prop="sign" label="短信签名" width="140" />
            <el-table-column prop="sub" label="子端口/子账号" width="140" />
            <el-table-column prop="use" label="用途" min-width="120" />
            <el-table-column prop="status" label="状态" width="88">
              <template #default="{ row }">
                <el-tag type="success" size="small">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
          <el-button class="sms-mt" type="primary" plain size="small" @click="ElMessage.info('提交运营商新增签名（演示）')">申请新签名</el-button>
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="12">
        <el-card shadow="never">
          <template #header><span class="sms-h">余额与网关路由</span></template>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="当前余额">{{ balance }} 条（折合 ¥ 约 {{ money }}）</el-descriptions-item>
            <el-descriptions-item label="主用网关">GW-A（移动） / 失败自动旁路 GW-B</el-descriptions-item>
            <el-descriptions-item label="本月已消耗">842,100 条</el-descriptions-item>
            <el-descriptions-item label="预警阈值">余额 &lt; 20 万条时短信通知财务与运维</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="sms-mt">
      <template #header><span class="sms-h">近期账单摘要</span></template>
      <el-table :data="bills" border stripe size="small">
        <el-table-column prop="period" label="账期" width="110" />
        <el-table-column prop="count" label="条数" width="100" align="right" />
        <el-table-column prop="amount" label="金额(¥)" width="100" align="right" />
        <el-table-column prop="note" label="备注" min-width="200" show-overflow-tooltip />
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const signatures = ref([
  { sign: '【美的服务】', sub: 'SP-10086-A', use: '通知 / 挂机', status: '生效' },
  { sign: '【美的】', sub: 'SP-10086-B', use: '营销（带退订）', status: '生效' },
])

const balance = '1,258,900'
const money = '62,945'

const bills = ref([
  { period: '2026-02', count: '756,200', amount: '37,810', note: '通知类占比 72%' },
  { period: '2026-01', count: '802,400', amount: '40,120', note: '含春节活动营销波次' },
])
</script>

<style scoped>
.sms-h {
  font-weight: 600;
  font-size: 14px;
}
.sms-mt {
  margin-top: 12px;
}
</style>
