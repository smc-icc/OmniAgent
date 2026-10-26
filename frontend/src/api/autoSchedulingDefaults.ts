/** 向导第 4 步「自动排课」，与 backend `_is_default_auto_scheduling` 对齐 */

export type AutoSchedulingStatus = 'idle' | 'running' | 'success' | 'failed'

export type AutoSchedulingState = {
  status: AutoSchedulingStatus
  /** 可选年级 */
  grade_options: { id: string; label: string }[]
  /** 参与自动排课的年级 id */
  grade_ids: string[]
  /** 期望算法运行时间（分钟） */
  runtime_minutes: number
  /** 下拉可选分钟 */
  runtime_options: number[]
  last_message: string
  last_finished_at: string | null
}

export function defaultAutoScheduling(): AutoSchedulingState {
  const grade_options = [
    { id: 'g6', label: '六年级' },
    { id: 'g7', label: '七年级' },
    { id: 'g8', label: '八年级' },
    { id: 'g9', label: '九年级' },
  ]
  return {
    status: 'success',
    grade_options,
    grade_ids: grade_options.map((g) => g.id),
    runtime_minutes: 8,
    runtime_options: [3, 5, 8, 10, 15, 20, 30, 45, 60],
    last_message: '演示：排课已完成',
    last_finished_at: new Date().toISOString(),
  }
}

export function mergeAutoScheduling(fromApi: unknown): AutoSchedulingState {
  const base = defaultAutoScheduling()
  if (!fromApi || typeof fromApi !== 'object') return base
  const raw = fromApi as Record<string, unknown>
  const merged = { ...base, ...raw } as AutoSchedulingState
  merged.grade_options = Array.isArray(raw.grade_options)
    ? (raw.grade_options as AutoSchedulingState['grade_options'])
    : base.grade_options
  merged.grade_ids = Array.isArray(raw.grade_ids) ? (raw.grade_ids as string[]) : base.grade_ids
  merged.runtime_options = Array.isArray(raw.runtime_options)
    ? (raw.runtime_options as number[])
    : base.runtime_options
  if (typeof merged.runtime_minutes !== 'number' || Number.isNaN(merged.runtime_minutes)) {
    merged.runtime_minutes = base.runtime_minutes
  }
  const st = raw.status
  if (st === 'idle' || st === 'running' || st === 'success' || st === 'failed') {
    merged.status = st
  } else {
    merged.status = base.status
  }
  if (typeof merged.last_message !== 'string') merged.last_message = base.last_message
  merged.last_finished_at =
    typeof raw.last_finished_at === 'string' || raw.last_finished_at === null
      ? (raw.last_finished_at as string | null)
      : base.last_finished_at
  return merged
}
