import type { FastifyInstance } from 'fastify';
import { prisma } from '../../plugins/db.js';
import { parseWeChatXml } from '../../shared/wechat/xml.js';
import { resolveInbox, processIncomingMessage } from '../../shared/services/channel-incoming.js';
import { CHANNEL_TYPES } from '../../shared/wechat/webhook-url.js';
import { fetchWecomExternalContactDisplayName } from '../../shared/services/wechat-user-profile.js';

interface ContactXml {
  ToUserName?: string;
  FromUserName?: string;
  CreateTime?: string | number;
  MsgType?: string;
  Content?: string;
  MsgId?: string | number;
  Event?: string;
  ChangeType?: string;
  UserID?: string;
  ExternalUserID?: string;
}

export async function handleContactIncoming(
  channelId: number,
  xml: string,
  server: FastifyInstance,
): Promise<void> {
  const channel = await prisma.channel_wecom_contact.findUnique({ where: { id: channelId } });
  if (!channel) return;

  const inbox = await resolveInbox(CHANNEL_TYPES.WECOM_CONTACT, channel.id);
  if (!inbox) return;

  const msg = parseWeChatXml<ContactXml>(xml);

  if (msg.MsgType === 'event' && msg.Event === 'change_external_contact') {
    const externalUserId = msg.ExternalUserID;
    const followUser = msg.UserID;
    if (!externalUserId) return;

    if (msg.ChangeType === 'add_external_contact' || msg.ChangeType === 'edit_external_contact') {
      const contactName = await fetchWecomExternalContactDisplayName(
        channel.corp_id,
        channel.contact_secret,
        externalUserId,
      );
      await processIncomingMessage(
        {
          accountId: inbox.account_id,
          inboxId: inbox.id,
          sourceId: externalUserId,
          contactName,
          content: '[新增/更新外部联系人]',
          externalMessageId: `contact-evt-${msg.ChangeType}-${externalUserId}-${msg.CreateTime}`,
          conversationAttributes: {
            wecom_external_userid: externalUserId,
            wecom_follow_userid: followUser,
          },
          contactAttributes: { wecom_follow_userid: followUser },
        },
        {
          emitToAccount: server.emitToAccount.bind(server),
          enqueue: server.enqueue.bind(server),
        },
      );
    }
    return;
  }

  if (msg.MsgType === 'text' && msg.Content?.trim()) {
    const from = msg.ExternalUserID ?? msg.FromUserName;
    if (!from) return;
    const contactName = await fetchWecomExternalContactDisplayName(
      channel.corp_id,
      channel.contact_secret,
      from,
    );
    await processIncomingMessage(
      {
        accountId: inbox.account_id,
        inboxId: inbox.id,
        sourceId: from,
        contactName,
        content: msg.Content.trim(),
        externalMessageId: msg.MsgId ? String(msg.MsgId) : `contact-${msg.CreateTime}-${from}`,
        conversationAttributes: {
          wecom_external_userid: from,
          wecom_follow_userid: msg.UserID,
        },
      },
      {
        emitToAccount: server.emitToAccount.bind(server),
        enqueue: server.enqueue.bind(server),
      },
    );
  }
}
