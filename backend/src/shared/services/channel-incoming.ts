import { prisma } from '../../plugins/db.js';
import { emitConversationUnreadChanged } from './conversation-unread.js';
import { mergeAttrs, readLifecycle, reopenConversationIfEnded } from './conversation-lifecycle.js';
import {
  attachmentFileType,
  mediaToContentAttributes,
  type ChannelMedia,
} from './channel-media.js';
import { fileExtension } from './message-kind.js';

/**
 * 客户消息的「坐席回复截止时间」（epoch ms），写进 content_attributes 随消息下发。
 *
 * 前端据此在客户气泡上显示倒计时、到期变红提示「已超时」，让坐席知道这条必须尽快回；
 * **不带这个字段的消息表示不需要及时回复**（坐席自己发的、系统消息等）。
 *
 * 时长来源是渠道配置的 `reply_timeout_seconds`；渠道没配或为 0 就不带 —— 与
 * 「坐席回复超时」用的是同一个配置，避免出现两套互相打架的时限。
 */
async function replyDeadlineAttr(conversationId: number): Promise<Record<string, unknown>> {
  try {
    const conv = await prisma.conversations.findUnique({
      where: { id: conversationId },
      select: { inbox: { select: { channel_id: true } } },
    });
    const channelId = Number(conv?.inbox?.channel_id ?? 0) || 0;
    if (channelId <= 0) return {};
    const ch = await prisma.channel_wechat_mp
      .findUnique({ where: { id: channelId }, select: { reply_timeout_seconds: true } })
      .catch(() => null);
    const seconds = Number(ch?.reply_timeout_seconds ?? 0) || 0;
    if (seconds <= 0) return {};
    return { reply_deadline_ms: Date.now() + seconds * 1000 };
  } catch {
    return {};
  }
}

export interface IncomingMessageInput {
  accountId: number;
  inboxId: number;
  sourceId: string;
  contactName?: string;
  content: string;
  /** 图片/语音等；写入 content_attributes。ITR 用 transcript 或 content，不用 file_url */
  media?: ChannelMedia;
  externalMessageId?: string;
  conversationAttributes?: Record<string, unknown>;
  contactAttributes?: Record<string, unknown>;
  /** Contact identifier prefix, default wechat for backward compat */
  contactPrefix?: string;
  /**
   * 复用已存在的联系人（跨渠道归并）。
   * 例如客户先在 Widget 聊过、之后回复短信，应按手机号认成同一个人，
   * 而不是新建一个 `sms:138…` 的陌生联系人。
   */
  existingContactId?: number | null;
  /**
   * 允许复用该联系人在**其他 inbox** 的开放会话。
   * 开启后短信回复会落回客户原本的会话（全媒体统一时间线），
   * 而不是在短信 inbox 另起一个会话。
   */
  reuseConversationAcrossInboxes?: boolean;
}

export interface ChannelIncomingHooks {
  emitToAccount: (accountId: number, event: string, data: unknown) => void;
  enqueue?: (queue: string, job: string, data: unknown) => Promise<void>;
}

export async function resolveInbox(channelType: string, channelId: number) {
  return prisma.inboxes.findFirst({
    where: { channel_type: channelType, channel_id: channelId },
  });
}

export async function findOrCreateContact(
  accountId: number,
  sourceId: string,
  name?: string,
  extra?: Record<string, unknown>,
  prefix = 'wechat',
) {
  const identifier = `${prefix}:${sourceId}`;
  let contact = await prisma.contacts.findFirst({
    where: { account_id: accountId, identifier },
  });

  const fallbackName = prefix === 'phone'
    ? sourceId
    : `微信用户 ${sourceId.slice(-6)}`;

  if (!contact) {
    contact = await prisma.contacts.create({
      data: {
        account_id: accountId,
        name: name?.trim() || fallbackName,
        identifier,
        phone_number: prefix === 'phone' ? sourceId : undefined,
        custom_attributes: (extra ?? {}) as object,
        last_activity_at: new Date(),
      },
    });
  } else {
    const patch: { name?: string; phone_number?: string; last_activity_at: Date } = {
      last_activity_at: new Date(),
    };
    if (name?.trim()) {
      const trimmed = name.trim();
      const isFallback = contact.name === `微信用户 ${sourceId.slice(-6)}`;
      if (isFallback || contact.name !== trimmed) patch.name = trimmed;
    }
    if (prefix === 'phone' && !contact.phone_number) patch.phone_number = sourceId;
    if (patch.name || patch.phone_number) {
      contact = await prisma.contacts.update({
        where: { id: contact.id },
        data: patch,
      });
    }
  }

  return contact;
}

export async function findOrCreateContactInbox(
  inboxId: number,
  contactId: number,
  sourceId: string,
) {
  let ci = await prisma.contact_inboxes.findFirst({
    where: { inbox_id: inboxId, source_id: sourceId },
  });
  if (!ci) {
    ci = await prisma.contact_inboxes.create({
      data: { inbox_id: inboxId, contact_id: contactId, source_id: sourceId },
    });
  }
  return ci;
}

export async function findOrCreateOpenConversation(
  accountId: number,
  inboxId: number,
  contactId: number,
  contactInboxId: number,
  additionalAttributes?: Record<string, unknown>,
  opts?: { acrossInboxes?: boolean },
) {
  const existing = await prisma.conversations.findFirst({
    where: opts?.acrossInboxes
      // 全媒体统一时间线：不限 inbox，复用该客户最近活跃的开放会话
      ? { account_id: accountId, contact_id: contactId, status: 0 }
      : { inbox_id: inboxId, contact_id: contactId, status: 0 },
    orderBy: { last_activity_at: 'desc' },
  });
  if (existing) {
    let current = existing;
    if (readLifecycle(existing.additional_attributes) === 'ended') {
      const reopened = await reopenConversationIfEnded(existing.id);
      if (reopened) current = reopened;
    }
    if (additionalAttributes && Object.keys(additionalAttributes).length) {
      current = await prisma.conversations.update({
        where: { id: current.id },
        data: {
          additional_attributes: mergeAttrs(current.additional_attributes, additionalAttributes) as object,
          last_activity_at: new Date(),
        },
      });
    }
    return current;
  }

  const last = await prisma.conversations.findFirst({
    where: { account_id: accountId },
    orderBy: { display_id: 'desc' },
    select: { display_id: true },
  });
  const displayId = (last?.display_id ?? 0) + 1;

  return prisma.conversations.create({
    data: {
      account_id: accountId,
      inbox_id: inboxId,
      contact_id: contactId,
      contact_inbox_id: contactInboxId,
      display_id: displayId,
      status: 0,
      additional_attributes: (additionalAttributes ?? {}) as object,
      contact_last_seen_at: new Date(),
      last_activity_at: new Date(),
    },
  });
}

export async function messageExists(conversationId: number, sourceId: string): Promise<boolean> {
  if (!sourceId) return false;
  const existing = await prisma.messages.findFirst({
    where: { conversation_id: conversationId, source_id: sourceId },
    select: { id: true },
  });
  return !!existing;
}

export async function processIncomingMessage(
  input: IncomingMessageInput,
  hooks: ChannelIncomingHooks,
): Promise<{ conversationId: number; messageId: number; duplicate: boolean }> {
  // 跨渠道归并：调用方若能按手机号等线索认出「这就是同一个客户」，优先复用，避免造出重复联系人
  const existingContact = input.existingContactId
    ? await prisma.contacts.findFirst({ where: { id: input.existingContactId, account_id: input.accountId } })
    : null;
  const contact = existingContact
    ?? await findOrCreateContact(
      input.accountId,
      input.sourceId,
      input.contactName,
      input.contactAttributes,
      input.contactPrefix ?? 'wechat',
    );
  const contactInbox = await findOrCreateContactInbox(
    input.inboxId,
    contact.id,
    input.sourceId,
  );
  const conversation = await findOrCreateOpenConversation(
    input.accountId,
    input.inboxId,
    contact.id,
    contactInbox.id,
    input.conversationAttributes,
    { acrossInboxes: input.reuseConversationAcrossInboxes },
  );

  if (input.externalMessageId) {
    const dup = await messageExists(conversation.id, input.externalMessageId);
    if (dup) {
      return { conversationId: conversation.id, messageId: 0, duplicate: true };
    }
  }

  const { filterMessageContent } = await import('./omni-ops.js');
  const filtered = await filterMessageContent(input.content);
  const mediaAttrs = input.media ? mediaToContentAttributes(input.media) : {};
  const contentAttrs = {
    ...mediaAttrs,
    ...(filtered.hit
      ? { sensitive_hit: true, sensitive_blocked: filtered.blocked, sensitive_words: filtered.words }
      : {}),
    ...(await replyDeadlineAttr(conversation.id)),
  };

  const msg = await prisma.messages.create({
    data: {
      account_id: input.accountId,
      // 用会话自身的 inbox：跨渠道复用会话时（acrossInboxes），
      // incoming 的 inboxId 可能是短信 inbox，而会话属于客户原本的渠道
      inbox_id: conversation.inbox_id,
      conversation_id: conversation.id,
      content: filtered.text,
      message_type: 0,
      content_type: 0,
      sender_type: 'Contact',
      sender_id: contact.id,
      source_id: input.externalMessageId ?? undefined,
      ...(Object.keys(contentAttrs).length ? { content_attributes: contentAttrs as object } : {}),
    },
  });

  if (input.media?.file_url) {
    const fileName = input.media.file_name || 'file';
    await prisma.attachments.create({
      data: {
        message_id: msg.id,
        account_id: input.accountId,
        external_url: input.media.file_url,
        fallback_title: fileName,
        extension: fileExtension(fileName),
        file_type: attachmentFileType(input.media.kind),
        meta: {
          content_type: input.media.content_type,
          byte_size: input.media.byte_size,
        } as object,
      },
    }).catch(() => {});
  }

  await prisma.conversations.update({
    where: { id: conversation.id },
    data: { last_activity_at: new Date(), contact_last_seen_at: new Date() },
  });

  hooks.emitToAccount(input.accountId, 'message.created', {
    id: msg.id,
    conversation_id: conversation.id,
    content: msg.content ?? '',
    message_type: 'incoming',
    created_at: msg.created_at,
  });

  emitConversationUnreadChanged(
    hooks.emitToAccount,
    input.accountId,
    conversation.id,
  ).catch(() => {});

  if (hooks.enqueue) {
    hooks.enqueue('webhook', 'message_created', {
      account_id: input.accountId,
      conversation_id: conversation.id,
      message_id: msg.id,
    }).catch(() => {});

    const ca = (conversation.custom_attributes ?? {}) as Record<string, unknown>;
    if (ca.ai_auto_reply === true) {
      hooks.enqueue('conversation', 'ai_auto_reply', {
        account_id: input.accountId,
        conversation_id: conversation.id,
        message_id: msg.id,
        assistant_id: (ca.ai_assistant_id as number | undefined) ?? null,
      }).catch(() => {});
    }
  }

  // ITR：新会话自动启流程；已托管则推进
  void import('../../modules/itr/itr-lifecycle.js')
    .then(async ({ autoStartItrForConversation, relayVisitorToItr, isPassiveReplyInbox, scheduleActiveReplyTimeout, scheduleIdleRecycle }) => {
      const { isItrHosted } = await import('../../modules/itr/itr-queue.js');
      let skipRelay = false;
      if (!isItrHosted(conversation.id)) {
        const inboxRow = await prisma.inboxes.findUnique({
          where: { id: input.inboxId },
          select: { channel_type: true, channel_id: true },
        });
        const attrs = (conversation.additional_attributes ?? {}) as Record<string, unknown>;
        if (!attrs.itr_hosted && !(conversation as { assignee_id?: number | null }).assignee_id) {
          const started = await autoStartItrForConversation({
            conversationId: conversation.id,
            contactId: contact.id,
            inboxId: input.inboxId,
            channelType: inboxRow?.channel_type || input.contactPrefix || 'channel',
            callerId: input.sourceId,
          });
          // 启动流程时这条消息已经被"消费"掉了：启动本身就把欢迎语+菜单发给了客户。
          // 再把它喂进流程，菜单节点只会当成一次「选择」去匹配，客户就会多收到
          // 一句「输入无效，请重新选择。」加一遍菜单。
          // 这一点与渠道能不能主动推送无关（企业微信客服能主动推，但同样会重复），
          // 所以只要流程是本次启动的，就跳过转发。
          if (started) {
            skipRelay = true;
          }
        }
      }
      const itrText = (input.media?.transcript || input.content || '').trim();
      if (itrText && !skipRelay) await relayVisitorToItr(conversation.id, itrText);

      // 主动推送形态：坐席随时能推、客户不会卡在窗口里，所以「坐席回复超时」要靠
      // 客户发言后的延迟任务判定 —— 到点坐席仍没回，就把会话收回给 ITR 走超时流程。
      await scheduleActiveReplyTimeout(conversation.id);

      // 闲置回收：客户最后一次发言后 N 秒没有新消息，就把会话从流程里放出来
      // （默认走 release）。每次发言都会重置，所以只有真的没人说话才会触发。
      await scheduleIdleRecycle(conversation.id);
    })
    .catch(() => {});

  return { conversationId: conversation.id, messageId: msg.id, duplicate: false };
}
