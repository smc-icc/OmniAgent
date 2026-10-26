<template>
  <div class="vom-panel">
    <el-row :gutter="12" class="vom-cards">
      <el-col :xs="24" :md="8">
        <el-card shadow="never">
          <template #header><span class="vom-h">预约回电</span></template>
          <el-form label-position="top" size="small">
            <el-form-item label="关联单号">
              <el-input v-model="schedForm.refId" placeholder="VM / OF / 工单号" />
            </el-form-item>
            <el-form-item label="客户号码 / 渠道 ID">
              <el-input v-model="schedForm.contact" placeholder="外呼号码或渠道标识" />
            </el-form-item>
            <el-form-item label="预约时间">
              <el-date-picker
                v-model="schedForm.when"
                type="datetime"
                placeholder="选择时间"
                style="width: 100%"
                value-format="YYYY-MM-DD HH:mm:ss"
              />
            </el-form-item>
            <el-form-item label="提醒">
              <el-checkbox-group v-model="schedForm.remind">
                <el-checkbox value="sms">短信提醒客户</el-checkbox>
                <el-checkbox value="Seat pop">到点座席弹屏</el-checkbox>
              </el-checkbox-group>
            </el-form-item>
            <el-button type="primary" @click="submitSchedule">创建回电计划（演示）</el-button>
          </el-form>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="16">
        <el-card shadow="never">
          <template #header>
            <div class="vom-card-head">
              <span class="vom-h">指派与批量</span>
              <el-button size="small" @click="ElMessage.info('打开班长工单池（演示）')">打开工单池</el-button>
            </div>
          </template>
          <el-table :data="assignRows" border stripe size="small" max-height="280">
            <el-table-column type="selection" width="42" />
            <el-table-column prop="id" label="单号" width="130" />
            <el-table-column prop="type" label="类型" width="88" />
            <el-table-column prop="summary" label="摘要" min-width="160" show-overflow-tooltip />
            <el-table-column prop="wait" label="等待" width="72" />
            <el-table-column label="指派给" width="140">
              <template #default="{ row }">
                <el-select v-model="row.assignee" placeholder="坐席 / 组" size="small" style="width: 120px">
                  <el-option label="一组-张敏" value="一组-张敏" />
                  <el-option label="二组-李雷" value="二组-李雷" />
                  <el-option label="投诉组-班长" value="投诉组-班长" />
                </el-select>
              </template>
            </el-table-column>
          </el-table>
          <div class="vom-batch">
            <el-button type="primary" size="small" @click="ElMessage.success('已批量指派选中行（演示）')">批量指派</el-button>
            <el-button size="small" @click="ElMessage.success('已合并同客户待办（演示）')">合并同客户</el-button>
            <el-button size="small" type="warning" @click="ElMessage.warning('已标记升级班长（演示）')">升级班长</el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const schedForm = ref({
  refId: '',
  contact: '',
  when: '',
  remind: [] as string[],
})

function submitSchedule() {
  ElMessage.success('回电计划已写入日程（演示）')
  schedForm.value = { refId: '', contact: '', when: '', remind: [] }
}

const assignRows = ref([
  { id: 'VM20260330001', type: '语音', summary: '冰箱制冷异常', wait: '48分', assignee: '' },
  { id: 'OF20260330056', type: '离线', summary: '改约上门时间', wait: '1.2h', assignee: '' },
  { id: 'VM20260330002', type: '语音', summary: '安装延迟投诉', wait: '16h', assignee: '' },
])
</script>

<style scoped>
.vom-panel {
  min-height: 360px;
}
.vom-cards {
  align-items: stretch;
}
.vom-h {
  font-weight: 600;
  font-size: 14px;
}
.vom-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.vom-batch {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
