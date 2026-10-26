<template>
  <div class="as" v-loading="loading">
    <el-card shadow="never" class="as-card as-head-card">
      <div class="as-head">
        <div>
          <div class="as-title">坐席排班</div>
          <div class="as-sub">三班倒自动排班 · 请假 / 手工调整 · 工时薪资统计（账户级共享）</div>
        </div>
        <div class="as-actions">
          <el-button @click="leaveDlg = true">请假管理</el-button>
          <el-button @click="copyBoard">复制排班</el-button>
          <el-button @click="downloadCsv">导出 CSV</el-button>
          <el-button type="primary" :loading="saving" @click="regen">重新生成</el-button>
        </div>
      </div>
    </el-card>

    <div class="as-layout">
      <aside class="as-side">
        <el-card shadow="never" class="as-card">
          <template #header>排班设置</template>
          <el-form label-position="top" size="small" @submit.prevent>
            <el-form-item label="班次节律">
              <el-select v-model="form.rhythm" style="width: 100%" @change="onRhythm">
                <el-option label="三班两倒（早中夜休）" value="3-2" />
                <el-option label="四班三倒（早中夜休休休）" value="4-3" />
                <el-option label="三班三倒（8天）" value="3-3-8" />
                <el-option label="自定义" value="custom" />
              </el-select>
            </el-form-item>
            <el-form-item label="自定义序列">
              <div class="as-seq">
                <el-tag
                  v-for="(s, i) in form.sequence"
                  :key="`${s}-${i}`"
                  :type="tagType(s)"
                  class="as-seq-tag"
                  closable
                  @close="removeSeq(i)"
                >
                  {{ shiftLabel(s) }}
                </el-tag>
              </div>
              <div class="as-seq-add">
                <el-button size="small" @click="addSeq('day')">+早</el-button>
                <el-button size="small" @click="addSeq('mid')">+中</el-button>
                <el-button size="small" @click="addSeq('night')">+夜</el-button>
                <el-button size="small" @click="addSeq('off')">+休</el-button>
              </div>
            </el-form-item>
            <el-form-item label="开始日期">
              <el-date-picker
                v-model="form.start_date"
                type="date"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </el-form-item>
            <el-form-item label="天数">
              <el-select v-model="form.duration" style="width: 100%">
                <el-option :value="14" label="14 天" />
                <el-option :value="30" label="30 天" />
                <el-option :value="60" label="60 天" />
              </el-select>
            </el-form-item>
            <el-form-item label="每班需求人数">
              <el-input-number v-model="form.need_per_shift" :min="1" :max="50" style="width: 100%" />
            </el-form-item>
            <el-form-item label="早 / 中 / 夜时段">
              <el-input v-model="form.time_day" placeholder="早" class="as-mb" />
              <el-input v-model="form.time_mid" placeholder="中" class="as-mb" />
              <el-input v-model="form.time_night" placeholder="夜" />
            </el-form-item>
            <el-button type="primary" style="width: 100%" :loading="saving" @click="saveSettings">
              保存设置
            </el-button>
            <el-button style="width: 100%; margin-top: 8px; margin-left: 0" @click="clearManuals">
              恢复自动（清手工）
            </el-button>
          </el-form>
        </el-card>

        <el-card shadow="never" class="as-card">
          <template #header>人员编制</template>
          <div class="as-staff-add">
            <el-input
              v-model="staffName"
              placeholder="姓名，回车添加"
              size="small"
              @keyup.enter="onAddStaff"
            />
            <el-button type="primary" size="small" @click="onAddStaff">添加</el-button>
          </div>
          <div class="as-chips">
            <el-tag
              v-for="s in payload?.staff || []"
              :key="s.id"
              closable
              class="as-chip"
              @close="onRemoveStaff(s.id)"
            >
              {{ s.name }}
            </el-tag>
            <el-empty v-if="!(payload?.staff || []).length" description="暂无坐席" :image-size="40" />
          </div>
        </el-card>

        <el-card shadow="never" class="as-card">
          <template #header>工时 / 薪资</template>
          <el-form label-position="top" size="small">
            <el-form-item label="每班工时(h)">
              <el-input-number v-model="form.hours_per_shift" :min="1" :step="0.5" style="width: 100%" />
            </el-form-item>
            <el-form-item label="时薪(元/h)">
              <el-input-number v-model="form.hourly_rate" :min="0" style="width: 100%" />
            </el-form-item>
            <el-form-item label="夜班补贴(元/天)">
              <el-input-number v-model="form.night_bonus" :min="0" style="width: 100%" />
            </el-form-item>
          </el-form>
        </el-card>

        <el-card shadow="never" class="as-card">
          <template #header>节假日 / 备注日</template>
          <el-button style="width: 100%; margin-bottom: 8px" @click="onFillHolidays">
            填充 2026 法定节假日
          </el-button>
          <el-date-picker
            v-model="noteDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="日期"
            size="small"
            style="width: 100%; margin-bottom: 8px"
          />
          <el-input v-model="noteText" size="small" placeholder="备注" class="as-mb" />
          <el-button type="primary" size="small" style="width: 100%" @click="onAddNote">添加备注</el-button>
          <ul class="as-notes">
            <li v-for="(text, d) in payload?.notes || {}" :key="d">
              <span><b>{{ String(d).slice(5) }}</b> {{ text }}</span>
              <el-button link type="danger" size="small" @click="onDelNote(String(d))">删</el-button>
            </li>
          </ul>
        </el-card>
      </aside>

      <section class="as-main">
        <el-card shadow="never" class="as-card">
          <template #header>
            <div class="as-table-head">
              <span>排班表</span>
              <span class="as-legend">
                <i class="c-day" />早 <i class="c-mid" />中 <i class="c-night" />夜
                <i class="c-off" />休 <i class="c-leave" />假 · 绿点=手工 · 红框=连续≥7天
              </span>
            </div>
          </template>
          <div class="as-table-wrap">
            <table class="as-table" v-if="payload">
              <thead>
                <tr>
                  <th class="sticky-name">坐席</th>
                  <th
                    v-for="d in payload.dates"
                    :key="d"
                    :class="{ weekend: isWeekend(d), today: d === today }"
                  >
                    <div>{{ fmtMd(d) }}<span v-if="d === today" class="dot" /></div>
                    <div>
                      {{ weekLabel(d) }}
                      <span v-if="payload.notes[d]" class="hol" :title="payload.notes[d]">●</span>
                    </div>
                  </th>
                  <th class="sticky-total">合计</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in payload.grid" :key="row.name">
                  <td class="sticky-name">{{ row.name }}</td>
                  <td v-for="c in row.cells" :key="c.date">
                    <button
                      type="button"
                      class="shift"
                      :class="[c.shift, { manual: c.manual, warn: c.warn }]"
                      :title="shiftLabel(c.shift)"
                      @click="onCycle(row.name, c.date)"
                    >
                      {{ shiftLabel(c.shift) }}
                    </button>
                  </td>
                  <td class="sticky-total">{{ row.work_count }}</td>
                </tr>
                <tr class="as-daily">
                  <td class="sticky-name">在岗统计</td>
                  <td v-for="d in payload.daily" :key="d.date" class="daily-cell">
                    <div :class="needClass(d.day)">早 {{ d.day }}/{{ payload.board.need_per_shift }}</div>
                    <div :class="needClass(d.mid)">中 {{ d.mid }}/{{ payload.board.need_per_shift }}</div>
                    <div :class="needClass(d.night)">夜 {{ d.night }}/{{ payload.board.need_per_shift }}</div>
                  </td>
                  <td class="sticky-total">—</td>
                </tr>
              </tbody>
            </table>
            <el-empty v-else description="暂无排班数据" />
          </div>
        </el-card>

        <el-card shadow="never" class="as-card">
          <template #header>统计概览</template>
          <div class="as-stats" v-if="payload">
            <div class="as-stat">
              <div class="k">坐席人数</div>
              <div class="v">{{ payload.stats.staff_count }}</div>
            </div>
            <div class="as-stat">
              <div class="k">总工时(h)</div>
              <div class="v">{{ payload.stats.total_hours }}</div>
            </div>
            <div class="as-stat">
              <div class="k">夜班补贴(元)</div>
              <div class="v">{{ payload.stats.night_bonus_total }}</div>
            </div>
            <div class="as-stat">
              <div class="k">预估薪资(元)</div>
              <div class="v">{{ payload.stats.estimated_pay }}</div>
            </div>
          </div>
          <div class="as-charts" v-if="payload">
            <div class="as-chart">
              <div class="as-chart-t">班次分布</div>
              <div class="gantt" v-html="ganttSvg" />
            </div>
            <div class="as-chart">
              <div class="as-chart-t">每日在岗（早+中+夜）</div>
              <div class="line" v-html="lineSvg" />
            </div>
          </div>
        </el-card>
      </section>
    </div>

    <el-dialog v-model="leaveDlg" title="请假管理" width="520px">
      <el-form label-width="72px" size="small">
        <el-form-item label="坐席">
          <el-select v-model="leaveForm.staff_name" style="width: 100%">
            <el-option v-for="s in payload?.staff || []" :key="s.id" :label="s.name" :value="s.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="区间">
          <el-date-picker
            v-model="leaveRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始"
            end-placeholder="结束"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="leaveForm.type" style="width: 100%">
            <el-option label="请假" value="leave" />
            <el-option label="调休" value="offreq" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="leaveDlg = false">关闭</el-button>
        <el-button type="primary" @click="onAddLeave">保存</el-button>
      </template>
      <el-table :data="payload?.leaves || []" size="small" border stripe empty-text="暂无请假">
        <el-table-column prop="staff_name" label="坐席" width="100" />
        <el-table-column label="区间" min-width="180">
          <template #default="{ row }">{{ row.from_date }} ~ {{ row.to_date }}</template>
        </el-table-column>
        <el-table-column label="类型" width="72">
          <template #default="{ row }">{{ row.type === 'leave' ? '请假' : '调休' }}</template>
        </el-table-column>
        <el-table-column label="" width="64">
          <template #default="{ row }">
            <el-button link type="danger" size="small" @click="onRemoveLeave(row.id)">删</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '@/api/client'
import {
  fetchShiftBoard,
  patchShiftBoard,
  addShiftStaff,
  removeShiftStaff,
  addShiftLeave,
  removeShiftLeave,
  cycleShiftCell,
  upsertShiftNote,
  deleteShiftNote,
  fillShiftHolidays2026,
  type ShiftBoardPayload,
  type ShiftCode,
} from '@/api/agentShifts'

const PRESETS: Record<string, ShiftCode[]> = {
  '3-2': ['day', 'mid', 'night', 'off'],
  '4-3': ['day', 'mid', 'night', 'off', 'off', 'off'],
  '3-3-8': ['day', 'mid', 'night', 'off', 'day', 'mid', 'night', 'off'],
}

const loading = ref(false)
const saving = ref(false)
const payload = ref<ShiftBoardPayload | null>(null)
const staffName = ref('')
const noteDate = ref('')
const noteText = ref('')
const leaveDlg = ref(false)
const leaveRange = ref<[string, string] | null>(null)
const leaveForm = reactive({ staff_name: '', type: 'leave' })

const form = reactive({
  rhythm: '3-2',
  sequence: [...PRESETS['3-2']] as ShiftCode[],
  start_date: '',
  duration: 30,
  need_per_shift: 2,
  time_day: '08:00-16:00',
  time_mid: '16:00-00:00',
  time_night: '00:00-08:00',
  hours_per_shift: 8,
  hourly_rate: 30,
  night_bonus: 50,
})

const today = new Date().toISOString().slice(0, 10)
const WEEK = ['日', '一', '二', '三', '四', '五', '六']

function shiftLabel(s: string) {
  return ({ day: '早', mid: '中', night: '夜', off: '休', leave: '假' } as Record<string, string>)[s] || s
}
function tagType(s: string) {
  if (s === 'day') return 'primary'
  if (s === 'mid') return 'warning'
  if (s === 'night') return 'success'
  return 'info'
}
function fmtMd(d: string) {
  const [, m, day] = d.split('-')
  return `${Number(m)}/${Number(day)}`
}
function weekLabel(d: string) {
  return WEEK[new Date(d + 'T00:00:00').getDay()]
}
function isWeekend(d: string) {
  const w = new Date(d + 'T00:00:00').getDay()
  return w === 0 || w === 6
}
function needClass(n: number) {
  const need = payload.value?.board.need_per_shift ?? 2
  if (n === need) return 'ok'
  if (n < need) return 'warn'
  return 'bad'
}

function applyPayload(data: ShiftBoardPayload) {
  payload.value = data
  form.rhythm = data.board.rhythm
  form.sequence = [...data.board.sequence]
  form.start_date = data.board.start_date
  form.duration = data.board.duration
  form.need_per_shift = data.board.need_per_shift
  form.time_day = data.board.time_day
  form.time_mid = data.board.time_mid
  form.time_night = data.board.time_night
  form.hours_per_shift = data.board.hours_per_shift
  form.hourly_rate = data.board.hourly_rate
  form.night_bonus = data.board.night_bonus
  if (!leaveForm.staff_name && data.staff[0]) leaveForm.staff_name = data.staff[0].name
}

async function reload() {
  loading.value = true
  try {
    applyPayload(await fetchShiftBoard())
  } catch {
    ElMessage.error('加载排班失败')
  } finally {
    loading.value = false
  }
}

function onRhythm(v: string) {
  if (PRESETS[v]) form.sequence = [...PRESETS[v]]
}
function addSeq(s: ShiftCode) {
  form.sequence.push(s)
  form.rhythm = 'custom'
}
function removeSeq(i: number) {
  form.sequence.splice(i, 1)
  if (!form.sequence.length) form.sequence = ['day']
  form.rhythm = 'custom'
}

async function saveSettings() {
  saving.value = true
  try {
    applyPayload(
      await patchShiftBoard({
        rhythm: form.rhythm,
        sequence: form.sequence,
        start_date: form.start_date,
        duration: form.duration,
        need_per_shift: form.need_per_shift,
        time_day: form.time_day,
        time_mid: form.time_mid,
        time_night: form.time_night,
        hours_per_shift: form.hours_per_shift,
        hourly_rate: form.hourly_rate,
        night_bonus: form.night_bonus,
      }),
    )
    ElMessage.success('设置已保存')
  } catch {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

async function regen() {
  saving.value = true
  try {
    applyPayload(
      await patchShiftBoard({
        rhythm: form.rhythm,
        sequence: form.sequence,
        start_date: form.start_date,
        duration: form.duration,
        need_per_shift: form.need_per_shift,
        clear_manuals: true,
      }),
    )
    ElMessage.success('已重新生成')
  } catch {
    ElMessage.error('生成失败')
  } finally {
    saving.value = false
  }
}

async function clearManuals() {
  try {
    applyPayload(await patchShiftBoard({ clear_manuals: true }))
    ElMessage.success('已清除手工调整')
  } catch {
    ElMessage.error('操作失败')
  }
}

async function onAddStaff() {
  const name = staffName.value.trim()
  if (!name) return
  try {
    applyPayload(await addShiftStaff(name))
    staffName.value = ''
  } catch {
    ElMessage.error('添加失败（可能重名）')
  }
}

async function onRemoveStaff(id: number) {
  try {
    applyPayload(await removeShiftStaff(id))
  } catch {
    ElMessage.error('删除失败')
  }
}

async function onCycle(name: string, date: string) {
  try {
    applyPayload(await cycleShiftCell(name, date))
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
    ElMessage.error(msg === 'on_leave' ? '该日已请假' : '调整失败')
  }
}

async function onAddLeave() {
  if (!leaveForm.staff_name || !leaveRange.value) {
    ElMessage.warning('请填写坐席与日期区间')
    return
  }
  try {
    applyPayload(
      await addShiftLeave({
        staff_name: leaveForm.staff_name,
        from_date: leaveRange.value[0],
        to_date: leaveRange.value[1],
        type: leaveForm.type,
      }),
    )
    ElMessage.success('请假已保存')
  } catch {
    ElMessage.error('保存失败')
  }
}

async function onRemoveLeave(id: number) {
  try {
    applyPayload(await removeShiftLeave(id))
  } catch {
    ElMessage.error('删除失败')
  }
}

async function onFillHolidays() {
  try {
    applyPayload(await fillShiftHolidays2026())
    ElMessage.success('已填充 2026 节假日')
  } catch {
    ElMessage.error('填充失败')
  }
}

async function onAddNote() {
  if (!noteDate.value || !noteText.value.trim()) {
    ElMessage.warning('请填写日期与备注')
    return
  }
  try {
    applyPayload(await upsertShiftNote(noteDate.value, noteText.value))
    noteText.value = ''
  } catch {
    ElMessage.error('添加失败')
  }
}

async function onDelNote(date: string) {
  try {
    applyPayload(await deleteShiftNote(date))
  } catch {
    ElMessage.error('删除失败')
  }
}

async function copyBoard() {
  if (!payload.value) return
  const lines = payload.value.grid.map((g) => {
    const seq = g.cells.map((c) => shiftLabel(c.shift)).join('')
    return `${g.name}\t${seq}`
  })
  const text = `排班 ${payload.value.board.start_date} 起 ${payload.value.board.duration} 天\n${lines.join('\n')}`
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制')
  } catch {
    ElMessage.info(text)
  }
}

async function downloadCsv() {
  try {
    const { data } = await api.get('/api/agent-shifts/export.csv', { responseType: 'blob' })
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = `坐席排班_${payload.value?.board.start_date || 'export'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    ElMessage.error('导出失败')
  }
}

const ganttSvg = computed(() => {
  const p = payload.value
  if (!p) return ''
  const colors: Record<string, string> = {
    day: '#3b82f6',
    mid: '#f59e0b',
    night: '#8b5cf6',
    off: '#cbd5e1',
    leave: '#ef4444',
  }
  const W = Math.max(360, p.dates.length * 10 + 80)
  const rowH = 20
  const H = p.grid.length * rowH + 8
  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`
  p.grid.forEach((row, si) => {
    const y = si * rowH + 2
    svg += `<text x="0" y="${y + 12}" font-size="11" fill="#64748b">${row.name}</text>`
    row.cells.forEach((c, di) => {
      svg += `<rect x="${70 + di * 10}" y="${y}" width="9" height="14" rx="2" fill="${colors[c.shift]}"/>`
    })
  })
  return svg + '</svg>'
})

const lineSvg = computed(() => {
  const p = payload.value
  if (!p?.daily.length) return ''
  const values = p.daily.map((d) => d.day + d.mid + d.night)
  const W = Math.max(360, values.length * 12 + 40)
  const H = 140
  const max = Math.max(1, ...values)
  const peak = Math.max(...values)
  const pts = values.map((v, i) => {
    const x = 24 + (i * (W - 40)) / Math.max(1, values.length - 1)
    const y = H - 16 - (v / max) * (H - 36)
    return [x, y, v] as const
  })
  const path = pts.map((pt, i) => `${i ? 'L' : 'M'}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ')
  const area = `${path} L${pts[pts.length - 1][0]},${H - 16} L${pts[0][0]},${H - 16} Z`
  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`
  svg += `<path d="${area}" fill="rgba(37,99,235,.15)"/>`
  svg += `<path d="${path}" fill="none" stroke="#2563eb" stroke-width="2"/>`
  pts.forEach((pt) => {
    const peakPt = pt[2] === peak
    svg += `<circle cx="${pt[0]}" cy="${pt[1]}" r="${peakPt ? 4 : 2.5}" fill="${peakPt ? '#dc2626' : '#2563eb'}"/>`
  })
  return svg + '</svg>'
})

onMounted(reload)
</script>

<style scoped>
.as { width: 100%; }
.as-card { margin-bottom: 12px; }
.as-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap;
}
.as-title { font-size: 18px; font-weight: 700; }
.as-sub { font-size: 12px; color: #909399; margin-top: 4px; }
.as-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.as-layout {
  display: grid; grid-template-columns: 280px 1fr; gap: 12px; align-items: start;
}
@media (max-width: 1100px) {
  .as-layout { grid-template-columns: 1fr; }
}
.as-side { display: flex; flex-direction: column; gap: 0; }
.as-mb { margin-bottom: 6px; }
.as-seq { display: flex; flex-wrap: wrap; gap: 4px; min-height: 28px; }
.as-seq-tag { margin: 0; }
.as-seq-add { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
.as-staff-add { display: flex; gap: 6px; margin-bottom: 8px; }
.as-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.as-chip { margin: 0; }
.as-notes { list-style: none; padding: 0; margin: 8px 0 0; font-size: 12px; color: #606266; }
.as-notes li { display: flex; justify-content: space-between; gap: 8px; margin: 4px 0; }
.as-table-head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; width: 100%; }
.as-legend { font-size: 12px; color: #909399; display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.as-legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.c-day { background: #3b82f6; }
.c-mid { background: #f59e0b; }
.c-night { background: #8b5cf6; }
.c-off { background: #94a3b8; }
.c-leave { background: #ef4444; }
.as-table-wrap { overflow: auto; max-height: calc(100vh - 280px); }
.as-table {
  border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%;
  font-size: 12px;
}
.as-table th, .as-table td {
  border-bottom: 1px solid #ebeef5; border-right: 1px solid #f2f6fc;
  padding: 4px; text-align: center; white-space: nowrap;
}
.as-table th { position: sticky; top: 0; background: #f5f7fa; z-index: 2; }
.sticky-name {
  position: sticky; left: 0; z-index: 3; background: #f5f7fa; text-align: left !important;
  min-width: 72px; font-weight: 600;
}
.sticky-total { position: sticky; right: 0; z-index: 3; background: #f5f7fa; min-width: 48px; }
.weekend { color: #dc2626; background: #fef2f2 !important; }
.today { background: #fef3c7 !important; }
.dot {
  display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  background: #dc2626; margin-left: 3px; vertical-align: middle;
}
.hol { color: #b45309; font-weight: 700; }
.shift {
  border: none; min-width: 34px; height: 26px; border-radius: 8px; color: #fff;
  font-weight: 600; cursor: pointer; position: relative;
}
.shift.day { background: #3b82f6; }
.shift.mid { background: #f59e0b; }
.shift.night { background: #8b5cf6; }
.shift.off { background: #94a3b8; }
.shift.leave { background: #ef4444; }
.shift.manual::after {
  content: ''; position: absolute; right: 2px; top: 2px;
  width: 7px; height: 7px; border-radius: 50%; background: #22c55e; border: 1px solid #fff;
}
.shift.warn { outline: 2px solid #ef4444; outline-offset: -1px; }
.daily-cell { font-size: 11px; line-height: 1.25; }
.ok { color: #059669; font-weight: 600; }
.warn { color: #d97706; font-weight: 600; }
.bad { color: #dc2626; font-weight: 600; }
.as-stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 12px;
}
.as-stat {
  padding: 12px; border-radius: 10px; background: #f8fafc; border: 1px solid #ebeef5;
}
.as-stat .k { font-size: 12px; color: #909399; }
.as-stat .v { font-size: 20px; font-weight: 700; color: var(--oa-primary, #0066b3); margin-top: 4px; }
.as-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 1100px) {
  .as-charts, .as-stats { grid-template-columns: 1fr; }
}
.as-chart {
  border: 1px solid #ebeef5; border-radius: 10px; padding: 10px; overflow: auto; background: #fff;
}
.as-chart-t { font-size: 12px; color: #909399; margin-bottom: 6px; }
</style>
