<template>
  <el-popover
    v-model:visible="open"
    placement="bottom-end"
    :width="300"
    trigger="click"
    popper-class="agent-identity-popover"
  >
    <template #reference>
      <button type="button" class="agent-identity-trigger" :class="{ open }">
        <el-avatar :size="36" class="agent-identity-avatar">{{ productModules.enabled('icc') ? agent.avatarText : (auth.user?.name || '用户').slice(0,1) }}</el-avatar>
        <span class="agent-identity-caption">
          <span class="agent-identity-line">{{ productModules.enabled('icc') ? agent.headerCaption : (auth.user?.name || '用户') }}</span>
          <el-icon class="agent-identity-arrow"><ArrowDown /></el-icon>
        </span>
      </button>
    </template>

    <dl class="agent-identity-panel">
      <div class="agent-identity-row">
        <dt>姓名</dt>
        <dd>{{ agent.profile.name || auth.user?.name || '—' }}</dd>
      </div>
      <div class="agent-identity-row">
        <dt>工号</dt>
        <dd>{{ agent.profile.work_no || auth.user?.uid || '—' }}</dd>
      </div>
      <div class="agent-identity-row">
        <dt>ID</dt>
        <dd>{{ agent.profile.id || auth.user?.id || '—' }}</dd>
      </div>
      <div v-if="productModules.enabled('icc')" class="agent-identity-row">
        <dt>分机号</dt>
        <dd><ExtensionBindingStatus /></dd>
      </div>
      <div v-if="agent.profile.team" class="agent-identity-row">
        <dt>技能组</dt>
        <dd>{{ agent.profile.team }}</dd>
      </div>
    </dl>

    <section v-if="productModules.enabled('icc')" class="agent-video-settings">
      <strong>视频配置</strong>
      <AgentVideoConfigDetails
        :config="desktopMedia.config.revision ? desktopMedia.config : agent.profile.video_config"
        :registration="desktopMedia.registration"
        :registered-extension="desktopMedia.registration === 'registered' ? desktopMedia.config.extension : ''"
        :error="desktopMedia.error"
      />
    </section>

    <div class="agent-identity-actions">
      <button
        type="button"
        class="agent-identity-action"
        v-if="productModules.enabled('icc')" :disabled="busy || !agent.agentId"
        @click="onCcsSignOut"
      >
        话务签出
      </button>
      <button
        type="button"
        class="agent-identity-action agent-identity-action--danger"
        :disabled="busy"
        @click="onLogout"
      >
        退出登录
      </button>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { useProductModulesStore } from '@/stores/product-modules'
const productModules=useProductModulesStore()

import ExtensionBindingStatus from '@/components/ExtensionBindingStatus.vue'
import AgentVideoConfigDetails from '@/components/AgentVideoConfigDetails.vue'
import { useDesktopCallMediaStore } from '@/stores/desktop-call-media'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'
import { useAgentStore } from '@/stores/agent'
import { useAuthStore } from '@/stores/auth'

const agent = useAgentStore()
const desktopMedia = useDesktopCallMediaStore()
const auth = useAuthStore()
const router = useRouter()
const open = ref(false)
const busy = ref(false)

async function onCcsSignOut() {
  if (busy.value) return
  busy.value = true
  open.value = false
  try {
    await agent.setStatus('offline')
    ElMessage.success('已话务签出')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '话务签出失败')
  } finally {
    busy.value = false
  }
}

async function onLogout() {
  if (busy.value) return
  busy.value = true
  open.value = false
  // 必须等 LoggedOff 发出去：2s 就断 WS 会取消 45s grace，CCS 会话还在，再登 1053
  if (agent.agentId) {
    try {
      await Promise.race([
        agent.setStatus('offline'),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('logged-off timeout')), 5000)),
      ])
    } catch {
      /* 尽力签出，不阻塞清会话 */
    }
  }
    try {
      agent.resetSession()
      await auth.logout()
    ElMessage.success('已退出登录')
    await router.replace({ name: 'login' })
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.agent-video-settings { padding: 10px 0; border-top: 1px solid #e8eef5; }
.agent-video-settings > strong { display: block; margin-bottom: 5px; font-size: 13px; }
.agent-identity-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 2px 6px 2px 2px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  max-width: 180px;
}
.agent-identity-trigger:hover,
.agent-identity-trigger.open {
  border-color: #dcdfe6;
  background: #f5f7fa;
}
.agent-identity-avatar {
  flex-shrink: 0;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}
.agent-identity-caption {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.agent-identity-line {
  font-size: 12px;
  font-weight: 600;
  color: #303133;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}
.agent-identity-arrow {
  flex-shrink: 0;
  font-size: 10px;
  color: #909399;
}

.agent-identity-panel {
  margin: 0;
  padding: 4px 0;
}
.agent-identity-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  line-height: 1.4;
}
.agent-identity-row dt {
  flex-shrink: 0;
  width: 48px;
  margin: 0;
  color: #909399;
}
.agent-identity-row dd {
  margin: 0;
  min-width: 0;
  color: #303133;
  word-break: break-all;
}

.agent-identity-actions {
  border-top: 1px solid #ebeef5;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.agent-identity-action {
  width: 100%;
  padding: 8px 12px;
  border: none;
  border-radius: 4px;
  background: transparent;
  text-align: left;
  font-size: 13px;
  color: #303133;
  cursor: pointer;
}
.agent-identity-action:hover:not(:disabled) {
  background: #f5f7fa;
}
.agent-identity-action:disabled {
  color: #c0c4cc;
  cursor: not-allowed;
}
.agent-identity-action--danger {
  color: #f56c6c;
}
.agent-identity-action--danger:hover:not(:disabled) {
  background: #fef0f0;
}
</style>

<style>
.agent-identity-popover.el-popover {
  padding: 0;
}
</style>
