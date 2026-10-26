/**
 * 「路由」解析：某渠道 + 某触发点 → 按 priority 升序的候选目标列表。
 *
 * 路由信息此前散在三处 —— 渠道字段（reply_timeout_flow_id）、会话属性
 * （itr_flow_id）、ITR 流程内部 staff_service 节点的参数。想新增一种目标
 * （坐席 / 机器人坐席 / ACD 分组）就得改代码。
 *
 * 现在统一到 channel_route 表：同一 (channel_id, trigger) 可有多条，按 priority
 * 升序依次尝试（失败降级）。本模块只负责「解析」与「选目标」，
 * 真正的执行（进 ACD / 分配坐席 / 启动流程）由各触发点接上。
 *
 * 迁移期约定：新表没有记录时回退到旧渠道字段，保证行为不变、可随时回滚。
 */
import { prisma } from '../../plugins/db.js';

/**
 * 目标应用类型。与 ITR 流程里的应用概念对应。
 *
 * 这里是**唯一定义**：运行时白名单（route-exec 的归一化）和 zod 校验都从它派生。
 * 之前这份列表在 route-exec / channel-route / zod 各写了一份，加 release 时漏改一处
 * 导致它被静默归一成 none —— 所以收敛成单一来源。
 */
export const ROUTE_APP_TYPES = ['itr', 'agent', 'robot', 'acd', 'release', 'none'] as const;
export type RouteAppType = (typeof ROUTE_APP_TYPES)[number];

/**
 * 可配路由的渠道类型。
 *
 * 同样是**唯一定义**：表结构、查询、zod 校验、前端都从它派生。
 * 各渠道表主键各自从 1 开始，所以路由必须带上类型才能定位到唯一渠道实例。
 */
export const ROUTE_CHANNEL_TYPES = [
  'wechat_mp',
  'wecom_kf',
  'wecom_contact',
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
  'weibo',
  'miniprogram',
] as const;
export type ChannelRouteType = (typeof ROUTE_CHANNEL_TYPES)[number];

const ROUTE_CHANNEL_TYPE_SET = new Set<string>(ROUTE_CHANNEL_TYPES);

/** inboxes.channel_type / Conf 键 / 各种简写 → ROUTE_CHANNEL_TYPES */
const ROUTE_CHANNEL_ALIASES: Record<string, ChannelRouteType> = {
  wechatmp: 'wechat_mp',
  weixinmp: 'wechat_mp',
  mp: 'wechat_mp',
  wecomkf: 'wecom_kf',
  wechatkf: 'wecom_kf',
  kf: 'wecom_kf',
  wecomcontact: 'wecom_contact',
  contact: 'wecom_contact',
  webwidget: 'web_widget',
  widget: 'web_widget',
  api: 'api',
  telegram: 'telegram',
  line: 'line',
  twiliosms: 'twilio_sms',
  sms: 'sms',
  email: 'email',
  whatsapp: 'whatsapp',
  facebookpage: 'facebook',
  facebook: 'facebook',
  instagram: 'instagram',
  tiktok: 'tiktok',
  weibo: 'weibo',
  miniprogram: 'miniprogram',
};

/**
 * 把运行库里五花八门的渠道类型写法归一到 ROUTE_CHANNEL_TYPES。
 *
 * 实际见过的写法：`Channel::WechatMp`（inboxes.channel_type 的真实值）、
 * `wechat_mp` / `telegram`（配置文件里的写法）、`WechatMp` 之类的简写。
 * 归不出来就返回 null —— 宁可不路由，也不要把别家渠道的配置用错。
 */
export function normalizeRouteChannelType(
  channelType: string | null | undefined,
): ChannelRouteType | null {
  const s = String(channelType ?? '').trim();
  if (!s) return null;
  if (ROUTE_CHANNEL_TYPE_SET.has(s)) return s as ChannelRouteType;
  const bare = s.replace(/^Channel::/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return ROUTE_CHANNEL_ALIASES[bare] ?? null;
}

/**
 * 触发点（when）。ACD 结果码是动态的（`on_acd_<码>`，码值见 Include/acd_struct.h
 * 的 ACD_QUE_FIN_T），单独用正则放行，不进这个固定列表。
 *
 * 这里是**唯一定义**：zod 校验、前端下拉、文档都以此为准。
 * 之前没有白名单，配置里写错一个触发点会静默通过、永不生效 —— 这类问题很难查。
 */
export const ROUTE_TRIGGERS = [
  'on_inbound',
  'on_itr_route',
  'on_agent_no_answer',
  'on_agent_no_reply',
  'on_agent_end',
  'on_idle_timeout',
] as const;

/** ACD 结果码触发的形式：on_acd_0 … on_acd_13 */
export const ACD_TRIGGER_RE = /^on_acd_\d+$/;

export type RouteTrigger = (typeof ROUTE_TRIGGERS)[number] | `on_acd_${number}`;

/** 这个触发点是不是已知的（固定列表 + ACD 动态形式）。供 zod 校验用。 */
export function isKnownTrigger(raw: unknown): boolean {
  const t = String(raw ?? '').trim();
  if (!t) return false;
  return (ROUTE_TRIGGERS as readonly string[]).includes(t) || ACD_TRIGGER_RE.test(t);
}

export interface RouteTarget {
  /** channel_route.id；回退到旧字段时给 0 */
  id: number;
  appType: RouteAppType;
  flowId: number;
  agentId: number;
  robotId: number;
  agentGroupId: number;
  skillId: number;
  mediaType: number;
  linePriority: number;
  /** 0 = 用渠道回复类型推导的默认时限 */
  timeoutSeconds: number;
  priority: number;
}

// 白名单直接用唯一定义的 ROUTE_APP_TYPES（见文件上方说明）
const APP_TYPES: readonly string[] = ROUTE_APP_TYPES;

function toAppType(raw: unknown): RouteAppType {
  const s = String(raw ?? '').trim().toLowerCase();
  return (APP_TYPES as string[]).includes(s) ? (s as RouteAppType) : 'none';
}

function num(raw: unknown): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** channel_route 行 → RouteTarget */
function toTarget(row: Record<string, unknown>): RouteTarget {
  return {
    id: num(row.id),
    appType: toAppType(row.app_type ?? row.appType),
    flowId: num(row.flow_id ?? row.flowId),
    agentId: num(row.agent_id ?? row.agentId),
    robotId: num(row.robot_id ?? row.robotId),
    agentGroupId: num(row.agent_group_id ?? row.agentGroupId),
    skillId: num(row.skill_id ?? row.skillId),
    mediaType: num(row.media_type ?? row.mediaType),
    linePriority: num(row.line_priority ?? row.linePriority),
    timeoutSeconds: num(row.timeout_seconds ?? row.timeoutSeconds),
    priority: num(row.priority),
  };
}

/**
 * 旧渠道字段回退：迁移期新表没配时，沿用原来的行为。
 * 目前只有「坐席回复超时」有旧配置，对应 on_agent_no_reply。
 */
async function legacyTargets(
  channelId: number,
  trigger: RouteTrigger,
): Promise<RouteTarget[]> {
  if (trigger !== 'on_agent_no_reply') return [];
  const ch = await prisma.channel_wechat_mp.findUnique({
    where: { id: channelId },
    select: { reply_timeout_flow_id: true },
  });
  const flowId = num(ch?.reply_timeout_flow_id);
  if (flowId <= 0) return [];
  return [
    {
      id: 0,
      appType: 'itr',
      flowId,
      agentId: 0,
      robotId: 0,
      agentGroupId: 0,
      skillId: 0,
      mediaType: 0,
      linePriority: 0,
      timeoutSeconds: 0,
      priority: 0,
    },
  ];
}

/**
 * 解析某渠道某触发点的候选路由（已按 priority 升序）。
 * 新表无记录时回退旧字段；两者都没有则返回空数组（= 不路由，维持现状）。
 *
 * channelType 必须给对：各渠道表主键各自从 1 开始，只用 channelId 会把
 * 公众号和微信客服的路由混在一起（如 channel_wechat_mp.id=1 与 channel_wecom_kf.id=1）。
 * 缺省 wechat_mp 只是为了兼容既有调用方与历史数据。
 */
export async function resolveRoutes(
  channelId: number,
  trigger: RouteTrigger,
  channelType: ChannelRouteType = 'wechat_mp',
): Promise<RouteTarget[]> {
  const id = num(channelId);
  if (id <= 0) return [];
  let rows: Record<string, unknown>[] = [];
  try {
    rows = (await prisma.channel_route.findMany({
      where: { channel_type: channelType, channel_id: id, trigger, enabled: true },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    })) as unknown as Record<string, unknown>[];
  } catch (e) {
    // 迁移未跑 / 表不存在时不要让调用方崩：退回旧字段。
    console.warn('[route] channel_route query failed, falling back to legacy', e);
  }
  if (rows.length) return rows.map(toTarget);
  // 旧字段只有公众号有，其它渠道不要回退（否则会把公众号的配置误用到微信客服上）。
  if (channelType !== 'wechat_mp') return [];
  return legacyTargets(id, trigger);
}

/**
 * 会话背后的渠道（会话 → inbox → channel_type/channel_id）。
 *
 * ACD 回调只带 requestId 和会话，拿不到渠道，而路由是按渠道配的，
 * 所以按结果码路由之前必须先反查这一步。
 */
export async function channelOfConversation(
  conversationId: number,
): Promise<{ channelType: string; channelId: number }> {
  const id = num(conversationId);
  if (id <= 0) return { channelType: '', channelId: 0 };
  const conv = await prisma.conversations
    .findUnique({ where: { id }, select: { inbox_id: true } })
    .catch(() => null);
  const inboxId = num(conv?.inbox_id);
  if (inboxId <= 0) return { channelType: '', channelId: 0 };
  const inbox = await prisma.inboxes
    .findUnique({
      where: { id: inboxId },
      select: { channel_type: true, channel_id: true },
    })
    .catch(() => null);
  return {
    channelType: String(inbox?.channel_type ?? ''),
    channelId: num(inbox?.channel_id),
  };
}

/**
 * 「坐席超时」的默认时限（秒）：由渠道的回复类型推导，不逐条配。
 *
 * 业务约定：能主动推送的形态默认 5 分钟（坐席可能同时接多个会话，客户也不会卡在
 * 窗口里等）；只能被动回复的形态必须很短（微信订阅号 5 秒），因为超过窗口提示就发不出去。
 *
 * 路由条目上的 timeout_seconds 非 0 时优先，留给个别路由偏离默认。
 */
export const DEFAULT_ACTIVE_TIMEOUT_SECONDS = 300;
export const DEFAULT_PASSIVE_TIMEOUT_SECONDS = 5;

/** 被动渠道类型的默认时限；未登记的走 DEFAULT_PASSIVE_TIMEOUT_SECONDS。 */
const PASSIVE_TIMEOUT_SECONDS: Record<string, number> = {
  'Channel::WechatMp': 5,
  wechat_mp: 5,
};

export function replyTimeoutSecondsOf(opts: {
  channelType: string;
  supportsActiveReply: boolean;
  override?: number;
}): number {
  const o = num(opts.override);
  if (o > 0) return o;
  if (opts.supportsActiveReply) return DEFAULT_ACTIVE_TIMEOUT_SECONDS;
  const t = String(opts.channelType || '').trim();
  return PASSIVE_TIMEOUT_SECONDS[t] ?? DEFAULT_PASSIVE_TIMEOUT_SECONDS;
}

/**
 * 用 Conf 下发的 routes 整表替换该渠道的路由。
 *
 * 「整表替换」而不是合并：Conf 是配置源，页面上删掉一条就该真的删掉，
 * 否则残留配置会继续把会话路由到已废弃的目标。
 * routes 为 undefined 时完全不动现有配置 —— 兼容未带 routes 的旧版同步请求。
 */
export async function replaceChannelRoutes(
  channelId: number,
  routes: unknown,
  channelType: ChannelRouteType,
): Promise<void> {
  if (!Array.isArray(routes)) return;
  const id = num(channelId);
  if (id <= 0) return;
  const rows = routes.filter(
    (r): r is Record<string, unknown> => !!r && typeof r === 'object',
  );
  // 删除与写入都必须带 channel_type：各渠道表主键各自从 1 开始，
  // 只按 channel_id 删会把别的渠道（如微信客服 id=1）的路由一起清掉。
  const ops = [
    prisma.channel_route.deleteMany({ where: { channel_type: channelType, channel_id: id } }),
  ];
  if (rows.length) {
    ops.push(
      prisma.channel_route.createMany({
        data: rows.map((r, i) => ({
          channel_type: channelType,
          channel_id: id,
          trigger: String(r.trigger ?? '').trim(),
          priority: Number(r.priority ?? i) || 0,
          app_type: String(r.app_type ?? 'none'),
          flow_id: Number(r.flow_id ?? 0) || 0,
          agent_id: Number(r.agent_id ?? 0) || 0,
          robot_id: Number(r.robot_id ?? 0) || 0,
          agent_group_id: Number(r.agent_group_id ?? -1),
          skill_id: Number(r.skill_id ?? -1),
          media_type: Number(r.media_type ?? 0) || 0,
          line_priority: Number(r.line_priority ?? 0) || 0,
          timeout_seconds: Number(r.timeout_seconds ?? 0) || 0,
          enabled: r.enabled !== false,
        })),
      }),
    );
  }
  await prisma.$transaction(ops);
}

/** 渠道删除时清掉对应路由，避免 id 被复用后串到旧配置。 */
export async function clearChannelRoutes(
  channelType: ChannelRouteType,
  channelId: number,
): Promise<void> {
  const id = num(channelId);
  if (id <= 0) return;
  await prisma.channel_route.deleteMany({
    where: { channel_type: channelType, channel_id: id },
  });
}
