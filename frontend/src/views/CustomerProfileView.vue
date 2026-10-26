<template>
  <div class="cp-page" v-loading="loading">
    <div class="cp-head">
      <el-button text type="primary" @click="router.push({ name: 'customers' })">← 返回列表</el-button>
      <h3>{{ form.name || '客户画像' }}</h3>
      <div class="cp-head-actions">
        <el-button type="primary" size="small" :loading="saving" @click="saveProfile">保存档案</el-button>
      </div>
    </div>

    <el-empty v-if="!loading && !detail" description="客户不存在" />

    <template v-else-if="detail">
      <div class="cp-grid">
        <div class="cp-main">
          <el-card shadow="never" class="cp-card">
            <template #header>基本信息</template>
            <el-form label-width="72px" size="small" class="cp-form">
              <el-row :gutter="12">
                <el-col :span="12">
                  <el-form-item label="姓名">
                    <el-input v-model="form.name" />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="手机">
                    <el-input v-model="form.phone" />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="邮箱">
                    <el-input v-model="form.email" />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="地区">
                    <el-input v-model="form.location" />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="性别">
                    <el-select v-model="form.gender" style="width: 100%">
                      <el-option label="未知" value="未知" />
                      <el-option label="男" value="男" />
                      <el-option label="女" value="女" />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="类型">
                    <el-input v-model="form.customer_type" />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="等级">
                    <el-input v-model="form.level" />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="公司">
                    <div class="company-row">
                      <el-select
                        v-model="form.company_id"
                        clearable
                        filterable
                        style="flex: 1"
                        placeholder="关联公司"
                      >
                        <el-option
                          v-for="c in companies"
                          :key="c.id"
                          :label="c.name"
                          :value="c.id"
                        />
                      </el-select>
                      <el-button size="small" @click="openCreateCompany">新建</el-button>
                    </div>
                  </el-form-item>
                </el-col>
                <el-col :span="24">
                  <el-form-item label="标签">
                    <el-select
                      v-model="selectedLabelIds"
                      multiple
                      filterable
                      style="width: 100%"
                      placeholder="选择标签"
                      @change="saveLabels"
                    >
                      <el-option
                        v-for="l in labelOptions"
                        :key="l.id"
                        :label="l.title"
                        :value="l.id"
                      />
                    </el-select>
                  </el-form-item>
                </el-col>
              </el-row>
            </el-form>
          </el-card>

          <el-card shadow="never" class="cp-card">
            <template #header>
              <div class="cp-card-head">
                <span>跟进时间线</span>
                <el-button text type="primary" size="small" @click="noteDlg = true">写备注</el-button>
              </div>
            </template>
            <el-timeline v-if="timeline.length">
              <el-timeline-item
                v-for="item in timeline"
                :key="item.id"
                :timestamp="formatTs(item.at)"
                :type="timelineType(item.type)"
                placement="top"
              >
                <div class="tl-title">{{ item.title }}</div>
                <div v-if="item.summary" class="tl-summary">{{ item.summary }}</div>
                <el-button
                  v-if="item.type === 'note' && item.meta?.note_id"
                  link
                  type="danger"
                  size="small"
                  @click="removeNote(Number(item.meta.note_id))"
                >
                  删除备注
                </el-button>
              </el-timeline-item>
            </el-timeline>
            <el-empty v-else description="暂无跟进记录" :image-size="56" />
          </el-card>

          <el-card shadow="never" class="cp-card">
            <template #header>
              <div class="cp-card-head">
                <span>商机</span>
                <el-button text type="primary" size="small" @click="openOppDlg">新建商机</el-button>
              </div>
            </template>
            <el-table :data="detail.opportunities" size="small" stripe border empty-text="暂无商机">
              <el-table-column prop="title" label="标题" min-width="140" />
              <el-table-column prop="stage" label="阶段" width="120">
                <template #default="{ row }">
                  <el-select
                    :model-value="row.stage"
                    size="small"
                    @change="(v: string) => onOppStage(row.id, v)"
                  >
                    <el-option v-for="s in stages" :key="s" :label="stageLabel(s)" :value="s" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column prop="amount" label="金额" width="100" />
              <el-table-column label="预计关闭" width="150">
                <template #default="{ row }">
                  <el-date-picker
                    :model-value="toDateValue(row.expected_close)"
                    type="date"
                    size="small"
                    value-format="YYYY-MM-DD"
                    placeholder="选择日期"
                    style="width: 130px"
                    clearable
                    @update:model-value="(v: string | null) => onOppClose(row.id, v)"
                  />
                </template>
              </el-table-column>
              <el-table-column prop="status" label="状态" width="80" />
              <el-table-column label="操作" width="72" fixed="right">
                <template #default="{ row }">
                  <el-button link type="danger" size="small" @click="removeOpp(row.id)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
            <div class="opp-board-link">
              <el-button text type="primary" size="small" @click="router.push({ name: 'opportunities' })">
                打开商机看板 →
              </el-button>
            </div>
          </el-card>
        </div>

        <div class="cp-side">
          <el-card v-if="detail.company" shadow="never" class="cp-card">
            <template #header>
              <div class="cp-card-head">
                <span>所属公司</span>
                <div class="cp-card-actions">
                  <el-button text type="primary" size="small" @click="openEditCompany">编辑</el-button>
                  <el-button text type="danger" size="small" @click="removeCompany">删除</el-button>
                </div>
              </div>
            </template>
            <div class="company-name">{{ detail.company.name }}</div>
            <div class="muted">{{ detail.company.domain || '—' }}</div>
            <div class="muted">{{ detail.company.description || '' }}</div>
          </el-card>

          <el-card
            v-if="detail.company_contacts && detail.company_contacts.length"
            shadow="never"
            class="cp-card"
          >
            <template #header>同公司联系人</template>
            <ul class="peer-list">
              <li
                v-for="p in detail.company_contacts"
                :key="p.id"
                @click="router.push({ name: 'customer-profile', params: { id: String(p.id) } })"
              >
                <span class="peer-name">{{ p.name }}</span>
                <span class="muted">{{ p.phone || p.email || '—' }}</span>
              </li>
            </ul>
          </el-card>

          <el-card shadow="never" class="cp-card">
            <template #header>近期会话</template>
            <el-table :data="detail.conversations" size="small" stripe border empty-text="暂无会话">
              <el-table-column prop="id" label="会话" width="80" />
              <el-table-column label="状态" width="72">
                <template #default="{ row }">{{ row.status === 0 ? '进行中' : '已结束' }}</template>
              </el-table-column>
              <el-table-column label="最近活动" min-width="120">
                <template #default="{ row }">{{ formatTs(row.last_activity_at) }}</template>
              </el-table-column>
            </el-table>
          </el-card>

          <el-card shadow="never" class="cp-card">
            <template #header>话务记录</template>
            <el-table :data="detail.call_records" size="small" stripe border empty-text="暂无话单">
              <el-table-column prop="begin_time" label="开始" min-width="130" />
              <el-table-column prop="talk_sec" label="秒" width="56" />
              <el-table-column prop="work_no" label="工号" width="72" />
            </el-table>
          </el-card>
        </div>
      </div>
    </template>

    <el-dialog v-model="noteDlg" title="写备注" width="420px">
      <el-input v-model="noteText" type="textarea" :rows="4" placeholder="跟进内容" />
      <template #footer>
        <el-button type="primary" :loading="noteSaving" @click="submitNote">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="oppDlg" title="新建商机" width="440px">
      <el-form label-width="72px" size="small">
        <el-form-item label="标题">
          <el-input v-model="oppForm.title" />
        </el-form-item>
        <el-form-item label="阶段">
          <el-select v-model="oppForm.stage" style="width: 100%">
            <el-option v-for="s in stages" :key="s" :label="stageLabel(s)" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item label="金额">
          <el-input-number v-model="oppForm.amount" :min="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="关闭日">
          <el-date-picker
            v-model="oppForm.expected_close"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="预计关闭日期"
            style="width: 100%"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="primary" :loading="oppSaving" @click="submitOpp">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="companyDlg" :title="companyForm.id ? '编辑公司' : '新建公司'" width="440px">
      <el-form label-width="72px" size="small">
        <el-form-item label="名称">
          <el-input v-model="companyForm.name" />
        </el-form-item>
        <el-form-item label="域名">
          <el-input v-model="companyForm.domain" placeholder="example.com" />
        </el-form-item>
        <el-form-item label="简介">
          <el-input v-model="companyForm.description" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button
          v-if="companyForm.id"
          type="danger"
          plain
          :loading="companySaving"
          @click="removeCompanyFromDlg"
        >
          删除公司
        </el-button>
        <el-button type="primary" :loading="companySaving" @click="submitCompany">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  fetchCustomer,
  patchCustomer,
  fetchCustomerTimeline,
  createCustomerNote,
  deleteCustomerNote,
  putCustomerLabels,
  fetchCrmLabels,
  fetchCompanies,
  createCompany,
  patchCompany,
  deleteCompany,
  createOpportunity,
  patchOpportunity,
  deleteOpportunity,
  type CustomerDetail,
  type TimelineItem,
  type CrmLabel,
} from '@/api/customers'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const saving = ref(false)
const detail = ref<CustomerDetail | null>(null)
const timeline = ref<TimelineItem[]>([])
const labelOptions = ref<CrmLabel[]>([])
const selectedLabelIds = ref<number[]>([])
const companies = ref<Array<{ id: number; name: string }>>([])

const form = reactive({
  name: '',
  phone: '',
  email: '',
  location: '',
  gender: '未知',
  customer_type: '普通客户',
  level: '普通',
  company_id: null as number | null,
})

const noteDlg = ref(false)
const noteSaving = ref(false)
const noteText = ref('')

const stages = ['new', 'qualifying', 'proposal', 'won', 'lost'] as const
const oppDlg = ref(false)
const oppSaving = ref(false)
const oppForm = reactive({
  title: '',
  stage: 'new',
  amount: 0 as number | null,
  expected_close: '' as string | null,
})

const companyDlg = ref(false)
const companySaving = ref(false)
const companyForm = reactive({
  id: null as number | null,
  name: '',
  domain: '',
  description: '',
})

function stageLabel(s: string) {
  const map: Record<string, string> = {
    new: '新建',
    qualifying: '确认需求',
    proposal: '方案/报价',
    won: '赢单',
    lost: '丢单',
  }
  return map[s] || s
}

function timelineType(t: TimelineItem['type']): 'primary' | 'success' | 'warning' | 'info' {
  if (t === 'note') return 'success'
  if (t === 'call') return 'warning'
  return 'primary'
}

function formatTs(v: string | null | undefined) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleString('zh-CN')
}

function toDateValue(iso: string | null | undefined) {
  if (!iso) return null
  return iso.slice(0, 10)
}

function applyDetail(d: CustomerDetail) {
  detail.value = d
  form.name = d.name
  form.phone = d.phone
  form.email = d.email
  form.location = d.location
  form.gender = d.gender || '未知'
  form.customer_type = d.customer_type || '普通客户'
  form.level = d.level || '普通'
  form.company_id = d.company_id ?? null
  selectedLabelIds.value = (d.labels ?? []).map((l) => l.id)
}

async function reload() {
  const id = String(route.params.id)
  loading.value = true
  try {
    const [d, tl, labels, comps] = await Promise.all([
      fetchCustomer(id),
      fetchCustomerTimeline(id),
      fetchCrmLabels(),
      fetchCompanies(),
    ])
    applyDetail(d)
    timeline.value = tl
    labelOptions.value = labels
    companies.value = comps
  } catch {
    detail.value = null
  } finally {
    loading.value = false
  }
}

async function saveProfile() {
  if (!detail.value) return
  saving.value = true
  try {
    const d = await patchCustomer(detail.value.id, {
      name: form.name,
      phone: form.phone,
      email: form.email || null,
      location: form.location,
      gender: form.gender,
      customer_type: form.customer_type,
      level: form.level,
      company_id: form.company_id,
    })
    applyDetail(d)
    ElMessage.success('档案已保存')
  } catch {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

async function saveLabels() {
  if (!detail.value) return
  try {
    const items = await putCustomerLabels(detail.value.id, selectedLabelIds.value)
    if (detail.value) detail.value.labels = items
  } catch {
    ElMessage.error('标签保存失败')
  }
}

async function submitNote() {
  if (!detail.value || !noteText.value.trim()) {
    ElMessage.warning('请填写备注')
    return
  }
  noteSaving.value = true
  try {
    await createCustomerNote(detail.value.id, noteText.value)
    noteDlg.value = false
    noteText.value = ''
    timeline.value = await fetchCustomerTimeline(detail.value.id)
    ElMessage.success('已添加备注')
  } catch {
    ElMessage.error('保存失败')
  } finally {
    noteSaving.value = false
  }
}

async function removeNote(noteId: number) {
  if (!detail.value) return
  try {
    await deleteCustomerNote(detail.value.id, noteId)
    timeline.value = await fetchCustomerTimeline(detail.value.id)
  } catch {
    ElMessage.error('删除失败')
  }
}

function openOppDlg() {
  oppForm.title = ''
  oppForm.stage = 'new'
  oppForm.amount = 0
  oppForm.expected_close = null
  oppDlg.value = true
}

async function submitOpp() {
  if (!detail.value || !oppForm.title.trim()) {
    ElMessage.warning('请填写标题')
    return
  }
  oppSaving.value = true
  try {
    await createOpportunity({
      title: oppForm.title,
      stage: oppForm.stage,
      amount: oppForm.amount,
      contact_id: detail.value.id,
      company_id: form.company_id,
      expected_close: oppForm.expected_close || null,
    })
    oppDlg.value = false
    await reload()
    ElMessage.success('商机已创建')
  } catch {
    ElMessage.error('创建失败')
  } finally {
    oppSaving.value = false
  }
}

async function onOppStage(id: number, stage: string) {
  try {
    await patchOpportunity(id, { stage })
    if (detail.value) {
      const row = detail.value.opportunities.find((o) => o.id === id)
      if (row) row.stage = stage
    }
  } catch {
    ElMessage.error('更新失败')
  }
}

async function onOppClose(id: number, date: string | null) {
  try {
    await patchOpportunity(id, { expected_close: date || null })
    if (detail.value) {
      const row = detail.value.opportunities.find((o) => o.id === id)
      if (row) row.expected_close = date ? `${date}T00:00:00.000Z` : null
    }
  } catch {
    ElMessage.error('更新关闭日期失败')
  }
}

async function removeOpp(id: number) {
  try {
    await ElMessageBox.confirm('确认删除该商机？', '删除商机', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteOpportunity(id)
    await reload()
    ElMessage.success('已删除')
  } catch {
    ElMessage.error('删除失败')
  }
}

function openCreateCompany() {
  companyForm.id = null
  companyForm.name = ''
  companyForm.domain = ''
  companyForm.description = ''
  companyDlg.value = true
}

function openEditCompany() {
  const c = detail.value?.company
  if (!c) return
  companyForm.id = c.id
  companyForm.name = c.name
  companyForm.domain = c.domain
  companyForm.description = c.description
  companyDlg.value = true
}

async function removeCompany() {
  const c = detail.value?.company
  if (!c) return
  try {
    await ElMessageBox.confirm(
      `确认删除公司「${c.name}」？关联联系人将解除公司绑定，商机公司字段会清空。`,
      '删除公司',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await deleteCompany(c.id)
    form.company_id = null
    await reload()
    ElMessage.success('公司已删除')
  } catch {
    ElMessage.error('删除失败')
  }
}

async function removeCompanyFromDlg() {
  companyDlg.value = false
  await removeCompany()
}

async function submitCompany() {
  if (!companyForm.name.trim()) {
    ElMessage.warning('请填写公司名称')
    return
  }
  companySaving.value = true
  try {
    if (companyForm.id) {
      await patchCompany(companyForm.id, {
        name: companyForm.name,
        domain: companyForm.domain || null,
        description: companyForm.description || null,
      })
    } else {
      const created = await createCompany({
        name: companyForm.name,
        domain: companyForm.domain,
        description: companyForm.description,
      })
      form.company_id = created.id
      companies.value = await fetchCompanies()
    }
    companyDlg.value = false
    if (detail.value && form.company_id) {
      await patchCustomer(detail.value.id, { company_id: form.company_id })
      await reload()
    }
    ElMessage.success('公司已保存')
  } catch {
    ElMessage.error('保存失败')
  } finally {
    companySaving.value = false
  }
}

watch(
  () => route.params.id,
  () => {
    void reload()
  },
)

onMounted(reload)
</script>

<style scoped>
.cp-page {
  width: 100%;
}
.cp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.cp-head h3 {
  margin: 0;
  font-size: 18px;
  flex: 1;
}
.cp-grid {
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 12px;
  align-items: start;
}
@media (max-width: 1100px) {
  .cp-grid {
    grid-template-columns: 1fr;
  }
}
.cp-card {
  margin-bottom: 12px;
}
.cp-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.cp-card-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tl-title {
  font-weight: 600;
  font-size: 13px;
}
.tl-summary {
  margin-top: 4px;
  font-size: 12px;
  color: #606266;
  white-space: pre-wrap;
}
.company-name {
  font-weight: 600;
  margin-bottom: 4px;
}
.company-row {
  display: flex;
  gap: 8px;
  width: 100%;
}
.peer-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.peer-list li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px dashed #ebeef5;
  cursor: pointer;
  font-size: 13px;
}
.peer-name {
  font-weight: 600;
}
.opp-board-link {
  margin-top: 8px;
  text-align: right;
}
.muted {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
</style>
