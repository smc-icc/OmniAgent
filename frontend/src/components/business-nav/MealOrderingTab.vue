<template>
  <el-card shadow="never" class="mo-root">
    <template #header>
      <div>
        <span class="mo-title">订餐管理</span>
        <span class="mo-sub">
          供餐日选择、餐别菜单、下单与取消（演示数据，内存存储，重启后端后恢复种子订单）。
          接口：<code class="mo-code">/api/meal-order/*</code>
        </span>
      </div>
    </template>

    <div v-if="pageError" class="mo-block">
      <el-alert type="error" :title="pageError" show-icon :closable="false" />
    </div>

    <template v-else>
      <div class="mo-toolbar mo-block">
        <el-form :inline="true" class="mo-form">
          <el-form-item label="供餐日">
            <el-date-picker
              v-model="serveDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="选择日期"
              :disabled-date="disabledPast"
            />
          </el-form-item>
          <el-form-item label="当前坐席（演示）">
            <el-select v-model="agentId" style="width: 160px" @change="reloadAll">
              <el-option label="张敏 (A1001)" value="A1001" />
              <el-option label="王磊 (A1002)" value="A1002" />
              <el-option label="刘洋 (A2003)" value="A2003" />
              <el-option label="陈静 (A3008)" value="A3008" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="loadingOverview" @click="reloadAll">刷新</el-button>
          </el-form-item>
        </el-form>
      </div>

      <el-skeleton v-if="loadingOverview && !overview" :rows="4" animated class="mo-block" />
      <el-descriptions
        v-else-if="overview"
        :column="3"
        border
        size="small"
        class="mo-desc mo-block"
      >
        <el-descriptions-item label="供餐日">{{ overview.serve_date }}</el-descriptions-item>
        <el-descriptions-item label="供应商">{{ overview.vendor }}</el-descriptions-item>
        <el-descriptions-item label="取餐点">{{ overview.location }}</el-descriptions-item>
        <el-descriptions-item label="早餐截单">{{ overview.cutoff.breakfast }}</el-descriptions-item>
        <el-descriptions-item label="午餐截单">{{ overview.cutoff.lunch }}</el-descriptions-item>
        <el-descriptions-item label="晚餐截单">{{ overview.cutoff.dinner }}</el-descriptions-item>
        <el-descriptions-item label="当日已订(早/午/晚)">
          {{ overview.order_qty_by_meal.breakfast }} /
          {{ overview.order_qty_by_meal.lunch }} /
          {{ overview.order_qty_by_meal.dinner }}
        </el-descriptions-item>
        <el-descriptions-item label="我的已确认份数">{{ overview.my_confirmed_qty_today }}</el-descriptions-item>
        <el-descriptions-item label="说明" :span="1">{{ overview.hint }}</el-descriptions-item>
      </el-descriptions>

      <el-divider content-position="left">选择餐别与菜品</el-divider>

      <div class="mo-meal-tabs mo-block">
        <el-radio-group v-model="mealType" size="default" @change="onMealTypeChange">
          <el-radio-button value="breakfast">早餐</el-radio-button>
          <el-radio-button value="lunch">午餐</el-radio-button>
          <el-radio-button value="dinner">晚餐</el-radio-button>
        </el-radio-group>
      </div>

      <el-skeleton v-if="loadingMenu" :rows="5" animated class="mo-block" />
      <el-table v-else :data="menuItems" stripe border size="small" class="mo-block">
        <el-table-column prop="name" label="菜品" min-width="160" show-overflow-tooltip />
        <el-table-column prop="tags" label="标签" width="100" />
        <el-table-column prop="price" label="单价(元)" width="100">
          <template #default="{ row }">{{ row.price.toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="openOrderDialog(row)">订餐</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-divider content-position="left">订单</el-divider>

      <el-tabs v-model="orderTab" class="mo-block">
        <el-tab-pane label="我的订单" name="mine">
          <el-table :data="myOrders" stripe border size="small" empty-text="暂无订单">
            <el-table-column prop="created_at" label="下单时间" width="158" />
            <el-table-column prop="meal_type" label="餐别" width="80">
              <template #default="{ row }">{{ mealLabel(row.meal_type) }}</template>
            </el-table-column>
            <el-table-column prop="dish_name" label="菜品" min-width="140" show-overflow-tooltip />
            <el-table-column prop="qty" label="份数" width="70" />
            <el-table-column prop="amount" label="金额(元)" width="100">
              <template #default="{ row }">{{ row.amount.toFixed(2) }}</template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="row.status === 'confirmed' ? 'success' : 'info'">
                  {{ row.status === 'confirmed' ? '已确认' : '已取消' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="100" show-overflow-tooltip />
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button
                  v-if="row.status === 'confirmed'"
                  link
                  type="danger"
                  size="small"
                  :loading="cancellingId === row.id"
                  @click="onCancel(row)"
                >
                  取消
                </el-button>
                <span v-else class="mo-muted">—</span>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="当日全员（演示）" name="all">
          <el-table :data="allOrders" stripe border size="small" empty-text="暂无订单">
            <el-table-column prop="created_at" label="下单时间" width="158" />
            <el-table-column prop="agent_name" label="坐席" width="90" />
            <el-table-column prop="meal_type" label="餐别" width="80">
              <template #default="{ row }">{{ mealLabel(row.meal_type) }}</template>
            </el-table-column>
            <el-table-column prop="dish_name" label="菜品" min-width="140" show-overflow-tooltip />
            <el-table-column prop="qty" label="份数" width="70" />
            <el-table-column prop="amount" label="金额(元)" width="100">
              <template #default="{ row }">{{ row.amount.toFixed(2) }}</template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="row.status === 'confirmed' ? 'success' : 'info'">
                  {{ row.status === 'confirmed' ? '已确认' : '已取消' }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </template>

    <el-dialog v-model="dialogVisible" title="确认订餐" width="420px" destroy-on-close @closed="resetDialog">
      <el-form label-width="88px">
        <el-form-item label="供餐日">
          <span>{{ serveDate }}</span>
        </el-form-item>
        <el-form-item label="餐别">
          <span>{{ mealLabel(mealType) }}</span>
        </el-form-item>
        <el-form-item label="菜品">
          <span>{{ pendingItem?.name }}</span>
        </el-form-item>
        <el-form-item label="单价">
          <span>{{ pendingItem ? pendingItem.price.toFixed(2) : '—' }} 元</span>
        </el-form-item>
        <el-form-item label="份数">
          <el-input-number v-model="orderQty" :min="1" :max="99" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="orderRemark" type="textarea" rows="2" maxlength="120" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">关闭</el-button>
        <el-button type="primary" :loading="submitting" @click="submitOrder">提交订单</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { MealMenuItem, MealOrderOverview, MealOrderRow, MealType } from '@/api/mealOrder'
import {
  fetchMealOrderOverview,
  fetchMealMenu,
  fetchMealOrders,
  createMealOrder,
  cancelMealOrder,
} from '@/api/mealOrder'

function todayStr() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function disabledPast(d: Date) {
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  return d.getTime() < t.getTime()
}

const serveDate = ref(todayStr())
const agentId = ref('A1001')
const mealType = ref<MealType>('lunch')
const orderTab = ref('mine')

const overview = ref<MealOrderOverview | null>(null)
const menuItems = ref<MealMenuItem[]>([])
const myOrders = ref<MealOrderRow[]>([])
const allOrders = ref<MealOrderRow[]>([])

const loadingOverview = ref(false)
const loadingMenu = ref(false)
const pageError = ref('')
const submitting = ref(false)
const cancellingId = ref('')

const dialogVisible = ref(false)
const pendingItem = ref<MealMenuItem | null>(null)
const orderQty = ref(1)
const orderRemark = ref('')

const overviewLabels = computed(() => overview.value?.meal_type_labels)

function mealLabel(mt: MealType) {
  return overviewLabels.value?.[mt] ?? (mt === 'breakfast' ? '早餐' : mt === 'lunch' ? '午餐' : '晚餐')
}

async function loadOverview() {
  loadingOverview.value = true
  try {
    overview.value = await fetchMealOrderOverview(serveDate.value, agentId.value)
  } finally {
    loadingOverview.value = false
  }
}

async function loadMenu() {
  loadingMenu.value = true
  try {
    menuItems.value = await fetchMealMenu(mealType.value)
  } finally {
    loadingMenu.value = false
  }
}

async function loadOrders() {
  const d = serveDate.value
  const [mine, all] = await Promise.all([
    fetchMealOrders({ serve_date: d, agent_id: agentId.value }),
    fetchMealOrders({ serve_date: d }),
  ])
  myOrders.value = mine
  allOrders.value = all
}

async function reloadAll() {
  pageError.value = ''
  try {
    await Promise.all([loadOverview(), loadMenu(), loadOrders()])
  } catch (e) {
    pageError.value = e instanceof Error ? e.message : '加载失败'
  }
}

function onMealTypeChange() {
  void loadMenu()
}

function openOrderDialog(row: MealMenuItem) {
  pendingItem.value = row
  orderQty.value = 1
  orderRemark.value = ''
  dialogVisible.value = true
}

function resetDialog() {
  pendingItem.value = null
}

async function submitOrder() {
  const item = pendingItem.value
  if (!item) return
  submitting.value = true
  try {
    await createMealOrder({
      serve_date: serveDate.value,
      meal_type: mealType.value,
      menu_item_id: item.id,
      qty: orderQty.value,
      remark: orderRemark.value || undefined,
      agent_id: agentId.value,
    })
    ElMessage.success('订餐成功')
    dialogVisible.value = false
    await reloadAll()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '下单失败')
  } finally {
    submitting.value = false
  }
}

async function onCancel(row: MealOrderRow) {
  try {
    await ElMessageBox.confirm(`确定取消订单「${row.dish_name}」？`, '取消订餐', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '返回',
    })
  } catch {
    return
  }
  cancellingId.value = row.id
  try {
    await cancelMealOrder(row.id)
    ElMessage.success('已取消')
    await reloadAll()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '取消失败')
  } finally {
    cancellingId.value = ''
  }
}

watch(serveDate, () => {
  void reloadAll()
})

onMounted(() => {
  void reloadAll()
})
</script>

<style scoped>
.mo-root :deep(.el-card__header) {
  padding: 14px 18px;
}
.mo-root :deep(.el-card__body) {
  padding: 12px 16px 18px;
}
.mo-title {
  font-weight: 700;
  font-size: 16px;
  color: var(--oa-text, #303133);
}
.mo-sub {
  display: block;
  font-size: 12px;
  color: var(--oa-muted, #909399);
  margin-top: 6px;
  line-height: 1.55;
  max-width: 920px;
  font-weight: normal;
}
.mo-code {
  font-size: 11px;
  padding: 1px 6px;
  background: #f4f4f5;
  border-radius: 3px;
}
.mo-block {
  margin-bottom: 12px;
}
.mo-form {
  margin-bottom: 0;
}
.mo-desc {
  margin-top: 0;
}
.mo-meal-tabs {
  margin-bottom: 8px;
}
.mo-muted {
  color: #c0c4cc;
  font-size: 12px;
}
</style>
