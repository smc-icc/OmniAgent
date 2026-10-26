import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../plugins/db.js';
import { computeSignature, verifySignature } from '../../shared/wechat/signature.js';
import {
  createWechatMpSchema,
  updateWechatMpSchema,
  createWecomKfSchema,
  updateWecomKfSchema,
  createWecomContactSchema,
  updateWecomContactSchema,
} from '../../shared/validators/wechat-channels.js';
import { NotFoundError } from '../../shared/errors/index.js';
import {
  CHANNEL_TYPES,
  wechatMpWebhookUrl,
  wecomKfWebhookUrl,
  wecomContactWebhookUrl,
} from '../../shared/wechat/webhook-url.js';
import { parseMpWebhookBody, handleMpIncomingMessage } from './wechat-mp.incoming.js';
import { buildTextReplyXml, buildWeChatXml } from '../../shared/wechat/xml.js';
import { encryptWeChatMessage } from '../../shared/wechat/crypto.js';
import {
  clearMenuRoute,
  drainPendingReplies,
  getMenuRoute,
  isPassiveReplyEnabled,
  joinPassiveReplies,
  openPassiveSlot,
  setMenuRoute,
  type PassiveSlot,
} from '../../shared/services/wechat-mp-passive.js';
import { parseWecomWebhookBody, handleKfCallbackEvent } from './wecom-kf.incoming.js';
import { handleContactIncoming } from './wecom-contact.incoming.js';
import { markTimeoutFlow } from '../itr/itr-queue.js';
import { resolveRoutes, replyTimeoutSecondsOf } from '../../shared/services/channel-route.js';

function maskSecret(s: string): string {
  if (s.length <= 8) return '********';
  return `${s.slice(0, 4)}****${s.slice(-4)}`;
}

function formatMpChannel(ch: Record<string, unknown>, inboxId?: number) {
  return {
    id: ch.id,
    account_id: ch.account_id,
    name: ch.name,
    app_id: ch.app_id,
    app_secret_masked: maskSecret(String(ch.app_secret)),
    token: ch.token,
    encoding_aes_key: ch.encoding_aes_key,
    account_type: ch.account_type,
    // 渠道能力：没有「客服消息」权限的公众号（未认证订阅号，含个人号）填 false
    supports_active_reply: ch.supports_active_reply,
    passive_reply_enabled: ch.passive_reply_enabled,
    route_ttl_seconds: ch.route_ttl_seconds,
    pending_reply_max: ch.pending_reply_max,
    inbox_id: inboxId,
    webhook_url: wechatMpWebhookUrl(String(ch.app_id)),
    created_at: ch.created_at,
    updated_at: ch.updated_at,
  };
}

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
      greeting_message: '您好，请问有什么可以帮您？',
      timezone: 'Asia/Shanghai',
    },
  });
}

// ── WeChat MP CRUD ──

export async function listWechatMpChannels(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const channels = await prisma.channel_wechat_mp.findMany({ where: { account_id: accId } });
  const payload = await Promise.all(channels.map(async (ch) => {
    const inbox = await prisma.inboxes.findFirst({
      where: { channel_type: CHANNEL_TYPES.WECHAT_MP, channel_id: ch.id },
    });
    return formatMpChannel(ch as unknown as Record<string, unknown>, inbox?.id);
  }));
  return reply.send({ payload });
}

export async function createWechatMpChannel(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = createWechatMpSchema.parse(request.body);
  const accId = parseInt(account_id, 10);

  const channel = await prisma.channel_wechat_mp.create({
    data: {
      account_id: accId,
      name: body.name,
      app_id: body.app_id,
      app_secret: body.app_secret,
      token: body.token,
      encoding_aes_key: body.encoding_aes_key ?? null,
      account_type: body.account_type,
      ...(body.supports_active_reply !== undefined && { supports_active_reply: body.supports_active_reply }),
      ...(body.passive_reply_enabled !== undefined && { passive_reply_enabled: body.passive_reply_enabled }),
      ...(body.route_ttl_seconds !== undefined && { route_ttl_seconds: body.route_ttl_seconds }),
      ...(body.pending_reply_max !== undefined && { pending_reply_max: body.pending_reply_max }),
    },
  });

  const inbox = await createLinkedInbox(
    accId,
    CHANNEL_TYPES.WECHAT_MP,
    channel.id,
    body.inbox_name ?? body.name,
  );

  return reply.status(200).send({
    ...formatMpChannel(channel as unknown as Record<string, unknown>, inbox.id),
    inbox,
  });
}

export async function updateWechatMpChannel(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = updateWechatMpSchema.parse(request.body);
  const existing = await prisma.channel_wechat_mp.findUnique({ where: { id: parseInt(id, 10) } });
  if (!existing) throw new NotFoundError('WeChat MP channel');

  const channel = await prisma.channel_wechat_mp.update({
    where: { id: parseInt(id, 10) },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.app_secret !== undefined && { app_secret: body.app_secret }),
      ...(body.token !== undefined && { token: body.token }),
      ...(body.encoding_aes_key !== undefined && { encoding_aes_key: body.encoding_aes_key }),
      ...(body.account_type !== undefined && { account_type: body.account_type }),
      ...(body.supports_active_reply !== undefined && { supports_active_reply: body.supports_active_reply }),
      ...(body.passive_reply_enabled !== undefined && { passive_reply_enabled: body.passive_reply_enabled }),
      ...(body.route_ttl_seconds !== undefined && { route_ttl_seconds: body.route_ttl_seconds }),
      ...(body.pending_reply_max !== undefined && { pending_reply_max: body.pending_reply_max }),
    },
  });
  const inbox = await prisma.inboxes.findFirst({
    where: { channel_type: CHANNEL_TYPES.WECHAT_MP, channel_id: channel.id },
  });
  return reply.send(formatMpChannel(channel as unknown as Record<string, unknown>, inbox?.id));
}

// ── WeCom KF CRUD ──

export async function listWecomKfChannels(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const channels = await prisma.channel_wecom_kf.findMany({ where: { account_id: accId } });
  const payload = await Promise.all(channels.map(async (ch) => {
    const inbox = await prisma.inboxes.findFirst({
      where: { channel_type: CHANNEL_TYPES.WECOM_KF, channel_id: ch.id },
    });
    return {
      id: ch.id,
      name: ch.name,
      corp_id: ch.corp_id,
      secret_masked: maskSecret(ch.secret),
      token: ch.token,
      open_kfid: ch.open_kfid,
      inbox_id: inbox?.id,
      webhook_url: wecomKfWebhookUrl(ch.id),
    };
  }));
  return reply.send({ payload });
}

export async function createWecomKfChannel(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = createWecomKfSchema.parse(request.body);
  const accId = parseInt(account_id, 10);

  const channel = await prisma.channel_wecom_kf.create({
    data: {
      account_id: accId,
      name: body.name,
      corp_id: body.corp_id,
      secret: body.secret,
      token: body.token,
      encoding_aes_key: body.encoding_aes_key ?? null,
      open_kfid: body.open_kfid ?? null,
    },
  });

  const inbox = await createLinkedInbox(
    accId,
    CHANNEL_TYPES.WECOM_KF,
    channel.id,
    body.inbox_name ?? body.name,
  );

  return reply.send({
    id: channel.id,
    name: channel.name,
    corp_id: channel.corp_id,
    open_kfid: channel.open_kfid,
    inbox_id: inbox.id,
    webhook_url: wecomKfWebhookUrl(channel.id),
  });
}

export async function updateWecomKfChannel(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = updateWecomKfSchema.parse(request.body);
  const existing = await prisma.channel_wecom_kf.findUnique({ where: { id: parseInt(id, 10) } });
  if (!existing) throw new NotFoundError('WeCom KF channel');

  const channel = await prisma.channel_wecom_kf.update({
    where: { id: parseInt(id, 10) },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.secret !== undefined && { secret: body.secret }),
      ...(body.token !== undefined && { token: body.token }),
      ...(body.encoding_aes_key !== undefined && { encoding_aes_key: body.encoding_aes_key }),
      ...(body.open_kfid !== undefined && { open_kfid: body.open_kfid }),
    },
  });
  return reply.send({
    id: channel.id,
    webhook_url: wecomKfWebhookUrl(channel.id),
  });
}

// ── WeCom Contact CRUD ──

export async function listWecomContactChannels(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const channels = await prisma.channel_wecom_contact.findMany({ where: { account_id: accId } });
  const payload = await Promise.all(channels.map(async (ch) => {
    const inbox = await prisma.inboxes.findFirst({
      where: { channel_type: CHANNEL_TYPES.WECOM_CONTACT, channel_id: ch.id },
    });
    return {
      id: ch.id,
      name: ch.name,
      corp_id: ch.corp_id,
      contact_secret_masked: maskSecret(ch.contact_secret),
      token: ch.token,
      agent_id: ch.agent_id,
      inbox_id: inbox?.id,
      webhook_url: wecomContactWebhookUrl(ch.id),
    };
  }));
  return reply.send({ payload });
}

export async function createWecomContactChannel(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = createWecomContactSchema.parse(request.body);
  const accId = parseInt(account_id, 10);

  const channel = await prisma.channel_wecom_contact.create({
    data: {
      account_id: accId,
      name: body.name,
      corp_id: body.corp_id,
      contact_secret: body.contact_secret,
      token: body.token,
      encoding_aes_key: body.encoding_aes_key ?? null,
      agent_id: body.agent_id ?? null,
    },
  });

  const inbox = await createLinkedInbox(
    accId,
    CHANNEL_TYPES.WECOM_CONTACT,
    channel.id,
    body.inbox_name ?? body.name,
  );

  return reply.send({
    id: channel.id,
    name: channel.name,
    corp_id: channel.corp_id,
    agent_id: channel.agent_id,
    inbox_id: inbox.id,
    webhook_url: wecomContactWebhookUrl(channel.id),
  });
}

export async function updateWecomContactChannel(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = updateWecomContactSchema.parse(request.body);
  const existing = await prisma.channel_wecom_contact.findUnique({ where: { id: parseInt(id, 10) } });
  if (!existing) throw new NotFoundError('WeCom contact channel');

  const channel = await prisma.channel_wecom_contact.update({
    where: { id: parseInt(id, 10) },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.contact_secret !== undefined && { contact_secret: body.contact_secret }),
      ...(body.token !== undefined && { token: body.token }),
      ...(body.encoding_aes_key !== undefined && { encoding_aes_key: body.encoding_aes_key }),
      ...(body.agent_id !== undefined && { agent_id: body.agent_id }),
    },
  });
  return reply.send({
    id: channel.id,
    webhook_url: wecomContactWebhookUrl(channel.id),
  });
}

// ── Webhooks ──

export async function wechatMpWebhookVerify(request: FastifyRequest, reply: FastifyReply) {
  const { app_id } = request.params as { app_id: string };
  const q = request.query as Record<string, string>;
  const channel = await prisma.channel_wechat_mp.findUnique({ where: { app_id } });
  if (!channel) return reply.status(404).send('not found');

  const sig = q.msg_signature ?? q.signature ?? '';
  // 注意两种模式的差异：
  // - 明文模式：signature = sha1(sort([token, timestamp, nonce]))，echostr 是明文
  // - 安全/兼容模式：签名同样不含 echostr，但 echostr 是密文，必须 AES 解密后再回给微信
  // 微信后台「提交」时只带 signature、不带 msg_signature，所以这里不能以 msg_signature 为前提。
  const ok = q.msg_signature && q.echostr
    ? verifySignature(channel.token, q.timestamp ?? '', q.nonce ?? '', sig, q.echostr)
    : verifySignature(channel.token, q.timestamp ?? '', q.nonce ?? '', sig);
  if (!ok) return reply.status(403).send('forbidden');

  if (channel.encoding_aes_key && q.echostr) {
    try {
      const { decryptWeChatMessage } = await import('../../shared/wechat/crypto.js');
      const plain = decryptWeChatMessage(channel.encoding_aes_key, channel.app_id, q.echostr);
      return reply.status(200).type('text/plain').send(plain);
    } catch {
      // 配了 AESKey 但解不开，说明后台提交的是明文 echostr（明文模式的容错）
      return reply.status(200).type('text/plain').send(q.echostr);
    }
  }
  return reply.status(200).type('text/plain').send(q.echostr ?? '');
}

/** 被动模式精简菜单里的「4.留言」分支；客户选中后下一条消息就是留言内容 */
const PASSIVE_LEAVE_BRANCH = '4';

/**
 * 组装被动回复应答体。
 *
 * 回复方式跟随**本次请求**：请求没带 encrypt_type=aes（微信明文模式）就回明文，
 * 带了才 AES 加密再包一层，且 msg_signature 要把密文一起参与签名。
 */
/** 微信被动回复硬限制（毫秒）：超过它微信就认为超时了，任何配置都不能越过 */
const WECHAT_PASSIVE_LIMIT_MS = 5000;
/**
 * 在渠道配置的「坐席回复超时」之上再扣掉这么多作为等待窗口，余下时间跑超时流程（毫秒）。
 *
 * 取 1 秒：既给超时流程留出执行时间（实测流程本身约 0.3 秒，1 秒足够），
 * 又尽量把窗口让给坐席 —— 少扣 0.5 秒就是给坐席多 0.5 秒的回复机会。
 */
const TIMEOUT_FLOW_HEADROOM_MS = 1000;

/**
 * 被动形态的等待窗口 = 渠道配置的「坐席回复超时」 − 留给超时流程的余量。
 *
 * 例：订阅号配 5 秒 → 等 4 秒判坐席未回，剩下 1 秒执行渠道配置的超时流程，
 * 整条链路仍落在微信 5 秒硬限制之内。
 * 0 = 未配置，按微信上限算，保证不配也能工作。
 */
function resolvePassiveWaitMs(channel: { reply_timeout_seconds: number }): number {
  // 时限来源（四期）：优先渠道显式配置；没配就按「回复类型」推导 ——
  // 被动形态默认 5 秒（业务约定：被动必须短，因为窗口只有 5 秒）。
  // 这样新渠道即使不配也能工作，而不是退回一个和业务无关的常量。
  const seconds =
    (channel.reply_timeout_seconds || 0) > 0
      ? channel.reply_timeout_seconds
      : replyTimeoutSecondsOf({
          channelType: 'Channel::WechatMp',
          supportsActiveReply: false,
        });
  const configured = seconds * 1000;
  return Math.max(
    500,
    Math.min(configured, WECHAT_PASSIVE_LIMIT_MS) - TIMEOUT_FLOW_HEADROOM_MS,
  );
}

/** 等超时流程产出的上限：用微信硬限减去已经等掉的时间，不写死 */
function resolveTimeoutFlowWaitMs(waitedMs: number): number {
  return Math.max(300, WECHAT_PASSIVE_LIMIT_MS - waitedMs - 300);
}

/**
 * 坐席回复超时兜底：把会话收回给 ITR，启动该渠道配置的超时流程，
 * 用它的输出作为本次被动回复。
 *
 * 复用 StartSession（传超时流程 flowId + meta.replyTimeout），不给 ITR 新增接口
 * ——「超时流程」本质上就是另一个流程，这也正好对应「两种渠道形态超时后挂不同流程」。
 *
 * 只在坐席确实拿住会话时判定超时：排队中/未分配属于正常等待，交给菜单流程兜底更合适。
 */
async function runReplyTimeoutFlow(
  channel: { id: number; app_id: string },
  conversationId: number | undefined,
  waitMs: number,
): Promise<string> {
  if (!conversationId || !channel.id) return '';
  // 目标走「路由」解析：channel_route 的 on_agent_no_reply 优先（可配多个候选、
  // 失败降级），没配时回退旧渠道字段 reply_timeout_flow_id —— 迁移期行为不变。
  const targets = await resolveRoutes(channel.id, 'on_agent_no_reply');
  if (!targets.length) return '';
  try {
    const conv = await prisma.conversations.findUnique({
      where: { id: conversationId },
      select: { inbox_id: true, assignee_id: true, additional_attributes: true },
    });
    if (!conv?.assignee_id) return '';
    const attrs = (conv.additional_attributes ?? {}) as Record<string, unknown>;
    const openid = String(attrs.wechat_mp_openid ?? '');
    if (!openid) return '';

    // 工号：超时文案要显示「工号xxx坐席正忙」，所以把卡住的这位坐席的工号一并传给流程
    // （流程里用 {{workNo}} 渲染）。取不到就留空，文案退化成不带工号。
    const ag = await prisma.users
      .findUnique({ where: { id: conv.assignee_id }, select: { uid: true } })
      .catch(() => null);
    const workNo = String(ag?.uid ?? '').trim();

    const timerSlot = openPassiveSlot(channel.app_id, openid, waitMs);
    try {
      // 执行候选路由（四期：on_agent_no_reply 不再只能指向一个流程，也可配 acd / agent
      // 等目标），按 priority 顺序尝试、失败降级。
      // meta 只传事实：在被动窗口里已经等了多久、被卡的坐席工号 —— 发什么提示由流程决定。
      const { executeRoutes } = await import('../../modules/itr/route-exec.js');
      const out = await executeRoutes(conversationId, targets, {
        meta: { replyTimeout: true, waitedSeconds: Math.round(waitMs / 1000), workNo },
      });
      if (out.ok) {
        // 只有 itr 目标会让流程继续持有会话；acd / agent 已经把会话交出去了。
        if (out.used?.appType === 'itr') markTimeoutFlow(conversationId);
      } else {
        console.warn('[wechat-mp] reply-timeout routes all failed', out.message);
      }
      return (await timerSlot.wait).trim();
    } finally {
      timerSlot.close();
    }
  } catch (e) {
    console.warn('[wechat-mp] reply-timeout flow failed', e);
    return '';
  }
}

function buildMpPassiveReply(
  channel: { app_id: string; token: string; encoding_aes_key: string | null },
  msg: { FromUserName?: string; ToUserName?: string },
  content: string,
  query: Record<string, string>,
): string {
  const toUser = String(msg.FromUserName ?? '');
  const fromUser = String(msg.ToUserName ?? channel.app_id);
  const xml = buildTextReplyXml(toUser, fromUser, joinPassiveReplies([content]));
  // 必须按请求的加解密方式来回复：微信明文模式收到密文 XML 会直接丢弃，
  // 客户就什么都看不到。不能只看渠道配没配 aes key —— 配了 key 也可能仍以明文接入。
  if (query.encrypt_type !== 'aes' || !channel.encoding_aes_key) return xml;
  const encrypted = encryptWeChatMessage(channel.encoding_aes_key, channel.app_id, xml);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = query.nonce || String(Math.floor(Math.random() * 1e9));
  return buildWeChatXml({
    Encrypt: encrypted,
    MsgSignature: computeSignature(channel.token, timestamp, nonce, encrypted),
    TimeStamp: timestamp,
    Nonce: nonce,
  });
}

export async function wechatMpWebhookProcess(request: FastifyRequest, reply: FastifyReply) {
  const { app_id } = request.params as { app_id: string };
  const channel = await prisma.channel_wechat_mp.findUnique({ where: { app_id } });
  if (!channel) return reply.status(404).send('not found');

  const q = request.query as Record<string, string>;
  const rawBody = typeof request.body === 'string'
    ? request.body
    : (request.body as { raw?: string })?.raw ?? '';

  if (q.signature || q.msg_signature) {
    const sig = q.msg_signature ?? q.signature ?? '';
    const { extractMpEncryptField } = await import('./wechat-mp.incoming.js');
    const encrypt = extractMpEncryptField(rawBody);
    const ok = verifySignature(channel.token, q.timestamp ?? '', q.nonce ?? '', sig, encrypt);
    if (!ok) return reply.status(403).send('forbidden');
  }

  if (!rawBody.trim()) {
    request.log.warn({ app_id }, 'WeChat MP webhook: empty body');
    return reply.status(200).type('text/plain').send('success');
  }

  // 没有客服消息权限的渠道（未认证订阅号，含个人号）只能靠本次请求的 XML 应答把话送出去。
  const passive = isPassiveReplyEnabled(channel);
  let slot: PassiveSlot | null = null;

  try {
    const msg = await parseMpWebhookBody(rawBody, channel, q);
    if (!msg) {
      request.log.warn({ app_id, bodyBytes: rawBody.length }, 'WeChat MP webhook: could not parse message body');
      return reply.status(200).type('text/plain').send('success');
    }

    const { extractMpMessageContent } = await import('./wechat-mp.incoming.js');
    request.log.info(
      {
        app_id,
        msgType: msg.MsgType,
        from: msg.FromUserName,
        content: extractMpMessageContent(msg),
        bodyBytes: rawBody.length,
      },
      'WeChat MP incoming',
    );

    const openid = String(msg.FromUserName ?? '');

    // 客户在被动菜单里选了「4.留言」→ 记下这个分支，等他下一条提供内容。
    // 写点必须在这里，不能挂在 ITR 的 leave 回调上：那个回调是留言**完成**之后
    // 才来的，用它记录会让客户随后的普通消息被误当成留言。
    const inboundText = extractMpMessageContent(msg)?.trim() ?? '';
    if (passive && openid && inboundText === PASSIVE_LEAVE_BRANCH) {
      await setMenuRoute(
        app_id,
        openid,
        { node: 'leave_passive', branch: PASSIVE_LEAVE_BRANCH },
        channel.route_ttl_seconds,
      );
    }

    // 「上次选了留言」且在 TTL 内 → 重启流程时直接进留言收集，跳过菜单。
    // ITR 的内存会话此时多半已经没了（流程结束后 sessions.pop()），
    // 不带这个标记，访客又得把菜单重选一遍。
    const menuRoute = passive && openid ? await getMenuRoute(app_id, openid) : null;
    const menuBranch = menuRoute?.branch === PASSIVE_LEAVE_BRANCH ? PASSIVE_LEAVE_BRANCH : '';
    if (menuBranch) await clearMenuRoute(app_id, openid);

    // 取出积压。超过渠道配置存活时长的陈旧内容会被丢弃 —— 否则客户下次发言
    // 会莫名其妙收到几小时前的旧消息（实测遇到过：发「测试」却收到两小时前的「？」）。
    const backlog = passive && openid
      ? await drainPendingReplies(app_id, openid, channel.pending_ttl_seconds)
      : [];
    // 被动形态：等待窗口取决于渠道配置的「坐席回复超时」（微信订阅号默认 5 秒），
    // 并受微信硬限制约。主动推送形态不经这里 —— 坐席随时可推，不存在"客户卡在窗口里"。
    const passiveWaitMs = resolvePassiveWaitMs(channel);
    const waitStartedAt = Date.now();
    // 有积压也照样开槽：本次响应要和积压一起送回客户。
    // 微信一条用户消息只允许回一条，所以「有积压就提前 return」会把本次响应整个丢掉，
    // 客户会觉得"发了消息没人理"—— 实测踩过这个坑。
    if (passive && openid) {
      slot = openPassiveSlot(app_id, openid, passiveWaitMs);
    }

    const stored = await handleMpIncomingMessage(
      app_id,
      msg,
      request.server,
      {
        ...(menuBranch
          ? { wechat_mp_menu_branch: menuBranch, itr_hosted: false }
          // 命中过之后必须把标记清掉（mergeAttrs 用 null 表示「删除该键」）。
          // 否则它会永久留在会话属性里，之后每次重启流程都被 route_gate 直接送进
          // 留言收集 —— 客户就再也看不到菜单，只能一直"请留言"。
          : { wechat_mp_menu_branch: null }),
      },
    );

    if (slot) {
      // ITR / 坐席的回复经 /api/itr/callback/reply 回来时会投进这个槽。
      const text = (await slot.wait).trim();
      // 积压 + 本次响应合并成一条（微信只接受一条被动回复）
      const parts = [...backlog];
      if (text) parts.push(text);
      if (!parts.length) {
        // 本次确实没有任何产出，才把会话收回给 ITR 走该渠道的超时流程
        const timeoutText = await runReplyTimeoutFlow(
          channel,
          stored?.conversationId,
          resolveTimeoutFlowWaitMs(Date.now() - waitStartedAt),
        );
        if (timeoutText) parts.push(timeoutText);
      }
      if (parts.length) {
        return reply
          .status(200)
          .type('text/plain')
          .send(buildMpPassiveReply(channel, msg, joinPassiveReplies(parts), q));
      }
    }
  } catch (err) {
    request.log.error({ err, app_id }, 'WeChat MP webhook error');
  } finally {
    slot?.close();
  }

  return reply.status(200).type('text/plain').send('success');
}

export async function wecomKfWebhookVerify(request: FastifyRequest, reply: FastifyReply) {
  const { channel_id } = request.params as { channel_id: string };
  const channel = await prisma.channel_wecom_kf.findUnique({ where: { id: parseInt(channel_id, 10) } });
  if (!channel) return reply.status(404).send('not found');

  const q = request.query as Record<string, string>;
  // 企业微信的签名包含 echostr（验证请求是 sha1(sort(token, timestamp, nonce, echostr))）。
  // 漏传第 5 个参数会退化成 3 段签名，企业微信必然校验失败（表现为"回调地址请求不通过"）。
  const ok = verifySignature(
    channel.token,
    q.timestamp ?? '',
    q.nonce ?? '',
    q.msg_signature ?? q.signature ?? '',
    q.echostr,
  );
  if (!ok) return reply.status(403).send('forbidden');

  if (channel.encoding_aes_key && q.echostr) {
    try {
      const { decryptWeChatMessage } = await import('../../shared/wechat/crypto.js');
      const plain = decryptWeChatMessage(channel.encoding_aes_key, channel.corp_id, q.echostr);
      return reply.status(200).type('text/plain').send(plain);
    } catch {
      return reply.status(403).send('decrypt failed');
    }
  }
  return reply.status(200).type('text/plain').send(q.echostr ?? '');
}

export async function wecomKfWebhookProcess(request: FastifyRequest, reply: FastifyReply) {
  const { channel_id } = request.params as { channel_id: string };
  const chId = parseInt(channel_id, 10);
  const channel = await prisma.channel_wecom_kf.findUnique({ where: { id: chId } });
  if (!channel) return reply.status(404).send('not found');

  const rawBody = typeof request.body === 'string' ? request.body : '';
  const q = request.query as Record<string, string>;

  try {
    const xml = await parseWecomWebhookBody(rawBody, channel, q);
    await handleKfCallbackEvent(chId, xml, request.server);
  } catch (err) {
    request.log.error({ err, channel_id }, 'WeCom KF webhook error');
  }

  return reply.status(200).type('text/plain').send('success');
}

export async function wecomContactWebhookVerify(request: FastifyRequest, reply: FastifyReply) {
  const { channel_id } = request.params as { channel_id: string };
  const channel = await prisma.channel_wecom_contact.findUnique({ where: { id: parseInt(channel_id, 10) } });
  if (!channel) return reply.status(404).send('not found');

  const q = request.query as Record<string, string>;
  // 同 wecomKfWebhookVerify：企业微信的签名要带上 echostr，否则校验必然失败。
  const ok = verifySignature(
    channel.token,
    q.timestamp ?? '',
    q.nonce ?? '',
    q.msg_signature ?? q.signature ?? '',
    q.echostr,
  );
  if (!ok) return reply.status(403).send('forbidden');

  if (channel.encoding_aes_key && q.echostr) {
    try {
      const { decryptWeChatMessage } = await import('../../shared/wechat/crypto.js');
      const plain = decryptWeChatMessage(channel.encoding_aes_key, channel.corp_id, q.echostr);
      return reply.status(200).type('text/plain').send(plain);
    } catch {
      return reply.status(403).send('decrypt failed');
    }
  }
  return reply.status(200).type('text/plain').send(q.echostr ?? '');
}

export async function wecomContactWebhookProcess(request: FastifyRequest, reply: FastifyReply) {
  const { channel_id } = request.params as { channel_id: string };
  const chId = parseInt(channel_id, 10);
  const channel = await prisma.channel_wecom_contact.findUnique({ where: { id: chId } });
  if (!channel) return reply.status(404).send('not found');

  const rawBody = typeof request.body === 'string' ? request.body : '';
  const q = request.query as Record<string, string>;

  try {
    let xml = rawBody;
    if (channel.encoding_aes_key && q.msg_signature) {
      xml = await parseWecomWebhookBody(rawBody, { corp_id: channel.corp_id, encoding_aes_key: channel.encoding_aes_key }, q);
    }
    await handleContactIncoming(chId, xml, request.server);
  } catch (err) {
    request.log.error({ err, channel_id }, 'WeCom contact webhook error');
  }

  return reply.status(200).type('text/plain').send('success');
}

export async function wechatOauthCallback(request: FastifyRequest, reply: FastifyReply) {
  const q = request.query as { code?: string; state?: string };
  const convId = parseInt(String(q.state || ''), 10);
  if (!Number.isFinite(convId) || convId <= 0) {
    return reply.status(400).type('text/html').send('<p>无效会话</p>');
  }
  try {
    const conv = await prisma.conversations.findUnique({
      where: { id: convId },
      select: { additional_attributes: true },
    });
    const prev = (conv?.additional_attributes ?? {}) as Record<string, unknown>;
    await prisma.conversations.update({
      where: { id: convId },
      data: {
        additional_attributes: { ...prev, wx_oauth_done: true, oauthDone: true, wx_oauth_code: q.code || '' } as object,
      },
    });
    const { relayVisitorToItr } = await import('../itr/itr-lifecycle.js');
    await relayVisitorToItr(convId, 'oauth_ok');
  } catch (err) {
    request.log.error({ err, convId }, 'wechat oauth callback failed');
  }
  return reply
    .status(200)
    .type('text/html; charset=utf-8')
    .send('<p>授权已完成，请返回会话继续。</p>');
}
