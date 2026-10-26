<template>
  <div class="sug-panel">
    <div class="sug-toolbar">
      <el-select v-model="dept" placeholder="我的部门视图" size="small" style="width: 180px">
        <el-option label="产品运营组" value="产品运营组" />
        <el-option label="呼叫中心运营" value="呼叫中心运营" />
        <el-option label="市场部" value="市场部" />
      </el-select>
      <el-button type="primary" size="small" @click="ElMessage.success('已刷新队列（演示）')">刷新</el-button>
    </div>

    <el-table :data="deskRows" border stripe size="small" class="sug-mt" max-height="400">
      <el-table-column prop="id" label="建议单号" width="130" />
      <el-table-column prop="category" label="类别" width="100" />
      <el-table-column prop="summary" label="摘要" min-width="180" show-overflow-tooltip />
      <el-table-column prop="due" label="承诺答复日" width="120" />
      <el-table-column prop="risk" label="风险" width="80">
        <template #default="{ row }">
          <el-tag v-if="row.risk === '超期'" type="danger" size="small">{{ row.risk }}</el-tag>
          <el-tag v-else type="info" size="small">{{ row.risk }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="assignee" label="经办人" width="100">
        <template #default="{ row }">
          <el-select v-model="row.assignee" size="small" placeholder="指派" style="width: 100px">
            <el-option label="—" value="" />
            <el-option label="张三" value="张三" />
            <el-option label="李四" value="李四" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="快捷动作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="reply(row)">答复模板</el-button>
          <el-button link type="success" size="small" @click="adopt(row)">采纳标记</el-button>
          <el-button link type="warning" size="small" @click="escalate(row)">升级</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="replyDlg" title="答复客户（演示）" width="520px" destroy-on-close>
      <el-input v-model="replyText" type="textarea" :rows="5" placeholder="将展示给客户或站内消息（演示）" />
      <template #footer>
        <el-button @click="replyDlg = false">取消</el-button>
        <el-button type="primary" @click="sendReply">发送</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const dept = ref('产品运营组')

interface DeskRow {
  id: string
  category: string
  summary: string
  due: string
  risk: string
  assignee: string
}

const deskRows = ref<DeskRow[]>([
  {
    id: 'SG20260330021',
    category: '产品功能',
    summary: '希望 APP 增加报修进度推送',
    due: '2026-04-02',
    risk: '正常',
    assignee: '',
  },
  {
    id: 'SG20260326015',
    category: '产品功能',
    summary: '语音遥控器方言识别优化',
    due: '2026-03-28',
    risk: '超期',
    assignee: '张三',
  },
])

const replyDlg = ref(false)
const replyText = ref('')

function reply(_row: DeskRow) {
  replyText.value = '感谢您的宝贵建议，我们已记录并将纳入下一版本评估。'
  replyDlg.value = true
}

function sendReply() {
  ElMessage.success('答复已保存（演示）')
  replyDlg.value = false
}

function adopt(row: DeskRow) {
  ElMessage.success(`已标记采纳 · ${row.id}（演示）`)
}

function escalate(row: DeskRow) {
  ElMessage.warning(`已升级至部门负责人 · ${row.id}（演示）`)
}
</script>

<style scoped>
.sug-panel {
  min-height: 360px;
}
.sug-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.sug-mt {
  margin-top: 12px;
}
</style>
