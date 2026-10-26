<template>
  <div class="vom-panel">
    <el-alert
      title="路由、优先级与 SLA"
      type="warning"
      show-icon
      :closable="false"
      class="vom-mb"
      description="以下为演示配置；生产环境通常由平台管理端维护，与 IVR、技能组、客户等级、时段策略联动。"
    />
    <el-row :gutter="12">
      <el-col :xs="24" :lg="14">
        <el-card shadow="never">
          <template #header><span class="vom-h">入队路由规则（简表）</span></template>
          <el-table :data="routeRules" border size="small" stripe>
            <el-table-column prop="name" label="规则名" min-width="120" />
            <el-table-column prop="cond" label="条件" min-width="200" show-overflow-tooltip />
            <el-table-column prop="target" label="目标队列" width="120" />
            <el-table-column prop="prio" label="优先级" width="80" />
            <el-table-column label="启用" width="72">
              <template #default="{ row }">
                <el-switch v-model="row.on" size="small" />
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="10">
        <el-card shadow="never">
          <template #header><span class="vom-h">SLA 阈值</span></template>
          <el-form label-width="120px" size="small">
            <el-form-item label="首次响应">
              <el-input-number v-model="sla.first" :min="5" :max="240" />
              <span class="vom-unit">分钟</span>
            </el-form-item>
            <el-form-item label="语音留言闭环">
              <el-input-number v-model="sla.vm" :min="30" :max="2880" />
              <span class="vom-unit">分钟</span>
            </el-form-item>
            <el-form-item label="离线消息闭环">
              <el-input-number v-model="sla.off" :min="30" :max="2880" />
              <span class="vom-unit">分钟</span>
            </el-form-item>
            <el-form-item label="超时动作">
              <el-select v-model="sla.action" placeholder="选择" style="width: 100%">
                <el-option label="班长队列 + 短信告警" value="班长队列 + 短信告警" />
                <el-option label="自动外呼客户（IVR）" value="自动外呼客户（IVR）" />
                <el-option label="仅报表记录" value="仅报表记录" />
              </el-select>
            </el-form-item>
            <el-button type="primary" @click="ElMessage.success('SLA 已保存（演示）')">保存</el-button>
          </el-form>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const routeRules = ref([
  { name: 'VIP 直通', cond: '客户标签含 VIP 且 时段 09:00-21:00', target: '高优技能组', prio: 'P1', on: true },
  { name: '投诉关键词', cond: '留言转写含「投诉」「315」', target: '投诉专席', prio: 'P1', on: true },
  { name: '非工作时间', cond: 'IVR 非工作时间键入留言', target: '次日首班消化', prio: 'P3', on: true },
])

const sla = ref({
  first: 30,
  vm: 240,
  off: 120,
  action: '班长队列 + 短信告警',
})
</script>

<style scoped>
.vom-panel {
  min-height: 360px;
}
.vom-mb {
  margin-bottom: 12px;
}
.vom-h {
  font-weight: 600;
  font-size: 14px;
}
.vom-unit {
  margin-left: 8px;
  font-size: 12px;
  color: #909399;
}
</style>
