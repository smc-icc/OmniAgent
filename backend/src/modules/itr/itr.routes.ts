import { activeVdn } from '../access/access.scope.js';
/**
 * ITR integration: Omni ↔ ITRPython ↔ ACD (StaffService path A).
 * - /api/itr/*          Omni → ITR
 * - /api/itr/callback/* ITR → Omni (reply / transfer / leave / ended)
 * - /api/itr/acd/*      ACD FinishEvt/RingAck（经 CCS 转发或联调）
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../plugins/db.js';
import { env } from '../../config/env.js';
import { itrEnd, itrOnMessage, itrStart } from '../../integrations/itr/itr-client.js';
import { acdCancel, acdRing } from '../../integrations/ccs/acd-client.js';
import { writeSystemMessage } from '../../shared/services/conversation-lifecycle.js';
import { resolveChannelSubtypes } from '../../shared/services/channel-group.js';
import {
  applyAcdFinishEvt,
  applyAcdRingAck,
  assignConversation,
  addLeaveMessage,
  forgetQueue,
  leaveMessages,
  markItrHosted,
  parseConvId,
  persistLeaveMessages,
  queueByConv,
  rememberQueue,
} from './itr-queue.js';
import { recordSessionEnded, recordSessionEvent } from '../../shared/services/omni-session-log.js';
import { resolveItrFlowId } from './itr-lifecycle.js';
import { inviteCsatSurvey } from './csat-invite.js';
import { agentDbg } from './debug-ingest.js';
import { synthesizeCosyVoice } from '../../shared/services/cosyvoice-tts.js';
import { dispatchItrOutbound } from '../../shared/services/itr-outbound.js';
import { isSafeSelectSql, runIccSelect } from '../../shared/services/itr-sql.js';
import { ioRef } from '../../processors/socket-ref.js';
import { formatFaqReply, matchFaqArticles, wantsStaffTransfer } from '../../shared/services/itr-robot.js';
import { transcribeAudioUrl, transcribeWavBase64 } from '../../shared/services/funasr-asr.js';
import { wechatOauthCallbackUrl } from '../../shared/wechat/webhook-url.js';
import { filterMessageContent, getQueueTip } from '../../shared/services/omni-ops.js';

function ok(extra: Record<string, unknown> = {}) {
  return { result: 0, message: 'ok', ...extra };
}

function checkAcdHookAuth(req: FastifyRequest): boolean {
  // HTTP 联调入口保留；生产走 ACD→Omni TARS AcdCbObj
  const expected = process.env.ITR_ACD_HOOK_TOKEN || '';
  if (!expected) return true;
  const h = req.headers.authorization || '';
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : '';
  const token = String((req.headers['x-itr-token'] as string) || bearer || '');
  return token === expected;
}

function resolveAcdTarget(body: Record<string, unknown>) {
  const g = Number(body.agentGroupId ?? -1);
  const s = Number(body.skillId ?? -1);
  const m = Number(body.mediaType ?? env.OMNI_ACD_MEDIA_TYPE);
  return {
    agentGroupId: g > 0 ? g : env.OMNI_DEFAULT_AGENT_GROUP_ID,
    skillId: s > 0 ? s : env.OMNI_DEFAULT_SKILL_ID,
    mediaType: m > 0 ? m : env.OMNI_ACD_MEDIA_TYPE,
  };
}

async function createOutgoingMessage(
  conversationId: number,
  content: string,
  asChat = false,
  extra?: { contentType?: string; meta?: Record<string, unknown> },
) {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    select: { id: true, account_id: true, inbox_id: true },
  });
  if (!conv) return null;
  const contentType = String(extra?.contentType || 'text');
  const meta = extra?.meta && typeof extra.meta === 'object' ? extra.meta : {};
  const attrs: Record<string, unknown> = { kind: contentType === 'text' ? 'itr' : contentType, ...meta };
  if (contentType === 'tts' && content) {
    const audio = await synthesizeCosyVoice({
      text: content,
      spkId: String(meta.spk_id || meta.spkId || ''),
      emotion: String(meta.emotion || ''),
    });
    if (audio) {
      attrs.file_url = audio.url;
      attrs.file_name = audio.fileName;
      attrs.content_type = 'audio/wav';
    }
  }
  if (asChat) {
    const filtered = await filterMessageContent(content);
    const persisted = filtered.text;
    const msg = await prisma.messages.create({
      data: {
        account_id: conv.account_id,
        inbox_id: conv.inbox_id,
        conversation_id: conv.id,
        content: persisted,
        message_type: 1,
        content_type: 0,
        content_attributes: {
          ...attrs,
          ...(filtered.hit
            ? { sensitive_hit: true, sensitive_blocked: filtered.blocked, sensitive_words: filtered.words }
            : {}),
        } as object,
        private: false,
      },
    });
    void dispatchItrOutbound(conversationId, msg.id, persisted, contentType, meta).catch((e) => {
      console.warn('[itr] outbound dispatch', e instanceof Error ? e.message : e);
    });
    // #region agent log
    agentDbg('F', 'itr.routes.ts:createOutgoingMessage', 'itr reply persisted', {
      conversationId,
      messageId: msg.id,
      messageType: 1,
      preview: content.slice(0, 40),
    });
    // #endregion
    return msg;
  }
  await writeSystemMessage(conv, content, 'itr');
  return true;
}

export async function itrRoutes(fastify: FastifyInstance) {
  // ── Omni → ITR ──
  fastify.post('/api/itr/sessions/start', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const conversationId = String(body.conversationId || '');
    if (!conversationId) return reply.code(400).send({ result: 1, message: 'conversationId required' });
    const convNum = parseConvId(conversationId);
    const flowId =
      Number(body.flowId) ||
      (Number.isFinite(convNum) ? await resolveItrFlowId(convNum, Number(body.inboxId || 0) || undefined) : 0) ||
      env.ITR_DEFAULT_FLOW_ID ||
      1001;
    const rsp = await itrStart({
      conversationId,
      contactId: String(body.contactId || ''),
      channelType: String(body.channelType || 'web_widget'),
      inboxId: Number(body.inboxId || 0),
      flowId,
      vdnId: activeVdn(Number(body.vdnId || env.OMNI_AGENT_VDN_ID || 1)),
      callerId: String(body.callerId || ''),
      meta: (body.meta as Record<string, unknown>) || {},
    });
    markItrHosted(conversationId, true);
    return reply.send(rsp);
  });

  fastify.post('/api/itr/sessions/:id/message', async (req: FastifyRequest, reply: FastifyReply) => {
    const id = String((req.params as { id: string }).id);
    const body = (req.body || {}) as Record<string, unknown>;
    const rsp = await itrOnMessage(id, String(body.content || ''), String(body.contentType || 'text'));
    return reply.send(rsp);
  });

  fastify.post('/api/itr/sessions/:id/end', async (req: FastifyRequest, reply: FastifyReply) => {
    const id = String((req.params as { id: string }).id);
    const q = queueByConv.get(id);
    if (q) {
      try {
        await acdCancel({ requestId: q.requestId, vdnId: q.vdnId });
      } catch {
        /* ignore */
      }
      forgetQueue(id);
    }
    markItrHosted(id, false);
    const rsp = await itrEnd(id);
    return reply.send(rsp);
  });

  // ── ITR → Omni callbacks ──
  fastify.post('/api/itr/callback/reply', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const convId = parseConvId(body.conversationId);
    if (!Number.isFinite(convId)) return reply.code(400).send({ result: 1, message: 'bad conversationId' });
    const content = String(body.content || '');
    const contentType = String(body.contentType || 'text');
    const rawMeta = body.metaJson;
    const meta =
      rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)
        ? (rawMeta as Record<string, unknown>)
        : typeof rawMeta === 'string'
          ? (() => {
              try {
                const p = JSON.parse(rawMeta) as unknown;
                return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
              } catch {
                return {};
              }
            })()
          : {};
    if (content) {
      const msg = await createOutgoingMessage(convId, content, true, { contentType, meta });
      try {
        const io = (fastify as { io?: { to: (r: string) => { emit: (e: string, d: unknown) => void } } }).io;
        const attrs =
          msg && typeof msg === 'object' && 'content_attributes' in msg
            ? (msg as { content_attributes?: unknown }).content_attributes
            : { kind: contentType === 'text' ? 'itr' : contentType, ...meta };
        io?.to(`conversation_${convId}`).emit('message.created', {
          conversation_id: convId,
          content,
          content_attributes: attrs,
        });
      } catch {
        /* optional */
      }
    }
    return reply.send(ok());
  });

  fastify.post('/api/itr/callback/transfer', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const convId = parseConvId(body.conversationId);
    if (!Number.isFinite(convId)) return reply.code(400).send({ result: 1, message: 'bad conversationId' });

    const vdnId = activeVdn(Number(body.vdnId || env.OMNI_AGENT_VDN_ID || 1));
    const requestId = convId;
    const callerId = String(body.callerId || body.privateData || `conv:${convId}`);
    const target = resolveAcdTarget(body);

    try {
      rememberQueue({
        requestId,
        vdnId,
        conversationId: convId,
        startedAt: Date.now(),
        connectTip: String(body.connectTip || '').trim() || undefined,
        skillId: target.skillId,
        agentGroupId: target.agentGroupId,
      });
      // #region agent log
      agentDbg('J', 'itr.routes.ts:callback/transfer', 'DoRing start', {
        convId,
        vdnId,
        agentGroupId: target.agentGroupId,
        skillId: target.skillId,
        mediaType: target.mediaType,
        rawGroup: Number(body.agentGroupId ?? -1),
        rawSkill: Number(body.skillId ?? -1),
        remembered: true,
      });
      // #endregion
      const ring = await acdRing({
        requestId,
        callerId,
        calledId: 'ITR',
        callerType: 1,
        vdnId,
        agentGroupId: target.agentGroupId,
        skillId: target.skillId,
        skillLevel: Number(body.skillLevel ?? 1),
        vipLevel: Number(body.linePriority ?? 1) || 1,
        agentId: Number(body.agentId ?? -1),
        mediaType: target.mediaType,
        pid: requestId,
      });
      // #region agent log
      agentDbg('J', 'itr.routes.ts:callback/transfer.ring', 'DoRing returned', {
        convId,
        ret: ring.ret,
        rsp: (ring.rsp || {}) as Record<string, unknown>,
      });
      // #endregion
      if (ring.ret !== 0) {
        forgetQueue(convId);
        return reply.send({ result: ring.ret, message: `DoRing failed ret=${ring.ret}`, rsp: ring.rsp });
      }
      const rspObj = (ring.rsp || {}) as Record<string, unknown>;
      rememberQueue({
        requestId,
        vdnId,
        conversationId: convId,
        startedAt: Date.now(),
        ewt: Number(rspObj.EWT ?? rspObj.ewt ?? 0) || undefined,
        queueLen: Number(rspObj.QueueLen ?? rspObj.queueLen ?? 0) || undefined,
        skillId: target.skillId,
        agentGroupId: target.agentGroupId,
      });
      await createOutgoingMessage(convId, await getQueueTip(String(body.queueTip || '').trim()));
      return reply.send(ok({ state: 'queued', requestId, ring }));
    } catch (e) {
      forgetQueue(convId);
      const msg = e instanceof Error ? e.message : String(e);
      if (env.ITR_ACD_FALLBACK_ASSIGN === '1') {
        const u = await prisma.users.findFirst({ orderBy: { id: 'asc' } });
        if (u) await assignConversation(convId, u.id);
        markItrHosted(convId, false);
        await createOutgoingMessage(convId, `（开发回退）ACD 不可用，已本地分配。原因: ${msg}`);
        return reply.send(ok({ state: 'transferred', fallback: true, error: msg }));
      }
      return reply.code(502).send({ result: -1, message: msg });
    }
  });

  fastify.post('/api/itr/callback/leave-message', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const convId = parseConvId(body.conversationId);
    if (!Number.isFinite(convId)) return reply.code(400).send({ result: 1, message: 'bad conversationId' });
    const content = String(body.content || '');
    // ITR 通过 metaJson 上报留言原因（非工作时间 / 排队溢出 / 坐席全忙等）。
    // 兼容几种常见写法，取不到就留空（前端不显示原因）。
    const meta = (body.metaJson ?? body.meta ?? {}) as Record<string, unknown>;
    const reason = String(
      meta.reason ?? meta.leaveReason ?? meta.leave_reason ?? body.reason ?? '',
    ).trim();
    addLeaveMessage({
      id: `lm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      conversationId: convId,
      content,
      createdAt: new Date().toISOString(),
      status: 'open',
      ...(reason ? { reason } : {}),
    });
    markItrHosted(convId, false);
    await createOutgoingMessage(convId, `【留言】${content}`);
    // 通知坐席端：左侧「留言」入口要亮未读角标。
    // 复用 HUB 语音留言的 voicemail.created —— 前端 socket.ts 监听的就是这个事件名，
    // 之前在线留言完全没有推送，所以角标（原先是小红点）从来没亮过。
    try {
      ioRef.get()?.emit('voicemail.created', {
        conversationId: convId,
        content,
        reason,
        source: 'itr_online_leave',
      });
    } catch (e) {
      // 推送失败不影响留言本身，坐席点进去仍能看到
      console.warn('[itr] voicemail.created emit failed', e);
    }
    return reply.send(ok({ leaveCount: leaveMessages.length }));
  });

  fastify.post('/api/itr/callback/ended', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const convId = parseConvId(body.conversationId);
    if (Number.isFinite(convId)) markItrHosted(convId, false);
    return reply.send(ok());
  });

  fastify.post('/api/itr/callback/robot', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const question = String(body.question || body.content || '').trim();
    if (wantsStaffTransfer(question)) {
      return reply.send(ok({ transfer: true, reply: '' }));
    }
    try {
      const articles = await prisma.articles.findMany({
        where: { status: 1 },
        orderBy: { updated_at: 'desc' },
        take: 80,
        select: { title: true, description: true, content: true },
      });
      const hit = matchFaqArticles(question, articles);
      if (hit) {
        return reply.send(ok({ transfer: false, reply: formatFaqReply(hit, '') }));
      }
    } catch {
      /* FAQ optional */
    }
    const fallback = String(body.fallback || '').trim();
    if (env.OPENAI_API_KEY && question) {
      try {
        const sug = await fastify.llm.replySuggestion({
          messages: [{ role: 'customer', content: question }],
        });
        const text = sug.suggestions?.[0];
        if (text && !text.startsWith('[LLM not configured]')) {
          return reply.send(ok({ transfer: false, reply: text }));
        }
      } catch {
        /* LLM optional */
      }
    }
    return reply.send(ok({ transfer: false, reply: fallback || `已收到：${question}` }));
  });

  fastify.post('/api/itr/callback/sql', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const sql = String(body.sql || '').trim();
    const check = isSafeSelectSql(sql);
    if (!check.ok) return reply.send({ result: 1, message: check.reason, rows: [] });
    try {
      const rows = await runIccSelect(check.sql);
      return reply.send(ok({ rows }));
    } catch (e) {
      return reply.send({ result: 1, message: e instanceof Error ? e.message : String(e), rows: [] });
    }
  });

  fastify.post('/api/itr/callback/asr', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const b64 = String(body.wavBase64 || body.wav_base64 || '').trim();
    const audioUrl = String(body.audioUrl || body.audio_url || '').trim();
    const spoken = String(body.text || body.content || '').trim();
    let text = '';
    if (b64) text = (await transcribeWavBase64(b64)) || '';
    if (!text && audioUrl) text = (await transcribeAudioUrl(audioUrl)) || '';
    if (!text) text = spoken;
    return reply.send(ok({ text }));
  });

  fastify.post('/api/itr/callback/wechat-auth', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const convId = parseConvId(body.conversationId);
    if (!Number.isFinite(convId)) return reply.send(ok({ oauthUrl: '', passthrough: true }));
    const conv = await prisma.conversations.findUnique({
      where: { id: convId },
      include: { inbox: true },
    });
    if (!conv?.inbox || conv.inbox.channel_type !== 'Channel::WechatMp') {
      return reply.send(ok({ oauthUrl: '', passthrough: true }));
    }
    const ch = await prisma.channel_wechat_mp.findUnique({ where: { id: conv.inbox.channel_id } });
    if (!ch?.app_id) return reply.send(ok({ oauthUrl: '', passthrough: true }));
    const redirect = encodeURIComponent(wechatOauthCallbackUrl());
    const oauthUrl =
      `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encodeURIComponent(ch.app_id)}` +
      `&redirect_uri=${redirect}&response_type=code&scope=snsapi_base&state=${convId}#wechat_redirect`;
    return reply.send(ok({ oauthUrl, passthrough: false }));
  });

  // ── ACD → Omni（生产：CCS 无 CallState 时 HTTP 转发）──
  fastify.post('/api/itr/acd/finish', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!checkAcdHookAuth(req)) return reply.code(401).send({ result: 401, message: 'unauthorized' });
    const body = (req.body || {}) as Record<string, unknown>;
    const out = await applyAcdFinishEvt({
      requestId: Number(body.requestId ?? body.RequestID),
      agentId: Number(body.agentId ?? body.AgentID ?? 0),
      finishedType: Number(body.finishedType ?? body.FinishedType ?? 0),
      groupId: Number(body.groupId ?? body.AgentGroupID ?? 0),
      skillId: Number(body.skillId ?? body.SkillID ?? 0),
    });
    return reply.send(out);
  });

  fastify.post('/api/itr/acd/ring-ack', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!checkAcdHookAuth(req)) return reply.code(401).send({ result: 401, message: 'unauthorized' });
    const body = (req.body || {}) as Record<string, unknown>;
    const out = await applyAcdRingAck({
      requestId: Number(body.requestId ?? body.RequestID),
      result: Number(body.result ?? body.Result ?? 0),
      queueLen: Number(body.queueLen ?? body.QueueLen ?? 0),
      ewt: Number(body.ewt ?? body.EWT ?? 0),
    });
    return reply.send(out);
  });

  /** @deprecated use /api/itr/acd/finish */
  fastify.post('/api/itr/dev/acd-finish', async (req, reply) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const out = await applyAcdFinishEvt({
      requestId: Number(body.requestId),
      agentId: Number(body.agentId || 1),
      finishedType: Number(body.finishedType ?? 0),
      groupId: Number(body.groupId || 0),
      skillId: Number(body.skillId || 0),
    });
    return reply.send(out);
  });

  // ── Agent P0 helpers ──
  /**
   * 离线消息：访客在非工作时段或等待中离开、会话已结束但留下了消息。
   * 定义：会话状态为已解决/已挂起，且客户侧发过消息。用于坐席事后跟进。
   */
  fastify.get('/api/itr/offline-messages', async (_req, reply) => {
    const rows = await (prisma as any).conversations.findMany({
      where: { status: { not: 0 } },
      orderBy: { last_activity_at: 'desc' },
      take: 100,
      select: {
        id: true,
        status: true,
        last_activity_at: true,
        additional_attributes: true,
        contact: { select: { id: true, name: true } },
        inbox: { select: { id: true, name: true, channel_type: true } },
        messages: {
          where: { message_type: 0 },
          orderBy: { created_at: 'desc' },
          take: 1,
          select: { content: true, created_at: true },
        },
      },
    });

    const items = rows
      .filter((c: any) => (c.messages?.length ?? 0) > 0)
      .map((c: any) => {
        const attrs = (c.additional_attributes ?? {}) as Record<string, unknown>;
        const lifecycle = String(attrs.omni_lifecycle ?? '');
        // 原因：能看出结束方式就给具体描述，否则兜底
        const reason = lifecycle === 'ended'
          ? '访客离开，会话结束'
          : c.status === 1
            ? '会话已解决，客户消息待跟进'
            : '会话挂起，待跟进';
        return {
          id: `off-${c.id}`,
          conversationId: c.id,
          visitor: c.contact?.name ?? '访客',
          lastMsg: c.messages[0].content ?? '',
          offlineTime: (c.messages[0].created_at ?? c.last_activity_at)?.toISOString?.() ?? null,
          status: c.status === 1 ? 'resolved' : 'pending',
          reason,
          channelType: c.inbox?.channel_type ?? null,
          inboxName: c.inbox?.name ?? null,
          channels: resolveChannelSubtypes(c.inbox?.channel_type, c.inbox?.name),
        };
      });

    return reply.send({ items });
  });

  fastify.get('/api/itr/leave-messages', async (_req, reply) => {
    const items = leaveMessages.slice(0, 200);
    // 留言本身只存会话号，渠道要反查会话所属 inbox ——
    // 否则坐席在留言列表里看不出这条留言来自微信 / 微博 / 网页。
    const convIds = [...new Set(items.map((x) => x.conversationId).filter(Boolean))];
    const inboxByConv = new Map<number, { channel_type: string | null; name: string | null }>();
    if (convIds.length) {
      const { prisma } = await import('../../plugins/db.js');
      const convs = await (prisma as any).conversations.findMany({
        where: { id: { in: convIds } },
        select: { id: true, inbox: { select: { channel_type: true, name: true } } },
      });
      for (const c of convs) {
        if (c.inbox) inboxByConv.set(Number(c.id), c.inbox);
      }
    }
    const enriched = items.filter(x => inboxByConv.has(x.conversationId)).map((x) => {
      const inbox = inboxByConv.get(x.conversationId);
      return {
        ...x,
        channelType: inbox?.channel_type ?? null,
        inboxName: inbox?.name ?? null,
        channels: inbox ? resolveChannelSubtypes(inbox.channel_type, inbox.name) : [],
      };
    });
    return reply.send({ items: enriched });
  });

  fastify.post('/api/itr/leave-messages/:id/claim', async (req, reply) => {
    const id = String((req.params as { id: string }).id);
    const body = (req.body || {}) as Record<string, unknown>;
    const assigneeId = Number(body.assigneeId || req.currentUser?.id || 0);
    const row = leaveMessages.find((x) => x.id === id);
    if (!row) return reply.code(404).send({ error: 'not found' });
    if (!assigneeId) return reply.code(400).send({ error: 'assigneeId required' });
    const permitted = await prisma.conversations.findFirst({ where: { id: row.conversationId }, select: { id: true } });
    if (!permitted) return reply.code(403).send({ error: '会话不在授权数据范围内' });
    row.status = 'claimed';
    row.assigneeId = assigneeId;
    persistLeaveMessages();
    markItrHosted(row.conversationId, false);
    await assignConversation(row.conversationId, assigneeId, { method: 'leave_claim', actorUserId: assigneeId });
    await createOutgoingMessage(row.conversationId, `留言已由坐席 #${assigneeId} 认领`);
    return reply.send(row);
  });

  fastify.get('/api/itr/queue-status/:conversationId', async (req, reply) => {
    const id = String((req.params as { conversationId: string }).conversationId);
    const q = queueByConv.get(id) || queueByConv.get(String(parseConvId(id)));
    if (!q) return reply.send({ queued: false });
    return reply.send({
      queued: true,
      requestId: q.requestId,
      vdnId: q.vdnId,
      waitedMs: Date.now() - q.startedAt,
      ewt: q.ewt ?? null,
      queueLen: q.queueLen ?? null,
      position: Math.max(1, Number(q.queueLen ?? 1) || 1),
    });
  });

  fastify.post('/api/itr/csat/invite', async (req, reply) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const convId = parseConvId(String(body.conversationId || ''));
    if (!Number.isFinite(convId)) return reply.code(400).send({ error: 'conversationId required' });
    try {
      const out = await inviteCsatSurvey(convId);
      return reply.send({ ok: true, ...out });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(400).send({ error: msg });
    }
  });

  fastify.post('/api/omnichannel/sessions/:id/leave-queue', async (req, reply) => {
    const id = String((req.params as { id: string }).id);
    const convId = parseConvId(id);
    if (!Number.isFinite(convId)) return reply.code(400).send({ error: 'bad id' });
    const q = queueByConv.get(String(convId));
    if (!q) return reply.send({ ok: true, queued: false });
    try {
      await acdCancel({ requestId: q.requestId, vdnId: q.vdnId });
    } catch {
      /* ignore */
    }
    forgetQueue(convId);
    await createOutgoingMessage(convId, '已取消排队');
    recordSessionEnded({ conversationId: convId, cause: 'queue_abandon' });
    return reply.send({ ok: true, queued: false });
  });

  fastify.post('/api/omnichannel/sessions/:id/transfer', async (req, reply) => {
    const id = String((req.params as { id: string }).id);
    const convId = parseConvId(id);
    if (!Number.isFinite(convId)) return reply.code(400).send({ error: 'bad id' });
    const body = (req.body || {}) as Record<string, unknown>;
    const mode = String(body.mode || 'agent');
    // #region agent log
    agentDbg('D', 'itr.routes.ts:transfer', 'transfer request', {
      convId,
      mode,
      skillId: Number(body.skillId ?? -1),
      agentGroupId: Number(body.agentGroupId ?? -1),
      assigneeId: Number(body.assigneeId || body.userId || 0),
    });
    // #endregion
    const q = queueByConv.get(String(convId));
    if (q) {
      try {
        await acdCancel({ requestId: q.requestId, vdnId: q.vdnId });
      } catch {
        /* ignore */
      }
      forgetQueue(convId);
    }

    if (mode === 'agent') {
      let userId = Number(body.assigneeId || body.userId || 0);
      const workNO = String(body.workNO || body.WorkNO || '').trim();
      if (!userId && workNO) {
        const { getSessionByWorkNo } = await import('../../integrations/ccs/session-manager.js');
        userId = getSessionByWorkNo(workNO)?.userId || 0;
        if (!userId) {
          const u = await prisma.users.findFirst({ where: { uid: workNO }, select: { id: true } });
          userId = u?.id || 0;
        }
      }
      if (!userId) return reply.code(400).send({ error: 'assigneeId or workNO required' });
      const actorUserId = Number(req.currentUser?.id || 0) || undefined;
      await assignConversation(convId, userId, { method: 'transfer', actorUserId });
      markItrHosted(convId, false);
      await createOutgoingMessage(convId, `会话已转接至坐席 #${userId}`);
      recordSessionEvent({
        conversationId: convId,
        type: 'transfer',
        actorUserId,
        targetUserId: userId,
      });
      return reply.send({ ok: true, mode: 'agent', assigneeId: userId, workNO: workNO || undefined });
    }

    const vdnId = activeVdn(Number(body.vdnId || env.OMNI_AGENT_VDN_ID || 1));
    const requestId = convId;
    const target = resolveAcdTarget(body);
    try {
      const ring = await acdRing({
        requestId,
        callerId: `xfer:${convId}`,
        calledId: 'XFER',
        callerType: 1,
        vdnId,
        agentGroupId: target.agentGroupId,
        skillId: target.skillId,
        skillLevel: Number(body.skillLevel ?? 1),
        agentId: -1,
        mediaType: target.mediaType,
      });
      rememberQueue({
        requestId,
        vdnId,
        conversationId: convId,
        startedAt: Date.now(),
        skillId: target.skillId,
        agentGroupId: target.agentGroupId,
      });
      await createOutgoingMessage(convId, '会话已重新排队转技能…');
      // #region agent log
      agentDbg('D', 'itr.routes.ts:transfer.skill', 'acdRing ok', {
        convId,
        vdnId,
        skillId: Number(body.skillId ?? -1),
        agentGroupId: Number(body.agentGroupId ?? -1),
        ringRet: (ring as { ret?: number })?.ret,
      });
      // #endregion
      return reply.send({ ok: true, mode: 'skill', ring });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // #region agent log
      agentDbg('D', 'itr.routes.ts:transfer.skill.catch', 'acdRing fail', { convId, err: msg });
      // #endregion
      return reply.code(502).send({ error: msg });
    }
  });

  fastify.post('/api/omnichannel/sessions/:id/invite', async (req, reply) => {
    const id = String((req.params as { id: string }).id);
    const convId = parseConvId(id);
    if (!Number.isFinite(convId)) return reply.code(400).send({ error: 'bad id' });
    const body = (req.body || {}) as Record<string, unknown>;
    let userId = Number(body.assigneeId || body.userId || 0);
    const workNO = String(body.workNO || body.WorkNO || '').trim();
    if (!userId && workNO) {
      const { getSessionByWorkNo } = await import('../../integrations/ccs/session-manager.js');
      userId = getSessionByWorkNo(workNO)?.userId || 0;
      if (!userId) {
        const u = await prisma.users.findFirst({ where: { uid: workNO }, select: { id: true } });
        userId = u?.id || 0;
      }
    }
    if (!userId) return reply.code(400).send({ error: 'assigneeId or workNO required' });
    const conv = await prisma.conversations.findUnique({
      where: { id: convId },
      select: { id: true, account_id: true },
    });
    if (!conv) return reply.code(404).send({ error: 'conversation not found' });
    const exists = await prisma.conversation_participants.findFirst({
      where: { conversation_id: convId, user_id: userId },
    });
    if (!exists) {
      await prisma.conversation_participants.create({
        data: { account_id: conv.account_id, user_id: userId, conversation_id: convId },
      });
    }
    const io = ioRef.get();
    const payload = {
      conversation_id: convId,
      account_id: conv.account_id,
      omni_lifecycle: 'assigned',
    };
    io?.to(`user:${userId}`).emit('conversation.created', payload);
    io?.to(`user:${userId}`).emit('conversation.assigned', payload);
    io?.to(`account:${conv.account_id}`).emit('conversation.created', payload);
    recordSessionEvent({
      conversationId: convId,
      type: 'invite',
      actorUserId: Number(req.currentUser?.id || 0) || undefined,
      targetUserId: userId,
    });
    await createOutgoingMessage(convId, `已邀请坐席加入会话`, true);
    return reply.send({ ok: true, userId, workNO: workNO || undefined });
  });

  const auth = { preHandler: [fastify.authenticate] };
  fastify.get('/api/itr/observe/recent', auth, async (_req, reply) => {
    const { getItrObserveRecent } = await import('../../integrations/itr/itr-observe-client.js');
    return reply.send({ events: getItrObserveRecent(80) });
  });
}

// re-export for tests / CCS docs
export { applyAcdFinishEvt } from './itr-queue.js';
