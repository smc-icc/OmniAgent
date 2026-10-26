<template>
  <el-card shadow="never" class="cs-root">
    <template #header>
      <div>
        <span class="cs-title">专项管理</span>
        <span class="cs-sub">
          呼叫中心运营侧专项能力归集：质量与合规、知识与话术、外呼与名单、录音与抽检、培训与体验、劳动力与绩效等。
          演示数据来自 <code class="cs-code">/api/call-center/specialty/*</code>；培训、问卷、绩效、排班等部分能力已在其他业务磁贴中提供。
        </span>
      </div>
    </template>

    <div class="cs-layout">
      <aside class="cs-aside">
        <el-menu :default-active="active" class="cs-menu" @select="onMenuSelect">
          <el-menu-item index="overview">总览</el-menu-item>
          <el-menu-item index="quality">质检任务</el-menu-item>
          <el-menu-item index="knowledge">知识库</el-menu-item>
          <el-menu-item index="outbound">外呼活动</el-menu-item>
          <el-menu-item index="recording">录音样本</el-menu-item>
          <el-menu-item index="script">话术脚本</el-menu-item>
          <el-menu-item index="compliance">合规抽检</el-menu-item>
          <el-menu-item index="announcement">专项公告</el-menu-item>
        </el-menu>
      </aside>
      <main class="cs-main">
        <el-skeleton v-if="loading && active === 'overview'" :rows="6" animated />
        <template v-else-if="loadError">
          <el-alert type="error" :title="loadError" show-icon :closable="false" />
        </template>
        <template v-else>
          <section v-show="active === 'overview'" class="cs-panel">
            <p class="cs-intro">{{ overview?.intro }}</p>
            <div class="cs-pillars">
              <el-card
                v-for="p in overview?.pillars ?? []"
                :key="p.id"
                shadow="hover"
                class="cs-pillar-card"
              >
                <div class="cs-pillar-title">{{ p.title }}</div>
                <p class="cs-pillar-summary">{{ p.summary }}</p>
                <div class="cs-pillar-stat">
                  <span class="cs-pillar-stat-label">{{ p.stat_label }}</span>
                  <span class="cs-pillar-stat-value">{{ p.stat_value }}</span>
                </div>
              </el-card>
            </div>
          </section>

          <section v-show="active === 'quality'" class="cs-panel">
            <el-skeleton v-if="panelLoading" :rows="4" animated />
            <el-table v-else :data="qualityRows" stripe border size="small">
              <el-table-column prop="id" label="编号" width="100" />
              <el-table-column prop="name" label="任务名称" min-width="160" show-overflow-tooltip />
              <el-table-column prop="queue" label="队列" width="100" />
              <el-table-column prop="pending" label="待处理" width="80" />
              <el-table-column prop="sla_hours" label="SLA(小时)" width="100" />
              <el-table-column prop="owner" label="责任组" width="120" />
            </el-table>
          </section>

          <section v-show="active === 'knowledge'" class="cs-panel">
            <el-skeleton v-if="panelLoading" :rows="4" animated />
            <el-table v-else :data="knowledgeRows" stripe border size="small">
              <el-table-column prop="id" label="编号" width="100" />
              <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
              <el-table-column prop="category" label="分类" width="100" />
              <el-table-column prop="updated_at" label="更新日期" width="110" />
              <el-table-column prop="status" label="状态" width="90" />
            </el-table>
          </section>

          <section v-show="active === 'outbound'" class="cs-panel">
            <el-skeleton v-if="panelLoading" :rows="4" animated />
            <el-table v-else :data="outboundRows" stripe border size="small">
              <el-table-column prop="id" label="编号" width="90" />
              <el-table-column prop="name" label="活动名称" min-width="180" show-overflow-tooltip />
              <el-table-column prop="channel" label="渠道" width="120" />
              <el-table-column prop="daily_cap" label="日上限" width="90" />
              <el-table-column prop="status" label="状态" width="90" />
            </el-table>
          </section>

          <section v-show="active === 'recording'" class="cs-panel">
            <el-skeleton v-if="panelLoading" :rows="4" animated />
            <el-table v-else :data="recordingRows" stripe border size="small">
              <el-table-column prop="id" label="录音号" width="110" />
              <el-table-column prop="agent" label="坐席" width="90" />
              <el-table-column prop="queue" label="队列" width="90" />
              <el-table-column prop="duration_sec" label="时长(秒)" width="100" />
              <el-table-column prop="flag" label="标记" width="80" />
              <el-table-column prop="date" label="日期" width="110" />
            </el-table>
          </section>

          <section v-show="active === 'script'" class="cs-panel">
            <el-skeleton v-if="panelLoading" :rows="4" animated />
            <el-table v-else :data="scriptRows" stripe border size="small">
              <el-table-column prop="id" label="编号" width="90" />
              <el-table-column prop="name" label="脚本名称" min-width="160" show-overflow-tooltip />
              <el-table-column prop="version" label="版本" width="80" />
              <el-table-column prop="owner" label="维护方" width="110" />
              <el-table-column prop="status" label="状态" width="90" />
            </el-table>
          </section>

          <section v-show="active === 'compliance'" class="cs-panel">
            <el-skeleton v-if="panelLoading" :rows="4" animated />
            <el-table v-else :data="complianceRows" stripe border size="small">
              <el-table-column prop="id" label="编号" width="90" />
              <el-table-column prop="topic" label="检查主题" min-width="180" show-overflow-tooltip />
              <el-table-column prop="scope" label="范围" width="130" />
              <el-table-column prop="last_run" label="最近执行" width="110" />
              <el-table-column prop="result" label="结果" width="90" />
            </el-table>
          </section>

          <section v-show="active === 'announcement'" class="cs-panel">
            <el-skeleton v-if="panelLoading" :rows="4" animated />
            <el-table v-else :data="announcementRows" stripe border size="small">
              <el-table-column prop="id" label="编号" width="90" />
              <el-table-column prop="title" label="标题" min-width="240" show-overflow-tooltip />
              <el-table-column prop="date" label="日期" width="110" />
              <el-table-column prop="priority" label="优先级" width="90" />
            </el-table>
          </section>
        </template>
      </main>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { SpecialtyOverview } from '@/api/callCenterSpecialty'
import {
  fetchSpecialtyOverview,
  fetchQualityTasks,
  fetchKnowledgeArticles,
  fetchOutboundCampaigns,
  fetchRecordingSamples,
  fetchSpecialtyScripts,
  fetchComplianceChecks,
  fetchSpecialtyAnnouncements,
} from '@/api/callCenterSpecialty'

type MenuKey =
  | 'overview'
  | 'quality'
  | 'knowledge'
  | 'outbound'
  | 'recording'
  | 'script'
  | 'compliance'
  | 'announcement'

const active = ref<MenuKey>('overview')
const loading = ref(true)
const loadError = ref('')
const panelLoading = ref(false)

const overview = ref<SpecialtyOverview | null>(null)
const qualityRows = ref<Awaited<ReturnType<typeof fetchQualityTasks>>>([])
const knowledgeRows = ref<Awaited<ReturnType<typeof fetchKnowledgeArticles>>>([])
const outboundRows = ref<Awaited<ReturnType<typeof fetchOutboundCampaigns>>>([])
const recordingRows = ref<Awaited<ReturnType<typeof fetchRecordingSamples>>>([])
const scriptRows = ref<Awaited<ReturnType<typeof fetchSpecialtyScripts>>>([])
const complianceRows = ref<Awaited<ReturnType<typeof fetchComplianceChecks>>>([])
const announcementRows = ref<Awaited<ReturnType<typeof fetchSpecialtyAnnouncements>>>([])

const fetched = ref<Partial<Record<MenuKey, boolean>>>({})

async function loadOverview() {
  overview.value = await fetchSpecialtyOverview()
  fetched.value.overview = true
}

async function loadPanel(key: MenuKey) {
  if (key === 'overview' || fetched.value[key]) return
  panelLoading.value = true
  try {
    switch (key) {
      case 'quality':
        qualityRows.value = await fetchQualityTasks()
        break
      case 'knowledge':
        knowledgeRows.value = await fetchKnowledgeArticles()
        break
      case 'outbound':
        outboundRows.value = await fetchOutboundCampaigns()
        break
      case 'recording':
        recordingRows.value = await fetchRecordingSamples()
        break
      case 'script':
        scriptRows.value = await fetchSpecialtyScripts()
        break
      case 'compliance':
        complianceRows.value = await fetchComplianceChecks()
        break
      case 'announcement':
        announcementRows.value = await fetchSpecialtyAnnouncements()
        break
      default:
        break
    }
    fetched.value[key] = true
  } finally {
    panelLoading.value = false
  }
}

function onMenuSelect(index: string) {
  const k = index as MenuKey
  if (
    k === 'overview' ||
    k === 'quality' ||
    k === 'knowledge' ||
    k === 'outbound' ||
    k === 'recording' ||
    k === 'script' ||
    k === 'compliance' ||
    k === 'announcement'
  ) {
    active.value = k
    void loadPanel(k)
  }
}

onMounted(async () => {
  loading.value = true
  loadError.value = ''
  try {
    await loadOverview()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : '加载专项管理数据失败'
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.cs-root :deep(.el-card__header) {
  padding: 14px 18px;
}
.cs-root :deep(.el-card__body) {
  padding: 12px 16px 18px;
}
.cs-title {
  font-weight: 700;
  font-size: 16px;
  color: var(--oa-text, #303133);
}
.cs-sub {
  display: block;
  font-size: 12px;
  color: var(--oa-muted, #909399);
  margin-top: 6px;
  line-height: 1.55;
  max-width: 960px;
  font-weight: normal;
}
.cs-code {
  font-size: 11px;
  padding: 1px 6px;
  background: #f4f4f5;
  border-radius: 3px;
}
.cs-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  min-height: 480px;
}
.cs-aside {
  width: 200px;
  flex-shrink: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
}
.cs-menu {
  border-right: none;
}
.cs-main {
  flex: 1;
  min-width: 0;
}
.cs-intro {
  font-size: 13px;
  color: #606266;
  line-height: 1.6;
  margin: 0 0 16px;
}
.cs-pillars {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}
.cs-pillar-card :deep(.el-card__body) {
  padding: 12px 14px;
}
.cs-pillar-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--oa-text, #303133);
  margin-bottom: 6px;
}
.cs-pillar-summary {
  font-size: 12px;
  color: #909399;
  margin: 0 0 10px;
  line-height: 1.5;
  min-height: 3em;
}
.cs-pillar-stat {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
}
.cs-pillar-stat-label {
  color: #909399;
}
.cs-pillar-stat-value {
  font-weight: 700;
  color: var(--oa-primary, #0066b3);
  font-size: 16px;
}
.cs-panel {
  width: 100%;
}
</style>
