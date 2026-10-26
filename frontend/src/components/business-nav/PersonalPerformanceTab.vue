<template>
  <div class="pp-page" v-loading="loading">
    <el-card shadow="never" class="pp-hero">
      <div class="pp-hero-inner">
        <div>
          <h1 class="pp-title">个人绩效指标看板</h1>
          <p class="pp-intro">
            汇总当前登录坐席的处理量、等待、AHT 与 CSAT。无排班、质检、NPS 或工单数据源的指标显示为「—」，不使用演示值。
          </p>
        </div>
        <div class="pp-hero-side">
          <el-select v-model="period" style="width: 120px" size="default">
            <el-option label="今日" value="day" />
            <el-option label="本周" value="week" />
            <el-option label="本月" value="month" />
          </el-select>
          <div class="pp-agent">
            <el-avatar :size="40">{{ agent.name.slice(0, 1) }}</el-avatar>
            <div>
              <div class="pp-agent-name">{{ agent.name }}</div>
              <div class="pp-agent-sub">{{ agent.role }} · 工号 {{ agent.code }}</div>
            </div>
          </div>
        </div>
      </div>
      <el-alert
        v-if="highRisk.flag"
        type="error"
        show-icon
        :closable="false"
        class="pp-risk-alert"
        title="高风险事件（一票否决）"
        :description="highRisk.detail"
      />
      <el-alert v-else type="success" show-icon :closable="false" class="pp-risk-alert" title="高风险事件：本期无记录" />
    </el-card>

    <!-- 一、效率与产能 -->
    <el-card shadow="never" class="pp-section">
      <template #header>
        <div class="pp-section-head">
          <span class="pp-section-title">一、效率与产能指标</span>
          <span class="pp-section-desc">衡量工作量与处理速度，直接影响人力成本</span>
        </div>
      </template>
      <el-row :gutter="14">
        <el-col v-for="m in efficiencyMetrics" :key="m.key" :xs="24" :sm="12" :lg="8">
          <div class="pp-tile">
            <div class="pp-tile-head">
              <span class="pp-tile-name">{{ m.name }}</span>
              <el-tag v-if="m.benchmark" size="small" type="info" effect="plain">{{ m.benchmark }}</el-tag>
            </div>
            <div class="pp-tile-val">
              {{ m.display }}
              <span v-if="m.unit" class="pp-unit">{{ m.unit }}</span>
            </div>
            <p class="pp-tile-hint">{{ m.hint }}</p>
            <div v-if="m.trend" :class="['pp-trend', m.trendDir === 'up' ? 'is-up' : 'is-down']">
              {{ m.trend }}
            </div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 二、服务质量 -->
    <el-card shadow="never" class="pp-section">
      <template #header>
        <div class="pp-section-head">
          <span class="pp-section-title">二、服务质量指标</span>
          <span class="pp-section-desc">通过质检评分量化体验与合规</span>
        </div>
      </template>
      <el-row :gutter="14" class="pp-row-primary">
        <el-col :xs="24" :lg="8">
          <div class="pp-tile pp-tile--accent">
            <div class="pp-tile-name">质检合格率</div>
            <div class="pp-tile-val pp-tile-val--lg">{{ quality.parent.display }}</div>
            <p class="pp-tile-hint">录音抽检 / 全量质检综合得分达标比例</p>
          </div>
        </el-col>
        <el-col :xs="24" :lg="16">
          <div class="pp-subgrid">
            <div v-for="s in quality.sub" :key="s.key" class="pp-tile pp-tile--compact">
              <div class="pp-tile-name">{{ s.name }}</div>
              <div class="pp-tile-val">{{ s.display }}</div>
              <p class="pp-tile-hint">{{ s.hint }}</p>
            </div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 三、客户满意度 -->
    <el-card shadow="never" class="pp-section">
      <template #header>
        <div class="pp-section-head">
          <span class="pp-section-title">三、客户满意度指标</span>
          <span class="pp-section-desc">邀评与调研反映客户主观感受</span>
        </div>
      </template>
      <el-row :gutter="14">
        <el-col v-for="m in satisfactionMetrics" :key="m.key" :xs="24" :sm="12" :lg="8">
          <div class="pp-tile">
            <div class="pp-tile-name">{{ m.name }}</div>
            <div class="pp-tile-val">{{ m.display }}<span class="pp-unit">{{ m.unit }}</span></div>
            <p class="pp-tile-hint">{{ m.hint }}</p>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 四、业务成果 -->
    <el-card shadow="never" class="pp-section">
      <template #header>
        <div class="pp-section-head">
          <span class="pp-section-title">四、业务成果指标</span>
          <span class="pp-section-desc">随呼叫中心定位（售前 / 售后 / 技术支撑）差异化考核</span>
        </div>
      </template>
      <el-tabs v-model="bizTab" class="pp-biz-tabs">
        <el-tab-pane label="售前 / 电销型" name="sales">
          <el-row :gutter="14">
            <el-col v-for="m in bizSales" :key="m.key" :xs="24" :sm="12" :lg="6">
              <div class="pp-tile pp-tile--compact">
                <div class="pp-tile-name">{{ m.name }}</div>
                <div class="pp-tile-val">{{ m.display }}</div>
                <p class="pp-tile-hint">{{ m.hint }}</p>
              </div>
            </el-col>
          </el-row>
        </el-tab-pane>
        <el-tab-pane label="售后 / 客服型" name="service">
          <el-row :gutter="14">
            <el-col v-for="m in bizService" :key="m.key" :xs="24" :sm="12" :lg="6">
              <div class="pp-tile pp-tile--compact">
                <div class="pp-tile-name">{{ m.name }}</div>
                <div class="pp-tile-val">{{ m.display }}</div>
                <p class="pp-tile-hint">{{ m.hint }}</p>
              </div>
            </el-col>
          </el-row>
        </el-tab-pane>
        <el-tab-pane label="技术 / 支撑型" name="tech">
          <el-row :gutter="14">
            <el-col v-for="m in bizTech" :key="m.key" :xs="24" :sm="12" :lg="6">
              <div class="pp-tile pp-tile--compact">
                <div class="pp-tile-name">{{ m.name }}</div>
                <div class="pp-tile-val">{{ m.display }}</div>
                <p class="pp-tile-hint">{{ m.hint }}</p>
              </div>
            </el-col>
          </el-row>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 五、综合能力 -->
    <el-card shadow="never" class="pp-section">
      <template #header>
        <div class="pp-section-head">
          <span class="pp-section-title">五、综合能力指标</span>
          <span class="pp-section-desc">知识掌握与红线风控</span>
        </div>
      </template>
      <el-row :gutter="14">
        <el-col :xs="24" :md="12">
          <div class="pp-tile">
            <div class="pp-tile-name">知识库考试通过率</div>
            <div class="pp-tile-val">{{ capability.examPass }}</div>
            <p class="pp-tile-hint">新业务、新流程上线后的应知应会考核</p>
          </div>
        </el-col>
        <el-col :xs="24" :md="12">
          <div class="pp-tile">
            <div class="pp-tile-name">高风险事件</div>
            <div class="pp-tile-val">
              <el-tag :type="highRisk.flag ? 'danger' : 'success'" size="large">
                {{ highRisk.flag ? '存在记录' : '无' }}
              </el-tag>
            </div>
            <p class="pp-tile-hint">舆情风险、监管通报等，通常实行一票否决</p>
          </div>
        </el-col>
      </el-row>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { fetchPersonalPerformance, type PersonalPerformance } from '@/api/performance'
import { useAuthStore } from '@/stores/auth'

const period = ref<'day' | 'week' | 'month'>('week')
const loading = ref(false)
const me = ref<PersonalPerformance | null>(null)
const auth = useAuthStore()

function dash(v: number | string | null | undefined): string {
  if (v == null || v === '') return '—'
  return String(v)
}

const agent = computed(() => ({
  name: me.value?.agent.name || auth.user?.name || '坐席',
  role: me.value?.agent.role || '在线坐席',
  code: me.value?.agent.uid || String(auth.user?.id || '—'),
}))

const highRisk = computed(() => me.value?.high_risk || { flag: false, detail: '' })

const efficiencyMetrics = computed(() => {
  const d = me.value
  return [
    {
      key: 'vol',
      name: '接听量 / 处理量',
      display: d ? String(d.handled) : '—',
      unit: '通',
      hint: '统计周期内已分配或已结束的全媒体会话（omni_session_records）',
      benchmark: d ? `进线 ${d.inbound}` : undefined,
      trend: d?.period || '',
      trendDir: 'up' as const,
    },
    {
      key: 'aht',
      name: '平均处理时长 AHT',
      display: d && d.handled ? String(d.aht_sec) : '—',
      unit: '秒',
      hint: '已结束会话 talk_sec 均值；无通话时长时显示 —',
    },
    {
      key: 'ring',
      name: '平均等待时长',
      display: d && d.inbound ? String(d.wait_sec_avg) : '—',
      unit: '秒',
      hint: '排队至接入的平均等待（wait_sec），全媒体无独立振铃字段',
    },
    {
      key: 'att',
      name: '出勤率',
      display: dash(d?.attendance_pct),
      unit: d?.attendance_pct == null ? '' : '%',
      hint: '需排班系统；当前无数据源',
    },
    {
      key: 'util',
      name: '工时利用率',
      display: dash(d?.utilization_pct),
      unit: d?.utilization_pct == null ? '' : '%',
      hint: '需就绪/登录工时；当前无数据源',
    },
    {
      key: 'aux',
      name: '小休 / 离席时长',
      display: dash(d?.aux_min),
      unit: d?.aux_min == null ? '' : '分/班',
      hint: '需 CCS 辅助状态统计；当前无数据源',
    },
  ]
})

const quality = computed(() => ({
  parent: { display: dash(me.value?.quality_rate) === '—' ? '—' : `${me.value?.quality_rate}%` },
  sub: [
    {
      key: 'flow',
      name: '流程执行率',
      display: '—',
      hint: '需质检系统，当前无数据源',
    },
    {
      key: 'comp',
      name: '合规性得分',
      display: '—',
      hint: '需质检系统，当前无数据源',
    },
    {
      key: 'fcr',
      name: '一次性解决率 FCR',
      display: dash(me.value?.fcr_pct) === '—' ? '—' : `${me.value?.fcr_pct}%`,
      hint: '需工单闭环标记；当前无数据源',
    },
    {
      key: 'acc',
      name: '准确率',
      display: '—',
      hint: '需工单字段校验；当前无数据源',
    },
  ],
}))

const satisfactionMetrics = computed(() => {
  const d = me.value
  return [
    {
      key: 'csat',
      name: '客户满意度',
      display: dash(d?.csat_pct),
      unit: d?.csat_pct == null ? '' : '%',
      hint: d?.csat_count ? `本期回收评价 ${d.csat_count} 条` : '本期尚无 CSAT 评价',
    },
    {
      key: 'dsat',
      name: '不满意 / 投诉率',
      display: dash(d?.dsat_pct),
      unit: d?.dsat_pct == null ? '' : '%',
      hint: '评价 ≤2 星占比；无评价时显示 —',
    },
    {
      key: 'nps',
      name: '净推荐值 NPS',
      display: dash(d?.nps),
      unit: '',
      hint: '需 NPS 问卷；当前无数据源',
    },
  ]
})

const bizTab = ref('sales')
const na = { display: '—', hint: '无工单/CRM 数据源，不展示演示值' }
const bizSales = [
  { key: 'cvr', name: '转化率', ...na },
  { key: 'order', name: '成单率', ...na },
  { key: 'rev', name: '个人销售额', ...na },
  { key: 'lead', name: '意向客户数', ...na },
]
const bizService = [
  { key: 'resolve', name: '问题解决率', ...na },
  { key: 'sla', name: '工单流转及时率', ...na },
  { key: 'repeat', name: '重复进线率', ...na },
  { key: 'esc', name: '升级率', ...na },
]
const bizTech = [
  { key: 'remote', name: '远程解决率', ...na },
  { key: 'first', name: '一线闭环率', ...na },
  { key: 'doc', name: '知识沉淀条数', ...na },
  { key: 'tool', name: '工具使用规范度', ...na },
]

const capability = computed(() => ({
  examPass: dash(me.value?.exam_pass) === '—' ? '—' : `${me.value?.exam_pass}%`,
}))

async function loadMe() {
  loading.value = true
  try {
    me.value = await fetchPersonalPerformance(period.value)
  } catch {
    me.value = null
  } finally {
    loading.value = false
  }
}

onMounted(() => { void loadMe() })
watch(period, () => { void loadMe() })
</script>

<style scoped>
.pp-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 1400px;
}

.pp-hero :deep(.el-card__body) {
  padding: 18px 20px;
}

.pp-hero-inner {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.pp-title {
  margin: 0 0 8px;
  font-size: 20px;
  font-weight: 700;
  color: var(--oa-text, #303133);
}

.pp-intro {
  margin: 0;
  max-width: 720px;
  font-size: 13px;
  line-height: 1.65;
  color: var(--oa-muted, #909399);
}

.pp-hero-side {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.pp-agent {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pp-agent-name {
  font-weight: 600;
  font-size: 14px;
  color: #303133;
}

.pp-agent-sub {
  font-size: 12px;
  color: #909399;
}

.pp-risk-alert {
  margin-top: 14px;
}

.pp-section :deep(.el-card__header) {
  padding: 14px 18px;
  background: #fafbfc;
  border-bottom: 1px solid #ebeef5;
}

.pp-section :deep(.el-card__body) {
  padding: 16px 18px 20px;
}

.pp-section-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pp-section-title {
  font-weight: 700;
  font-size: 15px;
  color: #303133;
}

.pp-section-desc {
  font-size: 12px;
  color: #909399;
  font-weight: normal;
}

.pp-tile {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 14px 16px;
  background: #fff;
  height: 100%;
  min-height: 132px;
  box-sizing: border-box;
  transition: box-shadow 0.2s, border-color 0.2s;
}

.pp-tile:hover {
  border-color: #c6e2ff;
  box-shadow: 0 2px 12px rgba(0, 102, 179, 0.08);
}

.pp-tile--compact {
  min-height: 108px;
}

.pp-tile--accent {
  background: linear-gradient(135deg, #ecf5ff 0%, #ffffff 55%);
  border-color: #d9ecff;
}

.pp-tile-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.pp-tile-name {
  font-size: 13px;
  font-weight: 600;
  color: #606266;
  line-height: 1.4;
}

.pp-tile-val {
  margin-top: 10px;
  font-size: 22px;
  font-weight: 700;
  color: var(--oa-primary, #0066b3);
  letter-spacing: -0.02em;
}

.pp-tile-val--lg {
  font-size: 28px;
}

.pp-unit {
  margin-left: 4px;
  font-size: 13px;
  font-weight: 500;
  color: #909399;
}

.pp-tile-hint {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.55;
  color: #909399;
}

.pp-trend {
  margin-top: 8px;
  font-size: 12px;
  font-weight: 500;
}

.pp-trend.is-up {
  color: #67c23a;
}

.pp-trend.is-down {
  color: #e6a23c;
}

.pp-row-primary {
  align-items: stretch;
}

.pp-subgrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  height: 100%;
}

@media (max-width: 768px) {
  .pp-subgrid {
    grid-template-columns: 1fr;
  }
}

.pp-biz-tabs :deep(.el-tabs__content) {
  padding-top: 12px;
}
</style>
