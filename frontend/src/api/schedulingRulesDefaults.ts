/** 排课规则（向导第 2 步）状态类型与默认数据，与 backend `_is_default_scheduling_rules` 对齐 */

export type SchedulingTreeNode = { id: string; label: string; children?: SchedulingTreeNode[] }

export type CourseAssocRuleItem = {
  id: string
  assoc_type: string
  courses: string[]
}

export type MergeOrSimRuleItem = {
  id: string
  course: string
  class_ids: string[]
  class_labels: string[]
}

export type TeacherAssocRuleItem = {
  id: string
  mode: string
  teacher_ids: string[]
  teacher_names: string[]
}

export type TimeSlotRuleItem = {
  id: string
  slot_kind: 'session' | 'period'
  teacher_ids: string[]
  teacher_labels: string[]
  day_part: string
  limit_kind: string
  limit_value: number
}

/** 班级/老师/课程限制：按选中实体存储周节次勾选 */
export type RestrictionEntityGrid = {
  mode: 'no_schedule' | 'priority'
  cells: Record<string, boolean>
}

export type RestrictionGridsBundle = {
  class_limit: Record<string, RestrictionEntityGrid>
  teacher_limit: Record<string, RestrictionEntityGrid>
  course_limit: Record<string, RestrictionEntityGrid>
}

export type ConsecutiveRuleRow = {
  id: string
  course_name: string
  scope: string
  pattern: string
  remark: string
}

export type SchedulingRulesState = {
  main_tab: string
  more_rules_subtab: 'time_slot' | 'daily' | 'weekly'
  course_catalog: string[]
  course_assoc_type: string
  /** 已保存的课程关联规则（主界面与规则列表共用） */
  course_assoc_items: CourseAssocRuleItem[]
  teacher_assoc_mode: string
  teacher_assoc_selected: string[]
  teacher_assoc_candidates: { id: string; name: string }[]
  teacher_assoc_items: TeacherAssocRuleItem[]
  teacher_tree_time_limit: SchedulingTreeNode[]
  /** 时段限制树当前勾选（node-key=id） */
  time_slot_teacher_checked: string[]
  time_slot_form: { day_part: string; limit_kind: string; limit_value: number }
  time_slot_rules: TimeSlotRuleItem[]
  daily_course_selected: string
  weekly_course_selected: string
  daily_rows: {
    id: string
    teacher_name: string
    course_name: string
    allow_span_am_pm: boolean
    max_consecutive: number | null
  }[]
  weekly_rows: {
    id: string
    teacher_name: string
    course_name: string
    distribution: string
    sync_level: string
  }[]
  rule_list_modal_tab: string
  rule_list_class_no_schedule: { grade_name: string; blocked_text: string }[]
  merge_selected_course: string
  merge_rules: MergeOrSimRuleItem[]
  sim_selected_course: string
  simultaneous_rules: MergeOrSimRuleItem[]
  simultaneous_grades: { grade: string; classes: { id: string; label: string }[] }[]
  merge_grade_classes: { grade: string; classes: { id: string; label: string }[] }[]
  /** 班级/老师/课程限制共用标签 */
  restriction_tags: string[]
  class_limit_tree: SchedulingTreeNode[]
  teacher_limit_tree: SchedulingTreeNode[]
  course_limit_tree: SchedulingTreeNode[]
  restriction_grids: RestrictionGridsBundle
  restriction_selection: {
    class_limit: string
    teacher_limit: string
    course_limit: string
  }
  /** 连堂规则列表（可与课务安排联动；演示含示例行） */
  consecutive_rows: ConsecutiveRuleRow[]
}

export function firstLeafId(nodes: SchedulingTreeNode[]): string {
  for (const n of nodes) {
    if (n.children?.length) {
      const x = firstLeafId(n.children)
      if (x) return x
    } else {
      return n.id
    }
  }
  return ''
}

function buildClassLimitTree(): SchedulingTreeNode[] {
  const grades = ['六年级', '七年级', '八年级', '九年级']
  return grades.map((g, gi) => ({
    id: `cl-g${gi}`,
    label: g,
    children: Array.from({ length: gi === 0 ? 7 : 4 }, (_, i) => ({
      id: `cl-g${gi}-c${i}`,
      label: `${i + 1}班`,
    })),
  }))
}

function buildCourseLimitTree(courses: string[]): SchedulingTreeNode[] {
  return courses.slice(0, 10).map((c, ci) => ({
    id: `cc-${ci}`,
    label: c,
    children: ['六年级', '七年级', '八年级', '九年级'].map((g, gi) => ({
      id: `cc-${ci}-g${gi}`,
      label: g,
    })),
  }))
}

const teachersYuwen = [
  '冯罗',
  '高乐诗',
  '黄锦莹',
  '康澎妮',
  '刘欣',
  '罗慧琳',
  '苏丹',
  '孙艺心',
  '孙悦',
  '唐晓文',
  '谢金茵',
]

export function defaultSchedulingRules(): SchedulingRulesState {
  const courses = [
    '语文/校本语文',
    '数学/校本数学',
    '英语/校本英语',
    '物理/综合实践科学探究',
    '化学/综合/探究',
    '生物/科学',
    '历史/综合',
    '地理',
    '体育',
    '信息',
    '音乐/艺术',
    '美术',
  ]
  const daily_rows = teachersYuwen.map((nm) => ({
    id: `dr-${nm}`,
    teacher_name: nm,
    course_name: '语文/校本语文',
    allow_span_am_pm: true,
    max_consecutive: null as number | null,
  }))
  const weekly_rows = teachersYuwen.map((nm) => ({
    id: `wr-${nm}`,
    teacher_name: nm,
    course_name: '语文/校本语文',
    distribution: 'dispersed',
    sync_level: 'weekly',
  }))
  const teacher_tree: SchedulingTreeNode[] = [
    { id: 'grp-lead', label: '校领导', children: [{ id: 't-l1', label: '演示校长' }] },
    {
      id: 'grp-bzr',
      label: '班主任',
      children: [
        { id: 't-b1', label: '严春梅' },
        { id: 't-b2', label: '冯罗' },
      ],
    },
    {
      id: 'grp-ch',
      label: '语文',
      children: teachersYuwen.slice(0, 6).map((n, i) => ({ id: `t-yw-${i}`, label: n })),
    },
    {
      id: 'grp-ma',
      label: '数学',
      children: [
        { id: 't-m1', label: '万良' },
        { id: 't-m2', label: '刘宇铭' },
      ],
    },
    { id: 'grp-en', label: '英语', children: [{ id: 't-e1', label: '张婉钰' }] },
  ]
  const class_limit_tree = buildClassLimitTree()
  const course_limit_tree = buildCourseLimitTree(courses)
  const restriction_selection = {
    class_limit: firstLeafId(class_limit_tree),
    teacher_limit: firstLeafId(teacher_tree),
    course_limit: firstLeafId(course_limit_tree),
  }
  const g6: [string, string][] = [
    ['1班', '严春梅'],
    ['2班', '严春梅'],
    ['3班', '李晶晶'],
    ['4班', '何钰莹'],
    ['5班', '李晶晶'],
    ['6班', '李诗琪'],
    ['7班', '李诗琪'],
  ]
  return {
    main_tab: 'consecutive',
    more_rules_subtab: 'time_slot',
    course_catalog: courses,
    course_assoc_type: 'same_day_mutex',
    course_assoc_items: [],
    teacher_assoc_mode: 'mutual_exclusion',
    teacher_assoc_selected: ['t-fl'],
    teacher_assoc_candidates: [
      { id: 't-fl', name: '冯罗' },
      { id: 't-gls', name: '高乐诗' },
      { id: 't-hjy', name: '黄锦莹' },
    ],
    teacher_tree_time_limit: teacher_tree,
    time_slot_teacher_checked: [],
    time_slot_form: { day_part: 'morning', limit_kind: 'max', limit_value: 1 },
    time_slot_rules: [],
    daily_course_selected: '__all__',
    weekly_course_selected: '__all__',
    daily_rows,
    weekly_rows,
    rule_list_modal_tab: 'all',
    rule_list_class_no_schedule: [
      {
        grade_name: '九年级',
        blocked_text: '周1第9节，周2第7、8、9节，周3第8、9节，周4第9节，周5第9节',
      },
      {
        grade_name: '八年级',
        blocked_text: '周1第9节，周2第8、9节，周3第8、9节，周4第9节，周5第9节',
      },
      {
        grade_name: '七年级',
        blocked_text: '周1第9节，周2第8、9节，周3第8、9节，周4第8、9节，周5第9节',
      },
      {
        grade_name: '六年级',
        blocked_text: '周1第5、6、9节，周2第5、6、9节，周3第5、6、9节，周4第5、6、9节，周5第5、6、9节',
      },
    ],
    simultaneous_grades: [
      {
        grade: '六年级',
        classes: g6.map(([lab, t], i) => ({
          id: `sim-g6-${i}`,
          label: `${lab} - (${t})`,
        })),
      },
      { grade: '七年级', classes: [{ id: 'sim-g7-1', label: '1班 - (凌佳丽)' }] },
      { grade: '八年级', classes: [] },
      { grade: '九年级', classes: [] },
    ],
    merge_selected_course: courses[0] ?? '',
    merge_rules: [],
    sim_selected_course: '数学/校本数学',
    simultaneous_rules: [],
    merge_grade_classes: [
      {
        grade: '六年级',
        classes: Array.from({ length: 5 }, (_, i) => ({
          id: `mg6-${i + 1}`,
          label: `${i + 1}班 - (冯罗)`,
        })),
      },
      { grade: '七年级', classes: [{ id: 'mg7-1', label: '1班 - (凌佳丽)' }] },
      { grade: '八年级', classes: [] },
      { grade: '九年级', classes: [] },
    ],
    teacher_assoc_items: [],
    restriction_tags: ['班会', '教研', '艺术课', '社团/自习', '行政管理', '心理/自习', '国防劳动AI'],
    class_limit_tree,
    teacher_limit_tree: teacher_tree,
    course_limit_tree,
    restriction_grids: {
      class_limit: {},
      teacher_limit: {},
      course_limit: {},
    },
    restriction_selection,
    consecutive_rows: [
      {
        id: 'conv-demo-1',
        course_name: '化学/综合/探究',
        scope: '六年级 1～3班',
        pattern: '4+1',
        remark: '示例：4 节单堂 + 1 节连堂；实际以课务安排「任教课时」为准',
      },
    ],
  }
}

function ensureArray<T>(v: unknown, fallback: T[]): T[] {
  return Array.isArray(v) ? (v as T[]) : fallback
}

export function mergeSchedulingRules(fromApi: unknown): SchedulingRulesState {
  const base = defaultSchedulingRules()
  if (!fromApi || typeof fromApi !== 'object') return base
  const raw = fromApi as Record<string, unknown>
  const merged = { ...base, ...raw } as SchedulingRulesState
  merged.course_assoc_items = ensureArray(raw.course_assoc_items, base.course_assoc_items)
  merged.teacher_assoc_items = ensureArray(raw.teacher_assoc_items, base.teacher_assoc_items)
  merged.time_slot_rules = ensureArray(raw.time_slot_rules, base.time_slot_rules)
  merged.time_slot_teacher_checked = ensureArray(raw.time_slot_teacher_checked, base.time_slot_teacher_checked)
  merged.merge_rules = ensureArray(raw.merge_rules, base.merge_rules)
  merged.simultaneous_rules = ensureArray(raw.simultaneous_rules, base.simultaneous_rules)
  if (typeof merged.merge_selected_course !== 'string') merged.merge_selected_course = base.merge_selected_course
  if (typeof merged.sim_selected_course !== 'string') merged.sim_selected_course = base.sim_selected_course
  if (typeof merged.weekly_course_selected !== 'string') merged.weekly_course_selected = base.weekly_course_selected
  merged.restriction_tags = ensureArray(raw.restriction_tags, base.restriction_tags)
  merged.class_limit_tree = ensureArray(raw.class_limit_tree, base.class_limit_tree) as SchedulingTreeNode[]
  merged.teacher_limit_tree = ensureArray(raw.teacher_limit_tree, base.teacher_limit_tree) as SchedulingTreeNode[]
  merged.course_limit_tree = ensureArray(raw.course_limit_tree, base.course_limit_tree) as SchedulingTreeNode[]
  merged.consecutive_rows = ensureArray(raw.consecutive_rows, base.consecutive_rows)
  const rg = raw.restriction_grids
  const brg = base.restriction_grids
  if (rg && typeof rg === 'object') {
    const x = rg as RestrictionGridsBundle
    merged.restriction_grids = {
      class_limit: { ...brg.class_limit, ...(x.class_limit || {}) },
      teacher_limit: { ...brg.teacher_limit, ...(x.teacher_limit || {}) },
      course_limit: { ...brg.course_limit, ...(x.course_limit || {}) },
    }
  } else {
    merged.restriction_grids = brg
  }
  const rs = raw.restriction_selection
  if (rs && typeof rs === 'object') {
    merged.restriction_selection = {
      ...base.restriction_selection,
      ...(rs as SchedulingRulesState['restriction_selection']),
    }
  } else {
    merged.restriction_selection = base.restriction_selection
  }
  return merged
}
