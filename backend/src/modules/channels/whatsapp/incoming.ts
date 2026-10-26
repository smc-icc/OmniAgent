import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { resolveInbox, processIncomingMessage, type ChannelIncomingHooks } from '../../../shared/services/channel-incoming.js';
import { persistRemoteMediaUrl, type ChannelMedia } from '../../../shared/services/channel-media.js';
import { extractWhatsappInbound, type WaInboundMessage, type WhatsappInboundHint } from './parse.js';
import { nextWhatsappWindowUntil } from './window.js';

export { extractWhatsappInbound } from './parse.js';
export type { WaInboundMessage, WhatsappInboundHint } from './parse.js';

interface WaPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        messages?: WaInboundMessage[];
      };
    }>;
  }>;
}

export async function downloadWhatsappMedia(
  token: string,
  mediaId: string,
): Promise<{ url: string } | null> {
  try {
    const meta = await fetch(`https://graph.facebook.com/v18.0/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meta.ok) return null;
    const json = (await meta.json()) as { url?: string };
    return json.url ? { url: json.url } : null;
  } catch {
    return null;
  }
}

async function persistWhatsappMedia(
  token: string,
  hint: WhatsappInboundHint,
): Promise<ChannelMedia | undefined> {
  const loc = await downloadWhatsappMedia(token, hint.mediaId);
  if (!loc?.url) return undefined;
  try {
    const saved = await persistRemoteMediaUrl(loc.url, {
      fileName: hint.fileName,
      contentType: hint.contentType,
      headers: { Authorization: `Bearer ${token}` },
    });
    return {
      ...saved,
      kind: hint.kind,
      caption: hint.caption,
      external_media_id: hint.mediaId,
    };
  } catch {
    return undefined;
  }
}

export async function handleWhatsappWebhook(
  phoneNumber: string,
  payload: WaPayload,
  hooks: ChannelIncomingHooks,
): Promise<void> {
  const channel = await prisma.channel_whatsapp.findFirst({ where: { phone_number: phoneNumber } });
  if (!channel) return;

  const inbox = await resolveInbox(CHANNEL_TYPES.WHATSAPP, channel.id);
  if (!inbox) return;

  const cfg = (channel.provider_config ?? {}) as Record<string, unknown>;
  const token = String(cfg.access_token ?? cfg.api_key ?? '');

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        const inbound = extractWhatsappInbound(msg);
        if (!inbound) continue;
        const media = inbound.hint && token
          ? await persistWhatsappMedia(token, inbound.hint)
          : undefined;
        await processIncomingMessage(
          {
            accountId: channel.account_id,
            inboxId: inbox.id,
            sourceId: msg.from,
            contactName: msg.from,
            content: inbound.content,
            media,
            externalMessageId: msg.id,
            contactPrefix: 'whatsapp',
            conversationAttributes: {
              whatsapp_window_until: nextWhatsappWindowUntil(),
              whatsapp_last_inbound_at: Date.now(),
            },
          },
          hooks,
        );
      }
    }
  }
}
