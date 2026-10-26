<template>
  <div class="sq-panel">
    <el-card shadow="never" class="sq-mb">
      <template #header><span class="sq-card-title">差评实时告警规则</span></template>
      <el-form :model="rule" label-width="120px" class="sq-form-max">
        <el-form-item label="触发条件">
          <el-checkbox-group v-model="rule.triggers">
            <el-checkbox value="score1">量表选择「非常不满意」</el-checkbox>
            <el-checkbox value="keyword">开放题命中敏感词</el-checkbox>
            <el-checkbox value="nps0">NPS 0–2 分</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="敏感词库">
          <el-input v-model="rule.keywords" type="textarea" :rows="2" placeholder="如：投诉315、曝光、工商局" />
        </el-form-item>
        <el-form-item label="推送渠道">
          <el-checkbox-group v-model="rule.channels">
            <el-checkbox value="ding">钉钉</el-checkbox>
            <el-checkbox value="wx">企业微信</el-checkbox>
            <el-checkbox value="sms">短信</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="接收人">
          <el-select v-model="rule.receivers" multiple filterable style="width: 100%">
            <el-option label="班组长-张（值班）" value="a" />
            <el-option label="质检主管-李" value="L" />
            <el-option label="二线值班" value="b" />
          </el-select>
        </el-form-item>
        <el-form-item label="SLA">
          <span class="sq-sla">黄金 <strong>30</strong> 分钟内必须认领或回电干预，超时自动升级</span>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="ElMessage.success('告警规则已保存（演示）')">保存规则</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-row :gutter="12">
      <el-col :xs="24" :lg="14">
        <el-card shadow="never">
          <template #header><span class="sq-card-title">最近告警</span></template>
          <el-table :data="alerts" size="small" stripe max-height="280">
            <el-table-column prop="time" label="时间" width="154" />
            <el-table-column prop="level" label="级别" width="88">
              <template #default="{ row }">
                <el-tag :type="row.level === '高' ? 'danger' : 'warning'" size="small">{{ row.level }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="summary" label="摘要" min-width="180" show-overflow-tooltip />
            <el-table-column prop="agent" label="坐席" width="88" />
            <el-table-column label="状态" width="88">
              <template #default="{ row }">
                <el-tag :type="row.done ? 'success' : 'info'" size="small">{{ row.done ? '已处理' : '待处理' }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="10">
        <el-card shadow="never">
          <template #header><span class="sq-card-title">自动生成工单</span></template>
          <p class="sq-p">特定差评类型自动建「投诉单」或「改进单」，流转责任部门。</p>
          <el-table :data="workOrders" size="small" border>
            <el-table-column prop="id" label="工单号" width="120" />
            <el-table-column prop="type" label="类型" width="100" />
            <el-table-column prop="status" label="状态" width="88" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const rule = ref({
  triggers: ['score1', 'keyword'] as string[],
  keywords: '投诉315、曝光、黑猫、工商局',
  channels: ['ding', 'wx'] as string[],
  receivers: ['a'] as string[],
})

const alerts = ref([
  { time: '今天 14:22:08', level: '高', summary: '开放题命中「要曝光你们」', agent: '800312', done: false },
  { time: '今天 11:05:33', level: '高', summary: '全量量表选「非常不满意」', agent: '800105', done: true },
  { time: '昨天 19:41:12', level: '中', summary: 'NPS=0 且无文字说明', agent: '800891', done: false },
])

const workOrders = ref([
  { id: 'WO-20260330-001', type: '投诉工单', status: '处理中' },
  { id: 'IM-20260329-014', type: '改进工单', status: '待分派' },
])
</script>

<style scoped>
.sq-mb {
  margin-bottom: 12px;
}
.sq-card-title {
  font-weight: 600;
}
.sq-form-max {
  max-width: 720px;
}
.sq-sla {
  font-size: 13px;
  color: #606266;
}
.sq-p {
  font-size: 13px;
  color: #606266;
  margin: 0 0 10px;
}
</style>
