<template>
  <div class="sat-panel">
    <div class="sat-toolbar">
      <el-input v-model="q" placeholder="模版名称 / 编码" clearable size="small" class="sat-search" />
      <el-button type="primary" size="small" @click="ElMessage.success('已刷新（演示）')">查询</el-button>
      <el-button type="success" size="small" @click="ElMessage.info('新建模版向导（演示）')">新建模版</el-button>
    </div>
    <el-table :data="filtered" border stripe size="small" class="sat-mt" max-height="440">
      <el-table-column prop="code" label="编码" width="120" />
      <el-table-column prop="name" label="模版名称" min-width="160" show-overflow-tooltip />
      <el-table-column prop="channel" label="渠道" width="100" />
      <el-table-column prop="type" label="题型" width="120" show-overflow-tooltip />
      <el-table-column prop="ver" label="版本" width="72" />
      <el-table-column prop="status" label="状态" width="88">
        <template #default="{ row }">
          <el-tag :type="row.status === '已发布' ? 'success' : 'info'" size="small">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="preview(row)">预览</el-button>
          <el-button link type="primary" size="small" @click="ElMessage.success('复制草稿（演示）')">复制</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="previewVisible" title="问卷预览（演示）" width="480px" destroy-on-close>
      <template v-if="previewRow">
        <p class="sat-preview-title">{{ previewRow.name }}</p>
        <el-divider content-position="left">示例题目</el-divider>
        <div v-for="(qu, i) in previewRow.questions" :key="i" class="sat-q">
          <span class="sat-q-no">{{ i + 1 }}.</span>
          <span>{{ qu }}</span>
        </div>
      </template>
      <template #footer>
        <el-button @click="previewVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'

interface TplRow {
  code: string
  name: string
  channel: string
  type: string
  ver: string
  status: string
  questions: string[]
}

const rows = ref<TplRow[]>([
  {
    code: 'SAT-IVR-01',
    name: '挂机五星 + 原因二级',
    channel: 'IVR',
    type: '星级 + 单选原因',
    ver: 'v3',
    status: '已发布',
    questions: ['总体满意度 1–5 星', '不满意时原因：态度 / 方案 / 等待 / 其他'],
  },
  {
    code: 'SAT-SMS-H5',
    name: '短信短链 H5 满意度',
    channel: '短信',
    type: 'CSAT + 开放文本',
    ver: 'v2',
    status: '已发布',
    questions: ['本次服务是否解决您的问题？', '您还有什么建议？（选填）'],
  },
  {
    code: 'SAT-NPS-WO',
    name: '工单结案 NPS',
    channel: '微信 / 邮件',
    type: 'NPS 0–10',
    ver: 'v1',
    status: '草稿',
    questions: ['您有多大意愿向亲友推荐我司？0–10 分', '主要原因（选填）'],
  },
])

const q = ref('')
const filtered = computed(() => {
  const s = q.value.trim()
  if (!s) return rows.value
  return rows.value.filter((r) => r.name.includes(s) || r.code.includes(s))
})

const previewVisible = ref(false)
const previewRow = ref<TplRow | null>(null)

function preview(row: TplRow) {
  previewRow.value = row
  previewVisible.value = true
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
.sat-search {
  width: 200px;
}
.sat-mt {
  margin-top: 12px;
}
.sat-preview-title {
  font-weight: 600;
  margin: 0 0 8px;
  font-size: 15px;
}
.sat-q {
  font-size: 13px;
  line-height: 1.6;
  margin-bottom: 8px;
  color: #606266;
}
.sat-q-no {
  font-weight: 600;
  margin-right: 6px;
  color: var(--oa-primary, #0066b3);
}
</style>
