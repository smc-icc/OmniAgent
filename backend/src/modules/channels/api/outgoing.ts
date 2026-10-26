import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { canonicalJsonBody, signApiPayload } from './hmac.js';

export async function sendApiChannelWebhook(
  conversationId: number,
  messageId: number,
  content: string,
  expectedType: string = CHANNEL_TYPES.API,
  eventName = 'message_created',
): Promise<{ ok: boolean; error?: string }> {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    include: { inbox: true },
  });
  if (!conv?.inbox || conv.inbox.channel_type !== expectedType) {
    return { ok: false, error: `not ${expectedType} channel` };
  }

  const channel = await prisma.channel_api.findUnique({ where: { id: conv.inbox.channel_id } });
  if (!channel?.webhook_url) return { ok: true };

  const payload = {
    event: eventName,
    conversation_id: conversationId,
    message_id: messageId,
    content,
  };
  const body = canonicalJsonBody(payload);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (channel.hmac_token) headers['X-Omni-Signature'] = signApiPayload(channel.hmac_token, body);

  try {
    const res = await fetch(channel.webhook_url, {
      method: 'POST',
      headers,
      body,
    });
    if (!res.ok) return { ok: false, error: `webhook HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'webhook failed' };
  }
}
