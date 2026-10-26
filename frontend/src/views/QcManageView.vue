<template>
  <div class="qm-root">
    <div class="qm-header">
      <h3 class="qm-title">🛠️ 质检管理中心</h3>
      <el-button :icon="Refresh" circle @click="loadCurrent" :loading="loading" title="刷新" />
    </div>

    <el-tabs v-model="tab" class="qm-tabs" @tab-change="loadCurrent">
      <!-- ── 实时告警 ─────────────────────────────── -->
      <el-tab-pane label="实时告警" name="alerts">
        <div class="qm-bar">
          <el-radio-group v-model="alertState" size="small" @change="loadAlerts">
            <el-radio-button value="">全部</el-radio-button>
            <el-radio-button value="open">未确认</el-radio-button>
            <el-radio-button value="acked">已确认</el-radio-button>
          </el-radio-group>
        </div>
        <el-table :data="alerts" stripe border size="small" v-loading="loading">
          <el-table-column prop="id" label="ID" width="70" />
          <el-table-column prop="sessionRef" label="会话" width="160" show-overflow-tooltip />
          <el-table-column prop="ruleId" label="规则" width="150" show-overflow-tooltip />
          <el-table-column label="级别" width="90">
            <template #default="{ row }">
              <el-tag :type="severityTag(row.severity)" size="small">{{ severityLabel(row.severity) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="message" label="告警内容" min-width="200" show-overflow-tooltip />
          <el-table-column label="时间点" width="100">
            <template #default="{ row }">{{ formatMs(row.startMs) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="row.state === 'open' ? 'danger' : 'info'" size="small">
                {{ row.state === 'open' ? '未确认' : '已确认' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="createdAt" label="时间" width="160">
            <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="90" fixed="right">
            <template #default="{ row }">
              <el-button v-if="row.state === 'open'" size="small" type="primary" link @click="onAck(row)">
                确认
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- ── 规则包 ──────────────────────────────── -->
      <el-tab-pane label="规则包" name="rules">
        <div class="qm-bar">
          <el-button type="primary" size="small" :icon="Plus" @click="pkgDialog = true">新建规则包</el-button>
        </div>
        <el-table :data="packages" stripe border size="small" v-loading="loading" row-key="id">
          <el-table-column type="expand">
            <template #default="{ row }">
              <el-table :data="row.versions" size="small" border class="qm-sub-table">
                <el-table-column prop="version" label="版本" width="100" />
                <el-table-column label="状态" width="100">
                  <template #default="{ row: v }">
                    <el-tag :type="v.status === 'published' ? 'success' : v.status === 'draft' ? 'warning' : 'info'" size="small">
                      {{ ({ published: '已发布', draft: '草稿', archived: '已归档' } as Record<string, string>)[v.status] || v.status }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="publishedBy" label="发布人" width="110" />
                <el-table-column prop="publishedAt" label="发布时间" width="170">
                  <template #default="{ row: v }">{{ formatTime(v.publishedAt) }}</template>
                </el-table-column>
                <el-table-column label="操作" min-width="160">
                  <template #default="{ row: v }">
                    <el-button v-if="v.status !== 'published'" size="small" type="success" link @click="onPublish(v)">
                      发布
                    </el-button>
                    <el-button size="small" link @click="onViewRules(row, v)">查看规则</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </template>
          </el-table-column>
          <el-table-column prop="code" label="编码" width="140" />
          <el-table-column prop="name" label="名称" min-width="160" show-overflow-tooltip />
          <el-table-column prop="source" label="来源" width="100" />
          <el-table-column prop="standardRef" label="标准引用" width="140" show-overflow-tooltip />
          <el-table-column prop="description" label="描述" min-width="180" show-overflow-tooltip />
          <el-table-column label="操作" width="130" fixed="right">
            <template #default="{ row }">
              <el-button size="small" type="primary" link @click="openVersionDialog(row)">新建版本</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- ── 申诉 ────────────────────────────────── -->
      <el-tab-pane label="申诉处理" name="appeals">
        <div class="qm-bar">
          <el-radio-group v-model="appealState" size="small" @change="loadAppeals">
            <el-radio-button value="">全部</el-radio-button>
            <el-radio-button value="pending">待处理</el-radio-button>
            <el-radio-button value="adjudicated">已裁定</el-radio-button>
            <el-radio-button value="rejected">已驳回</el-radio-button>
          </el-radio-group>
        </div>
        <el-table :data="appeals" stripe border size="small" v-loading="loading">
          <el-table-column prop="id" label="ID" width="70" />
          <el-table-column prop="taskId" label="任务" width="180" show-overflow-tooltip />
          <el-table-column prop="appellantId" label="申诉人" width="110" />
          <el-table-column prop="reason" label="申诉理由" min-width="200" show-overflow-tooltip />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="appealTag(row.state)" size="small">{{ appealLabel(row.state) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="resolution" label="处理结论" min-width="160" show-overflow-tooltip />
          <el-table-column prop="createdAt" label="时间" width="160">
            <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <template v-if="row.state === 'pending'">
                <el-button size="small" type="success" link @click="onResolve(row, 'adjudicated')">裁定</el-button>
                <el-button size="small" type="danger" link @click="onResolve(row, 'rejected')">驳回</el-button>
              </template>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- ── 整改 ────────────────────────────────── -->
      <el-tab-pane label="整改跟踪" name="rectifications">
        <div class="qm-bar">
          <el-radio-group v-model="rectState" size="small" @change="loadRectifications">
            <el-radio-button value="">全部</el-radio-button>
            <el-radio-button value="open">待整改</el-radio-button>
            <el-radio-button value="in_progress">整改中</el-radio-button>
            <el-radio-button value="closed">已关闭</el-radio-button>
          </el-radio-group>
        </div>
        <el-table :data="rectifications" stripe border size="small" v-loading="loading">
          <el-table-column prop="id" label="ID" width="70" />
          <el-table-column prop="title" label="整改事项" min-width="180" show-overflow-tooltip />
          <el-table-column prop="taskId" label="关联任务" width="170" show-overflow-tooltip />
          <el-table-column prop="assignee" label="责任人" width="110" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="rectTag(row)" size="small">{{ rectLabel(row.state) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="截止时间" width="160">
            <template #default="{ row }">
              <span :class="{ 'qm-overdue': row.overdue }">{{ formatTime(row.dueAt) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="description" label="说明" min-width="160" show-overflow-tooltip />
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button v-if="row.state === 'open'" size="small" type="primary" link @click="onRectState(row, 'in_progress')">
                开始整改
              </el-button>
              <el-button v-if="row.state === 'in_progress'" size="small" type="success" link @click="onRectState(row, 'closed')">
                完成
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- ── 分析 ────────────────────────────────── -->
      <el-tab-pane label="质检分析" name="analytics">
        <div class="qm-bar">
          <el-radio-group v-model="analyticsType" size="small" @change="loadAnalytics">
            <el-radio-button value="hot-topics">热点话题</el-radio-button>
            <el-radio-button value="hot-keywords">热点关键词</el-radio-button>
            <el-radio-button value="repeat-calls">重复来电</el-radio-button>
            <el-radio-button value="business-focus">业务关注</el-radio-button>
          </el-radio-group>
        </div>
        <el-table :data="analyticsItems" stripe border size="small" v-loading="loading">
          <el-table-column v-for="col in analyticsColumns" :key="col" :prop="col" :label="col" min-width="140" show-overflow-tooltip />
        </el-table>
        <el-empty v-if="!loading && !analyticsItems.length" description="暂无分析数据" />
      </el-tab-pane>

      <!-- ── 审计日志 ─────────────────────────────── -->
      <el-tab-pane label="审计日志" name="audit">
        <el-table :data="auditLogs" stripe border size="small" v-loading="loading">
          <el-table-column prop="id" label="ID" width="70" />
          <el-table-column prop="actor" label="操作人" width="120" />
          <el-table-column prop="action" label="动作" width="180" show-overflow-tooltip />
          <el-table-column prop="targetType" label="对象类型" width="110" />
          <el-table-column prop="targetId" label="对象" width="160" show-overflow-tooltip />
          <el-table-column label="详情" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">{{ JSON.stringify(row.detail) }}</template>
          </el-table-column>
          <el-table-column prop="createdAt" label="时间" width="170">
            <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- ── 新建规则包对话框 ────────────────────────── -->
    <el-dialog v-model="pkgDialog" title="新建规则包" width="480px">
      <el-form label-width="90px" size="default">
        <el-form-item label="编码" required>
          <el-input v-model="pkgForm.code" placeholder="如 state-grid-95598" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="pkgForm.name" placeholder="规则包名称" />
        </el-form-item>
        <el-form-item label="来源">
          <el-input v-model="pkgForm.source" placeholder="custom / standard" />
        </el-form-item>
        <el-form-item label="标准引用">
          <el-input v-model="pkgForm.standardRef" placeholder="如 GB/T XXXXX" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="pkgForm.description" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pkgDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onCreatePackage">创建</el-button>
      </template>
    </el-dialog>

    <!-- ── 新建规则版本对话框 ──────────────────────── -->
    <el-dialog v-model="versionDialog" title="新建规则版本" width="640px">
      <el-form label-width="90px" size="default">
        <el-form-item label="规则包">
          <el-input :model-value="versionPkg?.code" disabled />
        </el-form-item>
        <el-form-item label="版本号" required>
          <el-input v-model="versionForm.version" placeholder="如 1.1.0" />
        </el-form-item>
        <el-form-item label="规则 JSON" required>
          <el-input
            v-model="versionForm.rulesJson"
            type="textarea"
            :rows="12"
            placeholder='{"dimensions":[...],"rules":[...]}'
            spellcheck="false"
            class="qm-json-input"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="versionDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onCreateVersion">创建</el-button>
      </template>
    </el-dialog>

    <!-- ── 规则查看对话框 ──────────────────────────── -->
    <el-dialog v-model="rulesViewDialog" :title="`规则内容 · ${rulesViewTitle}`" width="720px">
      <pre class="qm-rules-view">{{ rulesViewContent }}</pre>
    </el-dialog>

    <!-- ── 申诉处理对话框 ──────────────────────────── -->
    <el-dialog v-model="resolveDialog" :title="resolveState === 'adjudicated' ? '裁定申诉' : '驳回申诉'" width="480px">
      <el-input v-model="resolveText" type="textarea" :rows="4" placeholder="处理结论" />
      <template #footer>
        <el-button @click="resolveDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onConfirmResolve">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Refresh } from '@element-plus/icons-vue'
import {
  ackQcAlert,
  createRulePackage,
  createRuleVersion,
  fetchPublishedRules,
  fetchQcAlerts,
  fetchQcAnalytics,
  fetchQcAppeals,
  fetchQcAuditLogs,
  fetchQcRectifications,
  fetchRulePackages,
  publishRuleVersion,
  resolveQcAppeal,
  updateQcRectification,
  type QcAlert,
  type QcAppeal,
  type QcAuditLog,
  type QcRectification,
  type QcRulePackage,
  type QcRuleVersion,
  type RiskLevel,
} from '@/api/inspection'

const tab = ref('alerts')
const loading = ref(false)
const saving = ref(false)

// alerts
const alerts = ref<QcAlert[]>([])
const alertState = ref('')

// rules
const packages = ref<QcRulePackage[]>([])
const pkgDialog = ref(false)
const pkgForm = reactive({ code: '', name: '', source: 'custom', standardRef: '', description: '' })
const versionDialog = ref(false)
const versionPkg = ref<QcRulePackage | null>(null)
const versionForm = reactive({ version: '', rulesJson: '' })
const rulesViewDialog = ref(false)
const rulesViewTitle = ref('')
const rulesViewContent = ref('')

// appeals
const appeals = ref<QcAppeal[]>([])
const appealState = ref('')
const resolveDialog = ref(false)
const resolveState = ref<'adjudicated' | 'rejected'>('adjudicated')
const resolveText = ref('')
const resolveTarget = ref<QcAppeal | null>(null)

// rectifications
const rectifications = ref<QcRectification[]>([])
const rectState = ref('')

// analytics
const analyticsType = ref('hot-topics')
const analyticsItems = ref<Record<string, unknown>[]>([])
const analyticsColumns = ref<string[]>([])

// audit
const auditLogs = ref<QcAuditLog[]>([])

function formatTime(v: string): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('zh-CN', { hour12: false })
}

function formatMs(ms: number): string {
  const s = Math.floor((ms || 0) / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function severityTag(s: RiskLevel) {
  return ({ low: 'info', medium: 'warning', high: 'danger', critical: 'danger' } as Record<string, string>)[s] || 'info'
}
function severityLabel(s: RiskLevel) {
  return ({ low: '低', medium: '中', high: '高', critical: '严重' } as Record<string, string>)[s] || s
}
function appealTag(s: string) {
  return ({ pending: 'warning', adjudicated: 'success', rejected: 'danger' } as Record<string, string>)[s] || 'info'
}
function appealLabel(s: string) {
  return ({ pending: '待处理', adjudicated: '已裁定', rejected: '已驳回' } as Record<string, string>)[s] || s
}
function rectTag(r: QcRectification) {
  if (r.overdue) return 'danger'
  return ({ open: 'warning', in_progress: 'primary', closed: 'success' } as Record<string, string>)[r.state] || 'info'
}
function rectLabel(s: string) {
  return ({ open: '待整改', in_progress: '整改中', closed: '已关闭' } as Record<string, string>)[s] || s
}

async function loadAlerts() {
  loading.value = true
  try {
    const r = await fetchQcAlerts({ state: alertState.value || undefined, limit: 200 })
    alerts.value = r.items
  } catch (e) {
    ElMessage.error('加载告警失败')
  } finally {
    loading.value = false
  }
}

async function loadRules() {
  loading.value = true
  try {
    const r = await fetchRulePackages()
    packages.value = r.items
  } catch {
    ElMessage.error('加载规则包失败')
  } finally {
    loading.value = false
  }
}

async function loadAppeals() {
  loading.value = true
  try {
    const r = await fetchQcAppeals({ state: appealState.value || undefined, limit: 200 })
    appeals.value = r.items
  } catch {
    ElMessage.error('加载申诉失败')
  } finally {
    loading.value = false
  }
}

async function loadRectifications() {
  loading.value = true
  try {
    const r = await fetchQcRectifications({ state: rectState.value || undefined, limit: 200 })
    rectifications.value = r.items
  } catch {
    ElMessage.error('加载整改失败')
  } finally {
    loading.value = false
  }
}

async function loadAnalytics() {
  loading.value = true
  try {
    const r = (await fetchQcAnalytics(analyticsType.value as never)) as { items?: Record<string, unknown>[] }
    analyticsItems.value = r.items ?? []
    analyticsColumns.value = analyticsItems.value.length ? Object.keys(analyticsItems.value[0]) : []
  } catch {
    ElMessage.error('加载分析失败')
    analyticsItems.value = []
  } finally {
    loading.value = false
  }
}

async function loadAudit() {
  loading.value = true
  try {
    const r = await fetchQcAuditLogs({ limit: 200 })
    auditLogs.value = r.items
  } catch {
    ElMessage.error('加载审计日志失败')
  } finally {
    loading.value = false
  }
}

function loadCurrent() {
  if (tab.value === 'alerts') return loadAlerts()
  if (tab.value === 'rules') return loadRules()
  if (tab.value === 'appeals') return loadAppeals()
  if (tab.value === 'rectifications') return loadRectifications()
  if (tab.value === 'analytics') return loadAnalytics()
  if (tab.value === 'audit') return loadAudit()
}

async function onAck(row: QcAlert) {
  try {
    await ackQcAlert(row.id)
    ElMessage.success('已确认')
    loadAlerts()
  } catch {
    ElMessage.error('确认失败')
  }
}

async function onCreatePackage() {
  if (!pkgForm.code.trim() || !pkgForm.name.trim()) {
    ElMessage.warning('编码和名称必填')
    return
  }
  saving.value = true
  try {
    await createRulePackage({ ...pkgForm })
    ElMessage.success('创建成功')
    pkgDialog.value = false
    pkgForm.code = pkgForm.name = pkgForm.standardRef = pkgForm.description = ''
    loadRules()
  } catch (e: unknown) {
    ElMessage.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '创建失败')
  } finally {
    saving.value = false
  }
}

function openVersionDialog(pkg: QcRulePackage) {
  versionPkg.value = pkg
  versionForm.version = ''
  versionForm.rulesJson = ''
  versionDialog.value = true
}

async function onCreateVersion() {
  if (!versionPkg.value || !versionForm.version.trim() || !versionForm.rulesJson.trim()) {
    ElMessage.warning('版本号和规则 JSON 必填')
    return
  }
  saving.value = true
  try {
    await createRuleVersion({
      packageCode: versionPkg.value.code,
      version: versionForm.version.trim(),
      rulesJson: versionForm.rulesJson,
    })
    ElMessage.success('版本已创建（草稿）')
    versionDialog.value = false
    loadRules()
  } catch (e: unknown) {
    ElMessage.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '创建失败')
  } finally {
    saving.value = false
  }
}

async function onPublish(v: QcRuleVersion) {
  try {
    await publishRuleVersion(v.id)
    ElMessage.success(`版本 ${v.version} 已发布`)
    loadRules()
  } catch {
    ElMessage.error('发布失败')
  }
}

async function onViewRules(pkg: QcRulePackage, _v: QcRuleVersion) {
  try {
    const r = (await fetchPublishedRules(pkg.code)) as { version?: string; rules?: unknown }
    rulesViewTitle.value = `${pkg.code}@${r.version ?? _v.version}`
    rulesViewContent.value = JSON.stringify(r.rules ?? r, null, 2)
    rulesViewDialog.value = true
  } catch {
    ElMessage.error('获取规则内容失败')
  }
}

function onResolve(row: QcAppeal, state: 'adjudicated' | 'rejected') {
  resolveTarget.value = row
  resolveState.value = state
  resolveText.value = ''
  resolveDialog.value = true
}

async function onConfirmResolve() {
  if (!resolveTarget.value) return
  saving.value = true
  try {
    await resolveQcAppeal(resolveTarget.value.id, resolveState.value, resolveText.value)
    ElMessage.success('已处理')
    resolveDialog.value = false
    loadAppeals()
  } catch {
    ElMessage.error('处理失败')
  } finally {
    saving.value = false
  }
}

async function onRectState(row: QcRectification, state: 'open' | 'in_progress' | 'closed') {
  try {
    await updateQcRectification(row.id, state)
    ElMessage.success('已更新')
    loadRectifications()
  } catch {
    ElMessage.error('更新失败')
  }
}

onMounted(loadCurrent)
</script>

<style scoped>
.qm-root {
  padding: 16px;
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
}
.qm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.qm-title {
  margin: 0;
  font-size: 18px;
}
.qm-tabs {
  margin-top: 4px;
}
.qm-bar {
  margin-bottom: 12px;
  display: flex;
  gap: 8px;
  align-items: center;
}
.qm-sub-table {
  margin: 8px 16px;
}
.qm-overdue {
  color: var(--el-color-danger);
  font-weight: 600;
}
.qm-json-input :deep(textarea) {
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 12px;
}
.qm-rules-view {
  background: var(--el-fill-color-light);
  padding: 12px;
  border-radius: 6px;
  max-height: 480px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
