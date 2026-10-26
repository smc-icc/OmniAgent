import { assertItrConversationInbox } from '../../shared/services/conf-itr-tenancy.js';
import { vdnForConversation } from '../../shared/services/conf-tenancy.js';
/**
 * Auto-start ITR on inbound + relay visitor messages while hosted.
 */
import { env } from '../../config/env.js';
import { prisma } from '../../plugins/db.js';
import { itrOnMessage, itrStart } from '../../integrations/itr/itr-client.js';
import { clearTimeoutFlow, isItrHosted, isTimeoutFlow, markItrHosted } from './itr-queue.js';
import { executeRoutes, parseRoutes } from './route-exec.js';
import {
  channelOfConversation,
  resolveRoutes,
  type RouteTrigger,
} from '../../shared/services/channel-route.js';
import { agentDbg } from './debug-ingest.js';
import { pickItrFlowId } from './itr-flow-pick.js';

export { pickItrFlowId } from './itr-flow-pick.js';

function attrsOf(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

export function itrFlowIdFromConfig(cfg: unknown): number {
  const a = attrsOf(cfg);
  return Number(a.itr_flow_id ?? a.itrFlowId ?? 0) || 0;
}

export function vdnIdFromConfig(cfg: unknown): number {
  const a = attrsOf(cfg);
  return Number(a.vdn_id ?? a.vdnId ?? 0) || 0;
}

/**
 * 取「进线路由」指定的流程 id。
 *
 * on_inbound 这个触发点一直是死的（定义了但没人读），这里把它接上：
 * 渠道上配了 on_inbound → itr/flow 之后，该渠道的新会话就走那个流程，
 * 于是不同渠道（公众号 / 微信客服）可以有各自的欢迎语和菜单。
 */
async function resolveInboundFlowId(conversationId: number): Promise<number> {
  try {
    const { resolveRoutes, channelOfConversation, normalizeRouteChannelType } =
      await import('../../shared/services/channel-route.js');
    const { channelType, channelId } = await channelOfConversation(conversationId);
    if (channelId <= 0) return 0;
    const routeType = normalizeRouteChannelType(channelType);
    if (!routeType) return 0;
    const routes = await resolveRoutes(channelId, 'on_inbound', routeType);
    const itr = routes.find((r) => r.appType === 'itr' && Number(r.flowId) > 0);
    return Number(itr?.flowId ?? 0) || 0;
  } catch {
    return 0;
  }
}

/**
 * Resolve flowId：渠道路由(on_inbound) → 会话属性 → inbox auto_assignment_config
 *                → VDN ItrDefaultFlowId → env default
 *
 * 为什么路由排最前：客户在渠道上配置的「进线走哪个流程」是最具体的意图，
 * 应该覆盖会话上可能残留的历史值（例如上一轮流程留下的 itr_flow_id）。
 */
export async function resolveItrFlowId(
  conversationId: number,
  inboxId?: number,
): Promise<number> {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    select: { additional_attributes: true, inbox_id: true, account_id: true },
  });
  await assertItrConversationInbox(conv, inboxId);
  const fromRoute = await resolveInboundFlowId(conversationId);
  if (fromRoute > 0) return fromRoute;
  const cAttrs = attrsOf(conv?.additional_attributes);
  const fromConv = Number(cAttrs.itr_flow_id ?? cAttrs.itrFlowId ?? 0);

  let inboxCfg: unknown;
  const resolvedInboxId = inboxId || conv?.inbox_id;
  if (resolvedInboxId) {
    const inbox = await prisma.inboxes.findUnique({
      where: { id: resolvedInboxId },
      select: { auto_assignment_config: true },
    });
    inboxCfg = inbox?.auto_assignment_config;
  }
  const fromInbox = itrFlowIdFromConfig(inboxCfg);
  const vdnId = await vdnForConversation(conversationId, vdnIdFromConfig(inboxCfg) || env.OMNI_AGENT_VDN_ID || 1);
  let fromVdn = 0;
  if (fromConv <= 0 && fromInbox <= 0 && vdnId > 0) {
    const { loadVdnDefaultItrFlowId } = await import('../../shared/services/icc-groups-dal.js');
    fromVdn = await loadVdnDefaultItrFlowId(vdnId);
  }
  return pickItrFlowId({
    conv: fromConv,
    inbox: fromInbox,
    vdn: fromVdn,
    envDefault: env.ITR_DEFAULT_FLOW_ID,
  });
}

export function shouldAutoStartItr(convAttrs?: unknown, inboxCfg?: unknown): boolean {
  if (env.ITR_AUTO_START !== '1') return false;
  const a = attrsOf(convAttrs);
  if (a.itr_enabled === false || a.itrEnabled === false) return false;
  const i = attrsOf(inboxCfg);
  if (i.itr_enabled === false || i.itrEnabled === false) return false;
  return true;
}

/**
 * 渠道是否具备主动推送能力。
 *
 * 目前只有微信公众号存在「没有客服消息权限」的情形（未认证订阅号，含个人号；
 * 未认证的企业订阅号同理），其余渠道出站走我们自己的 WebSocket / webhook / SMTP，
 * 一律不受限。
 *
 * 返回 undefined 表示「不适用」——此时不往 meta 里塞这个键，流程侧按未设置处理，
 * 走完整菜单，既有行为不变。认证通过后只需把渠道配置的 supports_active_reply
 * 改回 true，不用动代码、不用重新部署。
 */
async function resolveSupportsActiveReply(
  channelType?: string | null,
  channelId?: number | null,
): Promise<boolean | undefined> {
  if (!channelId || !isWechatMpChannelType(channelType)) return undefined;
  const ch = await prisma.channel_wechat_mp.findUnique({
    where: { id: channelId },
    select: { supports_active_reply: true },
  });
  return ch?.supports_active_reply ?? undefined;
}

/**
 * inbox.channel_type 的写法并不统一：运行库里的实际值是 `Channel::WechatMp`，
 * 而不少代码路径习惯写 `wechat_mp`。归一化后再比较，避免字面量差异让判断静默失效
 * —— 曾经因此导致 supports_active_reply 开关完全没生效、菜单一直是完整版。
 */
function isWechatMpChannelType(channelType?: string | null): boolean {
  const raw = String(channelType ?? '').trim();
  if (!raw) return false;
  const tail = raw.includes('::') ? raw.split('::').pop()! : raw;
  return tail.replace(/[^a-z0-9]/gi, '').toLowerCase() === 'wechatmp';
}

export async function autoStartItrForConversation(opts: {
  conversationId: number;
  contactId?: number | string;
  inboxId?: number;
  channelType?: string;
  callerId?: string;
}): Promise<Record<string, unknown> | null> {
  try {
    const conv = await prisma.conversations.findUnique({
      where: { id: opts.conversationId },
      select: { additional_attributes: true, inbox_id: true, account_id: true },
    });
    await assertItrConversationInbox(conv, opts.inboxId);
    const inbox = (opts.inboxId || conv?.inbox_id)
      ? await prisma.inboxes.findUnique({
          where: { id: opts.inboxId || conv!.inbox_id },
          select: { channel_type: true, channel_id: true, auto_assignment_config: true },
        })
      : null;
    const allowed = shouldAutoStartItr(conv?.additional_attributes, inbox?.auto_assignment_config);
    const flowId = await resolveItrFlowId(opts.conversationId, opts.inboxId || conv?.inbox_id);
    const supportsActiveReply = await resolveSupportsActiveReply(
      inbox?.channel_type,
      inbox?.channel_id,
    );
    // 被动模式下 webhook 会把「客户上次在菜单里选了哪个分支」写进会话属性，
    // 带进流程让它直接进对应节点，而不是把菜单重发一遍。
    const menuBranch = String(attrsOf(conv?.additional_attributes).wechat_mp_menu_branch || '');
    const fromInbox = itrFlowIdFromConfig(inbox?.auto_assignment_config);
    const fromConv = Number(attrsOf(conv?.additional_attributes).itr_flow_id || 0);
    const vdnId = await vdnForConversation(opts.conversationId, vdnIdFromConfig(inbox?.auto_assignment_config) || env.OMNI_AGENT_VDN_ID || 1);
    // #region agent log
    agentDbg('A', 'itr-lifecycle.ts:autoStart', 'autoStart resolve', {
      conversationId: opts.conversationId,
      inboxId: opts.inboxId || conv?.inbox_id || 0,
      allowed,
      flowId,
      fromInbox,
      fromConv,
      defaultFlow: env.ITR_DEFAULT_FLOW_ID,
      autoStartEnv: env.ITR_AUTO_START,
    });
    // #endregion
    if (!allowed) return null;
    const rsp = await itrStart({
      conversationId: String(opts.conversationId),
      contactId: String(opts.contactId ?? ''),
      channelType: opts.channelType || inbox?.channel_type || 'web_widget',
      inboxId: opts.inboxId || conv?.inbox_id || 0,
      flowId,
      vdnId,
      callerId: opts.callerId || `conv:${opts.conversationId}`,
      meta: {
        auto: true,
        event: String(
          attrsOf(conv?.additional_attributes).wx_event
            || attrsOf(conv?.additional_attributes).event
            || '',
        ),
        eventKey: String(
          attrsOf(conv?.additional_attributes).wx_event_key
            || attrsOf(conv?.additional_attributes).eventKey
            || '',
        ),
        oauthDone: Boolean(
          attrsOf(conv?.additional_attributes).wx_oauth_done || attrsOf(conv?.additional_attributes).oauthDone,
        ),
        // 渠道能力随 itrStart 送进流程，供 `if` 节点决定发精简菜单还是完整菜单。
        // ITR 侧会把它从 meta 拷进 sess.vars（_eval_bool 只读 vars，不读 meta）。
        ...(supportsActiveReply === undefined ? {} : { supportsActiveReply }),
        ...(menuBranch ? { menuBranch } : {}),
      },
    });
    // 流程可能一启动就发出路由指令（route 节点），这里同样要执行：
    // 已路由时托管状态由 helper 定，别再无条件置 true 把它盖掉。
    const routed = await runRoutedInstructions(opts.conversationId, rsp);
    if (!routed.handled) markItrHosted(opts.conversationId, true);
    await prisma.conversations.update({
      where: { id: opts.conversationId },
      data: {
        additional_attributes: {
          ...attrsOf(conv?.additional_attributes),
          itr_hosted: true,
          itr_flow_id: flowId,
        } as object,
      },
    });
    return rsp;
  } catch (e) {
    // #region agent log
    agentDbg('C', 'itr-lifecycle.ts:autoStart.catch', 'autoStart failed', {
      conversationId: opts.conversationId,
      err: e instanceof Error ? e.message : String(e),
    });
    // #endregion
    console.warn('[itr] autoStart failed', e);
    return null;
  }
}

/**
 * 该 inbox 是否属于「被动回复」公众号（无客服消息权限）。
 *
 * 被动模式一条客户消息只能回一条被动回复，所以「启动流程（发菜单）」和
 * 「消费这条消息」只能占用同一次机会 —— 调用方据此决定要不要跳过 relay。
 */
export async function isPassiveReplyInbox(
  channelType?: string | null,
  channelId?: number | null,
): Promise<boolean> {
  if (!channelId || !isWechatMpChannelType(channelType)) return false;
  const ch = await prisma.channel_wechat_mp.findUnique({
    where: { id: channelId },
    select: { supports_active_reply: true, passive_reply_enabled: true },
  });
  return !!ch && ch.supports_active_reply === false && ch.passive_reply_enabled === true;
}

/** ITR 回「这个会话我没见过」——通常意味着 ITR 进程重启过，它内存里的会话没了 */
function isItrSessionMissing(rsp: Record<string, unknown>): boolean {
  if (Number(rsp?.result) === 3) return true;
  return String(rsp?.message || '').toLowerCase().includes('session not found');
}

/**
 * 执行流程发出的路由指令（payloadJson.routes）。
 *
 * 流程的 route 节点只表达「去哪」，Omni 负责「怎么去」：按候选顺序执行、失败降级。
 * 返回 handled=true 表示这条消息的归宿已经定了，调用方不用再管。
 */
export async function runRoutedInstructions(
  conversationId: number,
  rsp: Record<string, unknown>,
): Promise<{ handled: boolean }> {
  const payload = (rsp.payload ?? {}) as Record<string, unknown>;
  const targets = parseRoutes(payload.routes);
  if (!targets.length) return { handled: false };
  const out = await executeRoutes(conversationId, targets);
  if (out.ok) {
    // acd / agent 已经把会话交出去了；只有 itr 还由流程持有。
    markItrHosted(conversationId, out.used?.appType === 'itr');
    return { handled: true };
  }
  console.warn('[itr] all route candidates failed', {
    conversationId,
    message: out.message,
  });
  markItrHosted(conversationId, false);
  return { handled: true };
}

/**
 * 按渠道配置执行某触发点的路由。
 *
 * 用于「没有流程 payload」的场景 —— 典型是坐席点结束会话后的满意度路由
 *（on_agent_end）：它不由流程发起，而是会话生命周期事件触发的。
 * 返回 true 表示该渠道对此触发点配了路由（不管执行成败）。
 */
export async function runChannelRoutes(
  conversationId: number,
  trigger: RouteTrigger,
): Promise<boolean> {
  try {
    const { channelType, channelId } = await channelOfConversation(conversationId);
    if (channelId <= 0) return false;
    const { normalizeRouteChannelType } = await import('../../shared/services/channel-route.js');
    const routeType = normalizeRouteChannelType(channelType);
    if (!routeType) return false;
    const targets = await resolveRoutes(channelId, trigger, routeType);
    if (!targets.length) return false;
    const out = await executeRoutes(conversationId, targets);
    // 满意度（on_agent_end）：渠道配置的流程负责「发邀请」，Omni 负责「打开收货开关」。
    // 不点亮 csat_pending 的话，客户回复的评分会被 tryConsumeCsatRating()
    // 的第一道门直接丢弃 —— 既不入库、也不会回「感谢您的评价」。
    if (trigger === 'on_agent_end' && out.ok && out.used?.appType === 'itr') {
      try {
        const { markCsatPending } = await import('./csat-invite.js');
        await markCsatPending(conversationId);
      } catch (e) {
        console.warn('[route] mark csat pending failed', e);
      }
    }
    console.log('[route] channel routes executed', {
      conversationId,
      trigger,
      ok: out.ok,
      used: out.used?.appType ?? null,
      message: out.message,
    });
    return true;
  } catch (e) {
    console.warn('[route] channel routes failed', { conversationId, trigger, e });
    return false;
  }
}

/** Forward visitor text to ITR when conversation is hosted */
export async function relayVisitorToItr(
  conversationId: number,
  content: string,
): Promise<boolean> {
  const key = String(conversationId);
  try {
    const consumed = await import('./csat-invite.js').then(({ tryConsumeCsatRating }) =>
      tryConsumeCsatRating(conversationId, content),
    );
    if (consumed) {
      agentDbg('E', 'itr-lifecycle.ts:relay', 'csat consumed', {
        conversationId,
        preview: content.slice(0, 24),
      });
      return true;
    }
  } catch (e) {
    console.warn('[itr] csat consume failed', e);
  }
  // 会话已经分配到坐席：这条消息默认只给坐席。
  //
  // 但「要不要给 ITR」不该由 Omni 自己拍。ITR 流程可能正停在等待输入的节点上
  // —— 比如坐席回复超时流程发出的「继续等待请按1，留言请按2」——
  // 这时客户发的就是流程在等的那条输入（按键，或留言正文）。
  //
  // 判断权归流程：把消息递过去，流程用 state 回答「这条我吃不吃」（waiting = 吃了）。
  // 吃掉就不再给坐席；没吃（流程已结束、或客户本就是想跟坐席说话）就交回坐席。
  // 这样 Omni 只做路由，不做业务判断 —— 坐席只是会话的一个状态，不是"消息从此不进 ITR"。
  const convNow = await prisma.conversations.findUnique({
    where: { id: conversationId },
    select: { additional_attributes: true, assignee_id: true },
  });
  if (convNow?.assignee_id) {
    // 会话已经分配到坐席：消息默认只给坐席。
    // 例外是这个会话当前挂着「坐席回复超时流程」—— 那条流程正停在
    // 「继续等待请按1，留言请按2」上等客户答复，客户发的就是它在等的那条输入
    //（按键，或按 2 之后的留言正文）。这是 Omni 对自己行为的记录（那条流程是它启动的），
    // 不是替流程做业务判断；"要不要给 ITR"这件事本身仍由流程用 state 回答。
    if (!isTimeoutFlow(conversationId)) {
      markItrHosted(conversationId, false);
      return false;
    }
    try {
      const rsp = await itrOnMessage(key, content, 'text');
      const state = String(rsp.state || '');
      if (!isItrSessionMissing(rsp) && state !== 'ended') {
        // 流程还活着（按键被消化 / 留言还没收完）→ 这条不给坐席
        markItrHosted(conversationId, true);
        return true;
      }
    } catch (e) {
      console.warn('[itr] timeout flow relay failed', e);
    }
    // 流程结束了（客户说的是别的话，不是按键）→ 收口，把消息交回坐席
    clearTimeoutFlow(conversationId);
    markItrHosted(conversationId, false);
    return false;
  }
  if (!isItrHosted(key)) {
    const a = attrsOf(convNow?.additional_attributes);
    if (!a.itr_hosted) return false;
    markItrHosted(conversationId, true);
  }
  try {
    // #region agent log
    agentDbg('E', 'itr-lifecycle.ts:relay', 'visitor relay', {
      conversationId,
      consumed: false,
      contentLen: content.length,
      preview: content.slice(0, 24),
    });
    // #endregion
    const rsp = await itrOnMessage(key, content, 'text');
    const state = String(rsp.state || '');

    // 流程发出了「路由指令」（route 节点）：候选目标在 payloadJson.routes 里，
    // 由 Omni 按顺序执行、失败降级。这是二期新增的通道，取代流程内硬编码的转接参数。
    const routed = await runRoutedInstructions(conversationId, rsp);
    if (routed.handled) return true;

    // ITR 侧会话已经不存在（进程重启 / 会话回收）：Omni 的托管标记却可能还是 true，
    // 若只走下面的 markItrHosted(false)，要等到「下一条消息」才会重新 StartSession，
    // 客户这一条就石沉大海了。这里当场自愈：清标记 → 重新拉起流程 → 重放这条消息。
    if (isItrSessionMissing(rsp)) {
      markItrHosted(conversationId, false);
      const restarted = await autoStartItrForConversation({ conversationId });
      if (restarted) {
        try {
          await itrOnMessage(key, content, 'text');
        } catch (e) {
          console.warn('[itr] replay after auto-restart failed', e);
        }
      }
      return true;
    }

    if (state === 'ended' || state === 'transferred' || state === 'queued') {
      if (state !== 'queued') markItrHosted(conversationId, false);
    }
    return true;
  } catch (e) {
    console.warn('[itr] relay failed', e);
    return false;
  }
}

/**
 * 会话闲置回收计时器（进程内）。
 *
 * 客户最后一次发言后，超过渠道配置的 `idle_recycle_seconds` 仍无新消息，就执行
 * on_idle_timeout 路由（默认 release：清掉坐席归属与流程状态），让客户下次发言
 * 从干净状态开始 —— 否则机器人会把会话停在菜单上等输入，客户不发 1/4 就永远出不来。
 *
 * 用进程内定时器而不是扫库定时任务：被动形态下每次客户发言都会进到
 * channel-incoming，在那里重置计时器最省事；重启丢失只是少回收一次，下次发言重来。
 * 多实例部署时这里要换成 Redis 分布式延迟任务。
 */
const idleRecycleTimers = new Map<number, ReturnType<typeof setTimeout>>();

export function cancelIdleRecycle(conversationId: number): void {
  const t = idleRecycleTimers.get(conversationId);
  if (t) {
    clearTimeout(t);
    idleRecycleTimers.delete(conversationId);
  }
}

export async function scheduleIdleRecycle(conversationId: number): Promise<void> {
  cancelIdleRecycle(conversationId);
  try {
    const conv = await prisma.conversations.findUnique({
      where: { id: conversationId },
      select: {
        assignee_id: true,
        inbox: { select: { channel_type: true, channel_id: true } },
      },
    });
    const channelId = conv?.inbox?.channel_id;
    if (!channelId || !isWechatMpChannelType(conv?.inbox?.channel_type)) return;
    const ch = await prisma.channel_wechat_mp.findUnique({
      where: { id: channelId },
      select: { idle_recycle_seconds: true },
    });
    const seconds = Number(ch?.idle_recycle_seconds ?? 0) || 0;
    if (seconds <= 0) return; // 0 = 不回收
    // 坐席接管中的会话**同样**要管：客户一直不发言时，「坐席超时」那套只会反复发提示、
    // 不会把会话交回来，两套机制之间会留一个"永远循环"的空档。
    // 所以这里不再按 assignee_id 过滤 —— 收不收、怎么收由 on_idle_timeout 的路由配置决定
    //（默认 release：清坐席归属与流程状态，客户下次发言重新走菜单）。
    const t = setTimeout(() => {
      idleRecycleTimers.delete(conversationId);
      void runChannelRoutes(conversationId, 'on_idle_timeout').catch((e) =>
        console.warn('[itr] idle recycle route failed', { conversationId, e }),
      );
    }, seconds * 1000);
    if (typeof t.unref === 'function') t.unref();
    idleRecycleTimers.set(conversationId, t);
  } catch (e) {
    console.warn('[itr] scheduleIdleRecycle failed', { conversationId, e });
  }
}

/**
 * 主动推送形态的「坐席回复超时」计时器（进程内）。
 *
 * 被动形态靠 webhook 的 5 秒窗口判定；主动推送形态下坐席随时能推、客户不会卡在
 * 窗口里，所以要在客户发言后起一个延迟任务：到点若坐席仍未回过，就把会话收回给
 * ITR 走该渠道配置的超时流程（此时 ITR 的输出能主动送达客户）。
 *
 * 用进程内定时器而不是队列：窗口只有几秒，重启丢失的代价极小，也不与队列基础设施
 * 耦合。多实例部署时这里要换成 Redis 分布式延迟任务。
 */
const activeReplyTimers = new Map<number, ReturnType<typeof setTimeout>[]>();

export async function scheduleActiveReplyTimeout(conversationId: number): Promise<void> {
  cancelActiveReplyTimeout(conversationId);
  try {
    const conv = await prisma.conversations.findUnique({
      where: { id: conversationId },
      select: {
        assignee_id: true,
        inbox: { select: { channel_type: true, channel_id: true } },
      },
    });
    // 没有坐席时不算「坐席回复超时」——排队等待交给流程自己兜底
    if (!conv?.assignee_id) return;
    const channelId = conv.inbox?.channel_id;
    if (!channelId || !isWechatMpChannelType(conv.inbox?.channel_type)) return;
    const ch = await prisma.channel_wechat_mp.findUnique({
      where: { id: channelId },
      select: {
        reply_timeout_seconds: true,
        reply_timeout_level2_seconds: true,
        reply_timeout_flow_id: true,
        supports_active_reply: true,
      },
    });
    // 被动形态由 webhook 窗口负责，这里只管主动推送形态
    if (!ch || ch.supports_active_reply !== true) return;
    if (!ch.reply_timeout_flow_id) return;

    const inboundAt = Date.now();
    const timers: ReturnType<typeof setTimeout>[] = [];
    // 两个调度时刻都来自渠道配置（0 = 不启用），不写死在代码里。
    // 注意 Omni 只做两件事：「什么时候叫醒流程」和「已经等了多少秒」——
    // 该发哪一级提示、要不要限流，全由 ITR 流程按 var.waitedSeconds 自己决定。
    const arm = (delaySeconds: number) => {
      if (!delaySeconds || delaySeconds <= 0) return;
      const timer = setTimeout(() => {
        void fireActiveReplyTimeout(conversationId, inboundAt, ch.reply_timeout_flow_id, delaySeconds).catch((e) =>
          console.warn(`[itr] active reply-timeout(${delaySeconds}s) failed`, e),
        );
      }, delaySeconds * 1000);
      timer.unref?.();
      timers.push(timer);
    };
    arm(ch.reply_timeout_seconds);
    arm(ch.reply_timeout_level2_seconds);
    if (timers.length) activeReplyTimers.set(conversationId, timers);
  } catch (e) {
    console.warn('[itr] schedule active reply-timeout failed', e);
  }
}

export function cancelActiveReplyTimeout(conversationId: number): void {
  const timers = activeReplyTimers.get(conversationId);
  if (!timers) return;
  timers.forEach((t) => clearTimeout(t));
  activeReplyTimers.delete(conversationId);
}

/** 到点检查坐席在窗口内是否回过；没回就把会话收回给 ITR 走超时流程 */
async function fireActiveReplyTimeout(
  conversationId: number,
  inboundAt: number,
  flowId: number,
  waitedSeconds: number,
): Promise<void> {
  // 到点先看「真人坐席」有没有回过：回过就不算超时。
  //
  // 必须用 sender_id 把 ITR / 系统消息排除掉 —— 它们同样是 outgoing（message_type=1），
  // 若一并算作「坐席已回」，一级提示自己就会把二级提示挡掉（实测踩过这个坑）。
  const lastAgentMsg = await prisma.messages.findFirst({
    where: { conversation_id: conversationId, message_type: 1, sender_id: { not: null } },
    orderBy: { id: 'desc' },
    select: { created_at: true },
  });
  if (lastAgentMsg && lastAgentMsg.created_at.getTime() >= inboundAt) return;

  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    select: { inbox_id: true, assignee_id: true },
  });
  if (!conv?.assignee_id) return;

  // 收回给 ITR：先清掉托管标记再起超时流程，否则会被当成「已托管」转发过去
  markItrHosted(conversationId, false);
  const rsp = await itrStart({
    conversationId: String(conversationId),
    contactId: '',
    channelType: 'Channel::WechatMp',
    inboxId: conv.inbox_id,
    flowId,
    vdnId: 0,
    callerId: `conv:${conversationId}`,
    // 只传事实：已经等了多久。该发哪一级提示、要不要限流，由流程自己决定。
    meta: { replyTimeout: true, waitedSeconds },
  });
  // 流程可能立即发出路由指令，与其它启动点一致地执行。
  const routed = await runRoutedInstructions(conversationId, rsp);
  if (!routed.handled) markItrHosted(conversationId, true);
}
