<template>
  <div class="srg">
    <table class="srg-table" border="0" cellspacing="0" cellpadding="0">
      <thead>
        <tr>
          <th class="srg-corner">节次</th>
          <th v-for="(dn, di) in dayNames" :key="di" class="srg-th">{{ dn }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(row, ri) in periodLayout" :key="rowKey(row, ri)">
          <tr v-if="row.kind === 'break'" class="srg-tr-break">
            <td class="srg-td-break" :colspan="dayNames.length + 1">{{ row.label }}</td>
          </tr>
          <tr v-else class="srg-tr-p">
            <td class="srg-td-idx">
              <div class="srg-idx-n">{{ row.period_no }}</div>
              <div v-if="row.time_range" class="srg-idx-t">{{ row.time_range }}</div>
            </td>
            <td
              v-for="(_dn, d) in dayNames"
              :key="d"
              class="srg-td"
              :style="cellStyle(d, row.period_no)"
            >
              <div class="srg-cell">
                <template v-for="(line, li) in formatLines(d, row.period_no)" :key="li">
                  <div :class="li === 0 ? 'srg-l1' : 'srg-l2'">{{ line }}</div>
                </template>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import type {
  ScheduleResultCell,
  ScheduleResultClassViewDisplay,
  ScheduleResultPeriodRow,
  ScheduleResultTeacherViewDisplay,
} from '@/api/intelligentScheduling'

function rowKey(row: ScheduleResultPeriodRow, ri: number) {
  if (row.kind === 'break') return 'b-' + ri
  return 'p-' + row.period_no + '-' + ri
}

const props = defineProps<{
  dayNames: string[]
  periodLayout: ScheduleResultPeriodRow[]
  cells: Record<string, ScheduleResultCell | undefined>
  mode: 'class' | 'teacher' | 'room'
  classDisplay: ScheduleResultClassViewDisplay
  teacherDisplay: ScheduleResultTeacherViewDisplay
}>()

function key(day: number, period: number) {
  return `d${day}-p${period}`
}

function cellAt(day: number, period: number): ScheduleResultCell | undefined {
  return props.cells[key(day, period)]
}

function cellStyle(day: number, period: number): Record<string, string> {
  const c = cellAt(day, period)
  if (!c) return {}
  if (props.mode === 'class' && !props.classDisplay.course_distinction) return {}
  if (props.mode === 'teacher' && !props.teacherDisplay.class_course_distinction) return {}
  if (props.mode === 'room' && !props.classDisplay.course_distinction) return {}
  if (c.color_bg) return { backgroundColor: c.color_bg }
  return {}
}

function formatLines(day: number, period: number): string[] {
  const c = cellAt(day, period)
  if (!c) return []
  if (props.mode === 'class') {
    const subj = props.classDisplay.subject_short ? c.subject_short : c.subject
    const lines: string[] = [subj]
    if (props.classDisplay.show_teacher && c.teacher_name) {
      lines.push(c.teacher_name)
    }
    if (props.classDisplay.show_room && c.room_label) {
      lines.push(c.room_label)
    }
    return lines.filter(Boolean)
  }
  if (props.mode === 'teacher') {
    const lines: string[] = []
    if (c.class_name) lines.push(c.class_name)
    if (props.teacherDisplay.show_subject && c.subject) {
      lines.push(c.subject)
    }
    if (props.teacherDisplay.show_room && c.room_label) {
      lines.push(c.room_label)
    }
    if (c.cell_kind === 'research') return [c.subject]
    return lines.filter(Boolean)
  }
  // room
  const lines: string[] = []
  if (c.class_name) lines.push(c.class_name)
  const pair = `${props.classDisplay.subject_short ? c.subject_short : c.subject}-${c.teacher_name}`
  if (c.subject || c.teacher_name) lines.push(pair)
  return lines.filter(Boolean)
}
</script>

<style scoped>
.srg-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.srg-corner,
.srg-th {
  border: 1px solid var(--el-border-color-lighter);
  background: #fafafa;
  padding: 6px 4px;
  text-align: center;
  font-weight: 600;
}
.srg-corner {
  width: 88px;
}
.srg-td-idx {
  border: 1px solid var(--el-border-color-lighter);
  background: #fafafa;
  padding: 4px 6px;
  text-align: center;
  vertical-align: middle;
}
.srg-idx-n {
  font-weight: 600;
}
.srg-idx-t {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
  white-space: nowrap;
}
.srg-td-break {
  border: 1px solid var(--el-border-color-lighter);
  background: #f0f2f5;
  text-align: center;
  padding: 4px;
  color: var(--el-text-color-secondary);
}
.srg-td {
  border: 1px solid var(--el-border-color-lighter);
  padding: 3px;
  vertical-align: top;
  min-width: 76px;
}
.srg-cell {
  min-height: 40px;
  line-height: 1.3;
  word-break: break-all;
}
.srg-l1 {
  font-weight: 600;
}
.srg-l2 {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}
</style>
