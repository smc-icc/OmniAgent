import { prisma } from '../../plugins/db.js';
import { getWecomAccessToken } from '../../shared/services/wechat-token-cache.js';
import { CHANNEL_TYPES } from '../../shared/wechat/webhook-url.js';

export async function sendWecomContactText(
  conversationId: number,
  messageId: number,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    include: { inbox: true },
  });
  if (!conv?.inbox || conv.inbox.channel_type !== CHANNEL_TYPES.WECOM_CONTACT) {
    return { ok: false, error: 'Not a WeCom contact conversation' };
  }

  const channel = await prisma.channel_wecom_contact.findUnique({
    where: { id: conv.inbox.channel_id },
  });
  if (!channel) return { ok: false, error: 'Channel not found' };

  const attrs = (conv.additional_attributes ?? {}) as Record<string, unknown>;
  const externalUserId = attrs.wecom_external_userid as string | undefined;
  const sender = (attrs.wecom_follow_userid as string | undefined)
    ?? (channel.agent_id ? String(channel.agent_id) : undefined);
  if (!externalUserId || !sender) {
    return { ok: false, error: 'Missing external_userid or sender userid' };
  }

  try {
    const token = await getWecomAccessToken(channel.corp_id, channel.contact_secret);
    const res = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/externalcontact/add_msg_template?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_type: 'single',
          external_userid: [externalUserId],
          sender,
          text: { content },
        }),
      },
    );
    const data = (await res.json()) as { errcode?: number; errmsg?: string; msgid?: string };
    if (data.errcode && data.errcode !== 0) {
      return { ok: false, error: data.errmsg ?? `errcode ${data.errcode}` };
    }

    await prisma.messages.update({
      where: { id: messageId },
      data: {
        content_attributes: {
          channel_sent: true,
          channel: 'wecom_contact',
          wecom_msg_template_id: data.msgid,
          note: '已通过客户联系群发任务发送，成员需在企微客户端确认发送',
        } as object,
      },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Send failed' };
  }
}
