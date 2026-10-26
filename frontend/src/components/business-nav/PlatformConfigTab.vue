<template>
  <VdnWorkingHoursPanel v-if="access.loaded && !canManagePlatform" />
  <el-skeleton v-else-if="!access.loaded" :rows="7" animated />
  <el-card v-else shadow="never" class="pc-root">
    <template #header>
      <div class="pc-head-row">
        <div>
          <span class="pc-title">平台基础配置管理</span>
          <span class="pc-sub">
            技能组、队列、号码映射、值班时间、对接集成、留存合规、业务码表与系统参数等；部分配置可保存至后端内存（演示）
            <code class="pc-code">/api/platform-config/*</code>。
          </span>
        </div>
        <el-button type="primary" :loading="refreshing" @click="reloadActive">刷新当前页</el-button>
      </div>
    </template>

    <div v-if="pageError" class="pc-block">
      <el-alert type="error" :title="pageError" show-icon :closable="false" />
    </div>

    <template v-else>
      <div class="pc-layout">
        <aside class="pc-aside">
          <el-menu :default-active="active" class="pc-menu" @select="onMenuSelect">
            <el-menu-item index="overview">总览说明</el-menu-item>
            <el-menu-item index="skills">技能组</el-menu-item>
            <el-menu-item index="queues">队列配置</el-menu-item>
            <el-menu-item index="hours">值班时间</el-menu-item>
            <el-menu-item index="numbers">号码映射</el-menu-item>
            <el-menu-item index="integrations">对接集成</el-menu-item>
            <el-menu-item index="retention">留存与合规</el-menu-item>
            <el-menu-item index="dictionaries">业务码表</el-menu-item>
            <el-menu-item index="params">系统参数</el-menu-item>
          </el-menu>
        </aside>
        <main class="pc-main">
          <el-skeleton v-if="panelLoading && active === 'overview'" :rows="6" animated />
          <template v-else>
            <section v-show="active === 'overview'" class="pc-panel">
              <p class="pc-intro">{{ overview?.intro }}</p>
              <p class="pc-hint">最近说明时间：{{ overview?.updated_hint }}</p>
              <el-table :data="overview?.domains ?? []" stripe border size="small">
                <el-table-column prop="title" label="配置域" min-width="140" />
                <el-table-column prop="id" label="标识" width="130" />
                <el-table-column prop="summary" label="说明" min-width="260" show-overflow-tooltip />
              </el-table>
            </section>

            <section v-show="active === 'skills'" class="pc-panel">
              <el-skeleton v-if="panelLoading" :rows="5" animated />
              <el-table v-else :data="skillGroups" stripe border size="small">
                <el-table-column prop="id" label="编码" width="120" />
                <el-table-column prop="name" label="名称" width="120" />
                <el-table-column prop="priority" label="路由优先级" width="110">
                  <template #default="{ row }">
                    <span>{{ row.priority }}</span>
                    <span class="pc-muted">（数值越小越优先）</span>
                  </template>
                </el-table-column>
                <el-table-column label="绑定队列" min-width="120">
                  <template #default="{ row }">{{ row.queues.join(', ') }}</template>
                </el-table-column>
                <el-table-column prop="agent_count" label="坐席数" width="88" />
                <el-table-column label="渠道" min-width="140">
                  <template #default="{ row }">{{ row.channels.join(' / ') }}</template>
                </el-table-column>
              </el-table>
            </section>

            <section v-show="active === 'queues'" class="pc-panel">
              <el-skeleton v-if="panelLoading" :rows="5" animated />
              <el-table v-else :data="queuesCfg" stripe border size="small">
                <el-table-column prop="queue_id" label="队列 ID" width="110" />
                <el-table-column prop="name" label="名称" width="120" />
                <el-table-column prop="media" label="媒体" width="100" />
                <el-table-column prop="overflow_target" label="溢出目标" width="120" show-overflow-tooltip>
                  <template #default="{ row }">{{ row.overflow_target || '—' }}</template>
                </el-table-column>
                <el-table-column prop="max_queue_depth" label="最大排队" width="100" />
                <el-table-column prop="music_on_hold" label="等待音" width="120" show-overflow-tooltip>
                  <template #default="{ row }">{{ row.music_on_hold || '—' }}</template>
                </el-table-column>
                <el-table-column label="录音" width="72">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.recording ? 'success' : 'info'">
                      {{ row.recording ? '开' : '关' }}
                    </el-tag>
                  </template>
                </el-table-column>
              </el-table>
            </section>

            <section v-show="active === 'hours'" class="pc-panel">
              <el-skeleton v-if="panelLoading" :rows="8" animated />
              <template v-else>
                <el-form label-width="140px" class="pc-form" @submit.prevent>
                  <el-form-item label="时区">
                    <el-input v-model="bhForm.timezone" style="max-width: 320px" />
                  </el-form-item>
                  <el-form-item label="工作日">
                    <el-time-select
                      v-model="bhForm.weekday_open"
                      start="06:00"
                      step="00:30"
                      end="23:30"
                      placeholder="开始"
                      style="width: 130px"
                    />
                    <span class="pc-range">—</span>
                    <el-time-select
                      v-model="bhForm.weekday_close"
                      start="06:00"
                      step="00:30"
                      end="23:30"
                      placeholder="结束"
                      style="width: 130px"
                    />
                  </el-form-item>
                  <el-form-item label="周六">
                    <el-time-select
                      v-model="bhForm.saturday_open"
                      start="06:00"
                      step="00:30"
                      end="23:30"
                      style="width: 130px"
                    />
                    <span class="pc-range">—</span>
                    <el-time-select
                      v-model="bhForm.saturday_close"
                      start="06:00"
                      step="00:30"
                      end="23:30"
                      style="width: 130px"
                    />
                  </el-form-item>
                  <el-form-item label="周日">
                    <el-radio-group v-model="bhForm.sunday_mode">
                      <el-radio value="closed">休息</el-radio>
                      <el-radio value="open">值班</el-radio>
                    </el-radio-group>
                    <template v-if="bhForm.sunday_mode === 'open'">
                      <el-time-select
                        v-model="bhForm.sunday_open"
                        start="06:00"
                        step="00:30"
                        end="23:30"
                        style="width: 130px; margin-left: 12px"
                      />
                      <span class="pc-range">—</span>
                      <el-time-select
                        v-model="bhForm.sunday_close"
                        start="06:00"
                        step="00:30"
                        end="23:30"
                        style="width: 130px"
                      />
                    </template>
                  </el-form-item>
                  <el-form-item label="节假日策略">
                    <el-select v-model="bhForm.holiday_policy" style="max-width: 320px">
                      <el-option label="跟随国家法定节假日" value="follow_national" />
                      <el-option label="忽略节假日（按周末规则）" value="ignore_holiday" />
                      <el-option label="仅按下方手动日期休业" value="manual_only" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="手动休业日期">
                    <el-input
                      v-model="bhHolidaysText"
                      type="textarea"
                      :rows="4"
                      placeholder="每行一个 YYYY-MM-DD"
                      style="max-width: 400px"
                    />
                  </el-form-item>
                  <el-form-item>
                    <el-button type="primary" :loading="savingBh" @click="saveBusinessHours">保存值班时间</el-button>
                  </el-form-item>
                </el-form>
              </template>
            </section>

            <section v-show="active === 'numbers'" class="pc-panel">
              <el-skeleton v-if="panelLoading" :rows="4" animated />
              <el-table v-else :data="inboundNumbers" stripe border size="small">
                <el-table-column prop="did" label="号码 / DID" min-width="140" />
                <el-table-column prop="label" label="用途" min-width="120" />
                <el-table-column prop="queue_id" label="目标队列" width="110" />
                <el-table-column prop="ivr_profile" label="IVR 模板" width="110" />
                <el-table-column label="状态" width="88">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.enabled ? 'success' : 'info'">
                      {{ row.enabled ? '启用' : '停用' }}
                    </el-tag>
                  </template>
                </el-table-column>
              </el-table>
            </section>

            <section v-show="active === 'integrations'" class="pc-panel">
              <el-skeleton v-if="panelLoading" :rows="4" animated />
              <template v-else>
                <el-table :data="integrations" stripe border size="small">
                  <el-table-column prop="name" label="系统" min-width="140" />
                  <el-table-column prop="vendor" label="厂商" width="90" />
                  <el-table-column label="密钥" min-width="200">
                    <template #default="{ row }">
                      <template v-if="row.editing">
                        <el-input v-model="row.editValue" :type="showPass[row.id] ? 'text' : 'password'" size="small" :placeholder="`输入${row.name}密钥`">
                          <template #suffix>
                            <el-icon @click="showPass[row.id]=!showPass[row.id]" style="cursor:pointer">
                              <View v-if="!showPass[row.id]" /><Hide v-else />
                            </el-icon>
                          </template>
                        </el-input>
                      </template>
                      <template v-else>
                        <el-tag :type="row.configured ? 'success' : 'danger'" size="small" effect="dark">
                          {{ row.configured ? '已配置' : '未配置' }}
                        </el-tag>
                        <span class="pc-masked">{{ row.endpoint_masked }}</span>
                      </template>
                    </template>
                  </el-table-column>
                  <el-table-column prop="description" label="说明" min-width="160" show-overflow-tooltip />
                  <el-table-column label="操作" width="160" fixed="right">
                    <template #default="{ row }">
                      <template v-if="row.editing">
                        <el-button size="small" type="primary" @click="saveIntegration(row)">保存</el-button>
                        <el-button size="small" @click="row.editing=false">取消</el-button>
                      </template>
                      <template v-else>
                        <el-button size="small" type="primary" link @click="row.editing=true;row.editValue=''">编辑</el-button>
                        <el-button v-if="row.configured" size="small" type="danger" link @click="deleteIntegration(row)">清除</el-button>
                      </template>
                    </template>
                  </el-table-column>
                </el-table>
                <p class="pc-note">密钥加密存储在数据库中，通过平台配置页面集中管理，支持变更审计。</p>
              </template>
            </section>

            <section v-show="active === 'retention'" class="pc-panel">
              <el-skeleton v-if="panelLoading" :rows="6" animated />
              <el-form v-else label-width="200px" class="pc-form" @submit.prevent>
                <el-form-item label="录音保留（天）">
                  <el-input-number v-model="retForm.recording_retention_days" :min="30" :max="3650" />
                </el-form-item>
                <el-form-item label="弹屏/操作日志（天）">
                  <el-input-number v-model="retForm.screen_log_days" :min="7" :max="1095" />
                </el-form-item>
                <el-form-item label="话单 CDR（天）">
                  <el-input-number v-model="retForm.cdr_days" :min="90" :max="3650" />
                </el-form-item>
                <el-form-item label="质检样本保留（天）">
                  <el-input-number v-model="retForm.quality_sample_days" :min="180" :max="3650" />
                </el-form-item>
                <el-form-item label="弹屏脱敏展示 PI">
                  <el-switch v-model="retForm.mask_pii_in_popscreen" />
                </el-form-item>
                <el-form-item label="允许坐席导出录音">
                  <el-switch v-model="retForm.allow_agent_export_recording" />
                </el-form-item>
                <el-form-item label="删除录音双人复核">
                  <el-switch v-model="retForm.dual_control_delete_recording" />
                </el-form-item>
                <el-form-item>
                  <el-button type="primary" :loading="savingRet" @click="saveRetention">保存策略</el-button>
                </el-form-item>
              </el-form>
            </section>

            <section v-show="active === 'dictionaries'" class="pc-panel">
              <el-skeleton v-if="panelLoading" :rows="4" animated />
              <template v-else>
                <el-collapse>
                  <el-collapse-item v-for="t in dictTables" :key="t.code" :title="`${t.name} (${t.code})`" :name="t.code">
                    <el-table :data="t.items" size="small" border stripe>
                      <el-table-column prop="value" label="值" width="140" />
                      <el-table-column prop="label" label="显示名" min-width="160" />
                    </el-table>
                  </el-collapse-item>
                </el-collapse>
                <p class="pc-note">码表维护可走独立「主数据」流程；本页只读演示。</p>
              </template>
            </section>

            <section v-show="active === 'params'" class="pc-panel">
              <el-skeleton v-if="panelLoading" :rows="4" animated />
              <el-table v-else :data="systemParams" stripe border size="small">
                <el-table-column prop="key" label="参数键" width="200" />
                <el-table-column prop="category" label="分类" width="130" />
                <el-table-column prop="value" label="当前值" width="140" />
                <el-table-column prop="description" label="说明" min-width="220" show-overflow-tooltip />
                <el-table-column label="操作" width="88" fixed="right">
                  <template #default="{ row }">
                    <el-button link type="primary" size="small" @click="openParamDialog(row)">修改</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </section>
          </template>
        </main>
      </div>
    </template>

    <el-dialog v-model="paramDialog" title="修改系统参数" width="480px" destroy-on-close @closed="paramEditing = null">
      <template v-if="paramEditing">
        <el-descriptions :column="1" border size="small" class="pc-param-desc">
          <el-descriptions-item label="参数键">{{ paramEditing.key }}</el-descriptions-item>
          <el-descriptions-item label="分类">{{ paramEditing.category }}</el-descriptions-item>
          <el-descriptions-item label="说明">{{ paramEditing.description }}</el-descriptions-item>
        </el-descriptions>
        <el-input v-model="paramValueDraft" class="pc-param-input" maxlength="500" show-word-limit />
      </template>
      <template #footer>
        <el-button @click="paramDialog = false">取消</el-button>
        <el-button type="primary" :loading="savingParam" @click="saveParam">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { View, Hide } from '@element-plus/icons-vue'
import type {
  BusinessHours,
  DictTable,
  InboundNumberRow,
  IntegrationRow,
  PlatformOverview,
  QueueConfigRow,
  RetentionPolicy,
  SkillGroupRow,
  SystemParamRow,
} from '@/api/platformConfig'
import {
  fetchPlatformOverview,
  fetchSkillGroups,
  fetchQueuesConfig,
  fetchBusinessHours,
  putBusinessHours,
  fetchInboundNumbers,
  fetchIntegrations,
  updateIntegration,
  removeIntegration,
  fetchRetentionPolicy,
  putRetentionPolicy,
  fetchDictionaries,
  fetchSystemParams,
  patchSystemParam,
} from '@/api/platformConfig'

import { useAccessStore } from '@/stores/access'
import VdnWorkingHoursPanel from './VdnWorkingHoursPanel.vue'
const access = useAccessStore()
const canManagePlatform = computed(() => access.systemSuperuser || access.administrator)

type MenuKey =
  | 'overview'
  | 'skills'
  | 'queues'
  | 'hours'
  | 'numbers'
  | 'integrations'
  | 'retention'
  | 'dictionaries'
  | 'params'

const active = ref<MenuKey>('overview')
const pageError = ref('')
const panelLoading = ref(false)
const refreshing = ref(false)
const savingBh = ref(false)
const savingRet = ref(false)
const savingParam = ref(false)

const overview = ref<PlatformOverview | null>(null)
const skillGroups = ref<SkillGroupRow[]>([])
const queuesCfg = ref<QueueConfigRow[]>([])
const inboundNumbers = ref<InboundNumberRow[]>([])
const integrations = ref<(IntegrationRow & { editing?: boolean; editValue?: string; configured?: boolean })[]>([])
const showPass = ref<Record<string, boolean>>({})

async function saveIntegration(row: { id: string; editValue?: string; editing?: boolean }) {
  if (!row.editValue) { ElMessage.warning('请输入密钥'); return }
  try {
    await updateIntegration(row.id, row.editValue)
    ElMessage.success('密钥已保存')
    row.editing = false
    await reloadActive()
  } catch { ElMessage.error('保存失败') }
}

async function deleteIntegration(row: { id: string; name: string; editing?: boolean }) {
  await ElMessageBox.confirm(`确定清除 ${row.name} 的密钥吗？`, '确认', { type: 'warning' })
  try {
    await removeIntegration(row.id)
    ElMessage.success('密钥已清除')
    row.editing = false
    await reloadActive()
  } catch { ElMessage.error('清除失败') }
}
const dictTables = ref<DictTable[]>([])
const systemParams = ref<SystemParamRow[]>([])

const bhForm = reactive<BusinessHours>({
  timezone: 'Asia/Shanghai',
  weekday_open: '08:00',
  weekday_close: '21:00',
  saturday_open: '09:00',
  saturday_close: '18:00',
  sunday_mode: 'closed',
  sunday_open: '10:00',
  sunday_close: '16:00',
  holiday_policy: 'follow_national',
  manual_holiday_dates: [],
})
const bhHolidaysText = ref('')

const retForm = reactive<RetentionPolicy>({
  recording_retention_days: 180,
  screen_log_days: 90,
  cdr_days: 365,
  quality_sample_days: 730,
  mask_pii_in_popscreen: true,
  allow_agent_export_recording: false,
  dual_control_delete_recording: true,
})

const fetched = ref<Partial<Record<MenuKey, boolean>>>({})

const paramDialog = ref(false)
const paramEditing = ref<SystemParamRow | null>(null)
const paramValueDraft = ref('')

function parseHolidayLines(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function applyBhToForm(bh: BusinessHours) {
  Object.assign(bhForm, bh)
  bhHolidaysText.value = (bh.manual_holiday_dates || []).join('\n')
}

function applyRetToForm(r: RetentionPolicy) {
  Object.assign(retForm, r)
}

async function loadPanel(key: MenuKey) {
  if (fetched.value[key]) return

  panelLoading.value = true
  pageError.value = ''
  try {
    switch (key) {
      case 'overview':
        overview.value = await fetchPlatformOverview()
        break
      case 'skills':
        skillGroups.value = await fetchSkillGroups()
        break
      case 'queues':
        queuesCfg.value = await fetchQueuesConfig()
        break
      case 'hours': {
        const bh = await fetchBusinessHours()
        applyBhToForm(bh)
        break
      }
      case 'numbers':
        inboundNumbers.value = await fetchInboundNumbers()
        break
      case 'integrations':
        integrations.value = await fetchIntegrations()
        break
      case 'retention': {
        const r = await fetchRetentionPolicy()
        applyRetToForm(r)
        break
      }
      case 'dictionaries':
        dictTables.value = await fetchDictionaries()
        break
      case 'params':
        systemParams.value = await fetchSystemParams()
        break
      default:
        break
    }
    fetched.value[key] = true
  } catch (e) {
    pageError.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    panelLoading.value = false
  }
}

function onMenuSelect(index: string) {
  const k = index as MenuKey
  const keys: MenuKey[] = [
    'overview',
    'skills',
    'queues',
    'hours',
    'numbers',
    'integrations',
    'retention',
    'dictionaries',
    'params',
  ]
  if (keys.includes(k)) {
    active.value = k
    void loadPanel(k)
  }
}

async function reloadActive() {
  refreshing.value = true
  fetched.value[active.value] = false
  try {
    await loadPanel(active.value)
    ElMessage.success('已刷新')
  } finally {
    refreshing.value = false
  }
}

async function saveBusinessHours() {
  savingBh.value = true
  try {
    const body: BusinessHours = {
      ...bhForm,
      manual_holiday_dates: parseHolidayLines(bhHolidaysText.value),
    }
    const saved = await putBusinessHours(body)
    applyBhToForm(saved)
    ElMessage.success('值班时间已保存（演示内存）')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    savingBh.value = false
  }
}

async function saveRetention() {
  savingRet.value = true
  try {
    const saved = await putRetentionPolicy({ ...retForm })
    applyRetToForm(saved)
    ElMessage.success('留存策略已保存（演示内存）')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    savingRet.value = false
  }
}

function openParamDialog(row: SystemParamRow) {
  paramEditing.value = row
  paramValueDraft.value = row.value
  paramDialog.value = true
}

async function saveParam() {
  const row = paramEditing.value
  if (!row) return
  savingParam.value = true
  try {
    await patchSystemParam(row.key, paramValueDraft.value)
    paramDialog.value = false
    ElMessage.success('已更新')
    fetched.value.params = false
    await loadPanel('params')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    savingParam.value = false
  }
}

onMounted(async () => {
  if (!access.loaded) await access.refresh()
  if (canManagePlatform.value) await loadPanel('overview')
})
</script>

<style scoped>
.pc-root :deep(.el-card__header) {
  padding: 14px 18px;
}
.pc-root :deep(.el-card__body) {
  padding: 12px 16px 18px;
}
.pc-head-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.pc-title {
  font-weight: 700;
  font-size: 16px;
  color: var(--oa-text, #303133);
}
.pc-sub {
  display: block;
  font-size: 12px;
  color: var(--oa-muted, #909399);
  margin-top: 6px;
  line-height: 1.55;
  max-width: 700px;
  font-weight: normal;
}
.pc-code {
  font-size: 11px;
  padding: 1px 6px;
  background: #f4f4f5;
  border-radius: 3px;
}
.pc-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  min-height: 520px;
}
.pc-aside {
  width: 200px;
  flex-shrink: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
}
.pc-menu {
  border-right: none;
}
.pc-main {
  flex: 1;
  min-width: 0;
}
.pc-panel {
  width: 100%;
}
.pc-intro {
  font-size: 13px;
  color: #606266;
  line-height: 1.65;
  margin: 0 0 8px;
}
.pc-hint {
  font-size: 12px;
  color: #909399;
  margin: 0 0 14px;
}
.pc-block {
  margin-bottom: 12px;
}
.pc-form {
  max-width: 640px;
}
.pc-range {
  margin: 0 8px;
  color: #909399;
}
.pc-muted {
  font-size: 11px;
  color: #c0c4cc;
  margin-left: 4px;
}
.pc-note {
  font-size: 12px;
  color: #909399;
  margin-top: 12px;
  line-height: 1.5;
}
.pc-param-desc {
  margin-bottom: 12px;
}
.pc-param-input {
  margin-top: 8px;
}
</style>
