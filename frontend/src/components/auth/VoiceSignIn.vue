<template><div v-if="productModules.enabled('icc') && !agent.agentId" class="voice-sign-in"><el-button :icon="Phone" :loading="loading" @click="submit">话务签入</el-button><p v-if="error" role="alert">{{ error }} <el-button link @click="binding.panelOpen=true">管理分机</el-button></p></div></template>
<script setup lang="ts">
import { useProductModulesStore } from '@/stores/product-modules'
const productModules=useProductModulesStore()

import {ref} from 'vue'
import {Phone} from '@element-plus/icons-vue'
import {useAgentStore} from '@/stores/agent'
import {useAuthStore} from '@/stores/auth'
import {useExtensionBindingStore} from '@/stores/extension-binding'
import {accessError} from '@/api/access'
const agent=useAgentStore(),auth=useAuthStore(),binding=useExtensionBindingStore(),loading=ref(false),error=ref('')
async function submit(){if(loading.value)return;loading.value=true;error.value='';try{await binding.refresh();if(!binding.binding.extension){binding.panelOpen=true;return}await auth.startBoundSession()}catch(e){error.value=e instanceof Error?e.message:accessError(e)}finally{loading.value=false}}
</script>
<style scoped>.voice-sign-in{flex-shrink:0}.voice-sign-in p{color:#b42318;line-height:1.5;max-width:380px;overflow-wrap:anywhere}</style>
