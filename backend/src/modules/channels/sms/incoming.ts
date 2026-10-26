import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { resolveInbox, processIncomingMessage, type ChannelIncomingHooks } from '../../../shared/services/channel-incoming.js';

interface TwilioSmsPayload {
  From?: string;
  To?: string;
  Body?: string;
  MessageSid?: string;
}

/**
 * 按手机号找出「很可能就是同一个人」的既有联系人。
 *
 * 客户通常先在 Web 会话里聊天，之后才收到/回复短信。若不归并，短信回复会落在一个
 * 全新的 `sms:138…` 联系人下，坐席就得在两个会话之间来回切 —— 也就是跨渠道割裂。
 *
 * 兼容 `+86 138 0013 8000` / `138-0013-8000` 等写法：比较数字串的**后 11 位**
 * （中国大陆手机号）。匹配不到就返回 null，走原有的「新建联系人」路径。
 */
async function findContactIdByPhone(accountId: number, phone: string): Promise<number | null> {
  const tail = String(phone ?? '').replace(/\D/g, '').slice(-11);
  if (tail.length !== 11) return null;
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM contacts
    WHERE account_id = ${accountId}
      AND phone_number IS NOT NULL
      AND phone_number <> ''
      AND right(regexp_replace(phone_number, '[^0-9]', '', 'g'), 11) = ${tail}
    ORDER BY id ASC
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

/** 上行短信统一走这里，带上跨渠道归并所需的线索 */
async function deliverIncomingSms(
  accountId: number,
  inboxId: number,
  from: string,
  body: string,
  messageSid: string | undefined,
  contactPrefix: string,
  hooks: ChannelIncomingHooks,
): Promise<void> {
  const mergedContactId = await findContactIdByPhone(accountId, from);
  await processIncomingMessage(
    {
      accountId,
      inboxId,
      sourceId: from,
      contactName: from,
      content: body,
      externalMessageId: messageSid,
      contactPrefix,
      existingContactId: mergedContactId,
      // 全媒体统一时间线：客户回短信落回它原本的会话，而不是另起一个新会话
      reuseConversationAcrossInboxes: true,
    },
    hooks,
  );
}

export async function handleSmsWebhook(
  phoneKey: string,
  payload: TwilioSmsPayload,
  hooks: ChannelIncomingHooks,
): Promise<void> {
  const from = payload.From;
  const body = payload.Body;
  if (!from || !body) return;

  let channelType: string = CHANNEL_TYPES.TWILIO_SMS;
  let channel = await prisma.channel_twilio_sms.findFirst({
    where: { OR: [{ phone_number: phoneKey }, { messaging_service_sid: phoneKey }] },
  });

  if (!channel) {
    channelType = CHANNEL_TYPES.SMS;
    const smsCh = await prisma.channel_sms.findFirst({ where: { phone_number: phoneKey } });
    if (!smsCh) return;
    const inbox = await resolveInbox(channelType, smsCh.id);
    if (!inbox) return;
    await deliverIncomingSms(
      smsCh.account_id,
      inbox.id,
      from,
      body,
      payload.MessageSid,
      'sms',
      hooks,
    );
    return;
  }

  const inbox = await resolveInbox(channelType, channel.id);
  if (!inbox) return;

  await deliverIncomingSms(
    channel.account_id,
    inbox.id,
    from,
    body,
    payload.MessageSid,
    'twilio_sms',
    hooks,
  );
}
