import { useProductModulesStore } from './product-modules'
import { useExtensionBindingStore } from './extension-binding'
import { startBoundVoice, voiceStartupError } from '@/services/auth/binding-startup'
import { clearCcsSignInMark, clearCcsHealthMarks } from '@/utils/ccs-health'
import { defineStore } from 'pinia'
import { useAccessStore } from './access'
import { ref } from 'vue'
import { api } from '../api/client'
import { connectSocket, disconnectSocket } from '../services/socket'
import { formatOmniLoginEmptyToken, formatOmniLoginError } from '@/utils/login-errors'
import { getOmniDeviceId } from '@/utils/device'
import { getNativeShell } from '@/utils/platform'
import { isOnLoginPage, rememberCcsHealth, tabHadCcsSignIn } from '@/utils/ccs-health'
import { clearOmniToken, readOmniToken, writeOmniToken } from '@/utils/auth-storage'
import type { SocialAuthResult } from '@/services/auth/social-auth'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(readOmniToken())
  const user = ref<{ id: number; name: string; email: string; account_id: number; uid?: string; work_no?: string; session_id?: string } | null>(null)
  const isLoggedIn = ref(false)
  const authenticationMethod = ref<'password' | 'social' | 'authorization_code' | 'sms'>('password')
  let signingOut = false
  let forcingLogout = false
  let startupInFlight: {token:string;promise:Promise<void>} | null = null
  let startingVoiceVersion: number | null = null
  let lastBindingEventVersion = -1
  window.addEventListener('omni:extension-binding-processing-finished', event => {
    if((event as CustomEvent<{vdn_id:number}>).detail.vdn_id===useAccessStore().vdnId)void useExtensionBindingStore().refresh().catch(()=>undefined)
  })
  window.addEventListener('omni:extension-binding-processing', event => {
    const detail=(event as CustomEvent<{vdn_id:number;operation_id:string}>).detail
    if(detail.vdn_id!==useAccessStore().vdnId)return
    const store=useExtensionBindingStore()
    if(store.snapshot)store.snapshot.operation={id:detail.operation_id,phase:'reserved',error:''}
    clearCcsSignInMark();clearCcsHealthMarks()
    void store.refresh().catch(()=>undefined)
  })
  window.addEventListener('omni:extension-binding-changed', event => {
    const detail=(event as CustomEvent<{vdn_id:number;binding_version:number}>).detail
    if(detail.vdn_id!==useAccessStore().vdnId || !token.value)return
    if(detail.binding_version<=lastBindingEventVersion)return
    lastBindingEventVersion=detail.binding_version
    const cached=useExtensionBindingStore().snapshot
    if(startingVoiceVersion===detail.binding_version && cached?.binding.version===detail.binding_version)return
    if(cached && cached.binding.version>=detail.binding_version && !cached.operation && ['signed_in','signed_out','unbound'].includes(cached.voice.state))return
    clearCcsSignInMark();clearCcsHealthMarks()
    void (async()=>{
      const {unregisterSip}=await import('@/services/sip/registration');await unregisterSip()
      const {useAgentStore}=await import('./agent');useAgentStore().resetSession()
      const binding=useExtensionBindingStore();await binding.refresh()
      if(!isOnLoginPage())try{await startBoundSession()}catch(e){binding.error=e instanceof Error?e.message:'话务启动失败，请重试'}
    })().catch(()=>{useExtensionBindingStore().error='分机已变更，请刷新并重试话务启动'})
  })

  const vdnChoices = ref<Array<{ user_id: number; vdn_id: number | null; name: string }>>([])
  const vdnScope = ref<'seats' | 'all'>('seats')
  function clearVdnChoices() { vdnChoices.value = []; vdnScope.value = 'seats' }

  async function login(workNo: string, password: string, selection?: { user_id?: number; vdn_id?: number | null }) {
    sessionStorage.removeItem('omni.selected-account')
    let res
    try {
      res = await api.post('/auth/sign_in', {
        work_no: workNo,
        password,
        device_id: getOmniDeviceId(),
        ...(selection?.user_id ? { user_id: selection.user_id } : {}),
        ...(selection?.vdn_id ? { vdn_id: selection.vdn_id } : {}),
      })
    } catch (err) {
      throw new Error(formatOmniLoginError(err))
    }
    const body = res.data
    if (body?.status === 'select_vdn' && Array.isArray(body.vdns)) {
      vdnChoices.value = body.vdns
      vdnScope.value = body.scope === 'all' ? 'all' : 'seats'
      return 'select_vdn' as const
    }
    clearVdnChoices()
    const authToken = body.headers?.['access-token']
      ?? body.data?.access_token
      ?? res.headers['access-token']
      ?? ''

    if (authToken) {
      token.value = authToken
      writeOmniToken(authToken)
      api.defaults.headers.common['Authorization'] = `Bearer ${authToken}`

      user.value = {
        ...(body.data ?? { id: 1, name: 'Agent Wang', email: workNo, account_id: 1 }),
        uid: body.data?.uid,
      }
      isLoggedIn.value = false
      authenticationMethod.value = 'password'
      return 'ok' as const
    }
    throw new Error(formatOmniLoginEmptyToken())
  }

  function acceptSocialSession(body: SocialAuthResult) {
    acceptIdentitySession(body, 'social')
  }

  function acceptIdentitySession(body: SocialAuthResult, method: 'social' | 'authorization_code' | 'sms') {
    const nextToken = body.headers?.['access-token']
    const identity = body.data
    if (!nextToken || !identity || !Number.isSafeInteger(identity.id) || typeof identity.name !== 'string' ||
      typeof identity.email !== 'string' || identity.authentication_method !== method) throw new Error('登录会话无效，请重新登录')
    token.value = nextToken
    writeOmniToken(nextToken)
    api.defaults.headers.common['Authorization'] = `Bearer ${nextToken}`
    user.value = { id: identity.id as number, name: identity.name, email: identity.email,
      account_id: Number(identity.account_id ?? 0), uid: String(identity.uid ?? ''), work_no: String(identity.work_no ?? ''), session_id: String(identity.session_id ?? '') }
    authenticationMethod.value = method
    isLoggedIn.value = false
    sessionStorage.removeItem('omni.selected-account')
  }

  function startBoundSession(): Promise<void> {
    if(startupInFlight?.token===token.value)return startupInFlight.promise
    const identityToken=token.value
    const operation=runBoundSession(identityToken).finally(()=>{if(startupInFlight?.promise===operation){startupInFlight=null;startingVoiceVersion=null}})
    startupInFlight={token:identityToken,promise:operation}
    return operation
  }
  async function runBoundSession(identityToken:string): Promise<void> {
    const access=useAccessStore()
    await access.refresh()
    if(!access.loaded)throw new Error('无法确认当前租户授权，请稍后重试')
    const modules = useProductModulesStore(); await modules.refresh()
    if (!modules.enabled('icc')) { await startSocket(); if(identityToken!==token.value)throw new Error('身份已变化，请重新登录'); isLoggedIn.value=true; return }
    if(access.systemSuperuser){await startSocket();if(identityToken!==token.value)throw new Error('身份已变化，请重新登录');isLoggedIn.value=true;return}
    const binding=useExtensionBindingStore()
    const {useAgentStore}=await import('./agent')
    const agent=useAgentStore()
    try { await startBoundVoice({
      readBinding:async()=>{await binding.refresh();if(identityToken!==token.value)throw new Error('身份已变化，请重新登录');startingVoiceVersion=binding.binding.version;agent.profile.extension=binding.binding.extension;const workNo=String(user.value?.work_no ?? user.value?.uid ?? '').trim();if(workNo)agent.profile.work_no=workNo;return binding.binding},
      startSocket,
      registerSip:getNativeShell()==='web' ? undefined : async()=>{const {ensureSipRegistered}=await import('@/services/sip/registration');await ensureSipRegistered({displayName:agent.profile.work_no})},
      signInVoice:async()=>{await agent.ccsSignIn()},
      clearVoice:async()=>{agent.resetSession();clearCcsSignInMark();clearCcsHealthMarks();await (await import('@/services/sip/registration')).unregisterSip()},
    }) } catch (error) {
      if(binding.binding.extension){await (await import('@/api/extension-binding')).extensionApi.startupFailure(binding.binding.version).catch(()=>undefined);await binding.refresh().catch(()=>undefined)}
      throw new Error(voiceStartupError(error))
    }
    if(identityToken!==token.value)throw new Error('身份已变化，已取消旧话务启动')
    isLoggedIn.value=true
  }

  /** 身份有效的未绑定或主动签出会话允许恢复全媒体。失败话务保留身份以供重试。 */
  async function autoLogin(): Promise<true | 'no_auth' | 'session_expired'> {
    if(!token.value)return 'no_auth'
    let body
    try {
      api.defaults.headers.common['Authorization']=`Bearer ${token.value}`
      body=(await api.get('/auth/validate_token')).data.data
      user.value=body
      const method=body?.authentication_method
      authenticationMethod.value=['social','authorization_code','sms'].includes(method)?method:'password'
    } catch {await logout();return 'no_auth'}
    const access=useAccessStore();await access.refresh()
    if(access.systemSuperuser){isLoggedIn.value=true;return true}
    const modules=useProductModulesStore();await modules.refresh()
    if(!modules.enabled('icc')){clearCcsSignInMark();clearCcsHealthMarks();isLoggedIn.value=true;return true}
    const binding=useExtensionBindingStore()
    try {await binding.refresh()}catch{return 'session_expired'}
    if(!binding.binding.extension || binding.snapshot?.voice.state==='signed_out'){
      clearCcsSignInMark();clearCcsHealthMarks();isLoggedIn.value=true;return true
    }
    if(binding.snapshot?.voice.state!=='signed_in'){isLoggedIn.value=false;return 'session_expired'}
    try {
      const {data}=await api.get<{logged_in:boolean;ccs_up?:boolean;ccs_generation?:number;ccs_boot_id?:string}>('/api/agent/ccs-session')
      if(!data.logged_in){isLoggedIn.value=false;return 'session_expired'}
      rememberCcsHealth({up:data.ccs_up!==false,generation:data.ccs_generation ?? 0,bootId:data.ccs_boot_id,logged_in:true})
    }catch{return 'session_expired'}
    isLoggedIn.value=true;return true
  }

  async function logout() {
    useProductModulesStore().reset()
    const identityToken=token.value
    const { unregisterSip } = await import('@/services/sip/registration')
    await unregisterSip()
    if(token.value!==identityToken)return
    sessionStorage.removeItem('omni.selected-account')
    clearVdnChoices()
    useExtensionBindingStore().reset()
    lastBindingEventVersion=-1
    clearCcsSignInMark(); clearCcsHealthMarks()
    useAccessStore().reset()
    if (signingOut) {
      token.value = ''
      user.value = null
      isLoggedIn.value = false
      clearOmniToken()
      delete api.defaults.headers.common['Authorization']
      disconnectSocket()
      return
    }
    signingOut = true
    const current = identityToken
    if (current) {
      try {
        await Promise.race([
          api.delete('/auth/sign_out', {
            headers: { Authorization: `Bearer ${current}` },
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 5000)),
        ])
      } catch {
        /* ignore */
      }
    }
    if(token.value!==identityToken){signingOut=false;return}
    token.value = ''
    user.value = null
    isLoggedIn.value = false
    authenticationMethod.value = 'password'
    clearOmniToken()
    delete api.defaults.headers.common['Authorization']
    disconnectSocket()
    signingOut = false
  }

  /** 话务会话没了：清会话回登录页，不提示原因。 */
  async function forceLogoutToLogin(_reason?: string) {
    if (forcingLogout) return
    forcingLogout = true
    const identityToken=token.value
    try {
      if (!isLoggedIn.value && !token.value) {
        const { default: router } = await import('../router')
        if (router.currentRoute.value.name !== 'login') {
          await router.replace({ name: 'login' })
        }
        return
      }
      try {
        const { useAgentStore } = await import('./agent')
        if(token.value && token.value!==identityToken)return
        useAgentStore().resetSession()
      } catch {
        /* agent store 可能尚未初始化 */
      }
      if(token.value && token.value!==identityToken)return
      await logout()
      if(token.value && token.value!==identityToken)return
      const { default: router } = await import('../router')
      if (router.currentRoute.value.name !== 'login') {
        await router.replace({ name: 'login' })
      }
    } finally {
      forcingLogout = false
    }
  }

  /**
   * 已在工作台且本页签认定签过话务时，核对 CCS 会话。
   * 明确 logged_in=false 才踢；请求失败不踢（避免闪断误下线）。
   */
  async function ensureCcsSessionAlive(): Promise<'ok' | 'expired' | 'unknown'> {
    if (!useProductModulesStore().enabled('icc')) return 'ok'
    if (isOnLoginPage()) return 'ok'
    const binding=useExtensionBindingStore()
    if(binding.snapshot && (!binding.binding.extension || binding.snapshot.voice.state==='signed_out' || binding.snapshot.operation))return 'ok'
    try {
      const { useAgentStore } = await import('./agent')
      const agent = useAgentStore()
      if (!tabHadCcsSignIn({ agentId: agent.agentId, callActive: agent.callPhase !== 'idle' })) {
        return 'ok'
      }
    } catch {
      /* store 未就绪时仍查一次会话 */
    }
    try {
      const { data } = await api.get<{ logged_in?: boolean }>('/api/agent/ccs-session')
      if (data.logged_in === false) {
        await forceLogoutToLogin('session_expired')
        return 'expired'
      }
      return 'ok'
    } catch {
      return 'unknown'
    }
  }

  async function startSocket() {
    if (token.value) {
      // 必须等 Socket 真正 connected，否则紧随其后的话务签入会报 Socket not connected
      const access = useAccessStore()
      await access.refresh()
      if (!access.loaded) throw new Error('无法确认当前租户授权，请稍后重试')
      await connectSocket(token.value, access.accountId)
      const { wireCcsAgentSocket } = await import('../services/ccs-agent')
      wireCcsAgentSocket()
    }
  }

  return {
    token,
    user,
    isLoggedIn,
    login,
    startBoundSession,
    acceptSocialSession,
    acceptIdentitySession,
    authenticationMethod,
    autoLogin,
    logout,
    startSocket,
    forceLogoutToLogin,
    ensureCcsSessionAlive,
    vdnChoices,
    vdnScope,
    clearVdnChoices,
  }
})
