<template>
  <div class="rr-root">
    <div class="rr-header">
      <h3 class="rr-title">小休申请记录</h3>
      <el-button text type="primary" :loading="loading" @click="reload">刷新</el-button>
    </div>

    <el-tabs v-model="tab" @tab-change="onTabChange">
      <el-tab-pane label="我的申请" name="mine" />
      <el-tab-pane v-if="isLeader" label="我的审批" name="approved" />
    </el-tabs>

    <el-table v-loading="loading" :data="rows" stripe size="small" empty-text="暂无记录">
      <template v-if="tab === 'mine'">
        <el-table-column label="申请时间" min-width="150">
          <template #default="{ row }">{{ fmtDt(row.requested_at) }}</template>
        </el-table-column>
        <el-table-column prop="content" label="内容" min-width="180" show-overflow-tooltip />
        <el-table-column label="时长" width="90">
          <template #default="{ row }">{{ fmtDur(row.duration_sec) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="审批时间" min-width="150">
          <template #default="{ row }">{{ fmtDt(row.approved_at) }}</template>
        </el-table-column>
        <el-table-column prop="approve_opinion" label="审批意见" min-width="140" show-overflow-tooltip />
        <el-table-column label="审批人" min-width="120">
          <template #default="{ row }">
            {{ row.leader_name || row.leader_work_no || '—' }}
            <span v-if="row.leader_work_no" class="rr-sub">（{{ row.leader_work_no }}）</span>
          </template>
        </el-table-column>
      </template>
      <template v-else>
        <el-table-column label="发起人" min-width="140">
          <template #default="{ row }">
            {{ row.applicant_name || row.applicant_work_no }}
            <span v-if="row.applicant_work_no" class="rr-sub">（{{ row.applicant_work_no }}）</span>
          </template>
        </el-table-column>
        <el-table-column prop="content" label="内容" min-width="180" show-overflow-tooltip />
        <el-table-column label="时长" width="90">
          <template #default="{ row }">{{ fmtDur(row.duration_sec) }}</template>
        </el-table-column>
        <el-table-column label="申请时间" min-width="150">
          <template #default="{ row }">{{ fmtDt(row.requested_at) }}</template>
        </el-table-column>
        <el-table-column label="审批时间" min-width="150">
          <template #default="{ row }">{{ fmtDt(row.approved_at) }}</template>
        </el-table-column>
        <el-table-column prop="approve_opinion" label="审批意见" min-width="160" show-overflow-tooltip />
        <el-table-column label="结果" width="90">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
      </template>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  fetchApprovedRestRequests,
  fetchMyRestRequests,
  fetchRestRequestMeta,
  type RestRequestItem,
  type RestRequestStatus,
} from '@/api/restRequests'
import { ElMessage } from 'element-plus'

const tab = ref<'mine' | 'approved'>('mine')
const isLeader = ref(false)
const loading = ref(false)
const rows = ref<RestRequestItem[]>([])

function fmtDt(v: string | null) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function fmtDur(sec: number | null | undefined) {
  const n = Number(sec) || 0
  if (n <= 0) return '不限时'
  if (n % 60 === 0) return `${n / 60} 分钟`
  return `${n} 秒`
}

function statusLabel(s: RestRequestStatus) {
  if (s === 'pending') return '待审批'
  if (s === 'approved') return '已同意'
  if (s === 'rejected') return '已拒绝'
  if (s === 'self_approved') return '自动通过'
  return s
}

function statusType(s: RestRequestStatus) {
  if (s === 'pending') return 'warning'
  if (s === 'approved' || s === 'self_approved') return 'success'
  if (s === 'rejected') return 'danger'
  return 'info'
}

async function reload() {
  loading.value = true
  try {
    rows.value =
      tab.value === 'approved' ? await fetchApprovedRestRequests() : await fetchMyRestRequests()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function onTabChange() {
  void reload()
}

onMounted(async () => {
  const meta = await fetchRestRequestMeta()
  isLeader.value = !!meta.is_leader
  await reload()
})
</script>

<style scoped>
.rr-root {
  padding: 16px 20px 24px;
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
  background: #f5f7fa;
}
.rr-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.rr-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}
.rr-sub {
  color: #909399;
  font-size: 12px;
}
</style>
