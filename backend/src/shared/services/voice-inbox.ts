import { prisma } from '../../plugins/db.js';
import { CHANNEL_TYPES } from '../channels/types.js';
import { ensureInbox } from '../channels/ensure-inbox.js';

const DEFAULT_ACCOUNT_ID = 1;
const HOTLINE_NUMBER = 'voice-hotline';

export async function ensureVoiceInbox(accountId = DEFAULT_ACCOUNT_ID) {
  const existingInbox = await prisma.inboxes.findFirst({
    where: { account_id: accountId, channel_type: CHANNEL_TYPES.VOICE },
    orderBy: { id: 'asc' },
  });
  if (existingInbox) return existingInbox;

  let channel = await prisma.channel_voice.findFirst({
    where: { account_id: accountId },
    orderBy: { id: 'asc' },
  });
  if (!channel) {
    channel = await prisma.channel_voice.create({
      data: {
        phone_number: `${HOTLINE_NUMBER}-${accountId}`,
        provider: 'ccs',
        provider_config: {},
        account_id: accountId,
      },
    });
  }
  return ensureInbox(accountId, CHANNEL_TYPES.VOICE, channel.id, '电话热线');
}
