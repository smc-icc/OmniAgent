import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { handleApiIdentifierWebhook, type ApiHmacContext } from '../api/incoming.js';
import type { ChannelIncomingHooks } from '../../../shared/services/channel-incoming.js';

export async function handleWeiboWebhook(
  identifier: string,
  payload: Record<string, unknown>,
  hooks: ChannelIncomingHooks,
  hmac?: ApiHmacContext,
) {
  return handleApiIdentifierWebhook(identifier, payload, hooks, CHANNEL_TYPES.WEIBO, 'weibo', hmac);
}

export async function sendWeiboText(
  conversationId: number,
  messageId: number,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    include: { inbox: true },
  });
  if (!conv?.inbox || conv.inbox.channel_type !== CHANNEL_TYPES.WEIBO) {
    return { ok: false, error: 'not weibo channel' };
  }
  const channel = await prisma.channel_api.findUnique({ where: { id: conv.inbox.channel_id } });
  if (!channel?.webhook_url) return { ok: true };

  try {
    const { canonicalJsonBody, signApiPayload } = await import('../api/hmac.js');
    const payload = {
      event: 'weibo_send',
      conversation_id: conversationId,
      message_id: messageId,
      content,
    };
    const body = canonicalJsonBody(payload);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (channel.hmac_token) headers['X-Omni-Signature'] = signApiPayload(channel.hmac_token, body);
    const res = await fetch(channel.webhook_url, {
      method: 'POST',
      headers,
      body,
    });
    if (!res.ok) return { ok: false, error: `weibo webhook HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'weibo send failed' };
  }
}
