import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import {
  processIncomingMessage,
  type ChannelIncomingHooks,
} from '../../../shared/services/channel-incoming.js';
import { canonicalJsonBody, verifyApiHmac } from './hmac.js';
import { normalizeApiInbound } from './normalize-inbound.js';

export type ApiInboundPayload = {
  from?: string;
  source_id?: string;
  content?: string;
  text?: string;
  name?: string;
  message_id?: string;
  id?: string;
};

export type ApiHmacContext = {
  signature?: string;
  rawBody?: string;
};

export async function handleApiIdentifierWebhook(
  identifier: string,
  payload: ApiInboundPayload | Record<string, unknown>,
  hooks: ChannelIncomingHooks,
  channelType: string = CHANNEL_TYPES.API,
  contactPrefix = 'api',
  hmac?: ApiHmacContext,
): Promise<{ conversationId?: number; skipped?: string; hmacFailed?: boolean }> {
  const id = String(identifier || '').trim();
  if (!id) return { skipped: 'no identifier' };

  const channel = await prisma.channel_api.findFirst({ where: { identifier: id } });
  if (!channel) return { skipped: 'channel not found' };

  if (channel.hmac_mandatory) {
    const body = hmac?.rawBody ?? canonicalJsonBody(payload);
    if (!verifyApiHmac(channel.hmac_token, body, hmac?.signature)) {
      return { skipped: 'hmac', hmacFailed: true };
    }
  }

  const inbox = await prisma.inboxes.findFirst({
    where: { channel_id: channel.id, channel_type: channelType },
  });
  if (!inbox) return { skipped: 'inbox not found' };

  const normalized = normalizeApiInbound(payload as Record<string, unknown>);
  const sourceId = String(normalized.from || normalized.source_id || '').trim();
  const content = String(normalized.content || normalized.text || '').trim();
  if (!sourceId || !content) return { skipped: 'from/content required' };

  const result = await processIncomingMessage(
    {
      accountId: inbox.account_id,
      inboxId: inbox.id,
      sourceId,
      contactName: normalized.name || sourceId,
      content,
      externalMessageId: normalized.message_id ? String(normalized.message_id) : normalized.id ? String(normalized.id) : undefined,
      contactPrefix,
    },
    hooks,
  );
  return { conversationId: result.conversationId };
}

export async function listApiChannelMessages(
  identifier: string,
  sourceId: string,
  channelType: string = CHANNEL_TYPES.API,
  hmac?: ApiHmacContext,
): Promise<{ hmacFailed?: boolean; skipped?: string; messages?: Array<{ id: number; content: string; message_type: number; created_at: Date }> }> {
  const id = String(identifier || '').trim();
  const from = String(sourceId || '').trim();
  if (!id || !from) return { skipped: 'identifier/from required' };
  const channel = await prisma.channel_api.findFirst({ where: { identifier: id } });
  if (!channel) return { skipped: 'channel not found' };
  if (channel.hmac_mandatory) {
    const body = hmac?.rawBody ?? `${id}:${from}`;
    if (!verifyApiHmac(channel.hmac_token, body, hmac?.signature)) {
      return { hmacFailed: true, skipped: 'hmac' };
    }
  }
  const inbox = await prisma.inboxes.findFirst({
    where: { channel_id: channel.id, channel_type: channelType },
  });
  if (!inbox) return { skipped: 'inbox not found' };
  const prefix =
    channelType === CHANNEL_TYPES.WEIBO ? 'weibo'
      : channelType === CHANNEL_TYPES.MINIPROGRAM ? 'miniprogram'
        : 'api';
  const contact = await prisma.contacts.findFirst({
    where: { account_id: inbox.account_id, identifier: `${prefix}:${from}` },
  });
  if (!contact) return { messages: [] };
  const conv = await prisma.conversations.findFirst({
    where: { inbox_id: inbox.id, contact_id: contact.id },
    orderBy: { last_activity_at: 'desc' },
  });
  if (!conv) return { messages: [] };
  const messages = await prisma.messages.findMany({
    where: { conversation_id: conv.id, private: false },
    orderBy: { id: 'asc' },
    take: 100,
    select: { id: true, content: true, message_type: true, created_at: true },
  });
  return {
    messages: messages.map((m) => ({
      id: m.id,
      content: m.content ?? '',
      message_type: m.message_type,
      created_at: m.created_at,
    })),
  };
}
