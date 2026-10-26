import { vdnForConversation } from '../../shared/services/conf-tenancy.js';
import { activeVdn } from '../access/access.scope.js';
/**
 * 路由执行器：把 ITR 发来的候选路由真正落到会话上。
 *
 * ITR 的 route 节点只表达「去哪」（payloadJson.routes），「怎么去」由这里决定：
 * 按候选顺序逐个尝试，失败降级到下一个。
 *
 * 刻意不 import itr.routes.ts —— 那边是 HTTP 入口，反向依赖会成环。
 * ACD 能力直接调 acdRing（与 /api/itr/callback/transfer 用的是同一个），
 * 分配走 assignConversation，启动流程走 itrStart，行为与既有路径一致。
 */
import { prisma } from '../../plugins/db.js';
import { env } from '../../config/env.js';
import { acdRing } from '../../integrations/ccs/acd-client.js';
import { CHANNEL_TYPES } from '../../shared/channels/types.js';
import { getQueueTip } from '../../shared/services/omni-ops.js';
import {
  assignConversation,
  forgetQueue,
  markItrHosted,
  pushVisitorMessageToChannel,
  rememberQueue,
  writeVisitorChatMessage,
} from './itr-queue.js';
import { ROUTE_APP_TYPES, type RouteAppType, type RouteTarget } from '../../shared/services/channel-route.js';

export interface RouteExecResult {
  ok: boolean;
  message: string;
  /** 实际生效的候选（全部失败时 undefined） */
  used?: RouteTarget;
}

/** 执行上下文：调用方按场景传进来的额外信息。 */
export interface RouteExecContext {
  /**
   * 传给 itr 目标的 meta（例如超时流程的 replyTimeout / waitedSeconds / workNo）。
   * 其它目标类型忽略它。
   */
  meta?: Record<string, unknown>;
}

// 白名单来自 channel-route 的唯一定义（别在这里重写一份 —— 加 release 时就是漏了这里）
const APP_TYPES: readonly string[] = ROUTE_APP_TYPES;

function num(v: unknown, d = 0): number {
  const n = Number(v ?? d);
  return Number.isFinite(n) ? n : d;
}

function toAppType(raw: unknown): RouteAppType {
  const s = String(raw ?? '').trim().toLowerCase();
  return (APP_TYPES as string[]).includes(s) ? (s as RouteAppType) : 'none';
}

/**
 * 解析 ITR 送来的候选（payloadJson.routes，字段已是 snake_case）。
 * 解析不出东西就返回空数组 = 不路由。
 */
export function parseRoutes(raw: unknown): RouteTarget[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r, i) => ({
      id: 0,
      appType: toAppType(r.app_type ?? r.appType),
      flowId: num(r.flow_id ?? r.flowId),
      agentId: num(r.agent_id ?? r.agentId),
      robotId: num(r.robot_id ?? r.robotId),
      agentGroupId: num(r.agent_group_id ?? r.agentGroupId, -1),
      skillId: num(r.skill_id ?? r.skillId, -1),
      mediaType: num(r.media_type ?? r.mediaType),
      linePriority: num(r.line_priority ?? r.linePriority),
      timeoutSeconds: num(r.timeout_seconds ?? r.timeoutSeconds),
      priority: i,
    }));
}

/** acd：进排队。参数缺省时用环境的默认分组/技能，与 /callback/transfer 一致。 */
async function execAcd(conversationId: number, t: RouteTarget): Promise<RouteExecResult> {
  const vdnId = await vdnForConversation(conversationId, activeVdn(num(env.OMNI_AGENT_VDN_ID, 1)));
  const requestId = conversationId;
  const agentGroupId =
    t.agentGroupId > 0 ? t.agentGroupId : num(env.OMNI_DEFAULT_AGENT_GROUP_ID, -1);
  const skillId = t.skillId > 0 ? t.skillId : num(env.OMNI_DEFAULT_SKILL_ID, -1);
  const mediaType = t.mediaType > 0 ? t.mediaType : num(env.OMNI_ACD_MEDIA_TYPE, 5);
  try {
    rememberQueue({
      requestId,
      vdnId,
      conversationId,
      startedAt: Date.now(),
      skillId,
      agentGroupId,
    });
    const ring = await acdRing({
      requestId,
      callerId: `conv:${conversationId}`,
      calledId: 'ITR',
      callerType: 1,
      vdnId,
      agentGroupId,
      skillId,
      skillLevel: 1,
      vipLevel: t.linePriority || 1,
      agentId: t.agentId > 0 ? t.agentId : -1,
      mediaType,
      pid: requestId,
    });
    if (ring.ret !== 0) {
      forgetQueue(conversationId);
      return { ok: false, message: `DoRing failed ret=${ring.ret}` };
    }
    // 排队成功：把排队信息补进队列条目（ACD 回调用它算 EWT / 排队长度）
    const rsp = (ring.rsp || {}) as Record<string, unknown>;
    rememberQueue({
      requestId,
      vdnId,
      conversationId,
      startedAt: Date.now(),
      ewt: num(rsp.EWT ?? rsp.ewt) || undefined,
      queueLen: num(rsp.QueueLen ?? rsp.queueLen) || undefined,
      skillId,
      agentGroupId,
    });
    // 进队提示（同 /callback/transfer：由 Omni 落一条访客可见消息）。
    // 写完必须再投一次渠道，否则被动形态下客户看不到 —— 这条消息本来就是给客户的。
    try {
      const tip = await getQueueTip('');
      const tipMsg = await writeVisitorChatMessage(conversationId, tip);
      await pushVisitorMessageToChannel(conversationId, tipMsg?.id ?? 0, tip);
    } catch (e) {
      console.warn('[route] queue tip failed', e);
    }
    return { ok: true, message: 'queued' };
  } catch (e) {
    forgetQueue(conversationId);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** agent：直接分配给指定坐席。坐席不存在视为失败，好让调用方降级。 */
async function execAgent(conversationId: number, t: RouteTarget): Promise<RouteExecResult> {
  if (t.agentId <= 0) return { ok: false, message: 'agent_id required for app_type=agent' };
  const u = await prisma.users
    .findUnique({ where: { id: t.agentId }, select: { id: true } })
    .catch(() => null);
  if (!u) return { ok: false, message: `agent ${t.agentId} not found` };
  try {
    await assignConversation(conversationId, t.agentId, { method: 'transfer' });
    markItrHosted(conversationId, false);
    return { ok: true, message: 'assigned' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** itr：启动另一个流程接管（例如转到满意度流程）。 */
async function execItr(
  conversationId: number,
  t: RouteTarget,
  ctx?: RouteExecContext,
): Promise<RouteExecResult> {
  if (t.flowId <= 0) return { ok: false, message: 'flow_id required for app_type=itr' };
  try {
    const conv = await prisma.conversations.findUnique({
      where: { id: conversationId },
      select: { inbox_id: true },
    });
    const { itrStart } = await import('../../integrations/itr/itr-client.js');
    const rsp = await itrStart({
      conversationId: String(conversationId),
      contactId: '',
      channelType: CHANNEL_TYPES.WECHAT_MP,
      inboxId: conv?.inbox_id ?? 0,
      flowId: t.flowId,
      vdnId: 0,
      callerId: '',
      // 调用方按场景带进来的 meta（如超时流程的 replyTimeout/waitedSeconds/workNo）
      meta: ctx?.meta ?? {},
    });
    const result = Number((rsp as Record<string, unknown>)?.result ?? 0);
    if (result !== 0) {
      return { ok: false, message: `itrStart failed result=${result}` };
    }
    return { ok: true, message: 'itr started' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * release：把会话从坐席手里收回，退回「未分配」。
 *
 * 清掉 assignee_id 与 itr_hosted，于是下一条客户消息会重新走 on_inbound 的路由
 *（菜单 / 机器人 / 直接排队）—— 这是「坐席超时未回复 → 收回重排」这条链路的收口动作。
 *
 * 为什么要专门做这个目标：超时流程原先只发提示、不改归属，会话会永远卡在坐席名下，
 * 「谁接管谁负责」的原则反而让客户再也回不到机器人。
 */
async function execRelease(conversationId: number): Promise<RouteExecResult> {
  try {
    const conv = await prisma.conversations
      .findUnique({
        where: { id: conversationId },
        select: { additional_attributes: true },
      })
      .catch(() => null);
    const attrs = (conv?.additional_attributes ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...attrs, itr_hosted: false };
    delete next.itr_flow_id;
    delete next.acd_request_id;
    delete next.acd_agent_id;
    await prisma.conversations.update({
      where: { id: conversationId },
      data: { assignee_id: null, additional_attributes: next as object },
    });
    markItrHosted(conversationId, false);
    // 计数也要一起清：「收回会话」在语义上就是重新开始。
    // 不清的话，上一个坐席会话攒下的 timeoutCount 会带到新的一轮 ——
    // 新会话第一次超时就可能直接命中「连续 3 次」去重新排队（实测踩到过）。
    try {
      const { itrResetTimeoutCount } = await import('../../integrations/itr/itr-client.js');
      await itrResetTimeoutCount(String(conversationId));
    } catch (e) {
      console.warn('[route] reset timeout count on release failed', e);
    }
    return { ok: true, message: 'released' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** 执行单个候选。app_type 不认识就算失败，交给调用方降级。 */
export async function executeRoute(
  conversationId: number,
  t: RouteTarget,
  ctx?: RouteExecContext,
): Promise<RouteExecResult> {
  switch (t.appType) {
    case 'acd':
      return execAcd(conversationId, t);
    case 'agent':
      return execAgent(conversationId, t);
    case 'itr':
      return execItr(conversationId, t, ctx);
    case 'release':
      return execRelease(conversationId);
    case 'robot':
      // 业务上只需要「能路由到机器人」，机器人自身能力另做。
      return { ok: false, message: 'robot route not implemented yet' };
    case 'none':
      return { ok: true, message: 'noop' };
    default:
      return { ok: false, message: `unsupported app_type=${String(t.appType)}` };
  }
}

/**
 * 按顺序尝试候选，返回第一个成功的。
 * 全部失败返回 ok=false（调用方决定怎么收尾 —— 按设计，没有全局兜底终点）。
 */
export async function executeRoutes(
  conversationId: number,
  targets: RouteTarget[],
  ctx?: RouteExecContext,
): Promise<RouteExecResult> {
  const list = targets.filter(Boolean);
  if (!list.length) return { ok: false, message: 'no candidate routes' };
  const failures: string[] = [];
  for (const t of list) {
    const r = await executeRoute(conversationId, t, ctx);
    if (r.ok) {
      if (failures.length) {
        console.warn('[route] degraded to later candidate', {
          conversationId,
          used: t.appType,
          skipped: failures,
        });
      }
      return { ...r, used: t };
    }
    failures.push(`${t.appType}: ${r.message}`);
    console.warn('[route] candidate failed, trying next', {
      conversationId,
      appType: t.appType,
      message: r.message,
    });
  }
  return { ok: false, message: failures.join(' | ') };
}
