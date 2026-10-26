/** 向导第 3 步「手工预排」，与 backend `_is_default_pre_scheduling` 对齐 */

export type MorningReadingRow = { id: string; label: string }
export type MorningReadingGrade = { id: string; label: string }

export type PrescheduleClassLine = {
  id: string
  label: string
  teacher: string
  placed: number
  total: number
}

export type PrescheduleSubjectGroup = {
  id: string
  course_name: string
  classes: PrescheduleClassLine[]
}

export type ClassPrescheduleCard = {
  id: string
  course_name: string
  teacher: string
  placed: number
  total: number
}

export type PreScheduleState = {
  subtab: 'morning_reading' | 'course' | 'class'
  morning_reading: {
    grade_checks: string[]
    grades: MorningReadingGrade[]
    rows: MorningReadingRow[]
    cols: string[]
    cells: Record<string, string>
  }
  course: {
    grade_id: string
    grade_options: { id: string; label: string }[]
    simultaneous_joint: boolean
    selected_class_ids: string[]
    subjects: PrescheduleSubjectGroup[]
    main_grid: Record<string, string>
    /** 格点对应的班级行 id，用于维护 placed 计数 */
    main_grid_meta: Record<string, string>
    ref_grids: [Record<string, string>, Record<string, string>]
  }
  class: {
    grade_id: string
    class_id: string
    grade_options: { id: string; label: string }[]
    class_options: { id: string; label: string }[]
    picked_card_id: string
    simultaneous_joint: boolean
    cards: ClassPrescheduleCard[]
    main_grid: Record<string, string>
    main_grid_meta: Record<string, string>
    ref_grids: [Record<string, string>, Record<string, string>]
  }
}

function g6Classes(): PrescheduleClassLine[] {
  const t = ['冯罗', '冯罗', '李晶晶', '何钰莹', '李晶晶', '李诗琪', '李诗琪']
  return t.map((teacher, i) => ({
    id: `c6-${i}`,
    label: `${i + 1}班`,
    teacher,
    placed: 0,
    total: 7,
  }))
}

export function defaultPreSchedule(): PreScheduleState {
  const grades: MorningReadingGrade[] = [
    { id: 'g6', label: '六年级' },
    { id: 'g7', label: '七年级' },
    { id: 'g8', label: '八年级' },
    { id: 'g9', label: '九年级' },
  ]
  const gradeOpts = grades.map((g) => ({ id: g.id, label: g.label }))
  const mrRows: MorningReadingRow[] = [
    { id: 'bzr', label: '班主任' },
    { id: 'yw', label: '语文/校本语文' },
    { id: 'sx', label: '数学/校本数学' },
    { id: 'yy', label: '英语/校本英语' },
    { id: 'wl', label: '物理综合实践科学探究' },
    { id: 'wl2', label: '物理/综合/探究' },
    { id: 'hx', label: '化学综合实践科学探究' },
    { id: 'hx2', label: '化学/综合/探究' },
  ]
  const subjects: PrescheduleSubjectGroup[] = [
    { id: 'sub-yw', course_name: '语文/校本语文', classes: g6Classes() },
    {
      id: 'sub-sx',
      course_name: '数学/校本数学',
      classes: g6Classes().map((c, i) => ({ ...c, id: `c6m-${i}`, total: 5, teacher: i % 2 === 0 ? '严春梅' : '李晶晶' })),
    },
    {
      id: 'sub-yy',
      course_name: '英语/校本英语',
      classes: g6Classes().map((c, i) => ({ ...c, id: `c6e-${i}`, total: 4, teacher: '陈雯' })),
    },
    {
      id: 'sub-sw',
      course_name: '生物/科学',
      classes: g6Classes().slice(0, 5).map((c, i) => ({ ...c, id: `c6b-${i}`, total: 3, teacher: '演示' })),
    },
    {
      id: 'sub-pe',
      course_name: '体育',
      classes: g6Classes().slice(0, 5).map((c, i) => ({ ...c, id: `c6p-${i}`, total: 3, teacher: '体育组' })),
    },
    {
      id: 'sub-it',
      course_name: '信息',
      classes: g6Classes().slice(0, 5).map((c, i) => ({ ...c, id: `c6i-${i}`, total: 2, teacher: '信息组' })),
    },
  ]
  const classCards: ClassPrescheduleCard[] = [
    { id: 'cc1', course_name: '语文/校本语文', teacher: '冯罗', placed: 0, total: 7 },
    { id: 'cc2', course_name: '数学/校本数学', teacher: '严春梅', placed: 0, total: 5 },
    { id: 'cc3', course_name: '英语/校本英语', teacher: '陈雯', placed: 0, total: 4 },
    { id: 'cc4', course_name: '物理综合实践科学探究', teacher: '刘宇铭', placed: 0, total: 14 },
  ]
  const classOptions = g6Classes().map((c) => ({ id: `cls-g6-${c.label}`, label: `${c.label}班` }))
  return {
    subtab: 'morning_reading',
    morning_reading: {
      grade_checks: ['g6', 'g7', 'g8', 'g9'],
      grades,
      rows: mrRows,
      cols: ['早读', '周一', '周二', '周三', '周四', '周五'],
      cells: {},
    },
    course: {
      grade_id: 'g6',
      grade_options: gradeOpts,
      simultaneous_joint: true,
      selected_class_ids: [],
      subjects,
      main_grid: {},
      main_grid_meta: {},
      ref_grids: [{}, {}],
    },
    class: {
      grade_id: 'g6',
      class_id: classOptions[0]?.id ?? 'cls-g6-1班',
      grade_options: gradeOpts,
      class_options: classOptions,
      picked_card_id: '',
      simultaneous_joint: true,
      cards: classCards,
      main_grid: {},
      main_grid_meta: {},
      ref_grids: [{}, {}],
    },
  }
}

function ensureArray<T>(v: unknown, fb: T[]): T[] {
  return Array.isArray(v) ? (v as T[]) : fb
}

export function mergePreSchedule(fromApi: unknown): PreScheduleState {
  const base = defaultPreSchedule()
  if (!fromApi || typeof fromApi !== 'object') return base
  const raw = fromApi as Record<string, unknown>
  const merged = { ...base, ...raw } as PreScheduleState
  merged.morning_reading = {
    ...base.morning_reading,
    ...(raw.morning_reading as object as PreScheduleState['morning_reading']),
  }
  merged.morning_reading.grade_checks = ensureArray(
    (raw.morning_reading as Record<string, unknown> | undefined)?.grade_checks,
    base.morning_reading.grade_checks,
  )
  merged.morning_reading.cells = {
    ...base.morning_reading.cells,
    ...((raw.morning_reading as Record<string, unknown> | undefined)?.cells as Record<string, string>),
  }
  merged.course = { ...base.course, ...(raw.course as object as PreScheduleState['course']) }
  merged.course.subjects = ensureArray(
    (raw.course as Record<string, unknown> | undefined)?.subjects,
    base.course.subjects,
  )
  merged.course.main_grid = {
    ...base.course.main_grid,
    ...((raw.course as Record<string, unknown> | undefined)?.main_grid as Record<string, string>),
  }
  merged.course.main_grid_meta = {
    ...base.course.main_grid_meta,
    ...((raw.course as Record<string, unknown> | undefined)?.main_grid_meta as Record<string, string>),
  }
  if (Array.isArray((raw.course as Record<string, unknown> | undefined)?.ref_grids)) {
    const rg = (raw.course as { ref_grids: [Record<string, string>, Record<string, string>] }).ref_grids
    merged.course.ref_grids = [rg[0] ?? {}, rg[1] ?? {}]
  }
  merged.class = { ...base.class, ...(raw.class as object as PreScheduleState['class']) }
  if (typeof merged.class.simultaneous_joint !== 'boolean') {
    merged.class.simultaneous_joint = base.class.simultaneous_joint
  }
  merged.class.cards = ensureArray(
    (raw.class as Record<string, unknown> | undefined)?.cards,
    base.class.cards,
  )
  merged.class.main_grid = {
    ...base.class.main_grid,
    ...((raw.class as Record<string, unknown> | undefined)?.main_grid as Record<string, string>),
  }
  merged.class.main_grid_meta = {
    ...base.class.main_grid_meta,
    ...((raw.class as Record<string, unknown> | undefined)?.main_grid_meta as Record<string, string>),
  }
  if (Array.isArray((raw.class as Record<string, unknown> | undefined)?.ref_grids)) {
    const rg = (raw.class as { ref_grids: [Record<string, string>, Record<string, string>] }).ref_grids
    merged.class.ref_grids = [rg[0] ?? {}, rg[1] ?? {}]
  }
  return merged
}
