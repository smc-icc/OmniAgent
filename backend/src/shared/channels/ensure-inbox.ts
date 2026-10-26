import { confTenancyEnabled } from '../services/conf-tenancy.js';
import { prisma } from '../../plugins/db.js';
import { getWelcomeText } from '../services/omni-ops.js';

export async function ensureInbox(
  accountId: number,
  channelType: string,
  channelId: number,
  inboxName: string,
) {
  const existing = await prisma.inboxes.findFirst({
    where: { channel_type: channelType, channel_id: channelId },
  });
  if (existing) {
    if (confTenancyEnabled() && existing.account_id !== accountId) throw new Error('Inbox belongs to another tenant');
    if (existing.name !== inboxName) {
      return prisma.inboxes.update({
        where: { id: existing.id },
        data: { name: inboxName },
      });
    }
    return existing;
  }
  const data = {
    account_id: accountId,
    channel_id: channelId,
    channel_type: channelType,
    name: inboxName,
    enable_auto_assignment: true,
    greeting_enabled: true,
    greeting_message: await getWelcomeText(),
    timezone: 'Asia/Shanghai',
  };
  try {
    return await prisma.inboxes.create({ data });
  } catch {
    const raced = await prisma.inboxes.findFirst({
      where: { channel_type: channelType, channel_id: channelId },
    });
    if (raced) {
      if (confTenancyEnabled() && raced.account_id !== accountId) throw new Error('Inbox belongs to another tenant');
      return raced;
    }
    const last = await prisma.inboxes.findFirst({
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    return prisma.inboxes.create({
      data: { ...data, id: (last?.id ?? 0) + 1 },
    });
  }
}

export async function deleteInboxForChannel(channelType: string, channelId: number) {
  const inbox = await prisma.inboxes.findFirst({
    where: { channel_type: channelType, channel_id: channelId },
  });
  if (inbox) {
    await prisma.inboxes.delete({ where: { id: inbox.id } }).catch(() => {});
  }
}
