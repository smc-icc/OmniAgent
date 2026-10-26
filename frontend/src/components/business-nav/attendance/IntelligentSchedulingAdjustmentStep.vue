<template>
  <div class="adj" :class="{ 'adj--fs': fullscreen }">
    <div class="adj-tabs">
      <el-radio-group
        :model-value="viewTab"
        size="small"
        @update:model-value="onViewTabChange"
      >
        <el-radio-button value="class">班级课表</el-radio-button>
        <el-radio-button value="teacher">教师课表</el-radio-button>
      </el-radio-group>
      <div class="adj-tools">
        <span class="adj-sw-label">课表评估</span>
        <el-switch
          :model-value="settings.timetable_eval"
          size="small"
          @change="(v: boolean) => patchSettings({ timetable_eval: v })"
        />
        <span class="adj-sw-label">课程分布</span>
        <el-switch
          :model-value="settings.course_distribution"
          size="small"
          @change="(v: boolean) => patchSettings({ course_distribution: v })"
        />
        <span class="adj-sw-label">多级调课</span>
        <el-switch
          :model-value="settings.multi_level"
          size="small"
          @change="(v: boolean) => patchSettings({ multi_level: v })"
        />
        <el-tooltip content="合班/走班同时移动（演示开关）" placement="top">
          <span class="adj-sw-label">同时上课</span>
        </el-tooltip>
        <el-switch
          :model-value="settings.simultaneous_classes"
          size="small"
          @change="(v: boolean) => patchSettings({ simultaneous_classes: v })"
        />
        <el-button size="small" @click="fullscreen = !fullscreen">
          {{ fullscreen ? '退出全屏' : '全屏操作' }}
        </el-button>
      </div>
    </div>

    <div v-loading="loading" class="adj-body">
      <aside class="adj-sider">
        <el-input
          v-model="treeFilter"
          :placeholder="viewTab === 'class' ? '筛选年级/班级' : '请输入教师姓名'"
          clearable
          size="small"
          class="adj-filter"
        />
        <el-scrollbar max-height="calc(100vh - 280px)">
          <el-tree
            v-if="viewTab === 'class'"
            ref="classTreeRef"
            :data="classTree"
            :props="{ label: 'label', children: 'children' }"
            node-key="id"
            highlight-current
            default-expand-all
            :filter-node-method="filterClassNode"
            @node-click="onClassTreeClick"
          />
          <el-tree
            v-else
            ref="teacherTreeRef"
            :data="teacherTree"
            :props="{ label: 'label', children: 'children' }"
            node-key="id"
            highlight-current
            default-expand-all
            :filter-node-method="filterTeacherNode"
            @node-click="onTeacherTreeClick"
          />
        </el-scrollbar>
      </aside>

      <div class="adj-work">
        <div class="adj-main">
          <div class="adj-main-hd">
            <span class="adj-main-title">{{ mainTimetable?.title ?? '课表' }}</span>
            <div class="adj-main-actions">
              <el-button
                v-if="viewTab === 'class'"
                text
                size="small"
                :disabled="!classFlatIds.length"
                @click="stepClass(-1)"
              >
                &lt;
              </el-button>
              <el-button
                v-if="viewTab === 'class'"
                text
                size="small"
                :disabled="!classFlatIds.length"
                @click="stepClass(1)"
              >
                &gt;
              </el-button>
              <el-tooltip content="检索（演示）">
                <el-button text circle size="small" @click="ElMessage.info('演示：检索课表')">
                  <el-icon><Search /></el-icon>
                </el-button>
              </el-tooltip>
              <el-tooltip :content="settings.main_locked ? '已锁定，禁止调课' : '点击锁定主课表'">
                <el-button
                  text
                  circle
                  size="small"
                  :type="settings.main_locked ? 'warning' : 'default'"
                  @click="patchSettings({ main_locked: !settings.main_locked })"
                >
                  <el-icon><Lock /></el-icon>
                </el-button>
              </el-tooltip>
            </div>
          </div>
          <AdjustmentTimetableGrid
            :day-names="dayLabelsEffective"
            :cells="mainCells"
            :pending-lesson-id="pendingLessonId"
            :readonly="settings.main_locked"
            @cell-click="onMainCell"
          />
        </div>

        <div class="adj-refs">
          <div v-if="refTeacherTitle" class="adj-ref-card">
            <div class="adj-ref-hd">{{ refTeacherTitle }}</div>
            <AdjustmentTimetableGrid
              :day-names="dayLabelsEffective"
              :cells="refTeacherCells"
              readonly
              compact
            />
          </div>
          <div
            v-if="settings.multi_level && refClassTitle && refClassId !== mainTargetId"
            class="adj-ref-card"
          >
            <div class="adj-ref-hd">{{ refClassTitle }}</div>
            <AdjustmentTimetableGrid
              :day-names="dayLabelsEffective"
              :cells="refClassCells"
              readonly
              compact
            />
          </div>
          <div class="adj-ref-card adj-history">
            <div class="adj-ref-hd">调课记录</div>
            <el-scrollbar max-height="140px">
              <div v-if="!history.length" class="adj-hist-empty">暂无调课记录</div>
              <div v-for="h in history" :key="h.id" class="adj-hist-row">
                <div class="adj-hist-txt">{{ h.summary }}</div>
                <div class="adj-hist-meta">
                  <span class="adj-hist-time">{{ formatHistTime(h.created_at) }}</span>
                  <el-button
                    v-if="h.undo"
                    type="primary"
                    link
                    size="small"
                    @click="onUndo(h.id)"
                  >
                    撤销调课
                  </el-button>
                </div>
              </div>
            </el-scrollbar>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Lock, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  type AdjustmentCell,
  type AdjustmentHistoryItem,
  type AdjustmentSettings,
  fetchIntelligentSchedulingWizardAdjustment,
  fetchIntelligentSchedulingWizardAdjustmentTimetable,
  postIntelligentSchedulingWizardAdjustmentSwap,
  postIntelligentSchedulingWizardAdjustmentUndo,
  putIntelligentSchedulingWizardAdjustmentSettings,
  putIntelligentSchedulingWizardAdjustmentViewTab,
} from '@/api/intelligentScheduling'
import AdjustmentTimetableGrid from './AdjustmentTimetableGrid.vue'

const props = defineProps<{
  taskId: string
  /** 来自向导教学时间（周几列标题） */
  dayLabels: string[]
}>()

const loading = ref(false)
const fullscreen = ref(false)
const viewTab = ref<'class' | 'teacher'>('class')
const treeFilter = ref('')
const classTreeRef = ref<{ filter: (v: string) => void; setCurrentKey?: (k: string) => void } | null>(null)
const teacherTreeRef = ref<{ filter: (v: string) => void; setCurrentKey?: (k: string) => void } | null>(null)

const classTree = ref<{ id: string; label: string; children?: { id: string; label: string }[] }[]>([])
const teacherTree = ref<
  { id: string; label: string; children?: { id: string; label: string; children?: object[] }[] }[]
>([])
const history = ref<AdjustmentHistoryItem[]>([])

const settings = ref<AdjustmentSettings>({
  timetable_eval: false,
  course_distribution: false,
  multi_level: false,
  simultaneous_classes: true,
  main_locked: false,
})

const selectedClassId = ref('')
const selectedTeacherId = ref('')

const mainTimetable = ref<{ title: string; cells: Record<string, AdjustmentCell> } | null>(null)
const refTeacherCells = ref<Record<string, AdjustmentCell>>({})
const refClassCells = ref<Record<string, AdjustmentCell>>({})
const refTeacherTitle = ref('')
const refClassTitle = ref('')
const refClassId = ref('')

const pendingLessonId = ref<string | null>(null)
const anchorCell = ref<AdjustmentCell | null>(null)

const dayLabelsEffective = computed(() =>
  props.dayLabels.length ? props.dayLabels : ['周一', '周二', '周三', '周四', '周五'],
)

const mainCells = computed(() => mainTimetable.value?.cells ?? {})
const mainTargetId = computed(() =>
  viewTab.value === 'class' ? selectedClassId.value : selectedTeacherId.value,
)

const classFlatIds = computed(() => {
  const out: string[] = []
  for (const g of classTree.value) {
    for (const c of g.children ?? []) {
      out.push(c.id)
    }
  }
  return out
})

function filterClassNode(value: string, data: { label: string; children?: unknown }): boolean {
  if (!value) return true
  const q = value.toLowerCase()
  if (String(data.label).toLowerCase().includes(q)) return true
  const kids = data.children as { label: string; children?: unknown }[] | undefined
  return Boolean(kids?.some((ch) => filterClassNode(value, ch)))
}

function filterTeacherNode(value: string, data: { label: string; children?: unknown }): boolean {
  if (!value) return true
  const q = value.toLowerCase()
  if (String(data.label).toLowerCase().includes(q)) return true
  const kids = data.children as { label: string; children?: unknown }[] | undefined
  return Boolean(kids?.some((ch) => filterTeacherNode(value, ch)))
}

watch(treeFilter, (q) => {
  const v = q ?? ''
  void nextTick(() => {
    classTreeRef.value?.filter(v)
    teacherTreeRef.value?.filter(v)
  })
})

function isClassLeaf(data: { children?: unknown[] }) {
  return !data.children || data.children.length === 0
}

function onClassTreeClick(data: { id: string; children?: unknown[] }) {
  if (!isClassLeaf(data)) return
  selectedClassId.value = data.id
  void loadMainTimetable()
}

function onTeacherTreeClick(data: { id: string; is_teacher?: boolean; children?: unknown[] }) {
  if (!data.is_teacher) return
  selectedTeacherId.value = data.id
  void loadMainTimetable()
}

async function loadMeta() {
  if (!props.taskId) return
  loading.value = true
  try {
    const m = await fetchIntelligentSchedulingWizardAdjustment(props.taskId)
    classTree.value = m.class_tree
    teacherTree.value = m.teacher_tree
    history.value = m.history
    viewTab.value = m.view_tab
    settings.value = { ...settings.value, ...m.settings }
    if (!selectedClassId.value && m.class_tree.length) {
      const first = m.class_tree[0]?.children?.[0]
      if (first) selectedClassId.value = first.id
    }
    if (!selectedTeacherId.value && m.teacher_tree.length) {
      const sub = m.teacher_tree[0]
      const gr = sub?.children?.[0]
      const te = gr?.children?.[0] as { id?: string } | undefined
      if (te?.id) selectedTeacherId.value = te.id
    }
    await loadMainTimetable()
    await nextTick()
    if (viewTab.value === 'class' && selectedClassId.value) {
      classTreeRef.value?.setCurrentKey?.(selectedClassId.value)
    } else if (selectedTeacherId.value) {
      teacherTreeRef.value?.setCurrentKey?.(selectedTeacherId.value)
    }
  } catch {
    ElMessage.error('加载课表调整数据失败')
  } finally {
    loading.value = false
  }
}

async function loadMainTimetable() {
  if (!props.taskId) return
  const kind = viewTab.value
  const id = kind === 'class' ? selectedClassId.value : selectedTeacherId.value
  if (!id) return
  try {
    const r = await fetchIntelligentSchedulingWizardAdjustmentTimetable(props.taskId, kind, id)
    mainTimetable.value = { title: r.title, cells: r.cells }
    pendingLessonId.value = null
    anchorCell.value = null
    await loadRefGrids()
  } catch {
    ElMessage.error('加载课表失败')
  }
}

async function loadRefGrids() {
  anchorCell.value = null
  refTeacherTitle.value = ''
  refClassTitle.value = ''
  refClassId.value = ''
  refTeacherCells.value = {}
  refClassCells.value = {}
}

async function loadRefsForAnchor(c: AdjustmentCell) {
  if (!props.taskId || !c.teacher_id) return
  try {
    const tr = await fetchIntelligentSchedulingWizardAdjustmentTimetable(
      props.taskId,
      'teacher',
      c.teacher_id,
    )
    refTeacherTitle.value = tr.title
    refTeacherCells.value = tr.cells
  } catch {
    refTeacherTitle.value = ''
    refTeacherCells.value = {}
  }
  if (settings.value.multi_level && c.class_id) {
    refClassId.value = c.class_id
    try {
      const cr = await fetchIntelligentSchedulingWizardAdjustmentTimetable(
        props.taskId,
        'class',
        c.class_id,
      )
      refClassTitle.value = cr.title
      refClassCells.value = cr.cells
    } catch {
      refClassTitle.value = ''
      refClassCells.value = {}
    }
  }
}

async function onMainCell(_day: number, _period: number, c: AdjustmentCell | null) {
  if (settings.value.main_locked) {
    ElMessage.warning('主课表已锁定')
    return
  }
  if (!c?.lesson_id) {
    pendingLessonId.value = null
    anchorCell.value = null
    await loadRefGrids()
    return
  }
  anchorCell.value = c
  await loadRefsForAnchor(c)

  if (!pendingLessonId.value) {
    pendingLessonId.value = c.lesson_id
    return
  }
  if (pendingLessonId.value === c.lesson_id) {
    pendingLessonId.value = null
    return
  }
  const a = pendingLessonId.value
  pendingLessonId.value = null
  try {
    await postIntelligentSchedulingWizardAdjustmentSwap(props.taskId, a, c.lesson_id)
    ElMessage.success('已对调课节')
    await loadMainTimetable()
    const m = await fetchIntelligentSchedulingWizardAdjustment(props.taskId)
    history.value = m.history
  } catch {
    ElMessage.error('对调失败（请确认两节课属于同一班级或同一教师课表）')
  }
}

async function patchSettings(p: Partial<AdjustmentSettings>) {
  if (!props.taskId) return
  settings.value = { ...settings.value, ...p }
  try {
    const r = await putIntelligentSchedulingWizardAdjustmentSettings(props.taskId, p)
    settings.value = r.settings
  } catch {
    ElMessage.error('保存设置失败')
  }
}

async function onViewTabChange(tab: string | number | boolean | undefined) {
  const t = tab === 'teacher' ? 'teacher' : 'class'
  viewTab.value = t
  pendingLessonId.value = null
  if (props.taskId) {
    try {
      await putIntelligentSchedulingWizardAdjustmentViewTab(props.taskId, t)
    } catch {
      /* ignore */
    }
  }
  await loadMainTimetable()
}

function stepClass(delta: number) {
  const ids = classFlatIds.value
  const i = ids.indexOf(selectedClassId.value)
  if (i < 0 || !ids.length) return
  const n = (i + delta + ids.length) % ids.length
  selectedClassId.value = ids[n]!
  void nextTick(() => classTreeRef.value?.setCurrentKey?.(selectedClassId.value))
  void loadMainTimetable()
}

async function onUndo(hid: string) {
  if (!props.taskId) return
  try {
    await postIntelligentSchedulingWizardAdjustmentUndo(props.taskId, hid)
    ElMessage.success('已撤销')
    await loadMainTimetable()
    const m = await fetchIntelligentSchedulingWizardAdjustment(props.taskId)
    history.value = m.history
  } catch {
    ElMessage.error('撤销失败')
  }
}

function formatHistTime(iso: string) {
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return iso
  }
}

watch(
  () => props.taskId,
  () => {
    void loadMeta()
  },
)

watch(
  () => settings.value.multi_level,
  async (on) => {
    if (on && anchorCell.value) {
      await loadRefsForAnchor(anchorCell.value)
    }
  },
)

onMounted(() => {
  void loadMeta()
})
</script>

<style scoped>
.adj {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 440px;
}
.adj--fs {
  position: fixed;
  inset: 12px;
  z-index: 3000;
  background: #fff;
  padding: 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
  border-radius: 8px;
}
.adj-tabs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.adj-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.adj-sw-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-left: 4px;
}
.adj-body {
  display: flex;
  gap: 12px;
  flex: 1;
  min-height: 0;
}
.adj-sider {
  width: 228px;
  flex-shrink: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 8px;
  background: #fafafa;
}
.adj-filter {
  margin-bottom: 8px;
}
.adj-work {
  flex: 1;
  display: flex;
  gap: 12px;
  min-width: 0;
}
.adj-main {
  flex: 1.6;
  min-width: 260px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.adj-main-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.adj-main-title {
  font-weight: 600;
  font-size: 14px;
}
.adj-main-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.adj-refs {
  flex: 1;
  min-width: 200px;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.adj-ref-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 8px;
  background: #fff;
}
.adj-ref-hd {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--el-text-color-regular);
}
.adj-history {
  flex-shrink: 0;
}
.adj-hist-empty {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: 8px 0;
}
.adj-hist-row {
  padding: 6px 0;
  border-bottom: 1px dashed var(--el-border-color-lighter);
  font-size: 12px;
}
.adj-hist-txt {
  line-height: 1.4;
}
.adj-hist-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}
.adj-hist-time {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
</style>
