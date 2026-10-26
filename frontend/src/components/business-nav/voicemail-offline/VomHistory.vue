<template>
  <div class="vom-panel">
    <div class="vom-toolbar">
      <el-date-picker
        v-model="dateRange"
        type="daterange"
        range-separator="至"
        start-placeholder="开始"
        end-placeholder="结束"
        size="small"
        value-format="YYYY-MM-DD"
      />
      <el-select v-model="resultCode" placeholder="处理结果码" clearable size="small" style="width: 160px">
        <el-option label="成功联络" value="成功联络" />
        <el-option label="客户拒接" value="客户拒接" />
        <el-option label="空号停机" value="空号停机" />
        <el-option label="已在线解决" value="已在线解决" />
      </el-select>
      <el-input v-model="historyQ" placeholder="单号 / 坐席" clearable size="small" style="width: 180px" />
      <el-button type="primary" size="small" @click="ElMessage.success('已查询历史（演示）')">查询</el-button>
      <el-button size="small" @click="ElMessage.info('导出 Excel（演示）')">导出</el-button>
    </div>

    <el-table :data="historyRows" border stripe size="small" class="vom-mt-table" max-height="420">
      <el-table-column prop="closedAt" label="闭环时间" width="160" />
      <el-table-column prop="id" label="原单号" width="130" />
      <el-table-column prop="type" label="类型" width="80" />
      <el-table-column prop="agent" label="处理坐席" width="100" />
      <el-table-column prop="result" label="结果码" width="100">
        <template #default="{ row }">
          <el-tag size="small" :type="row.result === '成功联络' ? 'success' : 'info'">{{ row.result }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="duration" label="处理耗时" width="92" />
      <el-table-column prop="ticket" label="关联工单" width="120" show-overflow-tooltip />
      <el-table-column prop="note" label="小结" min-width="200" show-overflow-tooltip />
      <el-table-column label="轨迹" width="72" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="showTrace(row)">查看</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="traceVisible" title="处理轨迹" width="520px" destroy-on-close>
      <el-timeline v-if="traceLines.length">
        <el-timeline-item v-for="(l, i) in traceLines" :key="i" :timestamp="l.t">{{ l.text }}</el-timeline-item>
      </el-timeline>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const dateRange = ref<[string, string] | ''>('')
const resultCode = ref('')
const historyQ = ref('')

const historyRows = ref([
  {
    closedAt: '2026-03-30 09:50:00',
    id: 'VM20260329088',
    type: '语音',
    agent: '座席B',
    result: '成功联络',
    duration: '11分',
    ticket: 'WO-992103',
    note: '已解释以旧换新政策，客户接受。',
  },
  {
    closedAt: '2026-03-29 17:20:00',
    id: 'OF20260328012',
    type: '离线',
    agent: '座席C',
    result: '已在线解决',
    duration: '6分',
    ticket: '—',
    note: '通过 APP 内消息闭环。',
  },
])

const traceVisible = ref(false)
const traceLines = ref<{ t: string; text: string }[]>([])

function showTrace(row: (typeof historyRows.value)[0]) {
  traceLines.value = [
    { t: row.closedAt, text: '关单 · ' + row.note },
    { t: '—', text: '首次联络 · 外呼接通' },
    { t: '—', text: '入队 · 技能组路由' },
  ]
  traceVisible.value = true
}
</script>

<style scoped>
.vom-panel {
  min-height: 360px;
}
.vom-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.vom-mt-table {
  margin-top: 12px;
}
</style>
