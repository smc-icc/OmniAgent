import { resolveChannelAccount, assertChannelOwnership } from './conf-channel-tenancy.js';
import { confTenancyEnabled } from './conf-tenancy.js';
import { prisma } from '../../plugins/db.js';
import { clearChannelRoutes, replaceChannelRoutes } from './channel-route.js';
import {
  CHANNEL_TYPES,
  wechatMpWebhookUrl,
  wecomKfWebhookUrl,
  wecomContactWebhookUrl,
} from '../wechat/webhook-url.js';
import {
  createWechatMpSchema,
  updateWechatMpSchema,
  createWecomKfSchema,
  updateWecomKfSchema,
  createWecomContactSchema,
  updateWecomContactSchema,
} from '../validators/wechat-channels.js';
import { getWelcomeText } from './omni-ops.js';

export type WechatChannelType = 'wechat_mp' | 'wecom_kf' | 'wecom_contact';

async function createLinkedInbox(
  accountId: number,
  channelType: string,
  channelId: number,
  name: string,
) {
  return prisma.inboxes.create({
    data: {
      account_id: accountId,
      channel_id: channelId,
      channel_type: channelType,
      name,
      enable_auto_assignment: true,
      greeting_enabled: true,
      greeting_message: await getWelcomeText(),
      timezone: 'Asia/Shanghai',
    },
  });
}

async function ensureInbox(
  accountId: number,
  channelType: string,
  channelId: number,
  inboxName: string,
) {
  const existing = await prisma.inboxes.findFirst({
    where: { channel_type: channelType, channel_id: channelId },
  });
  if (existing) {
    if (confTenancyEnabled() && existing.account_id !== accountId) throw new Error('Inbox belongs to another tenant');
    if (existing.name !== inboxName) {
      return prisma.inboxes.update({
        where: { id: existing.id },
        data: { name: inboxName },
      });
    }
    return existing;
  }
  return createLinkedInbox(accountId, channelType, channelId, inboxName);
}

/**
 * 渠道字段透传：把 ConfServer 传来的渠道能力 / 超时字段映射成 Prisma 的更新体。
 *
 * 必须显式列出每个字段 —— 之前只列了 5 个，结果页面上配的
 * supports_active_reply / reply_timeout_* 保存后根本没进 Omni。
 */
function mpChannelData(p: Record<string, unknown>): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  if (p.supports_active_reply !== undefined) m.supports_active_reply = p.supports_active_reply;
  if (p.passive_reply_enabled !== undefined) m.passive_reply_enabled = p.passive_reply_enabled;
  if (p.route_ttl_seconds !== undefined) m.route_ttl_seconds = p.route_ttl_seconds;
  if (p.pending_reply_max !== undefined) m.pending_reply_max = p.pending_reply_max;
  if (p.reply_timeout_seconds !== undefined) m.reply_timeout_seconds = p.reply_timeout_seconds;
  if (p.reply_timeout_level2_seconds !== undefined) {
    m.reply_timeout_level2_seconds = p.reply_timeout_level2_seconds;
  }
  if (p.reply_timeout_flow_id !== undefined) m.reply_timeout_flow_id = p.reply_timeout_flow_id;
  if (p.pending_ttl_seconds !== undefined) m.pending_ttl_seconds = p.pending_ttl_seconds;
  if (p.idle_recycle_seconds !== undefined) m.idle_recycle_seconds = p.idle_recycle_seconds;
  return m;
}

export async function syncWechatMpFromConf(
  accountId: number,
  omniChannelId: number | null | undefined,
  body: Record<string, unknown>,
) {
  let resolvedChannelId = omniChannelId;
  if ((resolvedChannelId == null || resolvedChannelId <= 0) && typeof body.app_id === 'string') {
    const existing = await prisma.channel_wechat_mp.findUnique({ where: { app_id: body.app_id } });
    if (existing) {
      if (confTenancyEnabled() && existing.account_id !== accountId) throw new Error('AppID belongs to another tenant');
      resolvedChannelId = existing.id;
    }
  }
  const isUpdate = resolvedChannelId != null && resolvedChannelId > 0;
  let channel;
  let inboxName: string;
  let routes: unknown;

  if (isUpdate) {
    const parsed = updateWechatMpSchema.parse(body);
    routes = parsed.routes;
    channel = await prisma.channel_wechat_mp.update({
      where: { id: resolvedChannelId! },
      data: mpChannelData(parsed as Record<string, unknown>),
    });
    inboxName = parsed.inbox_name ?? parsed.name ?? channel.name;
  } else {
    const create = createWechatMpSchema.parse(body);
    routes = create.routes;
    channel = await prisma.channel_wechat_mp.create({
      data: {
        account_id: accountId,
        name: create.name,
        app_id: create.app_id,
        app_secret: create.app_secret,
        token: create.token,
        encoding_aes_key: create.encoding_aes_key ?? null,
        account_type: create.account_type,
        ...mpChannelData(create as Record<string, unknown>),
      },
    });
    inboxName = create.inbox_name ?? create.name;
  }

  // 路由配置随渠道一起下发；不带 routes 时保持现状。
  await replaceChannelRoutes(channel.id, routes, 'wechat_mp');

  const inbox = await ensureInbox(accountId, CHANNEL_TYPES.WECHAT_MP, channel.id, inboxName);

  return {
    omni_channel_id: channel.id,
    omni_inbox_id: inbox.id,
    webhook_url: wechatMpWebhookUrl(channel.app_id),
    app_id: channel.app_id,
  };
}

export async function syncWecomKfFromConf(
  accountId: number,
  omniChannelId: number | null | undefined,
  body: Record<string, unknown>,
) {
  const isUpdate = omniChannelId != null && omniChannelId > 0;
  let channel;
  let inboxName: string;

  if (isUpdate) {
    const parsed = updateWecomKfSchema.parse(body);
    channel = await prisma.channel_wecom_kf.update({
      where: { id: omniChannelId! },
      data: {
        ...(parsed.name !== undefined && { name: parsed.name }),
        ...(parsed.secret !== undefined && { secret: parsed.secret }),
        ...(parsed.token !== undefined && { token: parsed.token }),
        ...(parsed.encoding_aes_key !== undefined && { encoding_aes_key: parsed.encoding_aes_key ?? null }),
        ...(parsed.open_kfid !== undefined && { open_kfid: parsed.open_kfid ?? null }),
      },
    });
    inboxName = parsed.inbox_name ?? parsed.name ?? channel.name;
  } else {
    const create = createWecomKfSchema.parse(body);
    channel = await prisma.channel_wecom_kf.create({
      data: {
        account_id: accountId,
        name: create.name,
        corp_id: create.corp_id,
        secret: create.secret,
        token: create.token,
        encoding_aes_key: create.encoding_aes_key ?? null,
        open_kfid: create.open_kfid ?? null,
      },
    });
    inboxName = create.inbox_name ?? create.name;
  }

  const inbox = await ensureInbox(accountId, CHANNEL_TYPES.WECOM_KF, channel.id, inboxName);

  // 路由配置随渠道一起下发（不带 routes 时保持现状）。
  // 有了它，这个渠道才能配自己的进线流程（on_inbound → itr/flow），
  // 用不同的欢迎语和菜单。
  await replaceChannelRoutes(channel.id, (body as { routes?: unknown }).routes, 'wecom_kf');

  return {
    omni_channel_id: channel.id,
    omni_inbox_id: inbox.id,
    webhook_url: wecomKfWebhookUrl(channel.id),
  };
}

export async function syncWecomContactFromConf(
  accountId: number,
  omniChannelId: number | null | undefined,
  body: Record<string, unknown>,
) {
  const isUpdate = omniChannelId != null && omniChannelId > 0;
  let channel;
  let inboxName: string;

  if (isUpdate) {
    const parsed = updateWecomContactSchema.parse(body);
    channel = await prisma.channel_wecom_contact.update({
      where: { id: omniChannelId! },
      data: {
        ...(parsed.name !== undefined && { name: parsed.name }),
        ...(parsed.contact_secret !== undefined && { contact_secret: parsed.contact_secret }),
        ...(parsed.token !== undefined && { token: parsed.token }),
        ...(parsed.encoding_aes_key !== undefined && { encoding_aes_key: parsed.encoding_aes_key ?? null }),
        ...(parsed.agent_id !== undefined && { agent_id: parsed.agent_id ?? null }),
      },
    });
    inboxName = parsed.inbox_name ?? parsed.name ?? channel.name;
  } else {
    const create = createWecomContactSchema.parse(body);
    channel = await prisma.channel_wecom_contact.create({
      data: {
        account_id: accountId,
        name: create.name,
        corp_id: create.corp_id,
        contact_secret: create.contact_secret,
        token: create.token,
        encoding_aes_key: create.encoding_aes_key ?? null,
        agent_id: create.agent_id ?? null,
      },
    });
    inboxName = create.inbox_name ?? create.name;
  }

  const inbox = await ensureInbox(accountId, CHANNEL_TYPES.WECOM_CONTACT, channel.id, inboxName);

  await replaceChannelRoutes(channel.id, (body as { routes?: unknown }).routes, 'wecom_contact');

  return {
    omni_channel_id: channel.id,
    omni_inbox_id: inbox.id,
    webhook_url: wecomContactWebhookUrl(channel.id),
  };
}

export async function deleteWechatChannelFromConf(
  channelType: WechatChannelType,
  omniChannelId: number,
) {
  const inbox = await prisma.inboxes.findFirst({
    where: {
      channel_id: omniChannelId,
      channel_type:
        channelType === 'wechat_mp'
          ? CHANNEL_TYPES.WECHAT_MP
          : channelType === 'wecom_kf'
            ? CHANNEL_TYPES.WECOM_KF
            : CHANNEL_TYPES.WECOM_CONTACT,
    },
  });

  if (channelType === 'wechat_mp') {
    await prisma.channel_wechat_mp.delete({ where: { id: omniChannelId } });
  } else if (channelType === 'wecom_kf') {
    await prisma.channel_wecom_kf.delete({ where: { id: omniChannelId } });
  } else {
    await prisma.channel_wecom_contact.delete({ where: { id: omniChannelId } });
  }

  if (inbox) {
    await prisma.inboxes.delete({ where: { id: inbox.id } }).catch(() => {});
  }
  await clearChannelRoutes(channelType, omniChannelId);

  return { ok: true };
}

export async function applyWechatChannelSync(payload: {
  action: 'upsert' | 'delete';
  channel_type: WechatChannelType;
  account_id?: number;
  vdn_id?: number;
  omni_channel_id?: number | null;
  data?: Record<string, unknown>;
}) {
  const { action, channel_type, omni_channel_id, data = {} } = payload;
  const account_id = await resolveChannelAccount(payload);
  await assertChannelOwnership(account_id, channel_type, omni_channel_id, data);

  if (action === 'delete') {
    if (!omni_channel_id) throw new Error('omni_channel_id required for delete');
    await deleteWechatChannelFromConf(channel_type, omni_channel_id);
    return { ok: true };
  }

  if (channel_type === 'wechat_mp') {
    return syncWechatMpFromConf(account_id, omni_channel_id, data);
  }
  if (channel_type === 'wecom_kf') {
    return syncWecomKfFromConf(account_id, omni_channel_id, data);
  }
  return syncWecomContactFromConf(account_id, omni_channel_id, data);
}
