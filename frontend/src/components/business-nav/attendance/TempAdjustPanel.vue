<template>
  <div class="tap">
    <template v-if="!createMode">
      <header class="tap-hd">
        <h2 class="tap-title">临时调代课</h2>
        <div class="tap-right">
          <el-select v-model="campusId" style="width: 240px" @change="loadAll">
            <el-option v-for="c in meta?.campuses ?? []" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
          <el-button type="primary" @click="settingsVisible = true">审批和通知设置</el-button>
        </div>
      </header>

      <el-tabs v-model="mainTab" class="tap-main-tabs">
        <el-tab-pane label="调代课记录" name="records" />
        <el-tab-pane label="调代课统计" name="stats" />
        <el-tab-pane label="管理员调代课" name="admin" />
      </el-tabs>

      <template v-if="mainTab === 'records' || mainTab === 'admin'">
        <div class="tap-filters">
          <el-input v-model="teacherQ" placeholder="教师姓名" clearable style="width: 160px" />
          <el-select v-model="status" style="width: 120px">
            <el-option v-for="s in meta?.status_options ?? []" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
          <el-select v-model="applyType" style="width: 120px">
            <el-option label="全部类型" value="all" />
            <el-option v-for="a in meta?.apply_type_options ?? []" :key="a.value" :label="a.label" :value="a.value" />
          </el-select>
          <el-button type="primary" @click="loadRecords">查询</el-button>
          <div class="tap-actions">
            <el-button type="primary" @click="openCreate('调课')">新增调课</el-button>
            <el-button @click="openCreate('代课')">新增代课</el-button>
          </div>
        </div>

        <el-table :data="records" border stripe size="small">
          <el-table-column prop="apply_type" label="变更类型" width="90" />
          <el-table-column prop="created_at" label="发起时间" width="170" />
          <el-table-column prop="applicant_name" label="发起人" width="100" />
          <el-table-column prop="target_period" label="调代课截止时间" width="180" show-overflow-tooltip />
          <el-table-column prop="reason_type" label="申请类型" width="130" />
          <el-table-column prop="detail" label="变更详情" min-width="300" show-overflow-tooltip />
          <el-table-column label="审批状态" width="100">
            <template #default="{ row }">
              <span class="tap-pending">{{ row.status_label }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="110" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openDetail(row.id)">查看详情</el-button>
            </template>
          </el-table-column>
        </el-table>
      </template>

      <template v-else>
        <div class="tap-stats">
          <el-card shadow="never"><div class="tap-stat"><b>{{ stats.total }}</b><span>总记录</span></div></el-card>
          <el-card shadow="never"><div class="tap-stat"><b>{{ stats.pending }}</b><span>待审批</span></div></el-card>
          <el-card shadow="never"><div class="tap-stat"><b>{{ stats.approved }}</b><span>已通过</span></div></el-card>
          <el-card shadow="never"><div class="tap-stat"><b>{{ stats.rejected }}</b><span>未通过</span></div></el-card>
        </div>
      </template>
    </template>

    <template v-else>
      <div class="tap-create-top">
        <h2>新建临时{{ createType }}</h2>
        <el-button @click="createMode = false">返回</el-button>
      </div>
      <div class="tap-create-form">
        <el-select v-model="campusId" style="width: 220px">
          <el-option v-for="c in meta?.campuses ?? []" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-select v-model="createTeacherId" style="width: 140px" @change="loadCreateGrid">
          <el-option v-for="t in meta?.teacher_options ?? []" :key="t.id" :label="t.name" :value="t.id" />
        </el-select>
        <el-date-picker v-model="createDate" type="date" value-format="YYYY-MM-DD" style="width: 150px" />
        <el-select v-model="createReason" style="width: 160px">
          <el-option v-for="r in meta?.reason_options ?? []" :key="r.value" :label="r.label" :value="r.label" />
        </el-select>
        <el-input v-model="createRemark" placeholder="备注说明" maxlength="50" show-word-limit style="width: 220px" />
      </div>

      <div class="tap-week-line">
        <span>{{ createGrid?.teacher_name || '教师' }}的课表</span>
        <el-select v-model="createWeek" style="width: 220px" @change="loadCreateGrid">
          <el-option v-for="w in meta?.weeks ?? []" :key="w.week_number" :label="w.label" :value="w.week_number" />
        </el-select>
      </div>

      <div class="tap-grid-row">
        <div class="tap-grid-card">
          <div class="tap-grid-title">我的课表</div>
          <GridMini :days="createGrid?.days ?? []" :periods="createGrid?.periods ?? []" :cells="createGrid?.own_cells ?? []" />
        </div>
        <div class="tap-grid-card">
          <div class="tap-grid-title">同年级课程</div>
          <GridMini :days="createGrid?.days ?? []" :periods="createGrid?.periods ?? []" :cells="createGrid?.same_subject_cells ?? []" />
        </div>
      </div>
      <div class="tap-grid-card">
        <div class="tap-grid-title">其他教师</div>
        <GridMini :days="createGrid?.days ?? []" :periods="createGrid?.periods ?? []" :cells="createGrid?.other_cells ?? []" />
      </div>
      <div class="tap-foot">
        <el-button @click="createMode = false">返回</el-button>
        <el-button type="primary" :loading="saving" @click="submitCreate">提交</el-button>
      </div>
    </template>

    <el-drawer v-model="detailVisible" title="记录详情" size="420px">
      <div v-if="detail">
        <p>申请人：{{ detail.applicant_name }}</p>
        <p>申请原因：{{ detail.reason_type }}</p>
        <p>审批状态：{{ detail.status_label }}</p>
        <h4>记录明细</h4>
        <p v-for="(c, i) in detail.changes" :key="i">{{ c }}</p>
      </div>
    </el-drawer>

    <el-dialog v-model="settingsVisible" title="审批和通知设置" width="760px">
      <div v-if="settings">
        <el-radio-group v-model="settings.approval_type">
          <el-radio value="teacher">被调课老师审批</el-radio>
          <el-radio value="admin">管理员审批</el-radio>
          <el-radio value="both">被调课老师和管理员审批</el-radio>
        </el-radio-group>
        <el-divider />
        <el-checkbox-group v-model="settings.notify_change_to">
          <el-checkbox value="head_teacher">班主任</el-checkbox>
          <el-checkbox value="parents">家长</el-checkbox>
          <el-checkbox value="students">学生</el-checkbox>
        </el-checkbox-group>
        <el-divider />
        <el-switch v-model="settings.allow_view_others_timetable" active-text="允许查看他人课表" />
      </div>
      <template #footer>
        <el-button @click="settingsVisible = false">取消</el-button>
        <el-button type="primary" @click="saveSettings">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { defineComponent, h, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  fetchTempAdjustApprovalSettings,
  fetchTempAdjustCreateGrid,
  fetchTempAdjustMeta,
  fetchTempAdjustRecordDetail,
  fetchTempAdjustRecords,
  fetchTempAdjustStats,
  postTempAdjustRecord,
  putTempAdjustApprovalSettings,
  type TempAdjustMeta,
  type TempAdjustRecord,
} from '@/api/tempAdjust'

const GridMini = defineComponent({
  name: 'GridMini',
  props: { days: { type: Array, required: true }, periods: { type: Array, required: true }, cells: { type: Array, required: true } },
  setup(props) {
    const cellText = (day: number, pid: string) => {
      const row = (props.cells as any[]).find((x) => x.day === day && x.period_id === pid)
      return row?.line || ''
    }
    return () =>
      h('table', { class: 'tap-mini' }, [
        h('thead', [h('tr', [h('th', '节次'), ...(props.days as any[]).map((d) => h('th', d.label))])]),
        h('tbody', (props.periods as any[]).map((p) => h('tr', [h('td', p.name), ...(props.days as any[]).map((d) => h('td', cellText(d.dow, p.id)))]))),
      ])
  },
})

const meta = ref<TempAdjustMeta | null>(null)
const campusId = ref('')
const mainTab = ref('records')
const teacherQ = ref('')
const status = ref('all')
const applyType = ref('all')
const records = ref<TempAdjustRecord[]>([])
const stats = ref({ total: 0, pending: 0, approved: 0, rejected: 0 })

const detailVisible = ref(false)
const detail = ref<any>(null)
const settingsVisible = ref(false)
const settings = ref<any>(null)

const createMode = ref(false)
const createType = ref<'调课' | '代课'>('调课')
const createTeacherId = ref('')
const createDate = ref('2026-03-30')
const createReason = ref('因私-请假')
const createRemark = ref('')
const createWeek = ref(5)
const createGrid = ref<any>(null)
const saving = ref(false)

async function loadMeta() {
  meta.value = await fetchTempAdjustMeta()
  campusId.value = meta.value.campuses[0]?.id ?? ''
  createTeacherId.value = meta.value.teacher_options[0]?.id ?? ''
  createWeek.value = meta.value.weeks.find((x) => x.week_number === 5)?.week_number ?? meta.value.weeks[0]?.week_number ?? 5
}

async function loadRecords() {
  if (!campusId.value) return
  records.value = await fetchTempAdjustRecords({
    campus_id: campusId.value,
    status: status.value,
    q_teacher: teacherQ.value,
    apply_type: applyType.value,
  })
}

async function loadStats() {
  if (!campusId.value) return
  stats.value = await fetchTempAdjustStats(campusId.value)
}

async function loadAll() {
  await Promise.all([loadRecords(), loadStats()])
}

async function openDetail(id: string) {
  detail.value = await fetchTempAdjustRecordDetail(id)
  detailVisible.value = true
}

async function openCreate(tp: '调课' | '代课') {
  createType.value = tp
  createMode.value = true
  await loadCreateGrid()
}

async function loadCreateGrid() {
  if (!createTeacherId.value) return
  createGrid.value = await fetchTempAdjustCreateGrid(createTeacherId.value, createWeek.value)
}

async function submitCreate() {
  if (!campusId.value || !createTeacherId.value) return
  saving.value = true
  try {
    await postTempAdjustRecord({
      campus_id: campusId.value,
      applicant_id: createTeacherId.value,
      date: createDate.value,
      apply_type: createType.value,
      reason_type: createReason.value,
      remark: createRemark.value,
      week_number: createWeek.value,
      selected_cells: [],
    })
    ElMessage.success(`已提交${createType.value}申请`)
    createMode.value = false
    await loadAll()
  } finally {
    saving.value = false
  }
}

async function saveSettings() {
  if (!settings.value) return
  await putTempAdjustApprovalSettings({
    approval_type: settings.value.approval_type,
    notify_change_to: settings.value.notify_change_to,
    notify_remind_at: settings.value.notify_remind_at,
    ack_roles: settings.value.ack_roles,
    allow_view_others_timetable: settings.value.allow_view_others_timetable,
    reason_options: settings.value.reason_options,
  })
  ElMessage.success('已保存设置')
  settingsVisible.value = false
}

onMounted(async () => {
  await loadMeta()
  await loadAll()
  settings.value = await fetchTempAdjustApprovalSettings()
})

watch(mainTab, async (v) => {
  if (v === 'stats') await loadStats()
  if (v === 'records' || v === 'admin') await loadRecords()
})
</script>

<style scoped>
.tap { padding: 16px 20px 24px; }
.tap-hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.tap-title { margin: 0; font-size: 16px; font-weight: 700; }
.tap-right { display: flex; gap: 8px; }
.tap-filters { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.tap-actions { margin-left: auto; display: flex; gap: 8px; }
.tap-pending { color: #e6a23c; font-weight: 600; }
.tap-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.tap-stat { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 14px; }
.tap-stat b { font-size: 26px; color: #409eff; }
.tap-create-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.tap-create-form { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.tap-week-line { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-weight: 600; }
.tap-grid-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.tap-grid-card { border: 1px solid #ebeef5; border-radius: 4px; padding: 8px; background: #fff; margin-bottom: 12px; overflow: auto; }
.tap-grid-title { font-weight: 600; margin-bottom: 8px; }
.tap-mini { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; }
.tap-mini th, .tap-mini td { border: 1px solid #ebeef5; padding: 6px; text-align: center; white-space: pre-line; }
.tap-foot { display: flex; justify-content: flex-end; gap: 8px; }
</style>
