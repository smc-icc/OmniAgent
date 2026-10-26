<template>
  <dl class="video-config-details">
    <div><dt>视频功能</dt><dd>{{ config?.enabled ? '已启用' : '已停止' }}</dd></div>
    <div><dt>视频分机</dt><dd>{{ config?.extension || '未配置' }}<span v-if="config?.video_extension_mode === 'shared_phone' || config?.same_extension">（电话共用）</span></dd></div>
    <div><dt>SIP 密码</dt><dd>{{ config?.password_configured ? '已设置' : '未设置' }}</dd></div>
    <div><dt>浏览器话机</dt><dd>{{ config?.web_sip_enabled ? '允许' : '关闭' }}</dd></div>
    <div><dt>Web 视频</dt><dd>{{ config?.web_video_enabled ? '允许' : '关闭' }}</dd></div>
    <div><dt>移动端视频</dt><dd>随绑定电话分机</dd></div>
    <div v-if="registration"><dt>当前视频注册</dt><dd>{{ registrationText }}<span v-if="registeredExtension"> · {{ registeredExtension }}</span></dd></div>
    <div v-if="error" class="video-config-error"><dt>接入提示</dt><dd>{{ error }}</dd></div>
  </dl>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { VideoAgentConfig } from '@/api/mobile'
const props = defineProps<{ config?: VideoAgentConfig; registration?: string; registeredExtension?: string; error?: string }>()
const registrationText = computed(() => ({ registered: '已注册', registering: '注册中', failed: '注册失败', unregistered: '未注册' }[props.registration || ''] || props.registration || '未注册'))
</script>
<style scoped>
.video-config-details { margin: 0; font-size: 12px; line-height: 1.65; }
.video-config-details > div { display: flex; align-items: baseline; gap: 12px; padding: 4px 0; }
.video-config-details dt { flex: 0 0 84px; color: #7b8794; }
.video-config-details dd { flex: 1; min-width: 0; margin: 0; color: #283d51; overflow-wrap: anywhere; }
.video-config-details dd span { font-size: 11px; }
.video-config-error dd { color: #c45656; }
</style>
