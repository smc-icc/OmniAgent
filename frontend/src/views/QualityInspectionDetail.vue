<template>
  <div class="qid-root">
    <!-- ── 顶部导航 ───────────────────────────────── -->
    <div class="qid-topbar">
      <el-button :icon="ArrowLeft" link @click="goBack">返回列表</el-button>
      <span class="qid-breadcrumb">质检详情</span>
      <div class="qid-topbar-right">
        <template v-if="detail">
          <el-button size="small" type="warning" plain @click="appealDialog = true">提交申诉</el-button>
          <el-button size="small" type="primary" plain @click="rectDialog = true">发起整改</el-button>
        </template>
        <el-button :icon="Refresh" circle size="small" @click="load" :loading="loading" title="刷新" />
      </div>
    </div>

    <!-- ── 加载中骨架 ─────────────────────────────── -->
    <el-skeleton v-if="loading" :rows="8" animated />

    <!-- ── 请求失败空态 ───────────────────────────── -->
    <el-empty
      v-else-if="error"
      :description="error"
      :image-size="100"
    >
      <el-button type="primary" @click="load">重试</el-button>
    </el-empty>

    <!-- ── 详情内容 ───────────────────────────────── -->
    <template v-else-if="detail">
      <!-- 基本信息 -->
      <el-card shadow="never" class="qid-card">
        <template #header>
          <div class="qid-card-header">
            <span>基本信息</span>
            <el-tag :type="statusTag(detail.status)" size="small">{{ statusText(detail.status) }}</el-tag>
          </div>
        </template>
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="通话 ID">{{ detail.call_id }}</el-descriptions-item>
          <el-descriptions-item label="坐席">{{ detail.agent }}</el-descriptions-item>
          <el-descriptions-item label="工号">{{ detail.work_no }}</el-descriptions-item>
          <el-descriptions-item label="通话时长">{{ fmtDuration(detail.duration) }}</el-descriptions-item>
          <el-descriptions-item label="会话引用">{{ detail.session_ref || '—' }}</el-descriptions-item>
          <el-descriptions-item label="检测策略">{{ detail.policy_name || detail.policy_id || '—' }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ fmtDate(detail.created_at) }}</el-descriptions-item>
          <el-descriptions-item label="风险等级">
            <el-tag :type="riskTag(detail.risk_level)" size="small">{{ riskText(detail.risk_level) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="命中项数">{{ detail.findings_count }}</el-descriptions-item>
        </el-descriptions>
      </el-card>

      <!-- 得分 & 维度 -->
      <el-card shadow="never" class="qid-card">
        <template #header>
          <div class="qid-card-header">
            <span>综合得分与维度</span>
            <div class="qid-score-badge" :class="scoreClass(detail.score)">{{ detail.score }} 分</div>
          </div>
        </template>

        <div v-if="detail.dimensions.length === 0" class="qid-empty-hint">暂无维度数据</div>
        <div v-else class="qid-dimensions">
          <div v-for="dim in detail.dimensions" :key="dim.name" class="qid-dim-item">
            <div class="qid-dim-header">
              <span class="qid-dim-name">{{ dim.name }}</span>
              <span class="qid-dim-score" :class="scoreClass(dim.score / dim.max_score * 100)">
                {{ dim.score }} / {{ dim.max_score }}
              </span>
            </div>
            <el-progress
              :percentage="Math.round(dim.score / dim.max_score * 100)"
              :color="progressColor(dim.score / dim.max_score * 100)"
              :stroke-width="8"
              style="margin-top: 4px"
            />
            <!-- 命中项 -->
            <div v-if="dim.findings.length > 0" class="qid-findings">
              <div
                v-for="f in dim.findings"
                :key="f.id"
                class="qid-finding-item"
              >
                <el-tag :type="riskTag(f.severity)" size="small" style="margin-right: 6px">{{ f.rule_name }}</el-tag>
                <span class="qid-finding-content">{{ f.hit_content }}</span>
                <span v-if="f.hit_time !== undefined" class="qid-finding-time">@{{ fmtDuration(f.hit_time) }}</span>
              </div>
            </div>
          </div>
        </div>
      </el-card>

      <!-- 双轨转写时间轴（占位） -->
      <el-card shadow="never" class="qid-card">
        <template #header>双轨转写时间轴</template>
        <div v-if="detail.transcript.length === 0" class="qid-empty-hint">
          <el-empty description="暂无转写数据" :image-size="60" />
        </div>
        <div v-else class="qid-transcript">
          <div
            v-for="(seg, idx) in detail.transcript"
            :key="idx"
            class="qid-seg"
            :class="seg.role === 'agent' ? 'qid-seg-agent' : 'qid-seg-customer'"
          >
            <div class="qid-seg-meta">
              <span class="qid-seg-role">{{ seg.role === 'agent' ? '坐席' : '客户' }}</span>
              <span class="qid-seg-time">{{ fmtDuration(seg.start_time) }} - {{ fmtDuration(seg.end_time) }}</span>
            </div>
            <div class="qid-seg-text">{{ seg.text }}</div>
          </div>
        </div>
      </el-card>

      <!-- 人工复核结果（如有） -->
      <el-card
        v-if="detail.reviewed_by"
        shadow="never"
        class="qid-card qid-review-card"
      >
        <template #header>人工复核结果</template>
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="复核员">{{ detail.reviewed_by }}</el-descriptions-item>
          <el-descriptions-item label="复核时间">{{ detail.reviewed_at ? fmtDate(detail.reviewed_at) : '—' }}</el-descriptions-item>
          <el-descriptions-item label="复核分数">{{ detail.review_score ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="复核评语" :span="2">{{ detail.review_comment || '—' }}</el-descriptions-item>
        </el-descriptions>
      </el-card>
    </template>

    <!-- ── 初始无数据（非 loading 非 error） ─────── -->
    <el-empty v-else description="未找到质检记录" :image-size="100">
      <el-button @click="goBack">返回列表</el-button>
    </el-empty>

    <!-- ── 申诉对话框 ─────────────────────────────── -->
    <el-dialog v-model="appealDialog" title="提交申诉" width="480px">
      <el-input
        v-model="appealReason"
        type="textarea"
        :rows="4"
        placeholder="请说明申诉理由（如误判场景、实际语境等）"
      />
      <template #footer>
        <el-button @click="appealDialog = false">取消</el-button>
        <el-button type="primary" :loading="acting" @click="onSubmitAppeal">提交</el-button>
      </template>
    </el-dialog>

    <!-- ── 整改对话框 ─────────────────────────────── -->
    <el-dialog v-model="rectDialog" title="发起整改" width="520px">
      <el-form label-width="90px" size="default">
        <el-form-item label="整改事项" required>
          <el-input v-model="rectForm.title" placeholder="如：服务用语规范培训" />
        </el-form-item>
        <el-form-item label="责任人">
          <el-input v-model="rectForm.assignee" placeholder="工号或姓名" />
        </el-form-item>
        <el-form-item label="截止时间">
          <el-date-picker
            v-model="rectForm.dueAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ssZ"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="整改说明">
          <el-input v-model="rectForm.description" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rectDialog = false">取消</el-button>
        <el-button type="primary" :loading="acting" @click="onCreateRect">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Refresh } from '@element-plus/icons-vue'
import {
  createQcRectification,
  fetchQcResultDetail,
  submitQcAppeal,
  type QcResultDetail,
  type AiqcStatus,
  type RiskLevel,
} from '@/api/inspection'

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const error = ref<string | null>(null)
const detail = ref<QcResultDetail | null>(null)

const id = route.params.id as string

// ── 申诉 / 整改 ──────────────────────────────────────────────────
const acting = ref(false)
const appealDialog = ref(false)
const appealReason = ref('')
const rectDialog = ref(false)
const rectForm = reactive({ title: '', assignee: '', dueAt: '', description: '' })

async function onSubmitAppeal() {
  if (!appealReason.value.trim()) {
    ElMessage.warning('请填写申诉理由')
    return
  }
  acting.value = true
  try {
    await submitQcAppeal(id, appealReason.value.trim())
    ElMessage.success('申诉已提交')
    appealDialog.value = false
    appealReason.value = ''
    load()
  } catch (err: unknown) {
    ElMessage.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || '申诉提交失败')
  } finally {
    acting.value = false
  }
}

async function onCreateRect() {
  if (!rectForm.title.trim()) {
    ElMessage.warning('请填写整改事项')
    return
  }
  acting.value = true
  try {
    await createQcRectification(id, {
      title: rectForm.title.trim(),
      assignee: rectForm.assignee.trim(),
      description: rectForm.description.trim(),
      due_at: rectForm.dueAt || undefined,
    })
    ElMessage.success('整改已创建')
    rectDialog.value = false
    rectForm.title = rectForm.assignee = rectForm.dueAt = rectForm.description = ''
  } catch (err: unknown) {
    ElMessage.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || '创建失败')
  } finally {
    acting.value = false
  }
}

async function load() {
  if (!id) {
    error.value = '无效的质检 ID'
    return
  }
  loading.value = true
  error.value = null
  try {
    detail.value = await fetchQcResultDetail(id)
  } catch (err: unknown) {
    const msg =
      (err as { response?: { data?: { message?: string }; status?: number } })?.response?.data?.message
      ?? (err instanceof Error ? err.message : '获取质检详情失败')
    error.value = msg
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}

function goBack() {
  void router.push({ name: 'inspection' })
}

// ── 格式化工具 ───────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function scoreClass(pct: number): string {
  if (pct >= 80) return 'score-good'
  if (pct >= 60) return 'score-warn'
  return 'score-bad'
}

function progressColor(pct: number): string {
  if (pct >= 80) return '#67c23a'
  if (pct >= 60) return '#e6a23c'
  return '#f56c6c'
}

function riskTag(level: RiskLevel): 'success' | 'warning' | 'danger' | 'info' {
  return { low: 'success', medium: 'warning', high: 'danger', critical: 'danger' }[level] as 'success' | 'warning' | 'danger' | 'info'
}

function riskText(level: RiskLevel): string {
  return { low: '低风险', medium: '中风险', high: '高风险', critical: '严重' }[level] ?? level
}

function statusTag(s: AiqcStatus): 'info' | 'primary' | 'success' | 'danger' | 'warning' {
  const map: Record<AiqcStatus, 'info' | 'primary' | 'success' | 'danger' | 'warning'> = {
    queued: 'info', running: 'primary', completed: 'success',
    failed: 'danger', reviewing: 'warning', appealed: 'danger', closed: 'info',
  }
  return map[s] ?? 'info'
}

function statusText(s: AiqcStatus): string {
  const map: Record<AiqcStatus, string> = {
    queued: '排队中', running: '检测中', completed: '已完成',
    failed: '失败', reviewing: '待复核', appealed: '申诉中', closed: '已关闭',
  }
  return map[s] ?? s
}

onMounted(load)
</script>

<style scoped>
.qid-root { padding: 16px; background: var(--oa-card, #fff); border-radius: 8px; min-height: 400px; }

.qid-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}
.qid-breadcrumb { font-size: 16px; font-weight: 600; color: #303133; }
.qid-topbar-right { margin-left: auto; }

.qid-card { margin-bottom: 14px; }
.qid-card-header { display: flex; align-items: center; justify-content: space-between; }

.qid-score-badge {
  font-size: 22px;
  font-weight: 700;
  padding: 2px 12px;
  border-radius: 6px;
}
.score-good { color: #67c23a; }
.score-warn { color: #e6a23c; }
.score-bad  { color: #f56c6c; }

.qid-empty-hint { color: #909399; font-size: 13px; text-align: center; padding: 20px 0; }

/* 维度 */
.qid-dimensions { display: flex; flex-direction: column; gap: 14px; }
.qid-dim-item { border: 1px solid #ebeef5; border-radius: 6px; padding: 10px 12px; }
.qid-dim-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.qid-dim-name { font-weight: 600; font-size: 14px; }
.qid-dim-score { font-size: 13px; }

/* 命中项 */
.qid-findings { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.qid-finding-item {
  background: #fef0f0;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.qid-finding-content { flex: 1; color: #606266; }
.qid-finding-time { color: #909399; white-space: nowrap; }

/* 转写时间轴 */
.qid-transcript { display: flex; flex-direction: column; gap: 8px; max-height: 400px; overflow-y: auto; padding-right: 4px; }
.qid-seg {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.qid-seg-agent { flex-direction: row; }
.qid-seg-customer { flex-direction: row-reverse; }

.qid-seg-meta {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 56px;
  gap: 2px;
}
.qid-seg-role {
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: #409eff;
  border-radius: 10px;
  padding: 1px 6px;
}
.qid-seg-customer .qid-seg-role { background: #909399; }
.qid-seg-time { font-size: 10px; color: #c0c4cc; }

.qid-seg-text {
  background: #f5f7fa;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
  max-width: 70%;
  line-height: 1.5;
}
.qid-seg-customer .qid-seg-text { background: #ecf5ff; }

/* 复核卡 */
.qid-review-card { border-color: #e6a23c; }
</style>
