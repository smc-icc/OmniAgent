<template>
  <div class="sat-panel">
    <el-alert
      title="派发策略决定「谁在什么时机收到哪种问卷」"
      type="success"
      show-icon
      :closable="false"
      class="sat-mb"
      description="支持按技能组 / 呼叫方向 / 通话时长 / 工单类型过滤，避免骚扰（频控、黑名单、免打扰时段）；以下为演示策略表。"
    />
    <el-table :data="policies" border stripe size="small" max-height="360">
      <el-table-column prop="name" label="策略名" min-width="140" show-overflow-tooltip />
      <el-table-column prop="event" label="触发事件" width="120" />
      <el-table-column prop="filter" label="过滤条件" min-width="200" show-overflow-tooltip />
      <el-table-column prop="template" label="模版" width="120" show-overflow-tooltip />
      <el-table-column prop="delay" label="延迟" width="100" />
      <el-table-column label="启用" width="72">
        <template #default="{ row }">
          <el-switch v-model="row.on" size="small" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default>
          <el-button link type="primary" size="small" @click="ElMessage.info('编辑策略（演示）')">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-card shadow="never" class="sat-mt">
      <template #header><span class="sat-h">频控与合规（简配）</span></template>
      <el-form :model="guard" label-width="140px" size="small" class="sat-form">
        <el-form-item label="同一客户最短间隔">
          <el-input-number v-model="guard.minDays" :min="1" :max="90" />
          <span class="sat-unit">天</span>
        </el-form-item>
        <el-form-item label="单日同一号码上限">
          <el-input-number v-model="guard.dailyCap" :min="1" :max="20" />
          <span class="sat-unit">次</span>
        </el-form-item>
        <el-form-item label="免打扰时段">
          <el-input v-model="guard.quietRange" placeholder="如 22:00–08:00" style="width: 220px" clearable />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="ElMessage.success('频控已保存（演示）')">保存</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const policies = ref([
  {
    name: '呼入人工接通',
    event: '通话结束',
    filter: '技能组∈售后 & 时长≥60s & 非测试号码',
    template: 'SAT-IVR-01',
    delay: '即时 IVR',
    on: true,
  },
  {
    name: '高价值客户短信',
    event: '通话结束',
    filter: '客户标签含 VIP & 未拒收营销',
    template: 'SAT-SMS-H5',
    delay: '+15 分钟',
    on: true,
  },
  {
    name: '工单已解决',
    event: '工单状态变更',
    filter: '类型=维修 & 结案原因=正常完结',
    template: 'SAT-NPS-WO',
    delay: '+24 小时',
    on: false,
  },
])

const guard = ref({
  minDays: 7,
  dailyCap: 2,
  quietRange: '22:00–08:00',
})
</script>

<style scoped>
.sat-panel {
  min-height: 360px;
}
.sat-mb {
  margin-bottom: 12px;
}
.sat-mt {
  margin-top: 14px;
}
.sat-h {
  font-weight: 600;
  font-size: 14px;
}
.sat-form {
  max-width: 520px;
}
.sat-unit {
  margin-left: 8px;
  font-size: 12px;
  color: #909399;
}
</style>
