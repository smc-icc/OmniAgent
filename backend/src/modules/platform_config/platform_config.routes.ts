import { createPushAccountRoutes } from './push-accounts.routes.js';
import { createConfRegistrationRoutes } from './conf-registration.routes.js';
import { managedPushRuntime, MANAGED_PUSH_CONFIG_KEY } from '../../shared/services/push-account-config.js';
import { AppError } from '../../shared/errors/index.js';
import { syncConfVdn, syncConfManagedUser, requireConfSync } from './conf-tenancy-sync.js';
import { confTenancyEnabled } from '../../shared/services/conf-tenancy.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../plugins/db.js';
import { env } from '../../config/env.js';
import { applyWechatChannelSync } from '../../shared/services/wechat-channel-sync.js';
import { applyOmniChannelSync } from '../../shared/services/omni-channel-sync.js';
import { OMNI_CHANNEL_KEYS } from '../../shared/channels/types.js';
import {
  maskRecordingAccess,
  saveRecordingAccessConfig,
} from '../../shared/services/recording-access.js';
import { applyConfUserSync } from '../../shared/services/conf-user-sync.js';
import { syncSystemSuperuserFromConfServer } from './system-superuser-sync.js';
export { syncSystemSuperuserFromConfServer } from './system-superuser-sync.js';
import { loadOmniOps, saveOmniOps } from '../../shared/services/omni-ops.js';
import { getAccess } from '../access/access.context.js';
import { probeAsrHealth } from '../../shared/services/funasr-asr.js';
import {
  getPublicBaseUrl,
  isPublicBaseUrlFromRuntime,
  setPublicBaseUrl,
} from '../../shared/services/public-base-url.js';
import {
  clearSmsProviderConfig,
  getSmsProviderConfig,
  setSmsProviderConfig,
} from '../../shared/services/sms-provider.js';

/**
 * Platform Configuration API — stores API keys and system settings in DB.
 * Used by the "平台配置管理" frontend page to manage integrations.
 */

function maskValue(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '****';
  return value.substring(0, 4) + '****' + value.substring(value.length - 4);
}

// ── Overview ──

export async function platformConfigOverview(_req: FastifyRequest, reply: FastifyReply) {
  const categories = await prisma.platform_configs.groupBy({
    by: ['category'],
    _count: { category: true },
  });
  const domains = categories.map((c: { category: string; _count: { category: number } }) => ({
    id: c.category,
    title: { general: '通用', integrations: '对接集成', retention: '留存合规', params: '系统参数' }[c.category] ?? c.category,
    summary: `${c._count.category} 项配置`,
  }));
  const lastUpdated = await prisma.platform_configs.findFirst({ orderBy: { updated_at: 'desc' }, select: { updated_at: true } });
  return reply.send({
    intro: '平台配置管理 — 管理系统集成密钥、业务参数与合规策略',
    domains,
    updated_hint: lastUpdated?.updated_at?.toISOString() ?? 'N/A',
  });
}

// ── Integrations ──

const INTEGRATION_KEYS = [
  { key: 'slack_bot_token', name: 'Slack', vendor: 'Slack', description: 'Slack Bot User OAuth Token' },
  { key: 'slack_signing_secret', name: 'Slack 签名密钥', vendor: 'Slack', description: 'Slack Signing Secret' },
  { key: 'linear_api_key', name: 'Linear', vendor: 'Linear', description: 'Linear API Key' },
  { key: 'shopify_api_key', name: 'Shopify API Key', vendor: 'Shopify', description: 'Shopify API Key' },
  { key: 'shopify_api_secret', name: 'Shopify 密钥', vendor: 'Shopify', description: 'Shopify API Secret' },
  { key: 'twitter_consumer_key', name: 'Twitter API Key', vendor: 'Twitter', description: 'Twitter Consumer Key' },
  { key: 'twitter_consumer_secret', name: 'Twitter 密钥', vendor: 'Twitter', description: 'Twitter Consumer Secret' },
  { key: 'whatsapp_access_token', name: 'WhatsApp Token', vendor: 'Meta', description: 'WhatsApp Cloud API Access Token' },
  { key: 'openai_api_key', name: 'OpenAI', vendor: 'OpenAI', description: 'OpenAI API Key' },
  { key: 'stripe_secret_key', name: 'Stripe', vendor: 'Stripe', description: 'Stripe Secret Key' },
];

export async function fetchIntegrations(_req: FastifyRequest, reply: FastifyReply) {
  const dbConfigs = await prisma.platform_configs.findMany({ where: { category: 'integrations' } });
  const dbMap = new Map(dbConfigs.map((c: { key: string; value: string; encrypted: boolean; updated_at: Date }) => [c.key, c]));

  const items = INTEGRATION_KEYS.map(ik => {
    const db = dbMap.get(ik.key);
    return {
      id: ik.key,
      name: ik.name,
      vendor: ik.vendor,
      endpoint_masked: db ? maskValue(db.value) : '(未配置)',
      auth: db?.encrypted ? '加密存储' : '明文',
      last_sync: db?.updated_at?.toISOString() ?? '',
      description: ik.description,
      configured: !!db?.value,
    };
  });

  return reply.send(items);
}

export async function updateIntegration(request: FastifyRequest, reply: FastifyReply) {
  const { key } = request.params as { key: string };
  const { value } = request.body as { value: string };
  const def = INTEGRATION_KEYS.find(k => k.key === key);
  if (!def) return reply.status(404).send({ error: 'Unknown integration key' });

  await prisma.platform_configs.upsert({
    where: { key },
    update: { value, updated_at: new Date() },
    create: {
      key,
      value,
      category: 'integrations',
      description: def.description,
      encrypted: false,
    },
  });

  return reply.send({ success: true, key });
}

export async function deleteIntegration(request: FastifyRequest, reply: FastifyReply) {
  const { key } = request.params as { key: string };
  await prisma.platform_configs.deleteMany({ where: { key, category: 'integrations' } });
  return reply.send({ success: true });
}

// ── Skill Groups (stored in teams table) ──

export async function fetchSkillGroups(request: FastifyRequest, reply: FastifyReply) {
  const teams = await prisma.teams.findMany();
  return reply.send({ items: teams.map((t: { id: number; name: string }) => ({
    id: String(t.id), name: t.name, priority: 0,
    queues: [], agent_count: 0, channels: [],
  }))});
}

// ── Business Hours ──
//
// 数据源：conf_vdn_working_hours（VDN 级，IVR 的 CheckWorkTime 节点读它决定
// 走"营业中"还是"非营业"分支）。
//
// 前端表单是"工作日 + 周六 + 周日"三段式（BusinessHours），库里是 7 天逐行记录。
// 这里做双向映射：
//   读：day_of_week 1..5 → weekday_*，6 → saturday_*，0 → sunday_*
//   写：weekday_* 展开成 5 条，saturday_* 1 条，sunday_* 1 条
// timezone / holiday_policy / manual_holiday_dates 不属于 IVR 判定范围，
// 仍存 platform_configs（键 business_hours），保持前端字段完整。

function hhmm(hour?: number | null, minutes?: number | null): string {
  const h = Math.max(0, Math.min(23, Number(hour ?? 0)));
  const m = Math.max(0, Math.min(59, Number(minutes ?? 0)));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseHhmm(v: unknown, fallbackHour: number, fallbackMin = 0): { hour: number; minutes: number } {
  const s = String(v ?? '').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return { hour: fallbackHour, minutes: fallbackMin };
  return {
    hour: Math.max(0, Math.min(23, parseInt(m[1], 10))),
    minutes: Math.max(0, Math.min(59, parseInt(m[2], 10))),
  };
}

export async function fetchBusinessHours(request: FastifyRequest, reply: FastifyReply) {
  const access = await getAccess(request);
  const vdnId = access.vdnId;

  // 非 IVR 字段（时区、节假日）仍从 platform_configs 取
  const config = await prisma.platform_configs.findFirst({
    where: { key: 'business_hours', category: 'general' },
  });
  let extras: Record<string, unknown> = {};
  try {
    if (config?.value) extras = JSON.parse(config.value);
  } catch { /* ignore malformed */ }

  const rowsDb = await prisma.conf_vdn_working_hours.findMany({
    where: { vdn_id: vdnId },
    orderBy: { day_of_week: 'asc' },
  });
  const byDay = new Map<number, typeof rowsDb[number]>();
  for (const r of rowsDb) byDay.set(r.day_of_week, r);

  // 工作日取周一(1)那条作为代表；缺失则用默认 08:00-18:00
  const wd = byDay.get(1);
  const weekdayOpen = wd && !wd.closed_all_day ? hhmm(wd.open_hour, wd.open_minutes) : '08:00';
  const weekdayClose = wd && !wd.closed_all_day ? hhmm(wd.close_hour, wd.close_minutes) : '18:00';

  const sa = byDay.get(6);
  const saturdayOpen = sa && !sa.closed_all_day ? hhmm(sa.open_hour, sa.open_minutes) : '';
  const saturdayClose = sa && !sa.closed_all_day ? hhmm(sa.close_hour, sa.close_minutes) : '';

  const su = byDay.get(0);
  const sundayClosed = su ? su.closed_all_day : true;
  const sundayOpen = su && !su.closed_all_day ? hhmm(su.open_hour, su.open_minutes) : '';
  const sundayClose = su && !su.closed_all_day ? hhmm(su.close_hour, su.close_minutes) : '';

  return reply.send({
    timezone: (extras.timezone as string) ?? 'Asia/Shanghai',
    weekday_open: weekdayOpen,
    weekday_close: weekdayClose,
    saturday_open: saturdayOpen,
    saturday_close: saturdayClose,
    sunday_mode: sundayClosed ? 'closed' : 'open',
    sunday_open: sundayOpen,
    sunday_close: sundayClose,
    holiday_policy: (extras.holiday_policy as string) ?? 'follow_sunday',
    manual_holiday_dates: (extras.manual_holiday_dates as string[]) ?? [],
    vdn_id: vdnId,
  });
}

export async function updateBusinessHours(request: FastifyRequest, reply: FastifyReply) {
  const access = await getAccess(request);
  const vdnId = access.vdnId;
  const body = (request.body ?? {}) as Record<string, unknown>;

  const wdOpen = parseHhmm(body.weekday_open, 8);
  const wdClose = parseHhmm(body.weekday_close, 18);

  const saOpen = String(body.saturday_open ?? '').trim();
  const saClose = String(body.saturday_close ?? '').trim();
  const saturdayClosed = !saOpen || !saClose;
  const saO = saturdayClosed ? { hour: 0, minutes: 0 } : parseHhmm(saOpen, 9);
  const saC = saturdayClosed ? { hour: 0, minutes: 0 } : parseHhmm(saClose, 17);

  const sundayClosed = String(body.sunday_mode ?? 'closed') === 'closed';
  const suO = sundayClosed ? { hour: 0, minutes: 0 } : parseHhmm(body.sunday_open, 9);
  const suC = sundayClosed ? { hour: 0, minutes: 0 } : parseHhmm(body.sunday_close, 17);

  type Row = {
    day_of_week: number; closed_all_day: boolean; open_all_day: boolean;
    open_hour: number; open_minutes: number; close_hour: number; close_minutes: number;
  };
  const plan: Row[] = [];
  // 周一..周五（1..5）
  for (let d = 1; d <= 5; d++) {
    plan.push({
      day_of_week: d, closed_all_day: false, open_all_day: false,
      open_hour: wdOpen.hour, open_minutes: wdOpen.minutes,
      close_hour: wdClose.hour, close_minutes: wdClose.minutes,
    });
  }
  // 周六（6）
  plan.push({
    day_of_week: 6, closed_all_day: saturdayClosed, open_all_day: false,
    open_hour: saO.hour, open_minutes: saO.minutes,
    close_hour: saC.hour, close_minutes: saC.minutes,
  });
  // 周日（0）
  plan.push({
    day_of_week: 0, closed_all_day: sundayClosed, open_all_day: false,
    open_hour: suO.hour, open_minutes: suO.minutes,
    close_hour: suC.hour, close_minutes: suC.minutes,
  });

  // 7 天整体覆盖（事务），IVR 下次呼叫即读到新值
  await prisma.$transaction(async (tx) => {
    await tx.conf_vdn_working_hours.deleteMany({ where: { vdn_id: vdnId } });
    for (const r of plan) {
      await tx.conf_vdn_working_hours.create({ data: { vdn_id: vdnId, ...r } });
    }
  });

  // 非 IVR 字段另存 platform_configs
  const extras = {
    timezone: body.timezone ?? 'Asia/Shanghai',
    holiday_policy: body.holiday_policy ?? 'follow_sunday',
    manual_holiday_dates: Array.isArray(body.manual_holiday_dates) ? body.manual_holiday_dates : [],
  };
  await prisma.platform_configs.upsert({
    where: { key: 'business_hours' },
    update: { value: JSON.stringify(extras) },
    create: {
      key: 'business_hours', category: 'general',
      value: JSON.stringify(extras), description: '营业时间扩展配置（时区/节假日）',
    },
  });

  return reply.send({ success: true, vdn_id: vdnId, working_hours: plan });
}

// ── System Parameters ──

export async function fetchSystemParams(_req: FastifyRequest, reply: FastifyReply) {
  const configs = await prisma.platform_configs.findMany({ where: { category: 'params' } });
  return reply.send({ items: configs.map((c: { key: string; value: string; category: string; description: string | null }) => ({ key: c.key, value: c.value, category: c.category, description: c.description ?? '' }))});
}

export async function updateSystemParam(request: FastifyRequest, reply: FastifyReply) {
  const { key } = request.params as { key: string };
  if (key === MANAGED_PUSH_CONFIG_KEY) return reply.code(403).send({ error: 'Managed push configuration requires ConfServer synchronization' });
  const { value } = request.body as { value: string };
  await prisma.platform_configs.upsert({
    where: { key },
    update: { value },
    create: { key, category: 'params', value, description: '' },
  });
  return reply.send({ success: true });
}

// ── ConfServer WeChat channel sync ──

const wechatSyncSchema = z.object({
  action: z.enum(['upsert', 'delete']),
  channel_type: z.enum(['wechat_mp', 'wecom_kf', 'wecom_contact']),
  account_id: z.number().int().positive().optional(),
  vdn_id: z.number().int().positive().optional(),
  omni_channel_id: z.number().int().positive().optional().nullable(),
  data: z.record(z.unknown()).optional(),
});

function verifyPlatformSync(request: FastifyRequest, reply: FastifyReply): boolean {
  if (confTenancyEnabled()) return requireConfSync(request, reply);
  const secret = env.PLATFORM_SYNC_SECRET;
  if (!secret) {
    if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') return true;
    reply.status(503).send({ error: 'PLATFORM_SYNC_SECRET not configured' });
    return false;
  }
  const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
  const header = String(request.headers['x-platform-sync-token'] ?? '');
  if (bearer === secret || header === secret) return true;
  reply.status(401).send({ error: 'Unauthorized' });
  return false;
}

export async function syncWechatChannelFromConfServer(request: FastifyRequest, reply: FastifyReply) {
  if (!verifyPlatformSync(request, reply)) return;
  const payload = wechatSyncSchema.parse(request.body);
  try {
    const result = await applyWechatChannelSync(payload);
    return reply.send({ success: true, data: result });
  } catch (err) {
    const message = err instanceof AppError ? err.message : '渠道同步失败，请核对字段及渠道归属';
    return reply.status(err instanceof AppError ? err.statusCode : 400).send({ error: message });
  }
}

const OMNI_SYNC_CHANNEL_TYPES = [
  'web_widget',
  'api',
  'telegram',
  'line',
  'twilio_sms',
  'sms',
  'email',
  'whatsapp',
  'facebook',
  'instagram',
  'tiktok',
  'wechat_mp',
  'wecom_kf',
  'wecom_contact',
  'weibo',
  'miniprogram',
] as [string, ...string[]];

const omniSyncSchema = z.object({
  action: z.enum(['upsert', 'delete']),
  channel_type: z.enum(OMNI_SYNC_CHANNEL_TYPES),
  account_id: z.number().int().positive().optional(),
  vdn_id: z.number().int().positive().optional(),
  omni_channel_id: z.number().int().positive().optional().nullable(),
  data: z.record(z.unknown()).optional(),
});

export async function syncOmniChannelFromConfServer(request: FastifyRequest, reply: FastifyReply) {
  if (!verifyPlatformSync(request, reply)) return;
  const payload = omniSyncSchema.parse(request.body);
  try {
    const result = await applyOmniChannelSync(payload as Parameters<typeof applyOmniChannelSync>[0]);
    return reply.send({ success: true, data: result });
  } catch (err) {
    const message = err instanceof AppError ? err.message : '渠道同步失败，请核对字段及渠道归属';
    return reply.status(err instanceof AppError ? err.statusCode : 400).send({ error: message });
  }
}

const recordingAccessSyncSchema = z.object({
  source: z.enum(['sftp', 'local', 'http']).default('sftp'),
  sftp_host: z.string().optional(),
  sftp_port: z.number().int().positive().optional(),
  sftp_user: z.string().optional(),
  sftp_password: z.string().optional(),
  remote_root: z.string().optional(),
});

export async function syncRecordingAccessFromConfServer(request: FastifyRequest, reply: FastifyReply) {
  if (!verifyPlatformSync(request, reply)) return;
  const payload = recordingAccessSyncSchema.parse(request.body ?? {});
  try {
    const saved = await saveRecordingAccessConfig(payload);
    return reply.send({ success: true, data: maskRecordingAccess(saved) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'sync failed';
    return reply.status(400).send({ error: message });
  }
}

export async function getOmniOps(_req: FastifyRequest, reply: FastifyReply) {
  const data = await loadOmniOps();
  return reply.send({ success: true, data });
}

export async function syncOmniOpsFromConfServer(request: FastifyRequest, reply: FastifyReply) {
  if (!verifyPlatformSync(request, reply)) return;
  try {
    const data = await saveOmniOps(request.body ?? {});
    return reply.send({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'sync failed';
    return reply.status(400).send({ error: message });
  }
}

export async function getAsrHealth(_req: FastifyRequest, reply: FastifyReply) {
  const probe = await probeAsrHealth();
  return reply.send(probe);
}

const confUserSyncSchema = z.object({
  action: z.enum(['upsert', 'delete']),
  account_id: z.number().int().positive().optional().default(1),
  work_no: z.string().min(1).max(50),
  previous_work_no: z.string().min(1).max(50).optional().nullable(),
  name: z.string().max(255).optional().nullable(),
  email: z.string().max(255).optional().nullable(),
  password: z.string().max(255).optional().nullable(),
  role: z.enum(['administrator', 'agent']).optional().default('agent'),
});

/** ConfServer 坐席账号同步：uid=WorkNO，邮箱只保存配置台通讯地址 */
export async function syncConfUserFromConfServer(request: FastifyRequest, reply: FastifyReply) {
  if (confTenancyEnabled()) return reply.status(409).send({ error: 'Use managed-users sync with VDN/source identity' });
  if (!verifyPlatformSync(request, reply)) return;
  const payload = confUserSyncSchema.parse(request.body ?? {});
  try {
    const result = await applyConfUserSync(payload);
    return reply.send({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'sync failed';
    return reply.status(400).send({ error: message });
  }
}

function inboxItrBinding(inbox: { id: number; name: string; channel_type: string | null; auto_assignment_config: unknown }) {
  const cfg =
    inbox.auto_assignment_config && typeof inbox.auto_assignment_config === 'object'
      ? (inbox.auto_assignment_config as Record<string, unknown>)
      : {};
  return {
    id: inbox.id,
    name: inbox.name,
    channel_type: inbox.channel_type,
    itr_flow_id: Number(cfg.itr_flow_id ?? cfg.itrFlowId ?? 0) || null,
    itr_enabled: cfg.itr_enabled !== false,
  };
}

/** Conf → Omni：列出 inbox 的 ITR 绑定 */
export async function listItrInboxBindings(request: FastifyRequest, reply: FastifyReply) {
  if (!verifyPlatformSync(request, reply)) return;
  const accountId = parseInt(String((request.query as { account_id?: string }).account_id || '1'), 10);
  const rows = await prisma.inboxes.findMany({
    where: { account_id: accountId },
    select: { id: true, name: true, channel_type: true, auto_assignment_config: true },
    orderBy: { id: 'asc' },
  });
  return reply.send({ items: rows.map(inboxItrBinding) });
}

const itrInboxBindSchema = z.object({
  inboxId: z.number().int().positive(),
  flowId: z.number().int().nullable().optional(),
  itrEnabled: z.boolean().optional(),
});

/** Conf → Omni：绑定 inbox ↔ ITR flowId（写入 auto_assignment_config） */
export async function bindItrInboxFromConfServer(request: FastifyRequest, reply: FastifyReply) {
  if (!verifyPlatformSync(request, reply)) return;
  const payload = itrInboxBindSchema.parse(request.body ?? {});
  const inbox = await prisma.inboxes.findUnique({
    where: { id: payload.inboxId },
    select: { id: true, name: true, channel_type: true, auto_assignment_config: true },
  });
  if (!inbox) return reply.status(404).send({ error: 'inbox not found' });
  const cfg =
    inbox.auto_assignment_config && typeof inbox.auto_assignment_config === 'object'
      ? { ...(inbox.auto_assignment_config as Record<string, unknown>) }
      : {};
  if (payload.flowId === null || payload.flowId === 0) delete cfg.itr_flow_id;
  else if (payload.flowId !== undefined) cfg.itr_flow_id = payload.flowId;
  if (payload.itrEnabled !== undefined) cfg.itr_enabled = payload.itrEnabled;
  const updated = await prisma.inboxes.update({
    where: { id: inbox.id },
    data: { auto_assignment_config: cfg as object },
    select: { id: true, name: true, channel_type: true, auto_assignment_config: true },
  });
  return reply.send({ success: true, data: inboxItrBinding(updated) });
}

// ── Routes ──

export async function platformConfigRoutes(fastify: FastifyInstance) {
  await fastify.register(createConfRegistrationRoutes());
  await fastify.register(createPushAccountRoutes(managedPushRuntime, () => env.PLATFORM_SYNC_SECRET || ''));
  const auth = { preHandler: [fastify.authenticate] };

  fastify.post('/api/platform-config/wechat-channels/sync', syncWechatChannelFromConfServer);
  fastify.post('/api/platform-config/channels/sync', syncOmniChannelFromConfServer);
  fastify.post('/api/platform-config/recording-access/sync', syncRecordingAccessFromConfServer);
  fastify.get('/api/platform-config/ops', auth, getOmniOps);
  fastify.post('/api/platform-config/ops/sync', syncOmniOpsFromConfServer);
  fastify.get('/api/platform-config/asr/health', getAsrHealth);
  fastify.post('/api/platform-config/users/sync', syncConfUserFromConfServer);
  fastify.post('/api/platform-config/vdns/sync', syncConfVdn);
  fastify.post('/api/platform-config/managed-users/sync', syncConfManagedUser);
  fastify.post('/api/platform-config/system-superuser/sync', syncSystemSuperuserFromConfServer);
  fastify.get('/api/platform-config/itr/inboxes', listItrInboxBindings);
  fastify.post('/api/platform-config/itr/inbox-binding', bindItrInboxFromConfServer);

  fastify.get('/api/platform-config/overview', auth, platformConfigOverview);
  fastify.get('/api/platform-config/integrations', auth, fetchIntegrations);
  fastify.put('/api/platform-config/integrations/:key', auth, updateIntegration);
  fastify.delete('/api/platform-config/integrations/:key', auth, deleteIntegration);
  fastify.get('/api/platform-config/skill-groups', auth, fetchSkillGroups);
  fastify.get('/api/platform-config/business-hours', auth, fetchBusinessHours);
  fastify.put('/api/platform-config/business-hours', auth, updateBusinessHours);
  fastify.get('/api/platform-config/params', auth, fetchSystemParams);
  fastify.put('/api/platform-config/params/:key', auth, updateSystemParam);

  // 对外公网根地址：ConfServer 下发（X-Platform-Sync-Token），写入即生效，无需重启
  fastify.get('/api/platform-config/public-base-url', fetchPublicBaseUrl);
  fastify.put('/api/platform-config/public-base-url', updatePublicBaseUrl);

  // 短信服务商配置：同上下发机制，写入即生效
  fastify.get('/api/platform-config/sms-provider', fetchSmsProvider);
  fastify.put('/api/platform-config/sms-provider', updateSmsProvider);
}

// ── 对外公网根地址（实例级、运行时可配，不经环境变量、不重建容器） ──

export async function fetchPublicBaseUrl(_req: FastifyRequest, reply: FastifyReply) {
  return reply.send({
    public_base_url: getPublicBaseUrl(),
    source: isPublicBaseUrlFromRuntime() ? 'runtime' : 'env',
  });
}

const publicBaseUrlSchema = z.object({
  public_base_url: z.string().min(1).max(500),
});

/**
 * ConfServer 下发公网根地址：写 DB 并刷新 Omni 内存缓存，立即对所有
 * webhook URL 生成生效，无需重建容器。鉴权复用 PLATFORM_SYNC_SECRET。
 */
export async function updatePublicBaseUrl(request: FastifyRequest, reply: FastifyReply) {
  if (!verifyPlatformSync(request, reply)) return;
  const parsed = publicBaseUrlSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: 'invalid public_base_url' });
  }
  const saved = await setPublicBaseUrl(parsed.data.public_base_url);
  return reply.send({ success: true, public_base_url: saved });
}

/** 读取当前生效的短信服务商配置（ConfServer 下发值 + 是否来自运行时下发） */
export async function fetchSmsProvider(_request: FastifyRequest, reply: FastifyReply) {
  return reply.send({
    success: true,
    sms_provider: getSmsProviderConfig(),
  });
}

/**
 * ConfServer 下发短信服务商配置：写 DB 并刷新 Omni 内存缓存，立即生效，无需重建容器。
 *
 * 出站优先级：channel_sms.provider_config 里显式给了 url/endpoint 就用它，
 * 否则回退到这里的平台级配置。鉴权复用 PLATFORM_SYNC_SECRET。
 */
export async function updateSmsProvider(request: FastifyRequest, reply: FastifyReply) {
  if (!verifyPlatformSync(request, reply)) return;
  const body = request.body as { sms_provider?: unknown } | undefined;
  // 允许传 null / {} 来清空下发值，回退到渠道级配置
  if (body?.sms_provider === null) {
    await clearSmsProviderConfig();
    return reply.send({ success: true, sms_provider: null });
  }
  try {
    const saved = await setSmsProviderConfig(body?.sms_provider ?? {});
    return reply.send({ success: true, sms_provider: saved });
  } catch (e) {
    return reply.status(400).send({ error: e instanceof Error ? e.message : 'invalid sms_provider' });
  }
}
