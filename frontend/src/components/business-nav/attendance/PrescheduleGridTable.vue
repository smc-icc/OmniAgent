<template>
  <div class="pgt" :class="{ 'pgt--compact': compact }">
    <table class="pgt-table" border="0" cellspacing="0" cellpadding="0">
      <thead>
        <tr>
          <th class="pgt-corner">节次</th>
          <th v-for="(dn, di) in dayNames" :key="di" class="pgt-th">{{ dn }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(row, ri) in layout">
          <tr v-if="row.kind === 'break'" :key="'b-' + ri" class="pgt-tr-break">
            <td :colspan="6" class="pgt-td-break">{{ row.label }}</td>
          </tr>
          <tr v-else :key="'p-' + row.n + '-' + ri" class="pgt-tr-p">
            <td class="pgt-td-idx">第{{ row.n }}节</td>
            <td
              v-for="d in 5"
              :key="d"
              class="pgt-td"
              :class="{ 'pgt-td--ro': readonly }"
              @click="emitClick(d - 1, row.n)"
            >
              <div class="pgt-cell">{{ cells[cellKey(d - 1, row.n)] || '' }}</div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
const dayNames = ['周一', '周二', '周三', '周四', '周五']

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

defineProps<{
  cells: Record<string, string>
  readonly?: boolean
  compact?: boolean
}>()

const emit = defineEmits<{
  cellClick: [day: number, period: number]
}>()

function cellKey(day: number, period: number) {
  return `d${day}-p${period}`
}

function emitClick(day: number, period: number) {
  emit('cellClick', day, period)
}
</script>

<style scoped>
.pgt-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.pgt--compact .pgt-table {
  font-size: 11px;
}
.pgt-corner,
.pgt-th {
  border: 1px solid var(--el-border-color-lighter);
  background: #fafafa;
  padding: 6px 4px;
  text-align: center;
  font-weight: 600;
}
.pgt-corner {
  width: 56px;
}
.pgt-td-idx {
  border: 1px solid var(--el-border-color-lighter);
  background: #fafafa;
  padding: 4px;
  text-align: center;
  white-space: nowrap;
}
.pgt-td-break {
  border: 1px solid var(--el-border-color-lighter);
  background: #f0f2f5;
  text-align: center;
  padding: 4px;
  color: var(--el-text-color-secondary);
}
.pgt-td {
  border: 1px solid var(--el-border-color-lighter);
  padding: 2px;
  vertical-align: middle;
  min-width: 72px;
  cursor: pointer;
}
.pgt-td--ro {
  cursor: default;
}
.pgt-cell {
  min-height: 36px;
  padding: 4px;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.25;
}
.pgt--compact .pgt-cell {
  min-height: 28px;
  padding: 2px;
  font-size: 10px;
}
.pgt-td:not(.pgt-td--ro):hover .pgt-cell {
  background: var(--el-color-primary-light-9);
}
</style>
