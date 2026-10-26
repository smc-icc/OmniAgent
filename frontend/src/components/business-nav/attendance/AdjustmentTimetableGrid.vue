<template>
  <div class="atg" :class="{ 'atg--compact': compact }">
    <table class="atg-table" border="0" cellspacing="0" cellpadding="0">
      <thead>
        <tr>
          <th class="atg-corner">节次</th>
          <th v-for="(dn, di) in dayNames" :key="di" class="atg-th">{{ dn }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(row, ri) in layout" :key="row.kind === 'break' ? 'b-' + ri : 'p-' + row.n + '-' + ri">
          <tr v-if="row.kind === 'break'" class="atg-tr-break">
            <td class="atg-td-break" :colspan="dayNames.length + 1">{{ row.label }}</td>
          </tr>
          <tr v-else class="atg-tr-p">
            <td class="atg-td-idx">第{{ row.n }}节</td>
            <td
              v-for="(_dn, d) in dayNames"
              :key="d"
              class="atg-td"
              :class="tdClass(d, row.n)"
              @click="emitClick(d, row.n)"
            >
              <div class="atg-cell">
                <template v-if="cellAt(d, row.n)">
                  <div class="atg-l1">{{ cellAt(d, row.n)!.line1 }}</div>
                  <div v-if="cellAt(d, row.n)!.line2" class="atg-l2">{{ cellAt(d, row.n)!.line2 }}</div>
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
import type { AdjustmentCell } from '@/api/intelligentScheduling'

type RowDef = { kind: 'lesson'; n: number } | { kind: 'break'; label: string }

const layout: RowDef[] = [
  { kind: 'lesson', n: 1 },
  { kind: 'lesson', n: 2 },
  { kind: 'break', label: '大课间' },
  { kind: 'lesson', n: 3 },
  { kind: 'lesson', n: 4 },
  { kind: 'lesson', n: 5 },
  { kind: 'break', label: '午休' },
  { kind: 'lesson', n: 6 },
  { kind: 'lesson', n: 7 },
  { kind: 'lesson', n: 8 },
  { kind: 'lesson', n: 9 },
]

const props = withDefaults(
  defineProps<{
    dayNames?: string[]
    cells: Record<string, AdjustmentCell | undefined>
    /** 对调：已选第一节 */
    pendingLessonId?: string | null
    readonly?: boolean
    compact?: boolean
  }>(),
  {
    dayNames: () => ['周一', '周二', '周三', '周四', '周五'],
    pendingLessonId: null,
    readonly: false,
    compact: false,
  },
)

const emit = defineEmits<{
  cellClick: [day: number, period: number, cell: AdjustmentCell | null]
}>()

function key(day: number, period: number) {
  return `d${day}-p${period}`
}

function cellAt(day: number, period: number): AdjustmentCell | null {
  return props.cells[key(day, period)] ?? null
}

function tdClass(day: number, period: number) {
  const c = cellAt(day, period)
  const id = c?.lesson_id
  const pend = props.pendingLessonId
  return {
    'atg-td--ro': props.readonly,
    'atg-td--pending': Boolean(pend && id && id === pend),
    'atg-td--has': Boolean(c?.lesson_id),
  }
}

function emitClick(day: number, period: number) {
  if (props.readonly) return
  emit('cellClick', day, period, cellAt(day, period))
}
</script>

<style scoped>
.atg-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.atg--compact .atg-table {
  font-size: 11px;
}
.atg-corner,
.atg-th {
  border: 1px solid var(--el-border-color-lighter);
  background: #fafafa;
  padding: 6px 4px;
  text-align: center;
  font-weight: 600;
}
.atg-corner {
  width: 56px;
}
.atg-td-idx {
  border: 1px solid var(--el-border-color-lighter);
  background: #fafafa;
  padding: 4px;
  text-align: center;
  white-space: nowrap;
}
.atg-td-break {
  border: 1px solid var(--el-border-color-lighter);
  background: #f0f2f5;
  text-align: center;
  padding: 4px;
  color: var(--el-text-color-secondary);
}
.atg-td {
  border: 1px solid var(--el-border-color-lighter);
  padding: 2px;
  vertical-align: middle;
  min-width: 72px;
  cursor: pointer;
}
.atg-td--ro {
  cursor: default;
}
.atg-td--has:hover:not(.atg-td--ro) .atg-cell {
  background: var(--el-color-primary-light-9);
}
.atg-td--pending .atg-cell {
  outline: 2px dashed var(--el-color-danger);
  outline-offset: -1px;
  background: #fff7f7;
}
.atg-cell {
  min-height: 40px;
  padding: 4px;
  line-height: 1.25;
  word-break: break-all;
}
.atg--compact .atg-cell {
  min-height: 30px;
  padding: 2px;
}
.atg-l1 {
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.atg-l2 {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}
.atg--compact .atg-l2 {
  font-size: 10px;
}
</style>
