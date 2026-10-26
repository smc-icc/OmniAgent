import { confTenancyEnabled } from '../../shared/services/conf-tenancy.js';
import { getSmsProviderConfig } from '../../shared/services/sms-provider.js';
import { sendSmsToNumber } from '../channels/sms/outgoing.js';
import { AppError } from '../../shared/errors/index.js';
import type { PhoneDelivery, PhoneReadiness } from './phone-auth.service.js';

export async function phoneReadiness(): Promise<PhoneReadiness> {
  if (!confTenancyEnabled()) return { supported: false, ready: false, reason: '当前环境尚未启用企业坐席映射，请使用账号或授权码登录' };
  if (process.env.OMNI_SMS_LOGIN_ENABLED === '0') return { supported: true, ready: false, reason: '手机号登录已停用，请使用账号或授权码登录' };
  const config = getSmsProviderConfig();
  const ready = config?.enabled !== false && config?.login_enabled === true && typeof config.endpoint === 'string' &&
    /^https?:\/\//.test(config.endpoint.trim()) && typeof config.login_template_id === 'string' && !!config.login_template_id.trim();
  return { supported: true, ready, reason: ready ? '' : '短信验证码服务尚未配置，请联系平台管理员；可使用账号或授权码登录' };
}
export function phoneDelivery(failure: PhoneDelivery['failure']): PhoneDelivery {
  return {
    readiness: phoneReadiness,
    failure,
    send: async (phone, code) => {
      if (!(await phoneReadiness()).ready) throw new AppError(503, '短信登录服务尚未配置');
      const config = getSmsProviderConfig()!;
      const to = config.login_phone_format === 'national' && phone.startsWith('+86') && phone.length === 14 ? phone.slice(3) : phone;
      const result = await sendSmsToNumber(0, to, `您的细语登录验证码为 ${code}，5 分钟内有效。请勿向他人提供验证码。`,
        { providerTemplateId: config.login_template_id, templateParameters: { code, minutes: '5' }, timeoutMs: 8000, platformOnly: true });
      // Never log or return provider bodies, which can contain phone numbers, OTPs or credentials.
      if (!result.ok) throw new AppError(502, '短信验证码发送失败');
    },
  };
}
