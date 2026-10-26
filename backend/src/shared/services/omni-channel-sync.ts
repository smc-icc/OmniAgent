import { resolveChannelAccount, assertChannelOwnership } from './conf-channel-tenancy.js';
import type { OmniChannelKey } from '../channels/types.js';
import {
  clearChannelRoutes,
  normalizeRouteChannelType,
  replaceChannelRoutes,
} from './channel-route.js';
import { applyWechatChannelSync } from './wechat-channel-sync.js';
import { syncWebWidget, deleteWebWidget } from '../../modules/channels/web-widget/sync.js';
import { syncApiChannel, deleteApiChannel, syncWeiboChannel, deleteWeiboChannel, syncMiniprogramChannel, deleteMiniprogramChannel } from '../../modules/channels/api/sync.js';
import { syncTelegram, deleteTelegram } from '../../modules/channels/telegram/sync.js';
import { syncLine, deleteLine } from '../../modules/channels/line/sync.js';
import { syncTwilioSms, syncGenericSms, deleteTwilioSms, deleteGenericSms } from '../../modules/channels/sms/sync.js';
import { syncEmail, deleteEmail } from '../../modules/channels/email/sync.js';
import { syncWhatsapp, deleteWhatsapp } from '../../modules/channels/whatsapp/sync.js';
import { syncFacebook, deleteFacebook } from '../../modules/channels/facebook/sync.js';
import { syncInstagram, deleteInstagram } from '../../modules/channels/instagram/sync.js';
import { syncTiktok, deleteTiktok } from '../../modules/channels/tiktok/sync.js';

export type OmniChannelSyncPayload = {
  action: 'upsert' | 'delete';
  channel_type: OmniChannelKey | 'wechat_mp' | 'wecom_kf' | 'wecom_contact';
  account_id?: number;
  vdn_id?: number;
  omni_channel_id?: number | null;
  data?: Record<string, unknown>;
};

const WECHAT_TYPES = ['wechat_mp', 'wecom_kf', 'wecom_contact'] as const;

export async function applyOmniChannelSync(payload: OmniChannelSyncPayload) {
  const { action, channel_type, omni_channel_id, data = {} } = payload;
  const account_id = await resolveChannelAccount(payload);
  await assertChannelOwnership(account_id, channel_type, omni_channel_id, data);

  if (WECHAT_TYPES.includes(channel_type as typeof WECHAT_TYPES[number])) {
    return applyWechatChannelSync({
      action,
      channel_type: channel_type as 'wechat_mp' | 'wecom_kf' | 'wecom_contact',
      account_id,
      vdn_id: payload.vdn_id,
      omni_channel_id,
      data,
    });
  }

  if (action === 'delete') {
    if (!omni_channel_id) throw new Error('omni_channel_id required for delete');
    const deleted = await deleteChannel(channel_type as OmniChannelKey, omni_channel_id);
    const routeType = normalizeRouteChannelType(channel_type);
    if (routeType) await clearChannelRoutes(routeType, omni_channel_id);
    return deleted;
  }

  let result: { omni_channel_id?: number };
  switch (channel_type as OmniChannelKey) {
    case 'web_widget':
      result = await syncWebWidget(account_id, omni_channel_id, data);
      break;
    case 'api':
      result = await syncApiChannel(account_id, omni_channel_id, data);
      break;
    case 'weibo':
      result = await syncWeiboChannel(account_id, omni_channel_id, data);
      break;
    case 'miniprogram':
      result = await syncMiniprogramChannel(account_id, omni_channel_id, data);
      break;
    case 'telegram':
      result = await syncTelegram(account_id, omni_channel_id, data);
      break;
    case 'line':
      result = await syncLine(account_id, omni_channel_id, data);
      break;
    case 'twilio_sms':
      result = await syncTwilioSms(account_id, omni_channel_id, data);
      break;
    case 'sms':
      result = await syncGenericSms(account_id, omni_channel_id, data);
      break;
    case 'email':
      result = await syncEmail(account_id, omni_channel_id, data);
      break;
    case 'whatsapp':
      result = await syncWhatsapp(account_id, omni_channel_id, data);
      break;
    case 'facebook':
      result = await syncFacebook(account_id, omni_channel_id, data);
      break;
    case 'instagram':
      result = await syncInstagram(account_id, omni_channel_id, data);
      break;
    case 'tiktok':
      result = await syncTiktok(account_id, omni_channel_id, data);
      break;
    default:
      throw new Error(`unsupported channel_type: ${channel_type}`);
  }

  const channelId = Number(result.omni_channel_id ?? omni_channel_id ?? 0);
  const routeType = normalizeRouteChannelType(channel_type);
  if (routeType && channelId > 0) {
    await replaceChannelRoutes(channelId, data.routes, routeType);
  }
  return result;
}

async function deleteChannel(channelType: OmniChannelKey, omniChannelId: number) {
  switch (channelType) {
    case 'web_widget':
      await deleteWebWidget(omniChannelId);
      break;
    case 'api':
      await deleteApiChannel(omniChannelId);
      break;
    case 'weibo':
      await deleteWeiboChannel(omniChannelId);
      break;
    case 'miniprogram':
      await deleteMiniprogramChannel(omniChannelId);
      break;
    case 'telegram':
      await deleteTelegram(omniChannelId);
      break;
    case 'line':
      await deleteLine(omniChannelId);
      break;
    case 'twilio_sms':
      await deleteTwilioSms(omniChannelId);
      break;
    case 'sms':
      await deleteGenericSms(omniChannelId);
      break;
    case 'email':
      await deleteEmail(omniChannelId);
      break;
    case 'whatsapp':
      await deleteWhatsapp(omniChannelId);
      break;
    case 'facebook':
      await deleteFacebook(omniChannelId);
      break;
    case 'instagram':
      await deleteInstagram(omniChannelId);
      break;
    case 'tiktok':
      await deleteTiktok(omniChannelId);
      break;
    default:
      throw new Error(`unsupported delete: ${channelType}`);
  }
  return { ok: true };
}
