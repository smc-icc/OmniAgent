import { prisma } from '../../plugins/db.js';
import { AppError } from '../errors/index.js';
import { confTenancyEnabled, sourceVdn } from './conf-tenancy.js';
import { CHANNEL_KEY_TO_TYPE, type OmniChannelKey } from '../channels/types.js';
const models: Record<OmniChannelKey, string> = {
  web_widget: 'channel_web_widgets', api: 'channel_api', weibo: 'channel_api', miniprogram: 'channel_api', telegram: 'channel_telegram', line: 'channel_line',
  sms: 'channel_sms', twilio_sms: 'channel_twilio_sms', email: 'channel_email', whatsapp: 'channel_whatsapp', facebook: 'channel_facebook_pages',
  instagram: 'channel_instagram', tiktok: 'channel_tiktok', wechat_mp: 'channel_wechat_mp', wecom_kf: 'channel_wecom_kf', wecom_contact: 'channel_wecom_contact',
};
export async function resolveChannelAccount(payload: { account_id?: number; vdn_id?: number }) {
  if (!confTenancyEnabled()) return payload.account_id ?? 1;
  if (payload.account_id == null && payload.vdn_id == null) throw new AppError(400, '托管渠道必须显式指定 VDN 或 account，禁止默认 account 1');
  for (const value of [payload.account_id, payload.vdn_id]) if (value != null && (!Number.isSafeInteger(value) || value <= 0)) throw new AppError(400, '无效租户标识');
  const map = payload.vdn_id != null ? await prisma.conf_vdn_accounts.findUnique({ where: { vdn_id: payload.vdn_id } })
    : await prisma.conf_vdn_accounts.findUnique({ where: { account_id: payload.account_id! } });
  if (!map?.enabled || !await sourceVdn(map.vdn_id) || (payload.account_id != null && payload.account_id !== map.account_id)) throw new AppError(403, '渠道 VDN/account 映射无效或不一致');
  return map.account_id;
}
/** Every trusted sync must prove existing channel AND inbox ownership before side effects. */
export async function assertChannelOwnership(accountId: number, type: OmniChannelKey, id?: number | null, data: Record<string, unknown> = {}) {
  if (!confTenancyEnabled()) return;
  if (!models[type]) throw new AppError(400, '无效渠道类型');
  if (data.account_id != null && data.account_id !== accountId) throw new AppError(403, '渠道数据不能覆盖租户');
  let channelId = id;
  if (type === 'wechat_mp' && !channelId && typeof data.app_id === 'string') {
    const existing = await prisma.channel_wechat_mp.findUnique({ where: { app_id: data.app_id } });
    if (existing) { if (existing.account_id !== accountId) throw new AppError(409, 'AppID 已属于其他租户，禁止自动接管'); channelId = existing.id; }
  }
  if (channelId == null) return;
  if (!Number.isSafeInteger(channelId) || channelId <= 0) throw new AppError(400, '无效渠道 ID');
  const channel = await (prisma as any)[models[type]].findUnique({ where: { id: channelId }, select: { id: true, account_id: true } });
  if (!channel || channel.account_id !== accountId) throw new AppError(403, '渠道不属于当前租户');
  const relatedTypes = Object.keys(models).filter(key => models[key as OmniChannelKey] === models[type]).map(key => CHANNEL_KEY_TO_TYPE[key as OmniChannelKey]);
  const inboxes = await prisma.inboxes.findMany({ where: { channel_id: channelId, channel_type: { in: relatedTypes } }, select: { account_id: true, channel_type: true } });
  if (inboxes.some(i => i.account_id !== accountId || i.channel_type !== CHANNEL_KEY_TO_TYPE[type])) throw new AppError(403, '渠道收件箱归属或类型不一致');
}
