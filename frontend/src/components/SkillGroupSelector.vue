<template>
  <el-popover v-if="productModules.enabled('icc')"
    v-model:visible="open"
    placement="bottom-start"
    :width="cascadeWidth"
    trigger="click"
    popper-class="skill-group-cascade-popover"
    @show="onPopoverShow"
  >
    <template #reference>
      <button type="button" class="skill-group-trigger" :class="{ open }">
        <img :src="skillIcon" alt="" class="skill-group-trigger-icon" />
        <span class="skill-group-trigger-caption">
          <span class="skill-group-trigger-label">{{ displayLabel }}</span>
          <el-icon class="skill-group-trigger-arrow"><ArrowDown /></el-icon>
        </span>
      </button>
    </template>

    <div class="cascade-panel" :class="{ 'has-sub': !!activeMenu }">
      <ul class="cascade-menu">
        <li>
          <button
            type="button"
            class="cascade-item"
            :disabled="loading || !canSignIn"
            :title="canSignIn ? '' : '请先在顶栏选择接听模式'"
            @click="onSignInAll"
          >
            <img :src="checkInAllIcon" alt="" class="cascade-item-icon" />
            <span class="cascade-item-divider" />
            <span class="cascade-item-label">签入所有</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            class="cascade-item"
            :disabled="loading || !canSignIn || !imsSkillIds.length"
            :title="imsSkillIds.length ? '' : '当前 VDN 未挂在线媒体技能'"
            @click="onSignInIms"
          >
            <img :src="checkInAllIcon" alt="" class="cascade-item-icon" />
            <span class="cascade-item-divider" />
            <span class="cascade-item-label">仅签入在线</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            class="cascade-item"
            :disabled="loading"
            @click="onSignOutAll"
          >
            <img :src="checkOutAllIcon" alt="" class="cascade-item-icon" />
            <span class="cascade-item-divider" />
            <span class="cascade-item-label">签出所有</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            class="cascade-item has-children"
            :class="{ active: activeMenu === 'custom' }"
            :disabled="!canSignIn"
            :title="canSignIn ? '' : '请先在顶栏选择接听模式'"
            @mouseenter="onHoverCustom"
            @click="onOpenCustom"
          >
            <img :src="checkinOroutIcon" alt="" class="cascade-item-icon" />
            <span class="cascade-item-divider" />
            <span class="cascade-item-label">指定技能</span>
            <el-icon class="cascade-item-arrow"><ArrowRight /></el-icon>
          </button>
        </li>
      </ul>

      <div
        v-show="activeMenu === 'custom'"
        class="cascade-sub"
        @mouseenter="activeMenu = 'custom'"
      >
        <div v-if="loading" class="cascade-sub-loading">保存中…</div>
        <el-checkbox-group
          v-else
          v-model="signedIn"
          class="cascade-check-list"
          @change="onCheckboxChange"
        >
          <el-checkbox
            v-for="skill in skillOptions"
            :key="skill.id"
            :value="skill.id"
            class="cascade-check-item"
          >
            <span class="cascade-check-label">{{ skill.label }}</span>
            <el-tag v-if="skill.mediaKinds?.includes('tas')" size="small" type="info" effect="plain" class="cascade-media-tag">电话</el-tag>
            <el-tag v-if="skill.mediaKinds?.includes('ims')" size="small" type="success" effect="plain" class="cascade-media-tag">在线</el-tag>
          </el-checkbox>
        </el-checkbox-group>
      </div>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { useProductModulesStore } from '@/stores/product-modules'
const productModules = useProductModulesStore()

import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ArrowDown, ArrowRight } from '@element-plus/icons-vue'
import { onCcsEvt } from '@/services/ccs-agent'
import skillIcon from '@/assets/images/icon/Enable/skill.png'
import checkInAllIcon from '@/assets/images/icon/Enable/checkInAll.png'
import checkOutAllIcon from '@/assets/images/icon/Enable/checkOutAll.png'
import checkinOroutIcon from '@/assets/images/icon/Enable/checkinOrout.png'
import { ElMessage } from 'element-plus'
import {
  fetchAgentSkillGroups,
  updateAgentSkillGroups,
  signInAllSkillGroups,
  signOutAllSkillGroups,
  fetchAcdQueuing,
  type SkillTreeNode,
} from '@/api/skillGroups'

const open = ref(false)
const loading = ref(false)
const activeMenu = ref<'custom' | null>(null)
const displayLabel = ref('默认技能组')
const treeData = ref<SkillTreeNode[]>([])
const signedIn = ref<string[]>([])
const queuingConfirmed = ref(false)
let persistTimer: ReturnType<typeof setTimeout> | null = null

const skillOptions = computed(() =>
  treeData.value.filter((n) => n.type === 'skill' || !n.type),
)

const imsSkillIds = computed(() =>
  skillOptions.value.filter((s) => s.mediaKinds?.includes('ims')).map((s) => s.id),
)

const canSignIn = computed(() => queuingConfirmed.value)

const cascadeWidth = computed(() => (activeMenu.value ? 380 : 180))

function onPopoverShow() {
  activeMenu.value = signedIn.value.length > 0 ? 'custom' : null
  void load(true)
}

function onOpenCustom() {
  if (!canSignIn.value) {
    ElMessage.warning('请先在顶栏选择接听模式')
    return
  }
  activeMenu.value = 'custom'
}

function onHoverCustom() {
  if (canSignIn.value) activeMenu.value = 'custom'
}

function applyState(data: { tree: SkillTreeNode[]; signed_in: string[]; display_label: string }) {
  treeData.value = data.tree
  signedIn.value = [...data.signed_in]
  displayLabel.value = data.display_label
}

async function loadQueuing() {
  try {
    const q = await fetchAcdQueuing()
    queuingConfirmed.value = !!q.queuing_confirmed
  } catch {
    queuingConfirmed.value = false
  }
}

async function load(syncFromCcs = false) {
  try {
    const data = await fetchAgentSkillGroups({ sync: syncFromCcs })
    applyState(data)
  } catch {
    displayLabel.value = '默认技能组'
  }
  await loadQueuing()
}

async function persistSignedIn(ids: string[], successMsg?: string) {
  if (!canSignIn.value) {
    ElMessage.warning('请先在顶栏选择接听模式')
    return
  }
  loading.value = true
  try {
    const data = await updateAgentSkillGroups(ids)
    applyState(data)
    if (successMsg) ElMessage.success(successMsg)
  } catch {
    ElMessage.error('技能组签入状态保存失败')
    await load()
  } finally {
    loading.value = false
  }
}

function onCheckboxChange(values: string[]) {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    void persistSignedIn(values)
  }, 200)
}

async function onSignInIms() {
  if (!canSignIn.value) {
    ElMessage.warning('请先在顶栏选择接听模式')
    return
  }
  const ids = imsSkillIds.value
  if (!ids.length) {
    ElMessage.warning('当前 VDN 没有挂在线媒体技能。请到 ICC 为组配置非电话技能后再签入。')
    return
  }
  loading.value = true
  try {
    const data = await updateAgentSkillGroups(ids)
    applyState(data)
    ElMessage.success('已签入在线技能组')
    open.value = false
  } catch {
    ElMessage.error('签入失败')
  } finally {
    loading.value = false
  }
}

async function onSignInAll() {
  if (!canSignIn.value) {
    ElMessage.warning('请先在顶栏选择接听模式')
    return
  }
  loading.value = true
  try {
    const data = await signInAllSkillGroups()
    applyState(data)
    if (!data.signed_in?.length) {
      ElMessage.warning(data.display_label === '未签入技能组' ? '未获取到可签入的技能组' : '签入结果为空')
      return
    }
    ElMessage.success('已签入全部技能组')
    open.value = false
  } catch {
    ElMessage.error('签入失败')
  } finally {
    loading.value = false
  }
}

async function onSignOutAll() {
  loading.value = true
  try {
    const data = await signOutAllSkillGroups()
    applyState(data)
    ElMessage.success('已签出全部技能组')
    open.value = false
  } catch {
    ElMessage.error('签出失败')
  } finally {
    loading.value = false
  }
}

const onSkillGroupsChanged = () => {
  void load()
}

const onCcsSkillGroups = (p: Record<string, unknown>) => {
  if (Array.isArray(p.signed_in)) {
    applyState({
      tree: treeData.value,
      signed_in: (p.signed_in as unknown[]).map(String),
      display_label: typeof p.display_label === 'string' ? p.display_label : displayLabel.value,
    })
    return
  }
  void load()
}

let offCcsSkillGroups: (() => void) | null = null

onMounted(() => {
  if (!productModules.enabled('icc')) return
  void load()
  window.addEventListener('omni:skill-groups-changed', onSkillGroupsChanged)
  window.addEventListener('omni:acd-queuing-changed', loadQueuing)
  offCcsSkillGroups = onCcsEvt('omni.skillGroupsChanged', onCcsSkillGroups)
})

onUnmounted(() => {
  window.removeEventListener('omni:skill-groups-changed', onSkillGroupsChanged)
  window.removeEventListener('omni:acd-queuing-changed', loadQueuing)
  offCcsSkillGroups?.()
})
</script>

<style scoped>
.skill-group-trigger {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 200px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #303133;
  font-size: 12px;
  cursor: pointer;
  line-height: 1;
}
.skill-group-trigger:hover,
.skill-group-trigger.open {
  border-color: #409eff;
  background: #ecf5ff;
}
.skill-group-trigger-icon {
  width: 22px;
  height: 22px;
  object-fit: contain;
  flex-shrink: 0;
  display: block;
}
.skill-group-trigger-caption {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  max-width: calc(100% - 26px);
}
.skill-group-trigger-label {
  min-width: 0;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  font-size: 12px;
  line-height: 1.1;
}
.skill-group-trigger-arrow {
  flex-shrink: 0;
  font-size: 10px;
  color: #909399;
}

.cascade-panel {
  display: flex;
  min-height: 120px;
}
.cascade-panel.has-sub .cascade-menu {
  border-right: 1px solid #ebeef5;
}
.cascade-menu {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  width: 180px;
  flex-shrink: 0;
}
.cascade-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 2px 8px;
  min-height: 26px;
  border: none;
  background: transparent;
  color: #303133;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.cascade-item:hover:not(:disabled),
.cascade-item.active {
  background: #f5f7fa;
}
.cascade-item:hover:not(:disabled) .cascade-item-label,
.cascade-item.active .cascade-item-label {
  color: var(--el-color-primary);
}
.cascade-item:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.cascade-item-icon {
  width: 22px;
  height: 22px;
  object-fit: contain;
  flex-shrink: 0;
}
.cascade-item-divider {
  width: 1px;
  height: 20px;
  background: #ebeef5;
  margin: 0 8px;
  flex-shrink: 0;
}
.cascade-item-label {
  flex: 1;
  min-width: 0;
  line-height: 1.2;
  white-space: nowrap;
}
.cascade-item.has-children .cascade-item-arrow {
  flex-shrink: 0;
  margin-left: 4px;
  font-size: 12px;
  color: #a8abb2;
}

.cascade-sub {
  flex: 1;
  min-width: 180px;
  padding: 8px 12px;
  overflow: auto;
  max-height: 280px;
}
.cascade-sub-loading {
  font-size: 12px;
  color: #909399;
  padding: 8px 0;
}
.cascade-check-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cascade-check-item {
  display: flex;
  align-items: center;
  margin-right: 0;
  height: 32px;
}
.cascade-check-label {
  margin-right: 6px;
}
.cascade-media-tag {
  margin-left: 2px;
}
</style>

<style>
.skill-group-cascade-popover.el-popover {
  padding: 0;
}
</style>
