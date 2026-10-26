<template>
  <div class="ips">
    <div class="ips-toolbar">
      <span class="ips-toolbar-spacer" />
      <template v-if="ps.subtab !== 'morning_reading'">
        <el-button type="danger" plain size="small" @click="clearCurrentPreGrid">清除预排</el-button>
        <el-button type="primary" size="small" @click="ElMessage.info('演示：上传 Excel 预排')">上传预排</el-button>
        <el-button type="primary" size="small" @click="ElMessage.info('演示：下载当前预排')">下载预排</el-button>
      </template>
    </div>

    <el-tabs v-model="ps.subtab" type="card" class="ips-tabs">
      <el-tab-pane label="早读安排" name="morning_reading">
        <el-alert
          type="warning"
          :closable="false"
          show-icon
          class="ips-mr-alert"
          title="设置各年级每日早读科目后，系统会尽量将第一节与早读衔接，避免间隔过长（演示）。"
        />
        <div class="ips-mr-body">
          <div class="ips-mr-grades">
            <div class="ips-mr-grades-hd">年级</div>
            <el-checkbox
              :model-value="allGradesChecked"
              :indeterminate="gradesIndeterminate"
              @update:model-value="toggleAllGrades"
            >
              全选
            </el-checkbox>
            <el-checkbox-group v-model="ps.morning_reading.grade_checks" class="ips-mr-glist">
              <el-checkbox v-for="g in ps.morning_reading.grades" :key="g.id" :value="g.id">
                {{ g.label }}
              </el-checkbox>
            </el-checkbox-group>
          </div>
          <div class="ips-mr-grid-wrap">
            <el-table :data="ps.morning_reading.rows" border size="small" class="ips-mr-table">
              <el-table-column prop="label" label="科目" width="200" fixed />
              <el-table-column
                v-for="(col, ci) in ps.morning_reading.cols"
                :key="ci"
                :label="col"
                min-width="100"
              >
                <template #default="{ row }">
                  <el-input v-model="ps.morning_reading.cells[mrCellKey(row.id, ci)]" size="small" clearable />
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="课程预排" name="course">
        <div class="ips-split">
          <div class="ips-side ips-side--course">
            <el-select v-model="ps.course.grade_id" size="small" class="ips-mb" style="width: 100%">
              <el-option v-for="g in ps.course.grade_options" :key="g.id" :label="g.label" :value="g.id" />
            </el-select>
            <el-scrollbar max-height="420">
              <el-collapse>
                <el-collapse-item
                  v-for="sub in ps.course.subjects"
                  :key="sub.id"
                  :title="sub.course_name"
                  :name="sub.id"
                >
                  <el-checkbox-group v-model="ps.course.selected_class_ids" class="ips-check-col">
                    <el-checkbox v-for="cl in sub.classes" :key="cl.id" :value="cl.id" class="ips-check-line">
                      <span>{{ cl.label }} {{ cl.teacher }}</span>
                      <span class="ips-ratio">({{ cl.placed }}/{{ cl.total }})</span>
                    </el-checkbox>
                  </el-checkbox-group>
                </el-collapse-item>
              </el-collapse>
            </el-scrollbar>
          </div>
          <div class="ips-center">
            <div class="ips-center-hd">
              <span class="ips-title">{{ currentGradeLabel }}课表</span>
              <el-button size="small" type="primary" plain @click="ps.course.selected_class_ids = []">
                取消选中
              </el-button>
              <span class="ips-switch-wrap">
                <span class="ips-switch-label">同时上课联排</span>
                <el-switch v-model="ps.course.simultaneous_joint" />
              </span>
            </div>
            <PrescheduleGridTable :cells="ps.course.main_grid" @cell-click="onCourseCell" />
          </div>
          <div class="ips-refs">
            <div class="ips-ref-block">
              <div class="ips-ref-title">参考课表 1</div>
              <PrescheduleGridTable :cells="ps.course.ref_grids[0]" readonly compact />
            </div>
            <div class="ips-ref-block">
              <div class="ips-ref-title">参考课表 2</div>
              <PrescheduleGridTable :cells="ps.course.ref_grids[1]" readonly compact />
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="班级预排" name="class">
        <div class="ips-split">
          <div class="ips-side">
            <div class="ips-filters">
              <el-select v-model="ps.class.grade_id" size="small" placeholder="年级" style="width: 48%">
                <el-option v-for="g in ps.class.grade_options" :key="g.id" :label="g.label" :value="g.id" />
              </el-select>
              <el-select v-model="ps.class.class_id" size="small" placeholder="班级" style="width: 48%">
                <el-option v-for="c in ps.class.class_options" :key="c.id" :label="c.label" :value="c.id" />
              </el-select>
            </div>
            <div class="ips-cards">
              <div
                v-for="card in ps.class.cards"
                :key="card.id"
                class="ips-card"
                :class="{ 'ips-card--on': ps.class.picked_card_id === card.id }"
                @click="ps.class.picked_card_id = card.id"
              >
                <div class="ips-card-name">{{ card.course_name }}</div>
                <div class="ips-card-sub">{{ card.teacher }}</div>
                <div class="ips-card-ratio">{{ card.placed }}/{{ card.total }}</div>
              </div>
            </div>
          </div>
          <div class="ips-center">
            <div class="ips-center-hd">
              <span class="ips-title">{{ currentClassTitle }}课表</span>
              <el-button size="small" type="primary" plain @click="ps.class.picked_card_id = ''">取消选中</el-button>
              <span class="ips-switch-wrap">
                <span class="ips-switch-label">同时上课联排</span>
                <el-switch v-model="ps.class.simultaneous_joint" />
              </span>
            </div>
            <p class="ips-hint">先点击左侧课程卡片，再点击课表空格填入；不选卡片时点格可清除该格。</p>
            <PrescheduleGridTable :cells="ps.class.main_grid" @cell-click="onClassCell" />
          </div>
          <div class="ips-refs">
            <div class="ips-ref-block">
              <div class="ips-ref-title">课表预览</div>
              <PrescheduleGridTable :cells="ps.class.ref_grids[0]" readonly compact />
            </div>
            <div class="ips-ref-block">
              <div class="ips-ref-title">课表预览</div>
              <PrescheduleGridTable :cells="ps.class.ref_grids[1]" readonly compact />
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { computed } from 'vue'
import type {
  PreScheduleState,
  PrescheduleClassLine,
  PrescheduleSubjectGroup,
} from '@/api/prescheduleDefaults'
import PrescheduleGridTable from './PrescheduleGridTable.vue'

const ps = defineModel<PreScheduleState>({ required: true })

function mrCellKey(rowId: string, colIdx: number) {
  return `${rowId}__${colIdx}`
}

const allGradesChecked = computed(() => {
  const g = ps.value.morning_reading.grades
  return g.length > 0 && g.every((x) => ps.value.morning_reading.grade_checks.includes(x.id))
})

const gradesIndeterminate = computed(() => {
  const n = ps.value.morning_reading.grade_checks.length
  const t = ps.value.morning_reading.grades.length
  return n > 0 && n < t
})

function toggleAllGrades(checked: boolean) {
  if (checked) {
    ps.value.morning_reading.grade_checks = ps.value.morning_reading.grades.map((g) => g.id)
  } else {
    ps.value.morning_reading.grade_checks = []
  }
}

const currentGradeLabel = computed(
  () => ps.value.course.grade_options.find((g) => g.id === ps.value.course.grade_id)?.label ?? '',
)

const currentClassTitle = computed(() => {
  const co = ps.value.class.class_options.find((c) => c.id === ps.value.class.class_id)
  return co?.label ?? '班级'
})

function gridKey(day: number, period: number) {
  return `d${day}-p${period}`
}

function findCourseLine(
  classId: string,
): { line: PrescheduleClassLine; subj: PrescheduleSubjectGroup } | null {
  for (const subj of ps.value.course.subjects) {
    const line = subj.classes.find((c) => c.id === classId)
    if (line) return { line, subj }
  }
  return null
}

function onCourseCell(day: number, period: number) {
  const key = gridKey(day, period)
  const ids = ps.value.course.selected_class_ids
  if (!ids.length) {
    const oldId = ps.value.course.main_grid_meta[key]
    if (oldId) {
      const hit = findCourseLine(oldId)
      if (hit && hit.line.placed > 0) hit.line.placed--
      delete ps.value.course.main_grid_meta[key]
      delete ps.value.course.main_grid[key]
    }
    return
  }
  const pick = ids[0]
  const hit = findCourseLine(pick)
  if (!hit) {
    ElMessage.warning('未找到班级行')
    return
  }
  const { line, subj } = hit
  if (line.placed >= line.total) {
    ElMessage.warning('该班课时已满')
    return
  }
  const oldId = ps.value.course.main_grid_meta[key]
  if (oldId && oldId !== pick) {
    const oh = findCourseLine(oldId)
    if (oh && oh.line.placed > 0) oh.line.placed--
  }
  const short = subj.course_name.split('/')[0] ?? subj.course_name
  ps.value.course.main_grid_meta[key] = pick
  ps.value.course.main_grid[key] = `${short}\n${line.label}·${line.teacher}`
  if (oldId !== pick) line.placed++
}

function findClassCard(id: string) {
  return ps.value.class.cards.find((c) => c.id === id)
}

function onClassCell(day: number, period: number) {
  const key = gridKey(day, period)
  const pick = ps.value.class.picked_card_id
  if (!pick) {
    const oldId = ps.value.class.main_grid_meta[key]
    if (oldId) {
      const oc = findClassCard(oldId)
      if (oc && oc.placed > 0) oc.placed--
      delete ps.value.class.main_grid_meta[key]
      delete ps.value.class.main_grid[key]
    }
    return
  }
  const card = findClassCard(pick)
  if (!card) return
  if (card.placed >= card.total) {
    ElMessage.warning('该课程课时已满')
    return
  }
  const oldId = ps.value.class.main_grid_meta[key]
  if (oldId && oldId !== pick) {
    const oc = findClassCard(oldId)
    if (oc && oc.placed > 0) oc.placed--
  }
  ps.value.class.main_grid_meta[key] = pick
  const short = card.course_name.split('/')[0] ?? card.course_name
  ps.value.class.main_grid[key] = `${short}\n${card.teacher}`
  if (oldId !== pick) card.placed++
}

function clearCurrentPreGrid() {
  if (ps.value.subtab === 'course') {
    for (const key of Object.keys(ps.value.course.main_grid_meta)) {
      const id = ps.value.course.main_grid_meta[key]
      const hit = id ? findCourseLine(id) : null
      if (hit && hit.line.placed > 0) hit.line.placed--
    }
    ps.value.course.main_grid = {}
    ps.value.course.main_grid_meta = {}
    ps.value.course.selected_class_ids = []
    ElMessage.success('已清除课程预排')
  } else if (ps.value.subtab === 'class') {
    for (const key of Object.keys(ps.value.class.main_grid_meta)) {
      const id = ps.value.class.main_grid_meta[key]
      const c = id ? findClassCard(id) : undefined
      if (c && c.placed > 0) c.placed--
    }
    ps.value.class.main_grid = {}
    ps.value.class.main_grid_meta = {}
    ps.value.class.picked_card_id = ''
    ElMessage.success('已清除班级预排')
  }
}
</script>

<style scoped>
.ips {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.ips-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-shrink: 0;
}
.ips-toolbar-spacer {
  flex: 1;
}
.ips-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.ips-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-top: 8px;
}
.ips-mr-alert {
  margin-bottom: 12px;
}
.ips-mr-body {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.ips-mr-grades {
  width: 140px;
  flex-shrink: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 10px;
  background: #fafafa;
}
.ips-mr-grades-hd {
  font-weight: 600;
  margin-bottom: 8px;
  font-size: 13px;
}
.ips-mr-glist {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.ips-mr-glist :deep(.el-checkbox) {
  margin-right: 0;
  height: auto;
}
.ips-mr-grid-wrap {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
.ips-mr-table {
  width: 100%;
}
.ips-split {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.ips-side {
  width: 260px;
  flex-shrink: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 10px;
  background: #fff;
}
.ips-side--course {
  width: 280px;
}
.ips-mb {
  margin-bottom: 8px;
}
.ips-check-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ips-check-line {
  margin: 0;
  height: auto;
  align-items: flex-start;
  white-space: normal;
}
.ips-ratio {
  color: var(--el-color-primary);
  font-weight: 500;
  margin-left: 4px;
}
.ips-center {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 10px;
  background: #fff;
}
.ips-center-hd {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 10px;
}
.ips-title {
  font-weight: 600;
  font-size: 15px;
}
.ips-switch-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
.ips-switch-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.ips-refs {
  width: 200px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ips-ref-block {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 8px;
  background: #fafafa;
}
.ips-ref-title {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--el-text-color-secondary);
}
.ips-filters {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
}
.ips-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ips-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 13px;
  transition: border-color 0.15s, background 0.15s;
}
.ips-card:hover {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}
.ips-card--on {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.ips-card-name {
  font-weight: 600;
}
.ips-card-sub {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-top: 4px;
}
.ips-card-ratio {
  margin-top: 6px;
  color: var(--el-color-primary);
  font-weight: 500;
}
.ips-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin: 0 0 8px;
}
@media (max-width: 1280px) {
  .ips-split {
    flex-direction: column;
  }
  .ips-side,
  .ips-side--course,
  .ips-refs {
    width: 100%;
  }
  .ips-refs {
    flex-direction: row;
  }
  .ips-ref-block {
    flex: 1;
  }
}
</style>
