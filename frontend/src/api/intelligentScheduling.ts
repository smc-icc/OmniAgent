import { api } from './client'
import type { AutoSchedulingState } from './autoSchedulingDefaults'
import type { PreScheduleState } from './prescheduleDefaults'
import type { SchedulingRulesState } from './schedulingRulesDefaults'
export type { AutoSchedulingState } from './autoSchedulingDefaults'
export type { PreScheduleState } from './prescheduleDefaults'
export type { SchedulingRulesState } from './schedulingRulesDefaults'
export { defaultAutoScheduling, mergeAutoScheduling } from './autoSchedulingDefaults'
export { defaultPreSchedule, mergePreSchedule } from './prescheduleDefaults'
export { defaultSchedulingRules, mergeSchedulingRules } from './schedulingRulesDefaults'

export type IntelligentSchedulingGroup = {
  group_key: string
  group_name: string
  items: {
    id: string
    name: string
    campus_name: string
    grades: string[]
    date_start: string
    date_end: string
    schedule_type_label: string
    status_code: string
    status_label: string
    last_applied_label: string
  }[]
}

export async function fetchIntelligentSchedulingMeta() {
  const { data } = await api.get<{
    campuses: { id: string; name: string }[]
    semesters: {
      id: string
      group_key: string
      group_name: string
      label_detail: string
      date_start: string
      date_end: string
      is_current: boolean
    }[]
    grade_options: { id: string; label: string }[]
  }>('/api/intelligent-scheduling/meta')
  return data
}

export async function fetchIntelligentSchedulingTasks(campusId: string) {
  const { data } = await api.get<{ groups: IntelligentSchedulingGroup[] }>(
    '/api/intelligent-scheduling/tasks',
    { params: { campus_id: campusId } },
  )
  return data
}

export async function fetchIntelligentSchedulingTaskDetail(taskId: string) {
  const { data } = await api.get<{
    id: string
    name: string
    campus_id: string
    semester_id: string
    semester_display: string
    date_start: string
    date_end: string
    schedule_type: 'admin' | 'rolling'
    task_source: 'new' | 'reuse'
    grades: string[]
  }>(`/api/intelligent-scheduling/tasks/${taskId}`)
  return data
}

export async function postIntelligentSchedulingTask(body: {
  campus_id: string
  semester_id: string
  name: string
  date_start: string
  date_end: string
  schedule_type: 'admin' | 'rolling'
  task_source: 'new' | 'reuse'
  grades: string[]
}) {
  const { data } = await api.post<{ ok: boolean; id: string }>('/api/intelligent-scheduling/tasks', body)
  return data
}

export async function putIntelligentSchedulingTask(
  taskId: string,
  body: {
    name?: string
    date_start?: string
    date_end?: string
    schedule_type?: 'admin' | 'rolling'
    grades?: string[]
  },
) {
  const { data } = await api.put<{ ok: boolean; message: string }>(
    `/api/intelligent-scheduling/tasks/${taskId}`,
    body,
  )
  return data
}

export async function deleteIntelligentSchedulingTasks(ids: string[]) {
  const { data } = await api.delete<{ ok: boolean; deleted: number }>('/api/intelligent-scheduling/tasks', {
    data: { ids },
  })
  return data
}

export async function postIntelligentSchedulingRun(taskId: string) {
  const { data } = await api.post<{ ok: boolean; message: string }>(
    `/api/intelligent-scheduling/tasks/${taskId}/run`,
    {},
  )
  return data
}

export type TeachingSlotRow =
  | { kind: 'lesson'; period_no: number; time_range: string }
  | { kind: 'break'; label: string; time_range: string }

export type TeachingHoursRow = {
  id: string
  class_name: string
  homeroom_teacher: string
  subjects: { key: string; title: string; teacher: string; hours: number }[]
  total_hours: number
}

const SC_TITLE = '物理综合实践科学探究'

function demoSubjects(
  ch: [string, number],
  ma: [string, number],
  en: [string, number],
  sc: [string, number],
): TeachingHoursRow['subjects'] {
  return [
    { key: 'ch', title: '语文/校本语文', teacher: ch[0], hours: ch[1] },
    { key: 'ma', title: '数学/校本数学', teacher: ma[0], hours: ma[1] },
    { key: 'en', title: '英语/校本英语', teacher: en[0], hours: en[1] },
    { key: 'sc', title: SC_TITLE, teacher: sc[0], hours: sc[1] },
  ]
}

/** 与后端 `_is_default_teaching_hours_rows` 一致；接口无行数据时前端兜底 */
export const TEACHING_HOURS_ROWS_DEMO: TeachingHoursRow[] = [
  {
    id: 'cls-g6-1',
    class_name: '六年级1班',
    homeroom_teacher: '严春梅',
    subjects: demoSubjects(['冯罗', 7], ['严春梅', 5], ['陈雯', 4], ['刘宇铭', 14]),
    total_hours: 30,
  },
  {
    id: 'cls-g6-2',
    class_name: '六年级2班',
    homeroom_teacher: '冯罗',
    subjects: demoSubjects(['冯罗', 7], ['严春梅', 5], ['李丽好', 4], ['刘宇铭', 14]),
    total_hours: 30,
  },
  {
    id: 'cls-g6-3',
    class_name: '六年级3班',
    homeroom_teacher: '谢金茵',
    subjects: demoSubjects(['谢金茵', 7], ['李晶晶', 5], ['陈雯', 4], ['刘宇铭', 14]),
    total_hours: 30,
  },
  {
    id: 'cls-g6-4',
    class_name: '六年级4班',
    homeroom_teacher: '唐晓文',
    subjects: demoSubjects(['唐晓文', 7], ['何钰莹', 5], ['李丽好', 4], ['刘宇铭', 14]),
    total_hours: 30,
  },
  {
    id: 'cls-g6-5',
    class_name: '六年级5班',
    homeroom_teacher: '李晶晶',
    subjects: demoSubjects(['谢金茵', 7], ['李晶晶', 5], ['钟柳华', 4], ['刘宇铭', 14]),
    total_hours: 30,
  },
  {
    id: 'cls-g7-1',
    class_name: '七年级1班',
    homeroom_teacher: '凌佳丽',
    subjects: demoSubjects(['张曦儿', 6], ['凌佳丽', 6], ['吴冰鑫', 6], ['刘宇铭', 19]),
    total_hours: 37,
  },
  {
    id: 'cls-g7-2',
    class_name: '七年级2班',
    homeroom_teacher: '张曦儿',
    subjects: demoSubjects(['张曦儿', 6], ['凌佳丽', 6], ['吴冰鑫', 6], ['刘宇铭', 19]),
    total_hours: 37,
  },
]

export async function fetchIntelligentSchedulingWizard(taskId: string) {
  const { data } = await api.get<{
    task_id: string
    task_name: string
    main_step: number
    step1_tab: 'teaching_time' | 'teaching_hours' | 'public_room' | 'odd_week'
    odd_subtab: 'single_double' | 'merge' | 'simultaneous'
    teaching_time: {
      weekday_indices: number[]
      early_self: number
      morning: number
      afternoon: number
      evening_self: number
    }
    day_column_labels: string[]
    slot_preview: TeachingSlotRow[]
    teaching_hours_view: 'class' | 'teacher'
    teaching_hours_rows: TeachingHoursRow[]
    class_tree_odd_week: { id: string; label: string; children?: { id: string; label: string }[] }[]
    merge_course_options: string[]
    scheduling_rules?: SchedulingRulesState
    pre_scheduling?: PreScheduleState
    auto_scheduling?: AutoSchedulingState
  }>(`/api/intelligent-scheduling/tasks/${taskId}/wizard`)
  return data
}

export async function putIntelligentSchedulingWizardTeachingTime(
  taskId: string,
  body: {
    weekday_indices: number[]
    early_self: number
    morning: number
    afternoon: number
    evening_self: number
  },
) {
  const { data } = await api.put<{
    ok: boolean
    slot_preview: TeachingSlotRow[]
    day_column_labels: string[]
  }>(`/api/intelligent-scheduling/tasks/${taskId}/wizard/teaching-time`, body)
  return data
}

export async function postIntelligentSchedulingWizardStep(taskId: string, main_step: number) {
  const { data } = await api.post<{ ok: boolean; main_step: number }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/step`,
    { main_step },
  )
  return data
}

export async function putIntelligentSchedulingWizardStep1Tab(
  taskId: string,
  tab: 'teaching_time' | 'teaching_hours' | 'public_room' | 'odd_week',
) {
  const { data } = await api.put<{ ok: boolean }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/step1-tab`,
    { tab },
  )
  return data
}

export async function putIntelligentSchedulingWizardHoursView(taskId: string, view: 'class' | 'teacher') {
  const { data } = await api.put<{ ok: boolean }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/teaching-hours-view`,
    { view },
  )
  return data
}

export async function putIntelligentSchedulingWizardTeachingHours(taskId: string, rows: TeachingHoursRow[]) {
  const { data } = await api.put<{ ok: boolean; message: string }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/teaching-hours`,
    { rows },
  )
  return data
}

export async function putIntelligentSchedulingWizardOddSubtab(
  taskId: string,
  subtab: 'single_double' | 'merge' | 'simultaneous',
) {
  const { data } = await api.put<{ ok: boolean }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/odd-subtab`,
    { subtab },
  )
  return data
}

export async function putIntelligentSchedulingWizardSchedulingRules(taskId: string, body: SchedulingRulesState) {
  const { data } = await api.put<{ ok: boolean; scheduling_rules: SchedulingRulesState }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/scheduling-rules`,
    body,
  )
  return data
}

export async function putIntelligentSchedulingWizardPreScheduling(taskId: string, body: PreScheduleState) {
  const { data } = await api.put<{ ok: boolean; pre_scheduling: PreScheduleState }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/pre-scheduling`,
    body,
  )
  return data
}

export async function putIntelligentSchedulingWizardAutoScheduling(taskId: string, body: AutoSchedulingState) {
  const { data } = await api.put<{ ok: boolean; auto_scheduling: AutoSchedulingState }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/auto-scheduling`,
    body,
  )
  return data
}

export async function postIntelligentSchedulingWizardAutoSchedulingRun(
  taskId: string,
  body?: { grade_ids?: string[]; runtime_minutes?: number },
) {
  const { data } = await api.post<{ ok: boolean; auto_scheduling: AutoSchedulingState }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/auto-scheduling/run`,
    body ?? {},
  )
  return data
}

/** 课表调整（第 5 步） */
export type AdjustmentCell = {
  line1: string
  line2: string
  lesson_id: string
  teacher_id: string
  class_id: string
}

export type AdjustmentHistoryItem = {
  id: string
  summary: string
  created_at: string
  undo: {
    lesson_id_a: string
    day_a: number
    period_a: number
    lesson_id_b: string
    day_b: number
    period_b: number
  } | null
}

export type AdjustmentSettings = {
  timetable_eval: boolean
  course_distribution: boolean
  multi_level: boolean
  simultaneous_classes: boolean
  main_locked: boolean
}

export async function fetchIntelligentSchedulingWizardAdjustment(taskId: string) {
  const { data } = await api.get<{
    ok: boolean
    day_column_labels: string[]
    view_tab: 'class' | 'teacher'
    settings: AdjustmentSettings
    class_tree: { id: string; label: string; children?: { id: string; label: string }[] }[]
    teacher_tree: {
      id: string
      label: string
      children?: { id: string; label: string; children?: { id: string; label: string; is_teacher?: boolean }[] }[]
    }[]
    history: AdjustmentHistoryItem[]
  }>(`/api/intelligent-scheduling/tasks/${taskId}/wizard/adjustment`)
  return data
}

export async function fetchIntelligentSchedulingWizardAdjustmentTimetable(
  taskId: string,
  kind: 'class' | 'teacher',
  id: string,
) {
  const { data } = await api.get<{
    ok: boolean
    kind: 'class' | 'teacher'
    target_id: string
    title: string
    cells: Record<string, AdjustmentCell>
  }>(`/api/intelligent-scheduling/tasks/${taskId}/wizard/adjustment/timetable`, {
    params: { kind, id },
  })
  return data
}

export async function putIntelligentSchedulingWizardAdjustmentSettings(
  taskId: string,
  body: Partial<AdjustmentSettings>,
) {
  const { data } = await api.put<{ ok: boolean; settings: AdjustmentSettings }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/adjustment/settings`,
    body,
  )
  return data
}

export async function putIntelligentSchedulingWizardAdjustmentViewTab(
  taskId: string,
  tab: 'class' | 'teacher',
) {
  const { data } = await api.put<{ ok: boolean; view_tab: 'class' | 'teacher' }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/adjustment/view-tab`,
    { tab },
  )
  return data
}

export async function postIntelligentSchedulingWizardAdjustmentSwap(
  taskId: string,
  lessonIdA: string,
  lessonIdB: string,
) {
  const { data } = await api.post<{ ok: boolean; history_id: string; summary: string }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/adjustment/swap`,
    { lesson_id_a: lessonIdA, lesson_id_b: lessonIdB },
  )
  return data
}

export async function postIntelligentSchedulingWizardAdjustmentUndo(taskId: string, historyId: string) {
  const { data } = await api.post<{ ok: boolean; message: string }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/adjustment/undo`,
    { history_id: historyId },
  )
  return data
}

/** 课表结果（第 6 步） */
export type ScheduleResultPeriodRow =
  | { kind: 'lesson'; period_no: number; time_range: string }
  | { kind: 'break'; label: string; time_range: string }

export type ScheduleResultCell = {
  lesson_id: string
  class_id: string
  class_name: string
  teacher_id: string
  teacher_name: string
  subject: string
  subject_short: string
  room_id: string
  room_label: string
  color_bg: string
  color_key: string
  cell_kind: string
}

export type ScheduleResultClassViewDisplay = {
  show_room: boolean
  show_teacher: boolean
  subject_short: boolean
  course_distinction: boolean
}

export type ScheduleResultTeacherViewDisplay = {
  show_room: boolean
  show_subject: boolean
  class_course_distinction: boolean
}

export type ScheduleResultGeneralViewDisplay = {
  show_room: boolean
  show_teacher: boolean
}

export async function fetchIntelligentSchedulingWizardScheduleResult(taskId: string) {
  const { data } = await api.get<{
    ok: boolean
    day_column_labels: string[]
    period_layout: ScheduleResultPeriodRow[]
    result_tab: 'class' | 'teacher' | 'room' | 'general'
    class_view: ScheduleResultClassViewDisplay
    teacher_view: ScheduleResultTeacherViewDisplay
    room_view: Record<string, unknown>
    general_view: ScheduleResultGeneralViewDisplay
    class_tree: { id: string; label: string; children?: { id: string; label: string }[] }[]
    teacher_list: { id: string; label: string }[]
    room_tree: { id: string; label: string; children?: { id: string; label: string; is_room?: boolean }[] }[]
  }>(`/api/intelligent-scheduling/tasks/${taskId}/wizard/schedule-result`)
  return data
}

export async function fetchIntelligentSchedulingWizardScheduleResultTimetable(
  taskId: string,
  kind: 'class' | 'teacher' | 'room',
  id: string,
) {
  const { data } = await api.get<{
    ok: boolean
    kind: string
    target_id: string
    title: string
    cells: Record<string, ScheduleResultCell | undefined>
  }>(`/api/intelligent-scheduling/tasks/${taskId}/wizard/schedule-result/timetable`, {
    params: { kind, id },
  })
  return data
}

export async function fetchIntelligentSchedulingWizardScheduleResultGeneral(taskId: string) {
  const { data } = await api.get<{
    ok: boolean
    day_labels: string[]
    periods: number[]
    classes: { id: string; name: string }[]
    cells: Record<string, ScheduleResultCell | null | undefined>
  }>(`/api/intelligent-scheduling/tasks/${taskId}/wizard/schedule-result/timetable-general`)
  return data
}

export async function putIntelligentSchedulingWizardScheduleResultTab(
  taskId: string,
  tab: 'class' | 'teacher' | 'room' | 'general',
) {
  const { data } = await api.put<{ ok: boolean; result_tab: string }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/schedule-result/tab`,
    { tab },
  )
  return data
}

export async function putIntelligentSchedulingWizardScheduleResultDisplay(
  taskId: string,
  body: {
    class_view?: Partial<ScheduleResultClassViewDisplay>
    teacher_view?: Partial<ScheduleResultTeacherViewDisplay>
    general_view?: Partial<ScheduleResultGeneralViewDisplay>
  },
) {
  const { data } = await api.put<{
    ok: boolean
    class_view: ScheduleResultClassViewDisplay
    teacher_view: ScheduleResultTeacherViewDisplay
    general_view: ScheduleResultGeneralViewDisplay
  }>(`/api/intelligent-scheduling/tasks/${taskId}/wizard/schedule-result/display`, body)
  return data
}

export async function postIntelligentSchedulingWizardScheduleResultExport(
  taskId: string,
  body?: Record<string, unknown>,
) {
  const { data } = await api.post<{ ok: boolean; message: string; filename: string }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/schedule-result/export`,
    body ?? {},
  )
  return data
}

/** 第 7 步 教室安排 */
export type ClassroomArrangementRoom = {
  id: string
  name: string
  room_type: string
  capacity: number
  used_slots_week: number
  capacity_slots_week: number
  overload: number
  status: string
}

export async function fetchIntelligentSchedulingWizardClassroomArrangement(taskId: string) {
  const { data } = await api.get<{
    ok: boolean
    rooms: ClassroomArrangementRoom[]
    summary: string
  }>(`/api/intelligent-scheduling/tasks/${taskId}/wizard/classroom-arrangement`)
  return data
}

export async function putIntelligentSchedulingWizardClassroomArrangement(
  taskId: string,
  body: { rooms?: ClassroomArrangementRoom[]; summary?: string },
) {
  const { data } = await api.put<{
    ok: boolean
    rooms: ClassroomArrangementRoom[]
    summary: string
  }>(`/api/intelligent-scheduling/tasks/${taskId}/wizard/classroom-arrangement`, body)
  return data
}

/** 第 8 步 课表应用 */
export type ApplyStudentMappingRow = {
  schedule_class_label: string
  basic_class_id: string
  options: { id: string; label: string }[]
}

export type ScheduleApplyState = {
  apply_sub_step: number
  student: {
    grade_ids: string[]
    grade_options: { id: string; label: string }[]
    validation: {
      passed: boolean
      schedule_admin_classes: number
      matched_same_name: number
      message: string
    }
    mappings_by_grade: Record<string, ApplyStudentMappingRow[]>
  }
  teacher: { match_passed: boolean; research_tag_sync: boolean }
  course_room: {
    course_match_passed: boolean
    course_total: number
    course_matched: number
    elective_label_to_timetable: boolean
    course_message: string
    room_match_passed: boolean
    room_total: number
    room_matched: number
    room_message: string
  }
  teaching_time: {
    match_passed: boolean
    date_start: string
    date_end: string
    notify_teachers: boolean
    period_rows: {
      section: string
      task_period: number
      enabled: boolean
      target_period_id: string
      target_period_label?: string
      time_junior: string
      time_primary: string
    }[]
    target_period_options: { id: string; label: string }[]
  }
}

export async function fetchIntelligentSchedulingWizardScheduleApply(taskId: string) {
  const { data } = await api.get<ScheduleApplyState & { ok: boolean }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/schedule-apply`,
  )
  return data
}

export async function putIntelligentSchedulingWizardScheduleApplySubStep(taskId: string, applySubStep: number) {
  const { data } = await api.put<{ ok: boolean; apply_sub_step: number }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/schedule-apply/sub-step`,
    { apply_sub_step: applySubStep },
  )
  return data
}

export async function putIntelligentSchedulingWizardScheduleApplyStudent(
  taskId: string,
  body: { grade_ids: string[]; mappings_by_grade: Record<string, ApplyStudentMappingRow[]> },
) {
  const { data } = await api.put<{ ok: boolean; student: ScheduleApplyState['student'] }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/schedule-apply/student`,
    body,
  )
  return data
}

export async function putIntelligentSchedulingWizardScheduleApplyTeacher(
  taskId: string,
  body: { research_tag_sync: boolean },
) {
  const { data } = await api.put<{ ok: boolean; teacher: ScheduleApplyState['teacher'] }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/schedule-apply/teacher`,
    body,
  )
  return data
}

export async function putIntelligentSchedulingWizardScheduleApplyCourseRoom(
  taskId: string,
  body: { elective_label_to_timetable: boolean },
) {
  const { data } = await api.put<{ ok: boolean; course_room: ScheduleApplyState['course_room'] }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/schedule-apply/course-room`,
    body,
  )
  return data
}

export async function putIntelligentSchedulingWizardScheduleApplyTeachingTime(
  taskId: string,
  body: Partial<ScheduleApplyState['teaching_time']>,
) {
  const { data } = await api.put<{ ok: boolean; teaching_time: ScheduleApplyState['teaching_time'] }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/schedule-apply/teaching-time`,
    body,
  )
  return data
}

export async function postIntelligentSchedulingWizardScheduleApplyConfirm(taskId: string) {
  const { data } = await api.post<{ ok: boolean; message: string }>(
    `/api/intelligent-scheduling/tasks/${taskId}/wizard/schedule-apply/confirm`,
    {},
  )
  return data
}
