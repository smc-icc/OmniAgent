<template>
  <div class="sat-panel">
    <div class="sat-toolbar">
      <el-select v-model="filterSev" placeholder="严重程度" clearable size="small" style="width: 120px">
        <el-option label="高" value="高" />
        <el-option label="中" value="中" />
      </el-select>
      <el-select v-model="filterState" placeholder="处理状态" clearable size="small" style="width: 120px">
        <el-option label="待分派" value="待分派" />
        <el-option label="跟进中" value="跟进中" />
        <el-option label="已闭环" value="已闭环" />
      </el-select>
      <el-button type="primary" size="small" @click="ElMessage.success('已刷新预警列表（演示）')">刷新</el-button>
    </div>

    <el-table :data="filtered" border stripe size="small" class="sat-mt" max-height="400">
      <el-table-column prop="id" label="预警单号" width="130" />
      <el-table-column prop="score" label="得分" width="72">
        <template #default="{ row }">
          <el-tag type="danger" size="small">{{ row.score }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="customer" label="客户" width="100" show-overflow-tooltip />
      <el-table-column prop="channel" label="来源" width="88" />
      <el-table-column prop="agent" label="责任坐席" width="100" show-overflow-tooltip />
      <el-table-column prop="reason" label="原因摘要" min-width="180" show-overflow-tooltip />
      <el-table-column prop="sev" label="级别" width="72">
        <template #default="{ row }">
          <el-tag :type="row.sev === '高' ? 'danger' : 'warning'" size="small">{{ row.sev }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="state" label="状态" width="88">
        <template #default="{ row }">
          <el-tag :type="row.state === '已闭环' ? 'success' : row.state === '跟进中' ? 'primary' : 'info'" size="small">
            {{ row.state }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="time" label="产生时间" width="160" />
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openRow(row)">处置</el-button>
          <el-button link type="primary" size="small" @click="ElMessage.info('跳转录音（演示）')">录音</el-button>
          <el-button link type="warning" size="small" @click="ElMessage.success('已指派班长（演示）')">升级</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dlg" title="低分预警处置" width="560px" destroy-on-close>
      <template v-if="dlgRow">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="预警单">{{ dlgRow.id }}</el-descriptions-item>
          <el-descriptions-item label="客户 / 坐席">{{ dlgRow.customer }} · {{ dlgRow.agent }}</el-descriptions-item>
          <el-descriptions-item label="原文摘要">{{ dlgRow.reason }}</el-descriptions-item>
        </el-descriptions>
        <el-form label-position="top" class="sat-dlg-form">
          <el-form-item label="处置结论">
            <el-radio-group v-model="dispose.kind">
              <el-radio value="回访">二次外呼回访</el-radio>
              <el-radio value="辅导">坐席辅导</el-radio>
              <el-radio value="合规">合规复核</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="dispose.note" type="textarea" :rows="3" placeholder="处理说明" />
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="dlg = false">取消</el-button>
        <el-button type="primary" @click="submitDispose">提交（演示）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'

interface AlertRow {
  id: string
  score: string
  customer: string
  channel: string
  agent: string
  reason: string
  sev: string
  state: string
  time: string
}

const rows = ref<AlertRow[]>([
  {
    id: 'AL20260330009',
    score: '1★',
    customer: '138****8001',
    channel: 'IVR',
    agent: '张敏',
    reason: '客户反馈等待过久且未一次性解决',
    sev: '高',
    state: '待分派',
    time: '2026-03-30 08:42:11',
  },
  {
    id: 'AL20260329188',
    score: '2★',
    customer: '访客_5512',
    channel: '短信 H5',
    agent: '李雷',
    reason: '对方案不满意，要求主管回电',
    sev: '中',
    state: '跟进中',
    time: '2026-03-29 19:10:00',
  },
  {
    id: 'AL20260328055',
    score: '2★',
    customer: '021-****9999',
    channel: 'IVR',
    agent: '王芳',
    reason: '态度生硬（主观评价）',
    sev: '中',
    state: '已闭环',
    time: '2026-03-28 11:25:33',
  },
])

const filterSev = ref('')
const filterState = ref('')

const filtered = computed(() => {
  let list = rows.value
  if (filterSev.value) list = list.filter((r) => r.sev === filterSev.value)
  if (filterState.value) list = list.filter((r) => r.state === filterState.value)
  return list
})

const dlg = ref(false)
const dlgRow = ref<AlertRow | null>(null)
const dispose = ref({ kind: '回访', note: '' })

function openRow(row: AlertRow) {
  dlgRow.value = row
  dispose.value = { kind: '回访', note: '' }
  dlg.value = true
}

function submitDispose() {
  ElMessage.success('处置已记录（演示）')
  if (dlgRow.value) dlgRow.value.state = '跟进中'
  dlg.value = false
}
</script>

<style scoped>
.sat-panel {
  min-height: 360px;
}
.sat-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.sat-mt {
  margin-top: 12px;
}
.sat-dlg-form {
  margin-top: 12px;
}
</style>
