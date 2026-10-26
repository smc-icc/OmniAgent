<template>
  <div class="iv-root">
    <!-- ── 页头 ───────────────────────────────────── -->
    <div class="iv-header">
      <h3 class="iv-title">🔍 AIQC 智能质检</h3>
      <div class="iv-header-actions">
        <el-button :icon="Refresh" circle @click="loadAll" :loading="loading" title="刷新" />
        <el-button type="primary" :icon="Plus" @click="openTaskDialog">提交质检任务</el-button>
      </div>
    </div>

    <!-- ── 统计卡 ──────────────────────────────────── -->
    <el-row :gutter="12" class="iv-stats" v-loading="statsLoading">
      <el-col v-for="card in statsCards" :key="card.key" :xs="12" :sm="8" :md="4">
        <el-card shadow="hover" class="iv-stat-card">
          <div class="iv-stat-label">{{ card.label }}</div>
          <div class="iv-stat-value" :class="card.colorClass">{{ card.value }}</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- ── 筛选栏 ──────────────────────────────────── -->
    <el-card shadow="never" class="iv-filter-bar">
      <el-form inline size="small" @submit.prevent>
        <el-form-item label="日期范围">
          <el-date-picker
            v-model="filterDateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            style="width: 220px"
            @change="onFilterChange"
          />
        </el-form-item>
        <el-form-item label="坐席">
          <el-input
            v-model="filterAgent"
            placeholder="工号 / 姓名"
            clearable
            style="width: 130px"
            @change="onFilterChange"
          />
        </el-form-item>
        <el-form-item label="风险等级">
          <el-select
            v-model="filterRisk"
            placeholder="全部"
            clearable
            style="width: 110px"
            @change="onFilterChange"
          >
            <el-option label="低风险" value="low" />
            <el-option label="中风险" value="medium" />
            <el-option label="高风险" value="high" />
            <el-option label="严重" value="critical" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button @click="resetFilter" size="small">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- ── 状态 Tabs + 列表 ───────────────────────── -->
    <el-tabs v-model="activeTab" @tab-change="onTabChange" class="iv-tabs">
      <el-tab-pane v-for="tab in tabOptions" :key="tab.value" :label="tab.label" :name="tab.value" />
    </el-tabs>

    <!-- 列表 -->
    <el-table
      :data="results"
      stripe
      border
      size="small"
      v-loading="loading"
      row-key="id"
      class="iv-table"
      @row-click="(row: QcResult) => goDetail(row.id)"
    >
      <el-table-column prop="agent" label="坐席" width="90" />
      <el-table-column prop="work_no" label="工号" width="80" />
      <el-table-column prop="call_id" label="通话ID" width="130" show-overflow-tooltip />
      <el-table-column label="时长" width="70">
        <template #default="{ row }">{{ fmtDuration(row.duration) }}</template>
      </el-table-column>
      <el-table-column label="得分" width="70">
        <template #default="{ row }">
          <span :class="scoreClass(row.score)">{{ row.score }}</span>
        </template>
      </el-table-column>
      <el-table-column label="命中项" width="65" align="center">
        <template #default="{ row }">
          <el-badge :value="row.findings_count" :max="99" type="danger" :hidden="row.findings_count === 0">
            <span>{{ row.findings_count }}</span>
          </el-badge>
        </template>
      </el-table-column>
      <el-table-column label="风险" width="80">
        <template #default="{ row }">
          <el-tag :type="riskTag(row.risk_level)" size="small">{{ riskText(row.risk_level) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="statusTag(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="150">
        <template #default="{ row }">{{ fmtDate(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="130" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="row.status === 'completed' || row.status === 'reviewing'"
            size="small"
            type="warning"
            link
            @click.stop="openReviewDialog(row)"
          >复核</el-button>
          <el-button size="small" type="primary" link @click.stop="goDetail(row.id)">详情</el-button>
        </template>
      </el-table-column>

      <!-- 空态 -->
      <template #empty>
        <el-empty v-if="!loading" description="暂无质检记录" :image-size="80">
          <el-button type="primary" size="small" @click="openTaskDialog">提交第一个任务</el-button>
        </el-empty>
      </template>
    </el-table>

    <!-- 分页 -->
    <div class="iv-pagination">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        small
        @current-change="loadList"
        @size-change="onPageSizeChange"
      />
    </div>

    <!-- ── 任务提交弹窗 ─────────────────────────────── -->
    <el-dialog v-model="taskVisible" title="提交质检任务" width="480px" :close-on-click-modal="false">
      <el-form :model="taskForm" :rules="taskRules" ref="taskFormRef" label-width="110px">
        <el-form-item label="会话引用" prop="session_ref">
          <el-input v-model="taskForm.session_ref" placeholder="SessionRef / 会话 ID" clearable />
        </el-form-item>
        <el-form-item label="录音 URI" prop="recording_uri">
          <el-input v-model="taskForm.recording_uri" placeholder="oss://bucket/path/to/record.wav" clearable />
        </el-form-item>
        <el-form-item label="检测策略 ID" prop="policy_id">
          <el-input v-model="taskForm.policy_id" placeholder="policy_xxx" clearable />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="taskVisible = false">取消</el-button>
        <el-button type="primary" :loading="taskSubmitting" @click="submitTask">提交</el-button>
      </template>
    </el-dialog>

    <!-- ── 人工复核弹窗 ─────────────────────────────── -->
    <el-dialog v-model="reviewVisible" title="人工复核" width="460px" :close-on-click-modal="false">
      <div v-if="reviewTarget" class="iv-review-info">
        <el-descriptions :column="2" size="small" border>
          <el-descriptions-item label="坐席">{{ reviewTarget.agent }}</el-descriptions-item>
          <el-descriptions-item label="通话ID">{{ reviewTarget.call_id }}</el-descriptions-item>
          <el-descriptions-item label="AI 得分">{{ reviewTarget.score }}</el-descriptions-item>
          <el-descriptions-item label="风险">{{ riskText(reviewTarget.risk_level) }}</el-descriptions-item>
        </el-descriptions>
      </div>
      <el-form :model="reviewForm" label-width="100px" class="iv-review-form">
        <el-form-item label="复核得分">
          <el-input-number v-model="reviewForm.score" :min="0" :max="100" :step="1" />
        </el-form-item>
        <el-form-item label="复核评语">
          <el-input v-model="reviewForm.comment" type="textarea" :rows="4" placeholder="请输入复核意见..." />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reviewVisible = false">取消</el-button>
        <el-button type="primary" :loading="reviewSubmitting" @click="submitReviewAction">提交复核</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue'
import { ElMessage, type FormInstance } from 'element-plus'
import { Refresh, Plus } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import {
  fetchQcResults,
  fetchQcStats,
  submitQcTask,
  submitReview,
  type QcResult,
  type QcStats,
  type AiqcStatus,
  type RiskLevel,
} from '@/api/inspection'

const router = useRouter()

// ── 分页与列表 ─────────────────────────────────────────────────
const results = ref<QcResult[]>([])
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)
const loading = ref(false)

// ── 统计 ────────────────────────────────────────────────────────
const statsLoading = ref(false)
const stats = ref<QcStats>({
  total_this_month: 0,
  avg_score: 0,
  passed_rate: 0,
  queued_count: 0,
  reviewing_count: 0,
  failed_count: 0,
  high_risk_count: 0,
})

const statsCards = computed(() => [
  { key: 'total', label: '本月总数', value: stats.value.total_this_month, colorClass: 'iv-blue' },
  { key: 'avg', label: '平均分', value: stats.value.avg_score.toFixed(1), colorClass: 'iv-green' },
  { key: 'pass', label: '通过率', value: `${stats.value.passed_rate.toFixed(1)}%`, colorClass: 'iv-green' },
  { key: 'queued', label: '排队中', value: stats.value.queued_count, colorClass: 'iv-gray' },
  { key: 'reviewing', label: '待复核', value: stats.value.reviewing_count, colorClass: 'iv-orange' },
  { key: 'highrisk', label: '高风险', value: stats.value.high_risk_count, colorClass: 'iv-red' },
])

// ── Tabs ────────────────────────────────────────────────────────
const tabOptions: { label: string; value: AiqcStatus | '' }[] = [
  { label: '全部', value: '' },
  { label: '排队中', value: 'queued' },
  { label: '检测中', value: 'running' },
  { label: '已完成', value: 'completed' },
  { label: '失败', value: 'failed' },
  { label: '待复核', value: 'reviewing' },
  { label: '申诉中', value: 'appealed' },
  { label: '已关闭', value: 'closed' },
]
const activeTab = ref<AiqcStatus | ''>('')

// ── 筛选 ────────────────────────────────────────────────────────
const filterDateRange = ref<[string, string] | null>(null)
const filterAgent = ref('')
const filterRisk = ref<RiskLevel | ''>('')

// ── 弹窗：任务提交 ─────────────────────────────────────────────
const taskVisible = ref(false)
const taskSubmitting = ref(false)
const taskFormRef = ref<FormInstance>()
const taskForm = reactive({ session_ref: '', recording_uri: '', policy_id: '' })
const taskRules = {
  session_ref: [{ required: true, message: '请填写会话引用', trigger: 'blur' }],
  recording_uri: [{ required: true, message: '请填写录音 URI', trigger: 'blur' }],
  policy_id: [{ required: true, message: '请填写检测策略 ID', trigger: 'blur' }],
}

// ── 弹窗：人工复核 ─────────────────────────────────────────────
const reviewVisible = ref(false)
const reviewSubmitting = ref(false)
const reviewTarget = ref<QcResult | null>(null)
const reviewForm = reactive({ score: 80, comment: '' })

// ══════════════════════════════════════════════════════════════
// 数据加载
// ══════════════════════════════════════════════════════════════

async function loadList() {
  loading.value = true
  try {
    const params = {
      status: activeTab.value || undefined,
      risk_level: filterRisk.value || undefined,
      agent: filterAgent.value || undefined,
      date_from: filterDateRange.value?.[0] || undefined,
      date_to: filterDateRange.value?.[1] || undefined,
      page: currentPage.value,
      page_size: pageSize.value,
    }
    const res = await fetchQcResults(params)
    results.value = res.items ?? []
    total.value = res.total ?? 0
  } catch (err: unknown) {
    results.value = []
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '加载质检列表失败'
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}

async function loadStats() {
  statsLoading.value = true
  try {
    stats.value = await fetchQcStats()
  } catch {
    // 统计失败不强拦，保持默认零值；列表已有 ElMessage
  } finally {
    statsLoading.value = false
  }
}

function loadAll() {
  void loadList()
  void loadStats()
}

// ══════════════════════════════════════════════════════════════
// 筛选 / Tab 事件
// ══════════════════════════════════════════════════════════════

function onTabChange() {
  currentPage.value = 1
  void loadList()
}

function onFilterChange() {
  currentPage.value = 1
  void loadList()
}

function onPageSizeChange() {
  currentPage.value = 1
  void loadList()
}

function resetFilter() {
  filterDateRange.value = null
  filterAgent.value = ''
  filterRisk.value = ''
  currentPage.value = 1
  void loadList()
}

// ══════════════════════════════════════════════════════════════
// 任务提交
// ══════════════════════════════════════════════════════════════

function openTaskDialog() {
  taskForm.session_ref = ''
  taskForm.recording_uri = ''
  taskForm.policy_id = ''
  taskVisible.value = true
}

async function submitTask() {
  const valid = await taskFormRef.value?.validate().catch(() => false)
  if (!valid) return
  taskSubmitting.value = true
  try {
    const res = await submitQcTask({ ...taskForm })
    ElMessage.success(`任务已提交，任务 ID：${res.task_id}`)
    taskVisible.value = false
    void loadAll()
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '提交任务失败'
    ElMessage.error(msg)
  } finally {
    taskSubmitting.value = false
  }
}

// ══════════════════════════════════════════════════════════════
// 人工复核
// ══════════════════════════════════════════════════════════════

function openReviewDialog(row: QcResult) {
  reviewTarget.value = row
  reviewForm.score = row.score
  reviewForm.comment = ''
  reviewVisible.value = true
}

async function submitReviewAction() {
  if (!reviewTarget.value) return
  if (!reviewForm.comment.trim()) {
    ElMessage.warning('请填写复核评语')
    return
  }
  reviewSubmitting.value = true
  try {
    await submitReview(reviewTarget.value.id, { score: reviewForm.score, comment: reviewForm.comment })
    ElMessage.success('复核已提交')
    reviewVisible.value = false
    void loadList()
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '提交复核失败'
    ElMessage.error(msg)
  } finally {
    reviewSubmitting.value = false
  }
}

// ══════════════════════════════════════════════════════════════
// 路由跳转
// ══════════════════════════════════════════════════════════════

function goDetail(id: string) {
  void router.push({ name: 'inspection-detail', params: { id } })
}

// ══════════════════════════════════════════════════════════════
// 格式化工具
// ══════════════════════════════════════════════════════════════

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function scoreClass(score: number): string {
  if (score >= 80) return 'iv-score-good'
  if (score >= 60) return 'iv-score-warn'
  return 'iv-score-bad'
}

function riskTag(level: RiskLevel): 'success' | 'warning' | 'danger' | 'info' {
  return { low: 'success', medium: 'warning', high: 'danger', critical: 'danger' }[level] as 'success' | 'warning' | 'danger' | 'info'
}

function riskText(level: RiskLevel): string {
  return { low: '低', medium: '中', high: '高', critical: '严重' }[level] ?? level
}

function statusTag(s: AiqcStatus): 'info' | 'primary' | 'success' | 'danger' | 'warning' {
  const map: Record<AiqcStatus, 'info' | 'primary' | 'success' | 'danger' | 'warning'> = {
    queued: 'info',
    running: 'primary',
    completed: 'success',
    failed: 'danger',
    reviewing: 'warning',
    appealed: 'danger',
    closed: 'info',
  }
  return map[s] ?? 'info'
}

function statusText(s: AiqcStatus): string {
  const map: Record<AiqcStatus, string> = {
    queued: '排队中',
    running: '检测中',
    completed: '已完成',
    failed: '失败',
    reviewing: '待复核',
    appealed: '申诉中',
    closed: '已关闭',
  }
  return map[s] ?? s
}

onMounted(loadAll)
</script>

<style scoped>
.iv-root { padding: 16px; background: var(--oa-card, #fff); border-radius: 8px; min-height: 400px; }

.iv-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.iv-title { margin: 0; font-size: 18px; }
.iv-header-actions { display: flex; gap: 8px; align-items: center; }

.iv-stats { margin-bottom: 14px; }
.iv-stat-card { text-align: center; padding: 4px 0; }
.iv-stat-label { color: #909399; font-size: 12px; }
.iv-stat-value { font-size: 22px; font-weight: 700; }
.iv-blue { color: #409eff; }
.iv-green { color: #67c23a; }
.iv-orange { color: #e6a23c; }
.iv-red { color: #f56c6c; }
.iv-gray { color: #909399; }

.iv-filter-bar { margin-bottom: 12px; }
.iv-filter-bar :deep(.el-form-item) { margin-bottom: 0; }

.iv-tabs { margin-bottom: 0; }
.iv-table { width: 100%; cursor: pointer; }

.iv-score-good { color: #67c23a; font-weight: 600; }
.iv-score-warn { color: #e6a23c; font-weight: 600; }
.iv-score-bad { color: #f56c6c; font-weight: 600; }

.iv-pagination { margin-top: 14px; display: flex; justify-content: flex-end; }

.iv-review-info { margin-bottom: 14px; }
.iv-review-form { margin-top: 12px; }
</style>
