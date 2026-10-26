<template>
  <div class="mobile-login oa-scroll" :style="{ '--login-visible-height': `${height}px` }">
    <div class="mobile-login-inner">
      <header class="mobile-login-brand">
        <img src="/mobile-brand/original/app-icon.png" width="114" height="114" alt="细语" />
        <h1>智能客服</h1>
      </header>

      <nav v-if="!binding" class="mobile-login-methods" aria-label="登录方式">
        <button type="button" :aria-pressed="loginMode === 'account'" :disabled="loading" @click="loginMode = 'account'">账号登录</button>
        <button type="button" :aria-pressed="loginMode === 'sms'" :disabled="loading" @click="loginMode = 'sms'">手机号登录</button>
        <button v-if="authorizationCodeEnabled" type="button" :aria-pressed="loginMode === 'authorization_code'" :disabled="loading" @click="loginMode = 'authorization_code'">授权码登录</button>
      </nav>
      <section v-if="loginMode === 'sms' && smsSelection && !binding" class="mobile-login-form" aria-label="选择 VDN">
        <h2>选择 VDN</h2>
        <p class="mobile-code-help">手机号验证成功，请选择要进入的 VDN。</p>
        <div class="mobile-vdn-list">
          <button v-for="vdn in smsSelection.vdns" :key="vdn.vdn_id" type="button" :disabled="loading || !smsSelectionValid"
            @click="$emit('selectSmsVdn', vdn.vdn_id)"><span>{{ vdn.name }}</span><small>VDN {{ vdn.vdn_id }}</small></button>
        </div>
        <p v-if="error" class="mobile-login-error" role="alert">{{ error }}</p>
        <button class="mobile-login-cancel" type="button" :disabled="loading" @click="$emit('cancelSmsSelection')">返回手机号验证</button>
      </section>
      <form v-else-if="loginMode === 'authorization_code' && !binding" class="mobile-login-form" @submit.prevent="$emit('submitCode')">
        <h2>授权码登录</h2>
        <p class="mobile-code-help">使用本 VDN 管理员为你签发的一次性授权码，有效期 15 分钟。</p>
        <label class="mobile-field"><span>授权码</span>
          <input v-model="authorizationCode" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false"
            placeholder="粘贴管理员提供的授权码" maxlength="80" required :disabled="loading" />
        </label>
        <p v-if="error" class="mobile-login-error" role="alert">{{ error }}</p>
        <button class="mobile-login-submit" type="submit" :disabled="loading">{{ loading ? '登录中…' : '登录' }}</button>
        <p class="mobile-code-help">登录成功后进入当前身份已授权的工作台。</p>
      </form>
      <form v-else-if="loginMode === 'sms' && !binding" class="mobile-login-form" @submit.prevent="$emit('submitSms')">
        <h2>手机号登录</h2>
        <p class="mobile-code-help">使用手机号和短信验证码登录；验证成功后进入已关联的 VDN。</p>
        <div class="mobile-sms-status">
          <p id="mobile-sms-status" class="mobile-code-help" role="status">{{ smsNotice }}</p>
          <button class="mobile-sms-refresh" type="button" :disabled="loading || smsStatusLoading || smsSending"
            @click="$emit('refreshSms')">{{ smsStatusLoading ? '正在检查…' : '刷新状态' }}</button>
        </div>
        <label class="mobile-field"><span>手机号</span>
          <input v-model="smsPhone" type="tel" inputmode="tel" autocomplete="off" autocapitalize="none" spellcheck="false"
            placeholder="11 位手机号或 +国际区号号码" aria-describedby="mobile-sms-status" required :disabled="loading" />
        </label>
        <div class="mobile-field"><label for="mobile-sms-code">验证码</label>
          <div class="mobile-sms-code-row">
            <input id="mobile-sms-code" v-model="smsCode" type="text" inputmode="numeric" maxlength="6" pattern="[0-9]{6}"
              autocomplete="one-time-code" autocapitalize="none" spellcheck="false" placeholder="六位数字验证码"
              required :disabled="loading || !smsChallengeActive" />
            <button class="mobile-sms-send" type="button" :disabled="!smsCanSend" @click="$emit('requestSms')">
              {{ smsSending ? '正在请求…' : smsRetry > 0 ? smsRetry + ' 秒后重试' : '获取验证码' }}
            </button>
          </div>
        </div>
        <p v-if="smsMessage" class="mobile-code-help" role="status">{{ smsMessage }}</p>
        <p v-if="error" class="mobile-login-error" role="alert">{{ error }}</p>
        <button class="mobile-login-submit" type="submit" :disabled="!smsCanLogin">{{ loading ? '登录中…' : '登录' }}</button>
        <button class="mobile-login-cancel" type="button" :disabled="loading" @click="loginMode = 'account'">返回账号登录</button>
        <p class="mobile-code-help">登录成功后进入当前身份已授权的工作台。</p>
      </form>
      <form v-else class="mobile-login-form" @submit.prevent="$emit('submit')">
        <h2>{{ binding ? '关联已有坐席账号' : '账号登录' }}</h2>
        <label class="mobile-field">
          <span>账号</span>
          <input v-model="email" type="text" autocomplete="username" autocapitalize="none"
            spellcheck="false" placeholder="工号" required :disabled="loading" />
        </label>
        <label class="mobile-field">
          <span>密码</span>
          <div class="mobile-password">
            <input v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password"
              placeholder="输入密码" required :disabled="loading" />
            <button type="button" :aria-label="showPassword ? '隐藏密码' : '显示密码'" :title="showPassword ? '隐藏密码' : '显示密码'"
              @click="showPassword = !showPassword"><el-icon :size="20"><Hide v-if="showPassword" /><View v-else /></el-icon></button>
          </div>
        </label>
        <label v-if="!binding" class="remember-login">
          <input v-model="rememberPassword" type="checkbox" :disabled="loading" />
          记住密码
        </label>
        <section v-if="vdnChoices.length" aria-label="选择 VDN">
          <p class="mobile-code-help">{{ vdnScope === 'all' ? `超级管理员请选择要进入的 VDN。共 ${vdnChoices.length} 个。` : '该工号可进入多个 VDN，请选择。' }}</p>
          <VdnPicker v-model="selectedVdnKey" :choices="vdnChoices" :disabled="loading" />
        </section>
        <p v-if="error" class="mobile-login-error" role="alert">{{ error }}</p>
        <button class="mobile-login-submit" type="submit" :disabled="loading">
          {{ loading ? '登录中…' : binding ? '验证并绑定' : '登录' }}
        </button>
        <button v-if="binding" class="mobile-login-cancel" type="button" :disabled="loading" @click="$emit('cancelBinding')">取消绑定</button>
      </form>

      <section v-if="socialEnabled && !binding && loginMode !== 'sms'" class="mobile-social">
        <h2>企业账号登录</h2>
        <label class="mobile-field"><span>企业代码</span>
          <input v-model="organizationCode" autocomplete="organization" autocapitalize="none" placeholder="企业代码"
            @change="$emit('organizationChange')" />
        </label>
        <div class="mobile-social-actions">
          <button v-for="provider in providers" :key="provider.id" type="button" :disabled="loading"
            @click="$emit('provider', provider.id)"><el-icon><Link /></el-icon>{{ provider.label }}</button>
        </div>
      </section>
      <footer class="mobile-login-footer">绵绵细语，服务在心</footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Hide, View, Link } from '@element-plus/icons-vue'
import VdnPicker, { type VdnChoice } from '@/components/auth/VdnPicker.vue'
import type { SmsVdnSelection } from '@/services/auth/sms-auth'
import type { SocialProvider, SocialProviderId } from '@/services/auth/social-auth'

withDefaults(defineProps<{
  height: number; loading: boolean; error: string; binding: boolean
  socialEnabled?: boolean; providers?: SocialProvider[]; authorizationCodeEnabled?: boolean
  smsNotice?: string; smsStatusLoading?: boolean; smsSending?: boolean; smsCanSend?: boolean; smsCanLogin?: boolean
  smsSelection?: SmsVdnSelection | null; smsSelectionValid?: boolean
  vdnChoices?: VdnChoice[]; vdnScope?: 'seats' | 'all'
  smsRetry?: number; smsMessage?: string; smsChallengeActive?: boolean
}>(), { socialEnabled: false, providers: () => [], authorizationCodeEnabled: false,
  smsNotice: '', smsStatusLoading: false, smsSending: false, smsCanSend: false, smsCanLogin: false,
  smsSelection: null, smsSelectionValid: false, smsRetry: 0, smsMessage: '', smsChallengeActive: false,
  vdnChoices: () => [], vdnScope: 'seats' })
defineEmits<{ submit: []; submitCode: []; requestSms: []; submitSms: []; refreshSms: []; selectSmsVdn: [vdnId: number]; cancelSmsSelection: []; provider: [id: SocialProviderId]; organizationChange: []; cancelBinding: [] }>()
const loginMode = defineModel<'account' | 'authorization_code' | 'sms'>('mode', { default: 'account' })
const smsPhone = defineModel<string>('smsPhone', { default: '' })
const smsCode = defineModel<string>('smsCode', { default: '' })
const authorizationCode = defineModel<string>('authorizationCode', { default: '' })
const email = defineModel<string>('email', { required: true })
const password = defineModel<string>('password', { required: true })
const showPassword = defineModel<boolean>('showPassword', { required: true })
const rememberPassword = defineModel<boolean>('rememberPassword', { default: false })
const selectedVdnKey = defineModel<string>('selectedVdnKey', { default: '' })
const organizationCode = defineModel<string>('organizationCode', { required: true })
</script>

<style scoped>
.mobile-login { height: var(--login-visible-height, 100dvh); width: 100%; overflow-y: auto; overflow-x: hidden; background: #fff;
  overscroll-behavior-y: contain; touch-action: pan-y; -webkit-overflow-scrolling: touch; }
.mobile-login-inner { width: min(100%, 440px); min-height: 100%; margin: 0 auto; display: flex; flex-direction: column;
  padding: max(24px, var(--oa-safe-top)) max(24px, var(--oa-safe-right)) max(20px, var(--oa-safe-bottom)) max(24px, var(--oa-safe-left)); }
.mobile-login-brand { display: flex; align-items: center; gap: 22px; margin: 12px 0 28px; flex-shrink: 0; }
.mobile-login-brand img { object-fit: contain; flex-shrink: 0; }
.mobile-login-brand h1 { font-size: 26px; line-height: 1.25; margin: 0; color: #202731; }
.mobile-login-methods { display: flex; gap: 8px; margin: 0 0 20px; }
.mobile-login-methods button { flex: 1; min-width: 0; min-height: 44px; border: 1px solid #d0d5dd; border-radius: 6px; padding: 10px 4px; background: #fff; color: #475467; font-size: 14px; white-space: nowrap; cursor: pointer; }
.mobile-login-methods button[aria-pressed="true"] { border-color: #0066b3; background: #e9f4fb; color: #0066b3; font-weight: 600; }
.mobile-sms-status { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.mobile-sms-refresh { min-height: 44px; padding: 8px 4px; border: 0; background: transparent; color: #0066b3; font-size: 14px; cursor: pointer; }
.mobile-sms-code-row { display: flex; gap: 8px; min-width: 0; }
.mobile-sms-code-row input { flex: 1; width: 0; }
.mobile-sms-send { flex-shrink: 0; min-height: 48px; padding: 8px; border: 1px solid #0066b3; border-radius: 6px;
  background: #fff; color: #0066b3; font-size: 14px; white-space: nowrap; cursor: pointer; }
.mobile-sms-send:disabled, .mobile-sms-refresh:disabled { opacity: .6; cursor: not-allowed; }
.mobile-sms-send:focus-visible, .mobile-sms-refresh:focus-visible, .mobile-login-methods button:focus-visible,
.mobile-login-submit:focus-visible, .mobile-login-cancel:focus-visible { outline: 2px solid #0066b3; outline-offset: 2px; }
.mobile-vdn-list { display: flex; flex-direction: column; gap: 10px; }
.mobile-vdn-list button { min-height: 56px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 12px 16px;
  border: 1px solid #d0d5dd; border-radius: 6px; background: #fff; color: #202731; font-size: 16px; text-align: left; overflow-wrap: anywhere; cursor: pointer; }
.mobile-vdn-list button small { color: #667085; font-size: 13px; }
.mobile-vdn-list button:focus-visible { outline: 2px solid #0066b3; outline-offset: 2px; }
.mobile-vdn-list button:disabled { opacity: .6; cursor: wait; }
.mobile-code-help { margin: 0; color: #667085; font-size: 14px; line-height: 1.6; }
.mobile-login-form { display: flex; flex-direction: column; gap: 18px; }
h2 { margin: 0; font-size: 18px; line-height: 1.5; font-weight: 600; color: #202731; }
.mobile-field { display: flex; flex-direction: column; gap: 8px; min-width: 0; color: #475467; font-size: 14px; }
.mobile-field input { width: 100%; min-width: 0; min-height: 48px; padding: 10px 12px; border: 1px solid #d0d5dd; border-radius: 6px;
  background: #fff; color: #202731; font: inherit; font-size: 16px; outline: none; }
.mobile-field input:focus { border-color: #0066b3; box-shadow: 0 0 0 2px #e9f4fb; }
.mobile-password { position: relative; }
.mobile-password input { padding-right: 52px; }
.mobile-password button { position: absolute; right: 2px; top: 2px; width: 44px; height: 44px; display: grid; place-items: center;
  border: 0; background: transparent; color: #667085; cursor: pointer; }
.mobile-login-submit { min-height: 48px; border: 0; border-radius: 6px; padding: 12px 16px; font-size: 16px; font-weight: 600; background: #0066b3; color: #fff; cursor: pointer; }
.mobile-login-submit:disabled { opacity: .6; cursor: wait; }
.remember-login { display: flex; align-items: center; gap: 8px; min-height: 44px; color: #475467; font-size: 14px; }
.mobile-login-error { margin: 0; padding: 12px; color: #b42318; background: #fff2f0; border-radius: 4px; font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
.mobile-login-cancel { min-height: 44px; border: 0; background: transparent; color: #475467; font-size: 14px; }
.mobile-social { border-top: 1px solid #eaecf0; margin-top: 28px; padding-top: 22px; display: flex; flex-direction: column; gap: 16px; }
.mobile-social-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.mobile-social-actions button { min-height: 44px; display: flex; justify-content: center; align-items: center; gap: 8px;
  border: 1px solid #d0d5dd; border-radius: 6px; background: #fff; color: #344054; font-size: 14px; padding: 8px; }
.mobile-login-footer { margin-top: auto; padding-top: 28px; text-align: center; font-size: 12px; color: #667085; }
@media (max-height: 560px) { .mobile-login-inner { padding-top: 16px; } .mobile-login-brand { margin: 0 0 18px; }
  .mobile-login-brand img { width: 84px; height: 84px; } .mobile-login-form { gap: 14px; } }
</style>
