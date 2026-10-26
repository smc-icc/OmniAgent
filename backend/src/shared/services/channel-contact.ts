import { prisma } from '../../plugins/db.js';

export async function findOrCreateChannelContact(
  accountId: number,
  channelPrefix: string,
  sourceId: string,
  name?: string,
  extra?: Record<string, unknown>,
) {
  const identifier = `${channelPrefix}:${sourceId}`;
  let contact = await prisma.contacts.findFirst({
    where: { account_id: accountId, identifier },
  });

  if (!contact) {
    contact = await prisma.contacts.create({
      data: {
        account_id: accountId,
        name: name?.trim() || `用户 ${sourceId.slice(-6)}`,
        identifier,
        custom_attributes: (extra ?? {}) as object,
        last_activity_at: new Date(),
      },
    });
  } else if (name?.trim() && contact.name !== name.trim()) {
    contact = await prisma.contacts.update({
      where: { id: contact.id },
      data: { name: name.trim(), last_activity_at: new Date() },
    });
  }

  return contact;
}
