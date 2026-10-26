<template>
  <div class="ays-panel">
    <div class="ays-head">
      <h2 class="ays-title">学年学期</h2>
      <div class="ays-actions">
        <el-button type="primary" @click="openUpgradeDrawer">
          <el-icon class="ays-btn-icon"><Refresh /></el-icon>
          升学年/学期
        </el-button>
        <el-button link type="primary" @click="openAutoDateDialog">
          <el-icon><EditPen /></el-icon>
          自动变更日期设置
        </el-button>
      </div>
    </div>

    <p class="ays-intro">
      查看当前与历史学年学期的名称、起止日期与周数；仅当前学期可修改起止时间。交界期可手动升学年/学期；未手动时系统默认在每年
      <strong>8 月 10 日</strong>自动升学年、<strong>1 月 31 日</strong>自动升学期（可在「自动变更日期设置」中修改）。
    </p>

    <el-alert v-if="loadErr" :title="loadErr" type="error" show-icon class="ays-mb" />
    <el-table v-loading="loading" :data="terms" border stripe size="default" class="ays-table">
      <el-table-column prop="school_year" label="学年" width="120" />
      <el-table-column label="学期" min-width="140">
        <template #default="{ row }">
          {{ row.semester_name }}<span v-if="row.is_current" class="ays-current-tag">（当前）</span>
        </template>
      </el-table-column>
      <el-table-column label="起止日期" min-width="220">
        <template #default="{ row }">
          {{ row.start_date }}至{{ row.end_date }}
        </template>
      </el-table-column>
      <el-table-column prop="weeks" label="周数" width="88" align="center" />
      <el-table-column label="操作" width="120" align="center">
        <template #default="{ row }">
          <el-button
            v-if="row.is_current"
            link
            type="primary"
            @click="openEditDrawer(row)"
          >
            修改时间
          </el-button>
          <span v-else class="ays-op-disabled">修改时间</span>
        </template>
      </el-table-column>
    </el-table>

    <!-- 修改当前学期起止日期 -->
    <el-drawer v-model="editVisible" title="修改学年学期" direction="rtl" size="480px" destroy-on-close>
      <el-alert title="说明" type="info" :closable="false" show-icon class="ays-drawer-alert">
        <ul class="ays-rule-list">
          <li>手动升学可从每年 <strong>7 月 1 日</strong>或 <strong>1 月 1 日</strong>起操作。</li>
          <li>若未手动升学，系统将按配置的日期自动升学年（默认 8 月 10 日）或升学期（默认 1 月 31 日）。</li>
          <li>升学年后：年级/班级自动升一级；教师历史学期任教数据清空，需在新学年排课后应用课表更新任教；选课、课表及日常管理数据归档至上一学年。</li>
        </ul>
      </el-alert>
      <div class="ays-form-block">
        <div class="ays-ro">
          <span class="ays-ro-label">当前学期</span>
          <span class="ays-ro-val">{{ editSummary }}</span>
        </div>
        <el-form label-position="top" class="ays-mt">
          <el-form-item label="学期时间" required>
            <el-date-picker
              v-model="editRange"
              type="daterange"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              value-format="YYYY-MM-DD"
              style="width: 100%"
            />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" @click="submitEdit">确定</el-button>
      </template>
    </el-drawer>

    <!-- 手动升学年/学期 -->
    <el-drawer v-model="upgradeVisible" title="升学年/学期" direction="rtl" size="520px" destroy-on-close>
      <div class="ays-auto-hint">
        <span>自动变更日期：升学年 {{ autoDates.school_year_date }}；升学期 {{ autoDates.semester_date }}</span>
        <el-button link type="primary" @click="openAutoDateDialog">编辑</el-button>
      </div>
      <el-alert type="info" :closable="false" show-icon class="ays-drawer-alert">
        <ul class="ays-rule-list">
          <li>手动升学可从每年 7 月 1 日或 1 月 1 日起操作。</li>
          <li>自动升学年、升学期分别按上方配置日期执行（未手动时）。</li>
          <li>升学年后：① 班级升一级；② 教师任教历史清空，需重新应用课表；③ 选课/课表/日常管理数据归档至上一学年。</li>
        </ul>
      </el-alert>
      <div class="ays-form-block">
        <div class="ays-ro">
          <span class="ays-ro-label">当前学期</span>
          <span class="ays-ro-val">{{ currentBrief }}</span>
        </div>
        <div class="ays-ro">
          <span class="ays-ro-label">当前学期时间</span>
          <span class="ays-ro-val">{{ currentRangeText }}</span>
        </div>
        <div class="ays-ro">
          <span class="ays-ro-label">升级后学期</span>
          <span class="ays-ro-val">{{ nextBrief }}</span>
        </div>
        <el-form label-position="top" class="ays-mt">
          <el-form-item label="学期起止时间" required>
            <el-date-picker
              v-model="upgradeRange"
              type="daterange"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              value-format="YYYY-MM-DD"
              style="width: 100%"
            />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="upgradeVisible = false">取消</el-button>
        <el-button type="primary" :loading="upgradeSaving" @click="submitUpgrade">手动升级</el-button>
      </template>
    </el-drawer>

    <!-- 修改自动升学年/学期时间 -->
    <el-dialog v-model="autoDialogVisible" title="修改自动升学年学期时间" width="480px" destroy-on-close>
      <el-alert type="info" :closable="false" show-icon class="ays-mb">
        <ul class="ays-rule-list">
          <li>年级/班级将自动升一级；</li>
          <li>教师管理任教数据将清空，可重新应用课表任教；</li>
          <li>选课/课表/日常管理等数据归档至上一学年，可通过归档数据查看。</li>
        </ul>
      </el-alert>
      <el-form label-width="120px">
        <el-form-item label="升学年触发日">
          <el-date-picker
            v-model="autoForm.school_year_date"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="默认 8 月 10 日"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="升学期触发日">
          <el-date-picker
            v-model="autoForm.semester_date"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="默认 1 月 31 日"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="autoDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="autoSaving" @click="submitAutoDates">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { EditPen, Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  fetchAcademicTerms,
  fetchAutoUpgradeDates,
  patchCurrentAcademicTerm,
  postAcademicUpgrade,
  putAutoUpgradeDates,
  type AcademicTerm,
} from '@/api/academicScheduling'

const terms = ref<AcademicTerm[]>([])
const loading = ref(false)
const loadErr = ref('')

const editVisible = ref(false)
const editRow = ref<AcademicTerm | null>(null)
const editRange = ref<[string, string] | null>(null)
const editSaving = ref(false)

const upgradeVisible = ref(false)
const upgradeRange = ref<[string, string] | null>(null)
const upgradeSaving = ref(false)

const autoDates = ref({ school_year_date: '2023-08-10', semester_date: '2024-01-31' })
const autoDialogVisible = ref(false)
const autoForm = ref({ school_year_date: '', semester_date: '' })
const autoSaving = ref(false)

const currentTerm = computed(() => terms.value.find((t) => t.is_current) ?? null)

const editSummary = computed(() => {
  const c = editRow.value
  if (!c) return ''
  return `${c.school_year} ${c.semester_name}（当前）`
})

const currentBrief = computed(() => {
  const c = currentTerm.value
  if (!c) return '—'
  return `${c.school_year} ${c.semester_name}`
})

const currentRangeText = computed(() => {
  const c = currentTerm.value
  if (!c) return '—'
  return `${c.start_date}至${c.end_date}`
})

function nextMeta(schoolYear: string, semesterName: string) {
  const parts = schoolYear.split('-').map(Number)
  const y0 = parts[0]!
  const y1 = parts[1]!
  if (semesterName === '第一学期') {
    return { schoolYear, semester: '第二学期' as const }
  }
  return { schoolYear: `${y0 + 1}-${y1 + 1}`, semester: '第一学期' as const }
}

const nextBrief = computed(() => {
  const c = currentTerm.value
  if (!c) return '—'
  const n = nextMeta(c.school_year, c.semester_name)
  return `${n.schoolYear} ${n.semester}`
})

async function loadTerms() {
  loading.value = true
  loadErr.value = ''
  try {
    terms.value = await fetchAcademicTerms()
  } catch (e) {
    loadErr.value = e instanceof Error ? e.message : '加载失败，请确认后端已启动'
    terms.value = []
  } finally {
    loading.value = false
  }
}

async function loadAutoDates() {
  try {
    autoDates.value = await fetchAutoUpgradeDates()
  } catch {
    /* 忽略，使用默认展示 */
  }
}

function openEditDrawer(row: AcademicTerm) {
  editRow.value = row
  editRange.value = [row.start_date, row.end_date]
  editVisible.value = true
}

async function submitEdit() {
  if (!editRange.value?.[0] || !editRange.value?.[1]) {
    ElMessage.warning('请选择学期起止时间')
    return
  }
  editSaving.value = true
  try {
    await patchCurrentAcademicTerm(editRange.value[0], editRange.value[1])
    ElMessage.success('当前学期时间已更新')
    editVisible.value = false
    await loadTerms()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    editSaving.value = false
  }
}

async function openUpgradeDrawer() {
  if (!currentTerm.value) {
    ElMessage.warning('无当前学期数据')
    return
  }
  await loadAutoDates()
  upgradeRange.value = null
  upgradeVisible.value = true
}

async function submitUpgrade() {
  if (!upgradeRange.value?.[0] || !upgradeRange.value?.[1]) {
    ElMessage.warning('请填写升级后学期的起止时间')
    return
  }
  upgradeSaving.value = true
  try {
    const res = await postAcademicUpgrade(upgradeRange.value[0], upgradeRange.value[1])
    ElMessage.success(res.message || '升学年/学期成功')
    terms.value = res.items
    upgradeVisible.value = false
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '升级失败')
  } finally {
    upgradeSaving.value = false
  }
}

function openAutoDateDialog() {
  autoForm.value = {
    school_year_date: autoDates.value.school_year_date,
    semester_date: autoDates.value.semester_date,
  }
  autoDialogVisible.value = true
}

async function submitAutoDates() {
  if (!autoForm.value.school_year_date || !autoForm.value.semester_date) {
    ElMessage.warning('请选择两个日期')
    return
  }
  autoSaving.value = true
  try {
    await putAutoUpgradeDates({
      school_year_date: autoForm.value.school_year_date,
      semester_date: autoForm.value.semester_date,
    })
    autoDates.value = { ...autoForm.value }
    ElMessage.success('自动变更日期已保存')
    autoDialogVisible.value = false
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    autoSaving.value = false
  }
}

onMounted(async () => {
  await loadTerms()
  await loadAutoDates()
})
</script>

<style scoped>
.ays-panel {
  padding: 20px 24px 28px;
  min-height: 420px;
}
.ays-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}
.ays-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #303133;
}
.ays-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ays-btn-icon {
  margin-right: 4px;
}
.ays-intro {
  font-size: 13px;
  color: #606266;
  line-height: 1.65;
  margin: 0 0 16px;
}
.ays-mb {
  margin-bottom: 12px;
}
.ays-table {
  width: 100%;
}
.ays-current-tag {
  color: var(--el-color-primary);
  font-weight: 500;
}
.ays-op-disabled {
  color: #c0c4cc;
  font-size: 14px;
}
.ays-drawer-alert {
  margin-bottom: 16px;
}
.ays-rule-list {
  margin: 0;
  padding-left: 18px;
  line-height: 1.6;
  font-size: 13px;
}
.ays-form-block {
  padding: 0 4px;
}
.ays-ro {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}
.ays-ro-label {
  font-size: 12px;
  color: #909399;
}
.ays-ro-val {
  font-size: 14px;
  color: #303133;
}
.ays-mt {
  margin-top: 8px;
}
.ays-auto-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 13px;
  color: #606266;
  margin-bottom: 12px;
}
</style>
