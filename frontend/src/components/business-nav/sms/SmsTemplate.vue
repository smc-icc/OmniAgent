<template>
  <!--
    「短信管理 → 模板管理」直接复用会话侧同一套真实实现
    （SmsTemplatesView：模板 CRUD + 变量 + 报备 ID + 审批状态），
    这样左侧导航不再需要独立的「短信模板」入口，功能也避免两份。
  -->
  <SmsTemplatesView embedded />
</template>

<script setup lang="ts">
import SmsTemplatesView from '@/views/SmsTemplatesView.vue'
</script>
