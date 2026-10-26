import { api } from './client'

// ── AIQC 状态枚举 ───────────────────────────────────────────────
export type AiqcStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'reviewing'
  | 'appealed'
  | 'closed'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

// ── 质检结果条目 ─────────────────────────────────────────────────
export interface QcResult {
  id: string
  agent: string          // 坐席姓名
  work_no: string        // 工号
  call_id: string        // 通话 ID
  duration: number       // 通话时长（秒）
  score: number          // 综合得分 0-100
  findings_count: number // 命中项数量
  risk_level: RiskLevel
  status: AiqcStatus
  created_at: string     // ISO8601
  session_ref?: string   // 会话引用
  policy_id?: string     // 检测策略 ID
}

// ── 分页响应 ─────────────────────────────────────────────────────
export interface PaginatedQcResults {
  items: QcResult[]
  total: number
  page: number
  page_size: number
}

// ── 统计卡数据 ───────────────────────────────────────────────────
export interface QcStats {
  total_this_month: number
  avg_score: number
  passed_rate: number        // 0-100
  queued_count: number
  reviewing_count: number
  failed_count: number
  high_risk_count: number
}

// ── 质检结果详情（包含维度、转写、命中证据） ────────────────────
export interface QcDimension {
  name: string
  score: number
  max_score: number
  findings: QcFinding[]
}

export interface QcFinding {
  id: string
  rule_name: string
  description: string
  hit_content: string      // 命中文本
  hit_time?: number        // 命中时间点（秒）
  severity: RiskLevel
}

export interface TranscriptSegment {
  role: 'agent' | 'customer'
  text: string
  start_time: number       // 秒
  end_time: number
  channel: 'left' | 'right'
}

export interface QcResultDetail extends QcResult {
  policy_name?: string
  dimensions: QcDimension[]
  transcript: TranscriptSegment[]
  review_comment?: string
  review_score?: number
  reviewed_by?: string
  reviewed_at?: string
}

// ── 任务提交参数 ─────────────────────────────────────────────────
export interface SubmitTaskParams {
  session_ref: string
  recording_uri: string
  policy_id: string
  asr_engine?: 'funasr' | 'whisper'
}

// ── 人工复核参数 ─────────────────────────────────────────────────
export interface ReviewParams {
  score: number
  comment: string
}

// ── 查询参数 ─────────────────────────────────────────────────────
export interface QcListParams {
  status?: AiqcStatus | ''
  risk_level?: RiskLevel | ''
  agent?: string
  date_from?: string       // YYYY-MM-DD
  date_to?: string
  page?: number
  page_size?: number
}

// ══════════════════════════════════════════════════════════════════
// API 函数
// ══════════════════════════════════════════════════════════════════

/** 获取质检结果列表（分页） */
export async function fetchQcResults(params?: QcListParams): Promise<PaginatedQcResults> {
  const { data } = await api.get<PaginatedQcResults>('/api/v1/qc/results', { params })
  return data
}

/** 获取质检结果详情 */
export async function fetchQcResultDetail(id: string): Promise<QcResultDetail> {
  const { data } = await api.get<QcResultDetail>(`/api/v1/qc/results/${id}`)
  return data
}

/** 提交人工复核评分 */
export async function submitReview(id: string, params: ReviewParams): Promise<void> {
  await api.post(`/api/v1/qc/results/${id}/review`, params)
}

/** 提交新质检任务 */
export async function submitQcTask(params: SubmitTaskParams): Promise<{ task_id: string }> {
  const { data } = await api.post<{ task_id: string }>('/api/v1/qc/tasks', params)
  return data
}

/** 获取统计数据（如后端单独提供，否则从列表接口推算） */
export async function fetchQcStats(): Promise<QcStats> {
  const { data } = await api.get<QcStats>('/api/v1/qc/results/stats')
  return data
}

// ══════════════════════════════════════════════════════════════════
// 六类分析
// ══════════════════════════════════════════════════════════════════

export type AnalyticsType =
  | 'overview'
  | 'hot-topics'
  | 'hot-keywords'
  | 'repeat-calls'
  | 'business-focus'
  | 'results'

export async function fetchQcAnalytics(
  type: AnalyticsType,
  params?: Record<string, unknown>,
): Promise<unknown> {
  const { data } = await api.get(`/api/v1/qc/analytics/${type}`, { params })
  return data
}

// ══════════════════════════════════════════════════════════════════
// 实时告警
// ══════════════════════════════════════════════════════════════════

export interface QcAlert {
  id: number
  sessionRef: string
  ruleId: string
  severity: RiskLevel
  message: string
  startMs: number
  state: 'open' | 'acked'
  createdAt: string
  ackedBy: string
}

export async function fetchQcAlerts(params?: {
  state?: string
  session_ref?: string
  limit?: number
  offset?: number
}): Promise<{ items: QcAlert[] }> {
  const { data } = await api.get('/api/v1/qc/alerts', { params })
  return data
}

export async function ackQcAlert(id: number): Promise<void> {
  await api.post(`/api/v1/qc/alerts/${id}/ack`)
}

// ══════════════════════════════════════════════════════════════════
// 规则包 / 版本
// ══════════════════════════════════════════════════════════════════

export interface QcRuleVersion {
  id: number
  version: string
  status: 'draft' | 'published' | 'archived'
  publishedAt: string
  publishedBy: string
}

export interface QcRulePackage {
  id: number
  code: string
  name: string
  description: string
  source: string
  standardRef: string
  versions: QcRuleVersion[]
}

export async function fetchRulePackages(): Promise<{ items: QcRulePackage[] }> {
  const { data } = await api.get('/api/v1/qc/rules/packages')
  return data
}

export async function createRulePackage(body: {
  code: string
  name: string
  description?: string
  source?: string
  standardRef?: string
}): Promise<{ id: number; code: string }> {
  const { data } = await api.post('/api/v1/qc/rules/packages', body)
  return data
}

export async function createRuleVersion(body: {
  packageCode: string
  version: string
  rulesJson: string | Record<string, unknown>
}): Promise<{ id: number; version: string }> {
  const { data } = await api.post('/api/v1/qc/rules/versions', body)
  return data
}

export async function publishRuleVersion(versionId: number): Promise<void> {
  await api.post(`/api/v1/qc/rules/versions/${versionId}/publish`)
}

export async function fetchPublishedRules(packageCode?: string): Promise<unknown> {
  const { data } = await api.get('/api/v1/qc/rules/published', {
    params: packageCode ? { package_code: packageCode } : {},
  })
  return data
}

// ══════════════════════════════════════════════════════════════════
// 申诉
// ══════════════════════════════════════════════════════════════════

export interface QcAppeal {
  id: number
  taskId: string
  appellantId: string
  reason: string
  state: 'pending' | 'adjudicated' | 'rejected'
  resolution: string
  createdAt: string
}

export async function fetchQcAppeals(params?: {
  state?: string
  limit?: number
  offset?: number
}): Promise<{ items: QcAppeal[] }> {
  const { data } = await api.get('/api/v1/qc/appeals', { params })
  return data
}

export async function submitQcAppeal(taskId: string, reason: string): Promise<{ appealId: number }> {
  const { data } = await api.post(`/api/v1/qc/results/${taskId}/appeal`, { reason })
  return data
}

export async function resolveQcAppeal(
  id: number,
  state: 'adjudicated' | 'rejected',
  resolution: string,
): Promise<void> {
  await api.post(`/api/v1/qc/appeals/${id}/resolve`, { state, resolution })
}

// ══════════════════════════════════════════════════════════════════
// 整改
// ══════════════════════════════════════════════════════════════════

export interface QcRectification {
  id: number
  taskId: string
  title: string
  assignee: string
  description: string
  state: 'open' | 'in_progress' | 'closed'
  dueAt: string
  createdAt: string
  overdue: boolean
}

export async function fetchQcRectifications(params?: {
  state?: string
  assignee?: string
  limit?: number
  offset?: number
}): Promise<{ items: QcRectification[] }> {
  const { data } = await api.get('/api/v1/qc/rectifications', { params })
  return data
}

export async function createQcRectification(
  taskId: string,
  body: { title: string; assignee?: string; description?: string; due_at?: string },
): Promise<{ rectificationId: number }> {
  const { data } = await api.post(`/api/v1/qc/results/${taskId}/rectification`, body)
  return data
}

export async function updateQcRectification(
  id: number,
  state: 'open' | 'in_progress' | 'closed',
): Promise<void> {
  await api.post(`/api/v1/qc/rectifications/${id}/state`, { state })
}

// ══════════════════════════════════════════════════════════════════
// 审计日志
// ══════════════════════════════════════════════════════════════════

export interface QcAuditLog {
  id: number
  actor: string
  action: string
  targetType: string
  targetId: string
  detail: Record<string, unknown>
  createdAt: string
}

export async function fetchQcAuditLogs(params?: {
  target_type?: string
  target_id?: string
  limit?: number
  offset?: number
}): Promise<{ items: QcAuditLog[] }> {
  const { data } = await api.get('/api/v1/qc/audit-logs', { params })
  return data
}
