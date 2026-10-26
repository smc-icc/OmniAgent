import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';

export async function sendTiktokText(
  conversationId: number,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    include: { inbox: true },
  });
  if (!conv?.inbox || conv.inbox.channel_type !== CHANNEL_TYPES.TIKTOK) {
    return { ok: false, error: 'not tiktok' };
  }

  const channel = await prisma.channel_tiktok.findUnique({ where: { id: conv.inbox.channel_id } });
  if (!channel) return { ok: false, error: 'channel not found' };

  const ci = await prisma.contact_inboxes.findFirst({
    where: { inbox_id: conv.inbox_id, contact_id: conv.contact_id ?? 0 },
  });
  if (!ci?.source_id) return { ok: false, error: 'contact source_id missing' };

  try {
    const res = await fetch('https://business-api.tiktok.com/open_api/v1.3/business/message/send/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': channel.access_token,
      },
      body: JSON.stringify({
        business_id: channel.business_id,
        recipient_id: ci.source_id,
        message_type: 'text',
        text: { body: content },
      }),
    });
    if (!res.ok) return { ok: false, error: await res.text() };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}
