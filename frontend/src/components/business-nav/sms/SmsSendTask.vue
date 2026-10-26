<template>
  <div class="sms-panel">
    <el-alert title="发送任务" type="warning" show-icon :closable="false" class="sms-mb">
      支持立即发送、定时发送、文件导入号码；可挂接挂机策略、问卷邀评、坐席直发额度管控（演示）。
    </el-alert>

    <el-card shadow="never" class="sms-mb">
      <template #header><span class="sms-h">新建任务</span></template>
      <el-form :model="task" label-width="120px" class="sms-form">
        <el-form-item label="任务名称" required>
          <el-input v-model="task.name" placeholder="如：3月满意度邀评-批次A" style="max-width: 400px" />
        </el-form-item>
        <el-form-item label="选用模板">
          <el-select v-model="task.tpl" filterable style="width: 100%; max-width: 400px">
            <el-option label="挂机评价链接 TPL-N-001" value="TPL-N-001" />
            <el-option label="活动邀约 TPL-M-002" value="TPL-M-002" />
            <el-option label="工单进度 TPL-N-NEW" value="TPL-N-NEW" />
          </el-select>
        </el-form-item>
        <el-form-item label="号码来源">
          <el-radio-group v-model="task.src">
            <el-radio value="file">文件导入</el-radio>
            <el-radio value="cti">CTI 随路名单</el-radio>
            <el-radio value="sql">客群标签圈选</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="发送时间">
          <el-radio-group v-model="task.when">
            <el-radio value="now">立即</el-radio>
            <el-radio value="cron">定时</el-radio>
          </el-radio-group>
          <el-date-picker
            v-if="task.when === 'cron'"
            v-model="task.schedule"
            type="datetime"
            placeholder="选择时间"
            style="margin-left: 12px"
            value-format="YYYY-MM-DD HH:mm:ss"
          />
        </el-form-item>
        <el-form-item label="峰值 QPS">
          <el-input-number v-model="task.qps" :min="10" :max="2000" />
          <span class="sms-tip">与网关合同及频控策略一致</span>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="submit">创建任务（演示）</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <template #header><span class="sms-h">任务列表</span></template>
      <el-table :data="tasks" border stripe size="small">
        <el-table-column prop="id" label="任务ID" width="140" />
        <el-table-column prop="name" label="名称" min-width="160" show-overflow-tooltip />
        <el-table-column prop="tpl" label="模板" width="120" />
        <el-table-column prop="cnt" label="计划数" width="88" align="center" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === '发送中' ? 'primary' : row.status === '已完成' ? 'success' : 'info'" size="small">
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="prog" label="进度" width="120">
          <template #default="{ row }">
            <el-progress :percentage="row.prog" :stroke-width="10" />
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const task = ref({
  name: '',
  tpl: 'TPL-N-001',
  src: 'file',
  when: 'now',
  schedule: '' as string | null,
  qps: 200,
})

const tasks = ref([
  { id: 'JOB-88321', name: '挂机邀评-华南', tpl: 'TPL-N-001', cnt: 12000, status: '发送中', prog: 68 },
  { id: 'JOB-88302', name: '逾期账单提醒', tpl: 'TPL-N-NEW', cnt: 3200, status: '定时队列', prog: 0 },
  { id: 'JOB-88288', name: '会员活动', tpl: 'TPL-M-002', cnt: 8500, status: '已完成', prog: 100 },
])

function submit() {
  ElMessage.success('任务已创建并入队（演示）')
}
</script>

<style scoped>
.sms-mb {
  margin-bottom: 12px;
}
.sms-h {
  font-weight: 600;
  font-size: 14px;
}
.sms-form {
  max-width: 720px;
}
.sms-tip {
  margin-left: 12px;
  font-size: 12px;
  color: #909399;
}
</style>
