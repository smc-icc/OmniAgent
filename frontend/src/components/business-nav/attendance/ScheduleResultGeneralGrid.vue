<template>
  <div class="sgg-wrap">
    <table class="sgg-table" border="0" cellspacing="0" cellpadding="0">
      <thead>
        <tr>
          <th class="sgg-corner" rowspan="2">班级</th>
          <th
            v-for="(dn, d) in dayLabels"
            :key="'d1-' + d"
            class="sgg-th-day"
            :colspan="periods.length"
          >
            {{ dn }}
          </th>
        </tr>
        <tr>
          <template v-for="(_dn, d) in dayLabels" :key="'d2-' + d">
            <th v-for="p in periods" :key="d + '-' + p" class="sgg-th-p">{{ p }}</th>
          </template>
        </tr>
      </thead>
      <tbody>
        <tr v-for="cl in classes" :key="cl.id">
          <td class="sgg-td-class">{{ cl.name }}</td>
          <td
            v-for="meta in flatCells(cl.id)"
            :key="meta.k"
            class="sgg-td"
            :style="meta.bg ? { backgroundColor: meta.bg } : {}"
          >
            <div class="sgg-cell">
              <div v-if="meta.subj" class="sgg-l1">{{ meta.subj }}</div>
              <div v-if="meta.tch" class="sgg-l2">{{ meta.tch }}</div>
              <div v-if="meta.rm" class="sgg-l2">{{ meta.rm }}</div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import type { ScheduleResultCell, ScheduleResultGeneralViewDisplay } from '@/api/intelligentScheduling'

const props = defineProps<{
  dayLabels: string[]
  periods: number[]
  classes: { id: string; name: string }[]
  cells: Record<string, ScheduleResultCell | null | undefined>
  display: ScheduleResultGeneralViewDisplay
}>()

function flatCells(classId: string) {
  const out: { k: string; subj: string; tch: string; rm: string; bg: string }[] = []
  for (let d = 0; d < props.dayLabels.length; d++) {
    for (const p of props.periods) {
      const k = `${classId}_${d}_${p}`
      const c = props.cells[k]
      const subj = c ? c.subject : ''
      const tch = props.display.show_teacher && c?.teacher_name ? c.teacher_name : ''
      const rm = props.display.show_room && c?.room_label ? c.room_label : ''
      const bg = c?.color_bg ?? ''
      out.push({ k, subj, tch, rm, bg })
    }
  }
  return out
}
</script>

<style scoped>
.sgg-wrap {
  overflow: auto;
  max-width: 100%;
}
.sgg-table {
  border-collapse: collapse;
  font-size: 11px;
  min-width: 720px;
}
.sgg-corner,
.sgg-th-day,
.sgg-th-p {
  border: 1px solid var(--el-border-color-lighter);
  background: #f5f7fa;
  padding: 4px 2px;
  text-align: center;
  font-weight: 600;
}
.sgg-th-p {
  min-width: 56px;
  font-weight: 500;
}
.sgg-td-class {
  border: 1px solid var(--el-border-color-lighter);
  background: #fafafa;
  padding: 4px 8px;
  white-space: nowrap;
  position: sticky;
  left: 0;
  z-index: 1;
}
.sgg-td {
  border: 1px solid var(--el-border-color-lighter);
  padding: 2px;
  vertical-align: top;
}
.sgg-cell {
  min-height: 32px;
  line-height: 1.25;
}
.sgg-l1 {
  font-weight: 600;
}
.sgg-l2 {
  font-size: 10px;
  color: var(--el-text-color-secondary);
}
</style>
