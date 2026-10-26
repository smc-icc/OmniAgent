<template>
  <MobileLogin v-if="mobile" v-model:email="email" v-model:password="password"
    v-model:show-password="showPassword" v-model:remember-password="rememberPassword" v-model:organization-code="organizationCode"
    v-model:selected-vdn-key="selectedVdnKey" :vdn-choices="auth.vdnChoices" :vdn-scope="auth.vdnScope"
    :height="height" :loading="loading" :error="formError" :binding="Boolean(bindingTicket)" :providers="providers" :social-enabled="socialEnabled"
    :authorization-code-enabled="authorizationCodeEnabled" v-model:mode="mobileLoginMode" v-model:authorization-code="authorizationCode"
    v-model:sms-phone="smsPhone" v-model:sms-code="smsCode" :sms-notice="smsNotice" :sms-status-loading="smsCapabilityStatus === 'loading'"
    :sms-sending="smsRequest.sending" :sms-can-send="smsCanSend" :sms-can-login="smsCanLogin" :sms-retry="smsRetry"
    :sms-selection="smsSelection" :sms-selection-valid="smsSelectionValid" @select-sms-vdn="onSmsSelect" @cancel-sms-selection="cancelSmsSelection"
    :sms-message="smsRequest.message" :sms-challenge-active="smsRequestValid(smsRequest, smsNow)"
    @request-sms="onSmsRequest" @submit-sms="onSmsLogin" @refresh-sms="refreshSmsCapabilities"
    @submit="onSubmit" @submit-code="onAuthorizationCodeLogin" @provider="onSocialLogin" @organization-change="loadSocialProviders" @cancel-binding="cancelBinding" />
  <div v-else class="login-page">
    <div class="login-bg-shape login-bg-shape--tl" aria-hidden="true" />
    <div class="login-bg-shape login-bg-shape--br" aria-hidden="true" />

    <div class="login-shell">
      <section class="login-panel login-panel--qr">
        <div class="qr-stack">
        <header class="panel-brand">
          <img src="/mobile-brand/original/app-icon.png" width="96" height="96" alt="细语" />
          <h1 class="panel-title">智能客服</h1>
        </header>
        <div class="qr-follow">
        <p class="panel-hint">细语APP / 企业微信 / 钉钉</p>
        <div class="qr-wrap" aria-hidden="true">
          <svg class="qr-svg" viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg">
            <rect width="180" height="180" fill="#fff" />
            <rect x="8" y="8" width="44" height="44" fill="#111" />
            <rect x="14" y="14" width="32" height="32" fill="#fff" />
            <rect x="20" y="20" width="20" height="20" fill="#111" />
            <rect x="128" y="8" width="44" height="44" fill="#111" />
            <rect x="134" y="14" width="32" height="32" fill="#fff" />
            <rect x="140" y="20" width="20" height="20" fill="#111" />
            <rect x="8" y="128" width="44" height="44" fill="#111" />
            <rect x="14" y="134" width="32" height="32" fill="#fff" />
            <rect x="20" y="140" width="20" height="20" fill="#111" />
            <g fill="#111">
              <rect x="64" y="12" width="8" height="8" />
              <rect x="80" y="12" width="8" height="8" />
              <rect x="96" y="12" width="8" height="8" />
              <rect x="64" y="28" width="8" height="8" />
              <rect x="88" y="28" width="8" height="8" />
              <rect x="112" y="28" width="8" height="8" />
              <rect x="64" y="44" width="8" height="8" />
              <rect x="76" y="44" width="8" height="8" />
              <rect x="100" y="44" width="8" height="8" />
              <rect x="64" y="64" width="8" height="8" />
              <rect x="88" y="72" width="8" height="8" />
              <rect x="104" y="64" width="8" height="8" />
              <rect x="120" y="72" width="8" height="8" />
              <rect x="136" y="64" width="8" height="8" />
              <rect x="64" y="88" width="8" height="8" />
              <rect x="80" y="96" width="8" height="8" />
              <rect x="104" y="88" width="8" height="8" />
              <rect x="128" y="96" width="8" height="8" />
              <rect x="152" y="88" width="8" height="8" />
              <rect x="64" y="112" width="8" height="8" />
              <rect x="96" y="120" width="8" height="8" />
              <rect x="120" y="112" width="8" height="8" />
              <rect x="144" y="120" width="8" height="8" />
              <rect x="64" y="136" width="8" height="8" />
              <rect x="88" y="144" width="8" height="8" />
              <rect x="112" y="136" width="8" height="8" />
              <rect x="136" y="144" width="8" height="8" />
              <rect x="160" y="136" width="8" height="8" />
              <rect x="64" y="160" width="8" height="8" />
              <rect x="96" y="152" width="8" height="8" />
              <rect x="120" y="160" width="8" height="8" />
              <rect x="152" y="152" width="8" height="8" />
            </g>
          </svg>
        </div>
        <p class="qr-tip">使用手机 App 扫码登录</p>

        <div class="other-methods">
          <span class="other-label">其他方式</span>
          <div class="other-icons">
            <span class="other-icon other-icon--alipay" title="支付宝">支</span>
            <span class="other-icon other-icon--wechat" title="微信">微</span>
            <span class="other-icon other-icon--ding" title="钉钉">钉</span>
            <span class="other-icon other-icon--corp" title="企业微信">企</span>
          </div>
        </div>
        </div>
        </div>
      </section>

      <div class="login-divider" aria-hidden="true" />

      <section class="login-panel login-panel--form">
        <div class="form-head">
          <div class="tabs" role="tablist">
            <button
              type="button"
              class="tab"
              :class="{ 'tab--active': activeTab === 'account' }"
              @click="activeTab = 'account'; mobileLoginMode = 'account'"
            >
              账密登录
            </button>
            <button
              type="button"
              class="tab"
              :class="{ 'tab--active': activeTab === 'phone' }"
              @click="activeTab = 'phone'; mobileLoginMode = 'sms'"
            >
              手机号登录
            </button>
            <button
              type="button"
              class="tab"
              :class="{ 'tab--active': activeTab === 'passkey' }"
              @click="activeTab = 'passkey'; mobileLoginMode = 'authorization_code'"
            >
              授权码登录
            </button>
          </div>
          <a class="register-link" href="#" @click.prevent>前往注册 &gt;</a>
        </div>

        <section v-if="activeTab === 'phone' && smsSelection" class="login-form" aria-label="选择 VDN">
          <p class="form-help">手机号验证成功，请选择要进入的 VDN。</p>
          <div class="vdn-list">
            <button v-for="vdn in smsSelection.vdns" :key="vdn.vdn_id" type="button" :disabled="loading || !smsSelectionValid" @click="onSmsSelect(vdn.vdn_id)">
              <span>{{ vdn.name }}</span>
              <small>VDN {{ vdn.vdn_id }}</small>
            </button>
          </div>
          <p v-if="formError" class="login-error" role="alert">{{ formError }}</p>
          <button class="text-action" type="button" :disabled="loading" @click="cancelSmsSelection">返回手机号验证</button>
        </section>

        <form v-else-if="activeTab === 'phone'" class="login-form" @submit.prevent="onSmsLogin">
          <p v-if="smsServiceClosed" class="form-help" role="status">服务未开启</p>
          <label class="field">
            <span class="field-label">手机号</span>
            <input v-model="smsPhone" class="field-input" type="tel" inputmode="tel" autocomplete="off" placeholder="11 位手机号或 +国际区号" :disabled="loading" />
          </label>
          <div class="field">
            <label class="field-label" for="web-sms-code">验证码</label>
            <input id="web-sms-code" v-model="smsCode" class="field-input" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="六位数字验证码" :disabled="loading || !smsRequestValid(smsRequest, smsNow)" />
            <button class="sms-send" type="button" :disabled="!smsCanSend" @click="onSmsRequest">
              {{ smsRequest.sending ? '正在请求…' : smsRetry > 0 ? smsRetry + ' 秒后重试' : '获取验证码' }}
            </button>
          </div>
          <p v-if="smsRequest.message" class="form-help" role="status">{{ smsRequest.message }}</p>
          <p v-if="formError" class="login-error" role="alert">{{ formError }}</p>
          <button type="submit" class="submit-btn" :disabled="!smsCanLogin">{{ loading ? '登录中…' : '立即登录' }}</button>
        </form>

        <form v-else-if="activeTab === 'passkey'" class="login-form" @submit.prevent="onAuthorizationCodeLogin">
          <label class="field">
            <span class="field-label">授权码</span>
            <input v-model="authorizationCode" class="field-input" type="text" autocomplete="off" spellcheck="false" maxlength="80" placeholder="粘贴管理员提供的授权码" :disabled="loading || !authorizationCodeEnabled" />
          </label>
          <p v-if="formError" class="login-error" role="alert">{{ formError }}</p>
          <button type="submit" class="submit-btn" :disabled="loading || !authorizationCodeEnabled || !authorizationCode.trim()">
            {{ loading ? '登录中…' : '立即登录' }}
          </button>
        </form>

        <form v-else class="login-form" @submit.prevent="onSubmit">
          <label class="field">
            <span class="field-label">工号</span>
            <input
              v-model="email"
              class="field-input"
              type="text"
              autocomplete="username"
              placeholder="请输入工号"
            />
          </label>
          <label class="field">
            <span class="field-label">密码</span>
            <input
              v-model="password"
              class="field-input field-input--password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              placeholder="请输入"
            />
            <button
              type="button"
              class="pwd-toggle"
              :aria-label="showPassword ? '隐藏密码' : '显示密码'"
              @click="showPassword = !showPassword"
            >
              <View v-if="!showPassword" />
              <Hide v-else />
            </button>
          </label>
          <label class="remember-login">
            <input v-model="rememberPassword" type="checkbox" />
            记住密码
          </label>
          <section v-if="auth.vdnChoices.length" aria-label="选择 VDN">
            <p class="form-help">{{ vdnHelp }}</p>
            <VdnPicker v-model="selectedVdnKey" :choices="auth.vdnChoices" :disabled="loading" />
          </section>

          <p v-if="formError" class="login-error" role="alert">{{ formError }}</p>
          <button type="submit" class="submit-btn" :disabled="loading">
            {{ loading ? '登录中…' : '立即登录' }}
          </button>
          <div class="form-foot">
            <a href="#" class="foot-link" @click.prevent>忘记登录名 &gt;</a>
            <a href="#" class="foot-link" @click.prevent>忘记密码 &gt;</a>
            <a href="#" class="foot-link" @click.prevent>RAM登录 &gt;</a>
          </div>
        </form>

      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { View, Hide } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { useAgentStore } from '@/stores/agent'
import { useAccessStore } from '@/stores/access'
import { formatOmniLoginError, isCredentialLoginError } from '@/utils/login-errors'
import MobileLogin from '@/components/auth/MobileLogin.vue'
import VdnPicker from '@/components/auth/VdnPicker.vue'
import { useMobileLogin } from '@/composables/useMobileLogin'
import { loginDestination, passwordLogin } from '@/services/auth/password-login'
import { socialCapabilities, socialProviders, socialLogin, bindSocialIdentity, cancelSocialLogin, type SocialProvider, type SocialProviderId, type SocialAuthResult } from '@/services/auth/social-auth'
import { loginCodeCapabilities, loginWithAuthorizationCode } from '@/services/auth/login-code'
import { smsCapabilities, requestSmsCode, loginWithSms, selectSmsVdn, type SmsVdnSelection, type SmsAuthenticated } from '@/services/auth/sms-auth'
import { SMS_SERVICE_UNAVAILABLE, emptySmsRequest, canRequestSms, beginSmsRequest, completeSmsRequest, failSmsRequest,
  invalidateSmsRequest, expireSmsRequest, smsRequestValid, smsRetrySeconds, smsCredentialsError, validSmsCode,
  smsCapabilityNotice, type SmsCapabilities } from '@/services/auth/sms-login-policy'

type LoginTab = 'account' | 'phone' | 'passkey'

const router = useRouter()
const route = useRoute()
/** 登录成功后要回到的页面（来自 ?redirect=，由 loginDestination 做站内校验）。 */
const loginRedirect = computed(() => route.query.redirect)
const auth = useAuthStore()
const agent = useAgentStore()
const { mobile, height } = useMobileLogin()

const activeTab = ref<LoginTab>('account')
const email = ref('')
const rememberPassword = ref(false)
const selectedVdnKey = ref('')
const vdnHelp = computed(() => auth.vdnScope === 'all'
  ? `超级管理员请选择要进入的 VDN。共 ${auth.vdnChoices.length} 个。`
  : '该工号可进入多个 VDN，请选择。')
const REMEMBER_KEY = 'omni.remember-login'
const password = ref('')
const showPassword = ref(false)
const loading = ref(false)
const formError = ref('')
const providers = ref<SocialProvider[]>([])
const socialEnabled = ref(false)
const organizationCode = ref(localStorage.getItem('xiyu_organization_code') ?? '')
const bindingTicket = ref('')
const mobileLoginMode = ref<'account' | 'authorization_code' | 'sms'>('account')
const authorizationCode = ref('')
const authorizationCodeEnabled = ref(false)
watch(mobileLoginMode, mode => { formError.value = ''; authorizationCode.value = ''; if (!mobile.value && mode === 'account') activeTab.value = 'account' }, { flush: 'sync' })

// Phone, OTP and VDN choice receipts stay in memory.
const smsSelection = ref<(SmsVdnSelection & { expiresAt: number }) | null>(null)
const smsPhone = ref('')
const smsCode = ref('')
const smsRequest = ref(emptySmsRequest())
const smsCapability = ref<SmsCapabilities | null>(null)
const smsCapabilityStatus = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const smsNow = ref(Date.now())
const smsActive = computed(() => (mobile.value || activeTab.value === 'phone') && mobileLoginMode.value === 'sms' && !bindingTicket.value)
const smsReady = computed(() => smsCapabilityStatus.value === 'ready' && smsCapability.value?.ready === true)
const smsRetry = computed(() => smsRetrySeconds(smsRequest.value, smsNow.value))
const smsSelectionValid = computed(() => !!smsSelection.value && smsNow.value < smsSelection.value.expiresAt)
const smsCanSend = computed(() => !smsSelection.value && smsActive.value && !loading.value && canRequestSms(smsRequest.value, smsReady.value,
  { phone: smsPhone.value }, smsNow.value))
const smsCanLogin = computed(() => !smsSelection.value && smsActive.value && smsReady.value && !loading.value && smsRequestValid(smsRequest.value, smsNow.value) &&
  !smsCredentialsError({ phone: smsPhone.value }) && validSmsCode(smsCode.value))
const smsServiceClosed = computed(() => activeTab.value === 'phone' && smsCapabilityStatus.value !== 'idle' && smsCapabilityStatus.value !== 'loading' && !smsReady.value)
const smsNotice = computed(() => {
  if (smsCapabilityStatus.value === 'loading' || smsCapabilityStatus.value === 'idle') return '正在检查手机号登录服务…'
  if (smsCapabilityStatus.value === 'error' || !smsCapability.value) return SMS_SERVICE_UNAVAILABLE
  return smsCapabilityNotice(smsCapability.value) || '手机号登录已可用，请获取验证码。'
})
let smsSendController: AbortController | null = null
let smsLoginController: AbortController | null = null
let smsCapabilityController: AbortController | null = null
let smsCapabilityGeneration = 0
let smsTimer: ReturnType<typeof window.setInterval> | undefined
let disposed = false

function invalidateSmsChallenge() {
  smsRequest.value = invalidateSmsRequest(smsRequest.value)
  smsCode.value = ''
  smsSelection.value = null
  smsSendController?.abort()
  smsLoginController?.abort()
}

function tickSmsClock() {
  if (disposed) return
  smsNow.value = Date.now()
  // The server decides an in-flight exchange; local TTL cleanup waits until it settles.
  if (smsLoginController) return
  if (smsSelection.value && smsNow.value >= smsSelection.value.expiresAt) {
    invalidateSmsChallenge()
    if (smsActive.value) formError.value = 'VDN 选择已过期，请重新验证手机号'
    return
  }
  const expired = expireSmsRequest(smsRequest.value, smsNow.value)
  if (expired !== smsRequest.value) {
    smsRequest.value = expired
    smsCode.value = ''
    if (smsActive.value) formError.value = '验证码已过期，请重新获取验证码'
  }
}

watch([smsPhone, mobileLoginMode, mobile, bindingTicket], () => {
  invalidateSmsChallenge()
  if (smsActive.value) formError.value = ''
}, { flush: 'sync' })
watch(smsActive, active => {
  if (smsTimer !== undefined) { window.clearInterval(smsTimer); smsTimer = undefined }
  if (active && !disposed) {
    tickSmsClock()
    smsTimer = window.setInterval(tickSmsClock, 1000)
  }
}, { flush: 'sync' })
watch(mobile, active => {
  if (active && smsCapabilityStatus.value === 'idle') void refreshSmsCapabilities()
  if (!active) {
    activeTab.value = mobileLoginMode.value === 'sms' ? 'phone' : mobileLoginMode.value === 'authorization_code' ? 'passkey' : 'account'
    smsCapabilityGeneration++
    smsCapabilityController?.abort()
    smsCapabilityStatus.value = 'idle'
    smsCapability.value = null
    smsPhone.value = ''
  }
}, { flush: 'sync' })
watch(activeTab, tab => {
  if (!mobile.value && tab === 'phone' && smsCapabilityStatus.value === 'idle') void refreshSmsCapabilities()
})

async function refreshSmsCapabilities() {
  if (disposed || (!mobile.value && activeTab.value !== 'phone') || loading.value || smsRequest.value.sending || smsCapabilityStatus.value === 'loading') return
  const generation = ++smsCapabilityGeneration
  const controller = new AbortController()
  smsCapabilityController = controller
  smsCapabilityStatus.value = 'loading'
  try {
    const status = await smsCapabilities(controller.signal)
    if (disposed || generation !== smsCapabilityGeneration) return
    smsCapability.value = status
    smsCapabilityStatus.value = 'ready'
    if (!status.ready) invalidateSmsChallenge()
  } catch {
    if (disposed || generation !== smsCapabilityGeneration) return
    smsCapability.value = null
    smsCapabilityStatus.value = 'error'
    invalidateSmsChallenge()
  } finally {
    if (smsCapabilityController === controller) smsCapabilityController = null
  }
}

async function onSmsRequest() {
  tickSmsClock()
  if (disposed || !smsCanSend.value) return
  formError.value = ''
  smsCode.value = ''
  smsRequest.value = beginSmsRequest(smsRequest.value, Date.now(), smsCapability.value?.retry_after)
  const generation = smsRequest.value.generation
  const controller = new AbortController()
  smsSendController = controller
  try {
    const result = await requestSmsCode({ phone: smsPhone.value }, controller.signal)
    if (disposed) return
    smsRequest.value = completeSmsRequest(smsRequest.value, generation, result, Date.now())
    tickSmsClock()
  } catch (error) {
    if (disposed || generation !== smsRequest.value.generation) return
    smsRequest.value = failSmsRequest(smsRequest.value, generation)
    formError.value = error instanceof Error ? error.message : SMS_SERVICE_UNAVAILABLE
  } finally {
    if (smsSendController === controller) smsSendController = null
  }
}

async function onSmsLogin() {
  tickSmsClock()
  if (disposed || !smsCanLogin.value) return
  const generation = smsRequest.value.generation
  const startedAt = Date.now()
  const controller = new AbortController()
  smsLoginController = controller
  loading.value = true
  formError.value = ''
  let accepted = false
  try {
    const result = await loginWithSms({ requestId: smsRequest.value.requestId, phone: smsPhone.value, code: smsCode.value }, controller.signal)
    if (disposed || generation !== smsRequest.value.generation) return
    smsLoginController = null
    if (result.status === 'select_vdn') {
      invalidateSmsChallenge()
      smsSelection.value = { ...result, expiresAt: startedAt + result.expires_in * 1000 }
      tickSmsClock()
    } else if (result.status === 'unbound') {
      invalidateSmsChallenge()
      formError.value = result.message
    } else { accepted = true; await acceptSmsSession(result) }
  } catch (error) {
    if (disposed || (!accepted && generation !== smsRequest.value.generation)) return
    presentLoginError(error, '手机号登录失败，请重新获取验证码后重试')
  } finally {
    smsCode.value = ''
    if (!disposed) loading.value = false
    if (smsLoginController === controller) smsLoginController = null
    tickSmsClock()
  }
}

async function acceptSmsSession(result: SmsAuthenticated) {
  agent.resetSession()
  auth.acceptIdentitySession(result, 'sms')
  invalidateSmsChallenge()
  await finishIdentitySession()
  smsPhone.value = ''
}
function cancelSmsSelection() {
  if (loading.value) return
  invalidateSmsChallenge()
  formError.value = ''
}
async function onSmsSelect(vdnId: number) {
  tickSmsClock()
  const selection = smsSelection.value
  if (disposed || loading.value || !smsActive.value || !smsReady.value || !smsSelectionValid.value || !selection?.vdns.some(v => v.vdn_id === vdnId)) return
  const generation = smsRequest.value.generation
  const controller = new AbortController()
  smsLoginController = controller
  loading.value = true
  formError.value = ''
  let accepted = false
  try {
    const result = await selectSmsVdn({ phone: smsPhone.value, selectionTicket: selection.selection_ticket, vdnId }, controller.signal)
    if (disposed || generation !== smsRequest.value.generation) return
    smsLoginController = null
    accepted = true
    await acceptSmsSession(result)
  } catch (error) {
    if (disposed || (!accepted && generation !== smsRequest.value.generation)) return
    smsLoginController = null
    if (!accepted) invalidateSmsChallenge()
    presentLoginError(error, 'VDN 登录失败，请重新验证手机号')
  } finally {
    if (!disposed) loading.value = false
    if (smsLoginController === controller) smsLoginController = null
    tickSmsClock()
  }
}

onUnmounted(() => {
  disposed = true
  smsCapabilityGeneration++
  smsCapabilityController?.abort()
  invalidateSmsChallenge()
  smsPhone.value = ''
  if (smsTimer !== undefined) window.clearInterval(smsTimer)
  window.removeEventListener('focus', tickSmsClock)
  window.removeEventListener('pageshow', tickSmsClock)
  document.removeEventListener('visibilitychange', tickSmsClock)
})


async function loadSocialProviders() {
  try {
    socialEnabled.value = (await socialCapabilities()).length > 0
    providers.value = await socialProviders(organizationCode.value)
  }
  catch { providers.value = [] }
}

function cancelBinding() { bindingTicket.value = ''; password.value = ''; formError.value = ''; void cancelSocialLogin() }

async function finishSocial(result: SocialAuthResult) {
  if (result.status === 'binding_required') {
    if (!result.bindingTicket) throw new Error('账号绑定凭据缺失')
    bindingTicket.value = result.bindingTicket
    password.value = ''
    return
  }
  agent.resetSession()
  auth.acceptSocialSession(result)
  await finishIdentitySession()
  localStorage.setItem('xiyu_organization_code', organizationCode.value.trim())
}

async function abandonPartialSession() {
  if (!auth.token) return
  try { await auth.logout() } catch { /* 半截会话清不掉也要回到登录表单 */ }
  agent.resetSession()
}

function clearRejectedPassword() {
  password.value = ''
  if (!rememberPassword.value) return
  localStorage.setItem(REMEMBER_KEY, JSON.stringify({ account: email.value, password: '' }))
}

function presentLoginError(error: unknown, fallback: string) {
  const msg = error instanceof Error && error.message ? error.message : ''
  formError.value = msg || formatOmniLoginError(error) || fallback
  if (isCredentialLoginError(formError.value)) clearRejectedPassword()
}

async function finishIdentitySession() {
  if (!auth.token) throw new Error('登录会话已失效，请重新登录')
  try {
    await auth.startBoundSession()
    await router.replace(loginDestination(useAccessStore().systemSuperuser, mobile.value, loginRedirect.value))
  } catch (error) {
    await abandonPartialSession()
    throw error
  }
}

async function onSocialLogin(provider: SocialProviderId) {
  if (loading.value) return
  loading.value = true
  formError.value = ''
  try { await finishSocial(await socialLogin(provider, organizationCode.value)) }
  catch (error) { presentLoginError(error, '第三方登录失败') }
  finally { loading.value = false }
}

async function onAuthorizationCodeLogin() {
  if (loading.value || !authorizationCodeEnabled.value || !authorizationCode.value.trim()) return
  loading.value = true
  formError.value = ''
  try {
    const result = await loginWithAuthorizationCode(authorizationCode.value)
    agent.resetSession()
    auth.acceptIdentitySession(result, 'authorization_code')
    await finishIdentitySession()
  } catch (error) { presentLoginError(error, '授权码登录失败，请重试') }
  finally { authorizationCode.value = ''; loading.value = false }
}

function loadRememberedLogin() {
  try {
    const saved = JSON.parse(localStorage.getItem(REMEMBER_KEY) || '') as { account?: string; password?: string }
    if (!saved?.account) return
    email.value = saved.account
    password.value = saved.password || ''
    rememberPassword.value = true
  } catch { localStorage.removeItem(REMEMBER_KEY) }
}
function storeRememberedLogin() {
  if (!rememberPassword.value) { localStorage.removeItem(REMEMBER_KEY); return }
  localStorage.setItem(REMEMBER_KEY, JSON.stringify({ account: email.value, password: password.value }))
}
watch(rememberPassword, checked => { if (!checked) localStorage.removeItem(REMEMBER_KEY) })
watch(email, () => { selectedVdnKey.value = ''; auth.clearVdnChoices() })
onMounted(() => {
  loadRememberedLogin()
  localStorage.removeItem('ccs_extension')
  if (auth.token && !auth.isLoggedIn) void abandonPartialSession()
  window.addEventListener('focus', tickSmsClock)
  window.addEventListener('pageshow', tickSmsClock)
  document.addEventListener('visibilitychange', tickSmsClock)
  if (mobile.value) document.title = '细语'
  if (smsCapabilityStatus.value === 'idle') void refreshSmsCapabilities()
  void loadSocialProviders()
  void loginCodeCapabilities().then(ready => { authorizationCodeEnabled.value = ready }).catch(() => { authorizationCodeEnabled.value = false })
})

async function onSubmit() {
  if (loading.value) return
  formError.value = ''
  loading.value = true
  try {
    if (bindingTicket.value) {
      await finishSocial(await bindSocialIdentity(bindingTicket.value, email.value, password.value))
      password.value = ''
      return
    }
    const target = await passwordLogin({ email: email.value, password: password.value }, {
      login: async (loginEmail, loginPassword) => {
        const chosen = auth.vdnChoices.find(item => `${item.user_id}:${item.vdn_id ?? 0}` === selectedVdnKey.value)
        if (auth.vdnChoices.length && !chosen) { const error = new Error('请选择 VDN'); error.name = 'NeedVdn'; throw error }
        const result = await auth.login(loginEmail, loginPassword, chosen ? { user_id: chosen.user_id, vdn_id: chosen.vdn_id } : undefined)
        if (result === 'select_vdn') { selectedVdnKey.value = ''; const error = new Error('请选择 VDN'); error.name = 'SelectVdn'; throw error }
        agent.resetSession()
      },
      startup: auth.startBoundSession,
      destination: () => loginDestination(useAccessStore().systemSuperuser, mobile.value, loginRedirect.value),
      setWorkNumber: () => { const workNo = String(auth.user?.work_no ?? auth.user?.uid ?? '').trim(); if (workNo) agent.profile.work_no = workNo },
    })
    storeRememberedLogin()
    auth.isLoggedIn = true
    if (!rememberPassword.value) password.value = ''
    ElMessage.success('登录成功')
    await router.replace(target)
  } catch (e) {
    if (e instanceof Error && e.name === 'SelectVdn') return
    if (e instanceof Error && e.name === 'NeedVdn') { formError.value = e.message; return }
    await abandonPartialSession()
    presentLoginError(e, '登录失败，请重试')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-error { color: #b42318; line-height: 1.5; overflow-wrap: anywhere; margin: 12px 0; }
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 20px;
  background: linear-gradient(135deg, #eef3fb 0%, #f7f9fc 42%, #edf1f8 100%);
  position: relative;
  overflow: hidden;
}

.login-bg-shape {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}

.login-bg-shape--tl {
  width: 420px;
  height: 420px;
  top: -120px;
  left: -80px;
  background: radial-gradient(circle, rgba(64, 105, 225, 0.08) 0%, transparent 70%);
}

.login-bg-shape--br {
  width: 360px;
  height: 360px;
  right: -60px;
  bottom: -80px;
  background: radial-gradient(circle, rgba(99, 132, 255, 0.1) 0%, transparent 72%);
}

.login-shell {
  position: relative;
  z-index: 1;
  display: flex;
  width: min(920px, 100%);
  min-height: 520px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 18px 48px rgba(31, 45, 61, 0.08);
  overflow: hidden;
}

.login-panel {
  flex: 1;
  padding: 40px 36px 32px;
  display: flex;
  flex-direction: column;
}

.login-panel--qr {
  max-width: 360px;
  align-items: flex-start;
}

.qr-stack {
  display: flex;
  flex-direction: column;
  flex: 1;
  width: fit-content;
  max-width: 100%;
  min-height: 100%;
}

.qr-follow {
  width: 0;
  min-width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.login-divider {
  width: 1px;
  background: #ebeef5;
  flex-shrink: 0;
}

.panel-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.panel-brand img {
  width: 96px;
  height: 96px;
  object-fit: contain;
  flex-shrink: 0;
}

.panel-title {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
  color: #1f2d3d;
  line-height: 1.25;
}

.panel-hint {
  margin: 10px 0 0;
  font-size: 13px;
  color: #4069e1;
  text-align: center;
}

.qr-wrap {
  margin: 28px 0 12px;
  width: 180px;
  height: 180px;
  padding: 8px;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  background: #fff;
}

.qr-svg {
  display: block;
  width: 100%;
  height: 100%;
}

.qr-tip {
  margin: 0;
  text-align: center;
  font-size: 12px;
  color: #909399;
}

.other-methods {
  margin-top: auto;
  padding-top: 28px;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.other-label {
  display: block;
  font-size: 12px;
  color: #909399;
  margin: 0;
  white-space: nowrap;
}

.other-icons {
  display: flex;
  justify-content: center;
  gap: 14px;
}

.other-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  cursor: default;
}

.other-icon--alipay {
  background: #1677ff;
}

.other-icon--wechat {
  background: #07c160;
}

.other-icon--ding {
  background: #0089ff;
}

.other-icon--corp {
  background: #2f54eb;
}

.login-panel--form {
  justify-content: flex-start;
  /* 页签与左侧 96px 标头里的「智能客服」同一水平线 */
  padding-top: calc(40px + (96px - 28px) / 2);
  padding-bottom: 32px;
}

.form-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 28px;
}

.tabs {
  display: flex;
  gap: 24px;
}

.tab {
  border: none;
  background: none;
  padding: 0 0 10px;
  font-size: 15px;
  color: #606266;
  cursor: pointer;
  position: relative;
}

.tab--active {
  color: #1f2d3d;
  font-weight: 600;
}

.tab--active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: #4069e1;
  border-radius: 1px;
}

.register-link {
  flex-shrink: 0;
  font-size: 13px;
  color: #4069e1;
  text-decoration: none;
}

.register-link:hover {
  color: #2f54eb;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  align-items: center;
  min-height: 44px;
  border: 1px solid #dcdfe6;
  border-radius: 2px;
  padding: 0 14px;
  transition: border-color 0.2s;
}

.field:focus-within {
  border-color: #4069e1;
}

.field-label {
  flex-shrink: 0;
  width: 56px;
  font-size: 14px;
  color: #303133;
}

.field-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 14px;
  color: #303133;
  background: transparent;
  min-width: 0;
}

.field-input::placeholder {
  color: #c0c4cc;
}

.field-input--password {
  padding-right: 4px;
}

.pwd-toggle {
  border: none;
  background: none;
  padding: 4px;
  color: #909399;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.pwd-toggle:hover {
  color: #606266;
}

.pwd-toggle :deep(svg) {
  width: 18px;
  height: 18px;
}

.submit-btn {
  margin-top: 8px;
  height: 44px;
  border: none;
  border-radius: 2px;
  background: #4069e1;
  color: #fff;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.submit-btn:hover:not(:disabled) {
  background: #2f54eb;
}

.submit-btn:disabled {
  opacity: 0.72;
  cursor: not-allowed;
}

.remember-login {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #606266;
  font-size: 13px;
}

.form-foot {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.form-help {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: #909399;
}

.text-action {
  border: none;
  background: none;
  padding: 0;
  color: #4069e1;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}

.text-action:disabled {
  color: #c0c4cc;
  cursor: not-allowed;
}

.sms-send {
  flex-shrink: 0;
  border: none;
  background: none;
  padding: 0 0 0 8px;
  color: #4069e1;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}

.sms-send:disabled {
  color: #c0c4cc;
  cursor: not-allowed;
}

.vdn-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.vdn-list button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-height: 44px;
  padding: 10px 14px;
  border: 1px solid #dcdfe6;
  border-radius: 2px;
  background: #fff;
  color: #303133;
  text-align: left;
  cursor: pointer;
}

.vdn-list button small {
  color: #909399;
  font-size: 12px;
}

.vdn-list button:hover:not(:disabled) {
  border-color: #4069e1;
  color: #4069e1;
}

.vdn-list button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.foot-link {
  font-size: 12px;
  color: #909399;
  text-decoration: none;
}

.foot-link:hover {
  color: #4069e1;
}

.tab-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: #909399;
  font-size: 14px;
  min-height: 280px;
}

.back-tab {
  border: 1px solid #dcdfe6;
  background: #fff;
  color: #606266;
  border-radius: 2px;
  padding: 8px 16px;
  cursor: pointer;
}

.back-tab:hover {
  border-color: #4069e1;
  color: #4069e1;
}

@media (max-width: 860px) {
  .login-shell {
    flex-direction: column;
    min-height: auto;
  }

  .login-divider {
    width: auto;
    height: 1px;
  }

  .login-panel--qr {
    max-width: none;
  }

  .other-methods {
    margin-top: 24px;
  }
}
</style>
