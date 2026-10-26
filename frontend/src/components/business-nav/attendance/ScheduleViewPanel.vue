<template>
  <div class="svp">
    <header class="svp-hd">
      <h2 class="svp-title">课表查看</h2>
    </header>

    <div class="svp-toolbar">
      <div class="svp-filters">
        <el-select v-model="termId" style="width: 200px" @change="reloadMeta">
          <el-option v-for="t in meta?.terms ?? []" :key="t.id" :label="t.label" :value="t.id" />
        </el-select>
        <el-select v-model="campusId" style="width: 220px" @change="reloadTrees">
          <el-option v-for="c in meta?.campuses ?? []" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-select v-model="weekNumber" style="width: 240px" @change="loadGrid">
          <el-option v-for="w in meta?.weeks ?? []" :key="w.week_number" :label="w.label" :value="w.week_number" />
        </el-select>
      </div>
      <div class="svp-actions">
        <el-button type="primary" @click="calendarDrawer = true">日历设置</el-button>
        <el-button type="primary" @click="exportMasterVisible = true">导出总课表</el-button>
        <el-button type="primary" @click="holidayDrawer = true">假期设置</el-button>
        <el-button v-if="mainTab === 'class'" type="primary" @click="doExport('class')">导出班级课表</el-button>
        <el-button v-if="mainTab === 'teacher'" type="primary" @click="doExport('teacher')">导出教师课表</el-button>
        <el-button v-if="mainTab === 'classroom'" type="primary" @click="doExport('classroom')">导出教室课表</el-button>
        <el-button @click="confirmDelete">删除课表</el-button>
      </div>
    </div>

    <el-tabs v-model="mainTab" class="svp-tabs" @tab-change="loadGrid">
      <el-tab-pane label="班级课表" name="class" />
      <el-tab-pane label="教师课表" name="teacher" />
      <el-tab-pane label="教室课表" name="classroom" />
      <el-tab-pane label="总课表" name="master" />
    </el-tabs>

    <div v-if="mainTab !== 'master'" class="svp-split">
      <aside class="svp-aside">
        <template v-if="mainTab === 'class'">
          <el-radio-group v-model="classScope" size="small" class="svp-seg" @change="loadGrid">
            <el-radio-button value="admin">行政班</el-radio-button>
            <el-radio-button value="other">非行政班</el-radio-button>
          </el-radio-group>
          <el-input v-model="classTreeFilter" clearable placeholder="搜索班级名称" class="svp-search" />
          <el-tree
            ref="classTreeRef"
            :data="classTreeData"
            :props="{ label: 'label', children: 'children' }"
            node-key="id"
            highlight-current
            default-expand-all
            :filter-node-method="filterClassNode"
            @node-click="onClassTreeClick"
          />
        </template>
        <template v-else-if="mainTab === 'teacher'">
          <el-input v-model="teacherTreeFilter" clearable placeholder="搜索教师名称" class="svp-search" />
          <el-tree
            ref="teacherTreeRef"
            :data="teacherTreeData"
            :props="{ label: 'label', children: 'children' }"
            node-key="id"
            highlight-current
            default-expand-all
            :filter-node-method="filterTeacherNode"
            @node-click="onTeacherTreeClick"
          />
        </template>
        <template v-else>
          <el-input v-model="roomSearch" clearable placeholder="搜索教室名称" class="svp-search" @input="loadRooms" />
          <ul class="svp-rlist">
            <li
              v-for="r in rooms"
              :key="r.id"
              :class="{ 'svp-rlist--on': r.id === selectedRoomId }"
              @click="selectRoom(r.id)"
            >
              {{ r.name }}
            </li>
          </ul>
        </template>
      </aside>

      <div v-loading="gridLoading" class="svp-main">
        <div class="svp-grid-title">{{ gridTitle }}</div>
        <table v-if="weekGrid" class="svp-tb">
          <thead>
            <tr>
              <th class="svp-tb-p">节次</th>
              <th
                v-for="d in weekGrid.days"
                :key="d.iso"
                class="svp-tb-d"
                :class="{ 'svp-tb-d--today': isTodayIso(d.iso) }"
              >
                {{ d.label }}({{ d.date_md }})
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in weekGrid.periods" :key="p.id">
              <td class="svp-tb-p">
                <div>{{ p.name }}</div>
                <div v-if="p.start" class="svp-tb-pt">{{ p.start }}-{{ p.end }}</div>
              </td>
              <td
                v-for="d in weekGrid.days"
                :key="d.dow + p.id"
                class="svp-tb-c"
                :class="{ 'svp-tb-c--today': isTodayIso(d.iso) }"
              >
                <div
                  v-if="mainTab === 'class' && classCell(d.dow, p.id)"
                  class="svp-cell2"
                  :style="{ background: classCell(d.dow, p.id)!.color }"
                >
                  <div>{{ classCell(d.dow, p.id)!.subject }}</div>
                  <div class="svp-cell2-sub">{{ classCell(d.dow, p.id)!.teacher }}</div>
                </div>
                <div v-else-if="mainTab === 'teacher' && teacherCell(d.dow, p.id)" class="svp-cell-t">
                  {{ teacherCell(d.dow, p.id)!.line }}
                </div>
                <div v-else-if="mainTab === 'classroom' && roomCell(d.dow, p.id)" class="svp-cell3">
                  <div>{{ roomCell(d.dow, p.id)!.subject }}</div>
                  <div class="svp-cell2-sub">{{ roomCell(d.dow, p.id)!.teacher }}</div>
                  <div class="svp-cell2-sub">{{ roomCell(d.dow, p.id)!.class_name }}</div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 总课表 -->
    <div v-else v-loading="masterLoading" class="svp-master">
      <div class="svp-grid-title">总课表</div>
      <div class="svp-master-scroll">
        <table v-if="masterData" class="svp-tb svp-tb-master">
          <thead>
            <tr>
              <th class="svp-fix">周次</th>
              <th class="svp-fix2">节次</th>
              <th v-for="c in masterData.class_columns" :key="c.id" class="svp-mcol">{{ c.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in masterData.period_rows" :key="row.id">
              <td class="svp-fix">{{ row.week_label || '—' }}</td>
              <td class="svp-fix2">
                <div>{{ row.name }}</div>
                <div class="svp-tb-pt">{{ row.time }}</div>
              </td>
              <td v-for="col in masterData.class_columns" :key="col.id" class="svp-mcell">
                <template v-for="mc in [masterCell(row.id, col.id)]" :key="col.id + row.id">
                  <template v-if="mc">
                    <div class="svp-mcell-in">{{ mc.subject }}</div>
                    <div class="svp-cell2-sub">{{ mc.teacher }}</div>
                  </template>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 课程日历设置 -->
    <el-drawer v-model="calendarDrawer" title="课程日历设置" size="420px" destroy-on-close @opened="loadCal">
      <el-alert type="warning" :closable="false" show-icon class="svp-mb">
        教师课表可应用到日历；若开启日程创建开关，系统将于每周日 18:00 自动创建次周日程，也可使用手动创建。
      </el-alert>
      <div class="svp-mb">选择校区：{{ calCampusLabel }}</div>
      <div class="svp-mb">
        <div class="svp-lbl">日程创建开关</div>
        <el-switch v-model="calAuto" active-text="若开启，周日自动创建次周日程" />
      </div>
      <p class="svp-tip">
        学校老师 {{ calAuth }} 人已授权，可正常创建日程，{{ calUnauth }} 人未授权。（老师可在移动端「我的课表」中授权）
      </p>
      <template #footer>
        <el-button @click="calendarDrawer = false">取消</el-button>
        <el-button type="primary" @click="saveCal">确定</el-button>
      </template>
    </el-drawer>

    <!-- 导出总课表 -->
    <el-dialog v-model="exportMasterVisible" title="导出总课表" width="520px" destroy-on-close>
      <div class="svp-lbl">导出格式</div>
      <el-radio-group v-model="exportLayout" class="svp-block">
        <el-radio value="classes_as_rows">班级为行、节次为列</el-radio>
        <el-radio value="periods_as_rows">节次为行、班级为列（与界面一致）</el-radio>
      </el-radio-group>
      <div class="svp-lbl">导出表格</div>
      <el-radio-group v-model="exportSheet" class="svp-block">
        <el-radio value="per_grade">每个年级一张表</el-radio>
        <el-radio value="single_sheet">所有班在同一张表（与导入模板相同）</el-radio>
      </el-radio-group>
      <template #footer>
        <el-button @click="exportMasterVisible = false">取消</el-button>
        <el-button type="primary" @click="submitExportMaster">确认导出</el-button>
      </template>
    </el-dialog>

    <!-- 假期设置 -->
    <el-drawer v-model="holidayDrawer" title="假期设置" size="480px" destroy-on-close>
      <div class="svp-drawer-hd">
        <el-button link type="primary" @click="holidayRecordsVisible = true">设置记录</el-button>
      </div>
      <el-alert type="warning" :closable="false" show-icon class="svp-mb">
        设置后，假期内课表将显示为空，课时统计将排除这些时段。
      </el-alert>
      <el-form label-position="top">
        <el-form-item label="选择校区">
          <el-radio-group v-model="holidayCampus">
            <el-radio v-for="c in meta?.campuses ?? []" :key="c.id" :value="c.id">{{ c.name }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="选择范围">
          <el-radio-group v-model="holidayScope">
            <el-radio value="grade">按年级设置放假</el-radio>
            <el-radio value="class">按班级设置放假</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="holidayScope === 'grade'" label="年级">
          <el-checkbox v-model="holidayAllGrades" @change="toggleHolidayGrades">全选</el-checkbox>
          <el-checkbox-group v-model="holidayGradeIds" class="svp-ggrid">
            <el-checkbox v-for="g in gradeOptions" :key="g.id" :value="g.id">{{ g.label }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="放假起止">
          <el-date-picker
            v-model="holidayRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            range-separator="至"
            start-placeholder="开始"
            end-placeholder="结束"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="备注（30字内）">
          <el-input v-model="holidayRemark" maxlength="30" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="primary" @click="submitHoliday">确定</el-button>
      </template>
    </el-drawer>

    <!-- 假期设置记录 -->
    <el-dialog v-model="holidayRecordsVisible" title="假期设置记录" width="720px" destroy-on-close>
      <el-alert type="info" :closable="false" class="svp-mb">本学期内的假期补课设置记录如下：</el-alert>
      <el-table :data="holidayRecords" border size="small" empty-text="暂无数据">
        <el-table-column type="index" label="序号" width="60" />
        <el-table-column prop="detail" label="详情" min-width="200" />
        <el-table-column prop="remark" label="备注信息" width="140" />
        <el-table-column prop="operated_at" label="操作日期" width="160" />
        <el-table-column prop="operator" label="操作人" width="100" />
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { ElTree } from 'element-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  fetchCalendarSettings,
  fetchGridClass,
  fetchGridClassroom,
  fetchGridMaster,
  fetchGridTeacher,
  fetchHolidayRecords,
  fetchScheduleViewClassTree,
  fetchScheduleViewClassrooms,
  fetchScheduleViewMeta,
  fetchScheduleViewTeacherTree,
  postDeleteSchedule,
  postHoliday,
  postScheduleViewExport,
  putCalendarSettings,
  type DayHeader,
  type PeriodRow,
} from '@/api/scheduleView'

const meta = ref<Awaited<ReturnType<typeof fetchScheduleViewMeta>> | null>(null)
const termId = ref('')
const campusId = ref('')
const weekNumber = ref(5)
const mainTab = ref<'class' | 'teacher' | 'classroom' | 'master'>('class')

const classScope = ref<'admin' | 'other'>('admin')
const classTreeData = ref<unknown[]>([])
const classTreeFilter = ref('')
const classTreeRef = ref<InstanceType<typeof ElTree>>()
const selectedClassId = ref('sv-cls-g1-1')

const teacherTreeData = ref<unknown[]>([])
const teacherTreeFilter = ref('')
const teacherTreeRef = ref<InstanceType<typeof ElTree>>()
const selectedTeacherId = ref('t-zcm')

const rooms = ref<{ id: string; name: string }[]>([])
const roomSearch = ref('')
const selectedRoomId = ref('room-info')

const gridLoading = ref(false)
const weekGrid = ref<{
  days: DayHeader[]
  periods: PeriodRow[]
  cells: Record<string, { subject?: string; teacher?: string; color?: string; line?: string; class_name?: string }>
} | null>(null)

const masterLoading = ref(false)
const masterData = ref<Awaited<ReturnType<typeof fetchGridMaster>> | null>(null)
const masterCellMap = ref<Map<string, { subject: string; teacher: string }>>(new Map())

const calendarDrawer = ref(false)
const calAuto = ref(true)
const calAuth = ref(11)
const calUnauth = ref(185)

const exportMasterVisible = ref(false)
const exportLayout = ref<'classes_as_rows' | 'periods_as_rows'>('periods_as_rows')
const exportSheet = ref<'per_grade' | 'single_sheet'>('single_sheet')

const holidayDrawer = ref(false)
const holidayRecordsVisible = ref(false)
const holidayCampus = ref('')
const holidayScope = ref<'grade' | 'class'>('grade')
const holidayGradeIds = ref<string[]>([])
const holidayAllGrades = ref(false)
const holidayRange = ref<[string, string] | null>(null)
const holidayRemark = ref('')
const holidayRecords = ref<Awaited<ReturnType<typeof fetchHolidayRecords>>>([])

const gradeOptions = [
  { id: 'g1', label: '一年级' },
  { id: 'g2', label: '二年级' },
  { id: 'g3', label: '三年级' },
  { id: 'g4', label: '四年级' },
  { id: 'g5', label: '五年级' },
  { id: 'g6', label: '六年级' },
  { id: 'g7', label: '七年级' },
  { id: 'g8', label: '八年级' },
  { id: 'g9', label: '九年级' },
]

const teacherGridTitle = ref('')

const gridTitle = computed(() => {
  if (mainTab.value === 'class') return findClassTitle(selectedClassId.value)
  if (mainTab.value === 'teacher') return `${teacherGridTitle.value || '教师'} 的课表`
  if (mainTab.value === 'classroom') {
    const r = rooms.value.find((x) => x.id === selectedRoomId.value)
    return r ? `${r.name} · 课表` : '教室课表'
  }
  return ''
})

const calCampusLabel = computed(() => meta.value?.campuses.find((c) => c.id === campusId.value)?.name ?? '—')

function findClassTitle(cid: string): string {
  const path: string[] = []
  let found: string[] = []
  const dfs = (nodes: any[]): boolean => {
    for (const n of nodes) {
      path.push(n.label)
      if (n.class_id === cid) {
        found = [...path]
        return true
      }
      if (n.children?.length && dfs(n.children)) return true
      path.pop()
    }
    return false
  }
  dfs(classTreeData.value as any[])
  if (!found.length) return '班级课表'
  return `${found.slice(1).join('')}课表`
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function isTodayIso(iso: string) {
  const t = new Date()
  const local = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`
  return local === iso
}

function cellKey(day: number, periodId: string) {
  return `${day}-${periodId}`
}

function classCell(day: number, periodId: string) {
  const c = weekGrid.value?.cells[cellKey(day, periodId)]
  if (c?.subject != null && c?.teacher != null) return c as { subject: string; teacher: string; color: string }
  return undefined
}

function teacherCell(day: number, periodId: string) {
  const c = weekGrid.value?.cells[cellKey(day, periodId)]
  if (c?.line) return c as { line: string }
  return undefined
}

function roomCell(day: number, periodId: string) {
  const c = weekGrid.value?.cells[cellKey(day, periodId)]
  if (c?.subject && c.class_name) return c as { subject: string; teacher: string; class_name: string }
  return undefined
}

function masterCell(rowId: string, classId: string) {
  return masterCellMap.value.get(`${rowId}|${classId}`)
}

async function reloadMeta() {
  meta.value = await fetchScheduleViewMeta(termId.value || undefined)
  if (!termId.value && meta.value.current_term_id) termId.value = meta.value.current_term_id
  if (!campusId.value && meta.value.campuses[0]) campusId.value = meta.value.campuses[0].id
  const w5 = meta.value.weeks.find((w) => w.week_number === 5)
  weekNumber.value = w5 ? 5 : meta.value.weeks[0]?.week_number ?? 1
}

async function reloadTrees() {
  if (!campusId.value) return
  classTreeData.value = (await fetchScheduleViewClassTree(campusId.value)) as unknown[]
  teacherTreeData.value = (await fetchScheduleViewTeacherTree(campusId.value)) as unknown[]
  await loadRooms()
  await nextTick()
  classTreeRef.value?.filter(classTreeFilter.value)
  teacherTreeRef.value?.filter(teacherTreeFilter.value)
  const findFirstClass = (nodes: any[]): string | null => {
    for (const n of nodes) {
      if (n.class_id) return n.class_id
      if (n.children?.length) {
        const x = findFirstClass(n.children)
        if (x) return x
      }
    }
    return null
  }
  const fc = findFirstClass(classTreeData.value as any[])
  if (fc) selectedClassId.value = fc
  classTreeRef.value?.setCurrentKey(selectedClassId.value)
}

async function loadRooms() {
  if (!campusId.value) return
  rooms.value = await fetchScheduleViewClassrooms(campusId.value, roomSearch.value || undefined)
}

function filterClassNode(val: string, data: { label?: string }) {
  if (!val) return true
  return (data.label ?? '').includes(val)
}

function filterTeacherNode(val: string, data: { label?: string }) {
  if (!val) return true
  return (data.label ?? '').includes(val)
}

watch(classTreeFilter, (v) => classTreeRef.value?.filter(v))
watch(teacherTreeFilter, (v) => teacherTreeRef.value?.filter(v))

function onClassTreeClick(data: { class_id?: string }) {
  if (data.class_id) {
    selectedClassId.value = data.class_id
    loadGrid()
  }
}

function onTeacherTreeClick(data: { is_teacher?: boolean; id?: string }) {
  if (data.is_teacher && data.id) {
    selectedTeacherId.value = data.id
    loadGrid()
  }
}

function selectRoom(id: string) {
  selectedRoomId.value = id
  loadGrid()
}

async function loadGrid() {
  if (!campusId.value || !termId.value) return
  if (mainTab.value === 'master') {
    await loadMaster()
    return
  }
  gridLoading.value = true
  try {
    if (mainTab.value === 'class') {
      const g = await fetchGridClass({
        campus_id: campusId.value,
        term_id: termId.value,
        week_number: weekNumber.value,
        class_id: selectedClassId.value,
        class_scope: classScope.value,
      })
      const cells: Record<string, Record<string, string>> = {}
      for (const c of g.cells) {
        cells[cellKey(c.day, c.period_id)] = { subject: c.subject, teacher: c.teacher, color: c.color }
      }
      weekGrid.value = { days: g.days, periods: g.periods, cells } as any
    } else if (mainTab.value === 'teacher') {
      const g = await fetchGridTeacher({
        campus_id: campusId.value,
        term_id: termId.value,
        week_number: weekNumber.value,
        teacher_id: selectedTeacherId.value,
      })
      const cells: Record<string, { line: string }> = {}
      for (const c of g.cells) cells[cellKey(c.day, c.period_id)] = { line: c.line }
      teacherGridTitle.value = g.teacher_name
      weekGrid.value = { days: g.days, periods: g.periods, cells } as any
    } else {
      const g = await fetchGridClassroom({
        campus_id: campusId.value,
        term_id: termId.value,
        week_number: weekNumber.value,
        room_id: selectedRoomId.value,
      })
      const cells: Record<string, Record<string, string>> = {}
      for (const c of g.cells) {
        cells[cellKey(c.day, c.period_id)] = {
          subject: c.subject,
          teacher: c.teacher,
          class_name: c.class_name,
        }
      }
      weekGrid.value = { days: g.days, periods: g.periods, cells } as any
    }
  } finally {
    gridLoading.value = false
  }
}

async function loadMaster() {
  masterLoading.value = true
  try {
    const g = await fetchGridMaster({
      campus_id: campusId.value,
      term_id: termId.value,
      week_number: weekNumber.value,
    })
    masterData.value = g
    const m = new Map<string, { subject: string; teacher: string }>()
    for (const c of g.cells) {
      m.set(`${c.row_id}|${c.class_id}`, { subject: c.subject, teacher: c.teacher })
    }
    masterCellMap.value = m
  } finally {
    masterLoading.value = false
  }
}

async function loadCal() {
  const s = await fetchCalendarSettings()
  calAuto.value = s.auto_create_next_week
  calAuth.value = s.authorized_teacher_count
  calUnauth.value = s.unauthorized_teacher_count
}

async function saveCal() {
  await putCalendarSettings({
    auto_create_next_week: calAuto.value,
    campus_id: campusId.value,
  })
  ElMessage.success('已保存')
  calendarDrawer.value = false
}

async function submitExportMaster() {
  const r = await postScheduleViewExport({
    export_type: 'master',
    layout: exportLayout.value,
    sheet_mode: exportSheet.value,
  })
  ElMessage.success(r.message)
  exportMasterVisible.value = false
}

async function doExport(t: 'class' | 'teacher' | 'classroom') {
  const r = await postScheduleViewExport({
    export_type: t,
    layout: 'periods_as_rows',
    sheet_mode: 'single_sheet',
  })
  ElMessage.success(r.message)
}

async function confirmDelete() {
  try {
    await ElMessageBox.confirm('确定删除当前学期课表？（演示环境不删除真实数据）', '删除课表', { type: 'warning' })
  } catch {
    return
  }
  const r = await postDeleteSchedule(campusId.value, termId.value)
  ElMessage.success(r.message)
}

function toggleHolidayGrades(v: boolean | string | number) {
  holidayGradeIds.value = Boolean(v) ? gradeOptions.map((g) => g.id) : []
}

async function submitHoliday() {
  if (!holidayRange.value?.length) {
    ElMessage.warning('请选择放假日期')
    return
  }
  await postHoliday({
    campus_id: holidayCampus.value || campusId.value,
    scope: holidayScope.value,
    grade_ids: holidayScope.value === 'grade' ? holidayGradeIds.value : [],
    date_start: holidayRange.value[0]!,
    date_end: holidayRange.value[1]!,
    remark: holidayRemark.value,
  })
  ElMessage.success('已保存假期设置（演示）')
  holidayDrawer.value = false
}

watch(holidayRecordsVisible, async (v) => {
  if (v) holidayRecords.value = await fetchHolidayRecords({ term_id: termId.value, campus_id: campusId.value })
})

watch([termId, campusId, weekNumber], () => {
  if (mainTab.value === 'master') loadMaster()
  else loadGrid()
})

onMounted(async () => {
  await reloadMeta()
  holidayCampus.value = campusId.value
  await reloadTrees()
  await loadGrid()
})
</script>

<style scoped>
.svp {
  padding: 16px 20px 24px;
  min-height: 480px;
}
.svp-hd {
  margin-bottom: 12px;
}
.svp-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #303133;
}
.svp-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.svp-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.svp-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.svp-tabs {
  margin-bottom: 12px;
}
.svp-split {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  min-height: 400px;
}
.svp-aside {
  width: 260px;
  flex-shrink: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 10px;
  background: #fafafa;
  max-height: 640px;
  overflow: auto;
}
.svp-seg {
  width: 100%;
  margin-bottom: 8px;
}
.svp-seg :deep(.el-radio-button__inner) {
  width: 50%;
}
.svp-search {
  margin-bottom: 8px;
}
.svp-rlist {
  list-style: none;
  margin: 0;
  padding: 0;
}
.svp-rlist li {
  padding: 8px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
.svp-rlist li:hover {
  background: #ecf5ff;
}
.svp-rlist--on {
  color: var(--el-color-primary);
  font-weight: 600;
  background: var(--el-color-primary-light-9);
}
.svp-main {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
.svp-master {
  min-height: 360px;
}
.svp-master-scroll {
  overflow-x: auto;
  max-width: 100%;
}
.svp-grid-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 10px;
  color: #303133;
}
.svp-tb {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  border: 1px solid #ebeef5;
}
.svp-tb th,
.svp-tb td {
  border: 1px solid #e4e7ed;
  padding: 6px 4px;
  text-align: center;
  vertical-align: middle;
}
.svp-tb th {
  background: #f5f7fa;
  font-weight: 600;
}
.svp-tb-p {
  width: 96px;
  background: #fafafa;
}
.svp-tb-d--today {
  background: #ecf5ff !important;
  color: var(--el-color-primary);
  box-shadow: inset 0 -2px 0 var(--el-color-primary);
}
.svp-tb-pt {
  font-size: 11px;
  color: #909399;
  margin-top: 2px;
}
.svp-tb-c {
  min-width: 72px;
  min-height: 48px;
}
.svp-tb-c--today {
  box-shadow: inset 3px 0 0 var(--el-color-primary);
  background: #fafcff;
}
.svp-cell2 {
  border-radius: 4px;
  padding: 6px 4px;
  line-height: 1.35;
}
.svp-cell2-sub {
  font-size: 11px;
  color: #606266;
  margin-top: 2px;
}
.svp-cell-t {
  background: #e3f2fd;
  border-radius: 4px;
  padding: 8px 4px;
  font-size: 12px;
}
.svp-cell3 {
  background: #e8f5e9;
  border-radius: 4px;
  padding: 6px 4px;
  text-align: center;
  line-height: 1.3;
  font-size: 11px;
}
.svp-tb-master .svp-fix {
  width: 56px;
  position: sticky;
  left: 0;
  z-index: 2;
  background: #f5f7fa;
}
.svp-tb-master .svp-fix2 {
  width: 120px;
  position: sticky;
  left: 56px;
  z-index: 2;
  background: #f5f7fa;
}
.svp-mcol {
  min-width: 100px;
  white-space: nowrap;
}
.svp-mcell {
  min-width: 96px;
}
.svp-mcell-in {
  font-weight: 500;
}
.svp-mb {
  margin-bottom: 12px;
}
.svp-lbl {
  font-weight: 600;
  margin-bottom: 8px;
  color: #303133;
}
.svp-block {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 16px;
}
.svp-tip {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
.svp-drawer-hd {
  text-align: right;
  margin-bottom: 8px;
}
.svp-ggrid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 8px;
}
</style>
