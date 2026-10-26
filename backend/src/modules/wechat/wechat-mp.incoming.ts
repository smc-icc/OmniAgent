import type { FastifyInstance } from 'fastify';
import { prisma } from '../../plugins/db.js';
import { parseWeChatXml } from '../../shared/wechat/xml.js';
import { decryptWeChatMessage } from '../../shared/wechat/crypto.js';
import { resolveInbox, processIncomingMessage } from '../../shared/services/channel-incoming.js';
import { CHANNEL_TYPES } from '../../shared/wechat/webhook-url.js';
import { fetchWechatMpUserDisplayName } from '../../shared/services/wechat-user-profile.js';
import {
  persistMediaBuffer,
  persistRemoteMediaUrl,
  type ChannelMedia,
} from '../../shared/services/channel-media.js';

interface MpXmlMessage {
  ToUserName?: string;
  FromUserName?: string;
  CreateTime?: string | number;
  MsgType?: string;
  Content?: string;
  MsgId?: string | number;
  Event?: string;
  EventKey?: string;
  Encrypt?: string;
  PicUrl?: string;
  MediaId?: string;
  Title?: string;
  Description?: string;
  Url?: string;
  Label?: string;
}

export function extractMpEncryptField(rawBody: string): string | undefined {
  if (!rawBody.includes('Encrypt')) return undefined;
  try {
    const parsed = parseWeChatXml<{ xml?: { Encrypt?: string }; Encrypt?: string }>(rawBody);
    return parsed.xml?.Encrypt ?? parsed.Encrypt;
  } catch {
    return undefined;
  }
}

/** Human-readable text stored in messages.content for the agent UI */
export function extractMpMessageContent(msg: MpXmlMessage): string | null {
  const type = String(msg.MsgType ?? '').toLowerCase();
  if (type === 'text') {
    const text = String(msg.Content ?? '').trim();
    return text || null;
  }
  if (type === 'image') {
    const pic = String(msg.PicUrl ?? '').trim();
    return pic ? `[图片消息] ${pic}` : '[图片消息]';
  }
  if (type === 'voice') {
    const mid = String(msg.MediaId ?? '').trim();
    return mid ? `[语音消息] ${mid}` : '[语音消息]';
  }
  if (type === 'video') return '[视频消息]';
  if (type === 'shortvideo') return '[短视频消息]';
  if (type === 'location') {
    const label = String(msg.Label ?? '').trim();
    return label ? `[位置] ${label}` : '[位置消息]';
  }
  if (type === 'link') {
    const title = String(msg.Title ?? '').trim();
    return title ? `[链接] ${title}` : '[链接消息]';
  }
  if (type === 'file') return '[文件消息]';
  if (type === 'miniprogrampage') return '[小程序卡片]';
  if (type === 'event') return null;
  if (!type) return null;
  return `[${msg.MsgType}消息]`;
}

export async function parseMpWebhookBody(
  rawBody: string,
  channel: { app_id: string; encoding_aes_key: string | null },
  query: Record<string, string>,
): Promise<MpXmlMessage | null> {
  if (!rawBody.trim()) return null;

  let xml = rawBody;
  const encrypted =
    !!channel.encoding_aes_key
    && (query.encrypt_type === 'aes' || rawBody.includes('Encrypt'));
  if (encrypted) {
    const encrypt = extractMpEncryptField(rawBody);
    if (encrypt) {
      xml = decryptWeChatMessage(channel.encoding_aes_key!, channel.app_id, encrypt);
    }
  }
  const msg = parseWeChatXml<MpXmlMessage>(xml);
  return msg;
}

export function extractMpEventMeta(msg: MpXmlMessage): { event: string; eventKey: string } {
  const event = String(msg.Event ?? '').trim();
  const eventKey = String(msg.EventKey ?? '').trim();
  return { event, eventKey };
}

/** 落库结果：被动回复模式下 webhook 需要 conversationId 才能把消息记成留言 */
export interface MpStoredMessage {
  conversationId: number;
  messageId: number;
  duplicate: boolean;
}

export async function handleMpIncomingMessage(
  appId: string,
  msg: MpXmlMessage,
  server: FastifyInstance,
  /**
   * 追加到会话上的属性。被动回复模式用它把「客户上次选了留言」透传进
   * processIncomingMessage，进而进入 ITR 启动时的 meta。
   */
  extraAttrs?: Record<string, unknown>,
): Promise<MpStoredMessage | null> {
  const channel = await prisma.channel_wechat_mp.findUnique({ where: { app_id: appId } });
  if (!channel) return null;

  const inbox = await resolveInbox(CHANNEL_TYPES.WECHAT_MP, channel.id);
  if (!inbox) return null;

  const openid = msg.FromUserName;
  if (!openid) return null;

  const contactName = await fetchWechatMpUserDisplayName(
    channel.app_id,
    channel.app_secret,
    openid,
  );

  if (msg.MsgType === 'event') {
    const { event, eventKey } = extractMpEventMeta(msg);
    if (!event) return null;
    const label =
      event.toLowerCase() === 'subscribe'
        ? '[用户关注公众号]'
        : event.toLowerCase() === 'unsubscribe'
          ? '[用户取消关注]'
          : eventKey
            ? `[事件] ${event}:${eventKey}`
            : `[事件] ${event}`;
    await processIncomingMessage(
      {
        accountId: inbox.account_id,
        inboxId: inbox.id,
        sourceId: openid,
        contactName,
        content: label,
        externalMessageId: `evt-${event}-${msg.CreateTime}-${openid}-${eventKey}`.slice(0, 120),
        conversationAttributes: {
          wechat_mp_openid: openid,
          wx_event: event,
          event,
          wx_event_key: eventKey,
          eventKey,
        },
        contactPrefix: 'wechat',
      },
      {
        emitToAccount: server.emitToAccount.bind(server),
        enqueue: server.enqueue.bind(server),
      },
    );
    // 事件消息不参与「留言内容」判定，调用方按 null 处理
    return null;
  }

  let content = extractMpMessageContent(msg);
  if (!content) {
    server.log.info(
      { appId, msgType: msg.MsgType, event: msg.Event },
      'WeChat MP: skipped message without displayable content',
    );
    return null;
  }

  const media = await persistIncomingMpMedia(channel, msg);
  if (media?.transcript) content = media.transcript;

  const externalId = msg.MsgId ? String(msg.MsgId) : `mp-${msg.CreateTime}-${openid}`;

  const result = await processIncomingMessage(
    {
      accountId: inbox.account_id,
      inboxId: inbox.id,
      sourceId: openid,
      contactName,
      content,
      media,
      externalMessageId: externalId,
      conversationAttributes: {
        wechat_mp_openid: openid,
        wechat_mp_session_from: Number(msg.CreateTime) || Math.floor(Date.now() / 1000),
        ...(extraAttrs ?? {}),
      },
      contactPrefix: 'wechat',
    },
    {
      emitToAccount: server.emitToAccount.bind(server),
      enqueue: server.enqueue.bind(server),
    },
  );

  if (!result.duplicate) {
    server.log.info(
      {
        appId,
        conversationId: result.conversationId,
        messageId: result.messageId,
        content,
        openid,
      },
      'WeChat MP message stored',
    );
  }

  return result;
}

async function persistIncomingMpMedia(
  channel: { app_id: string; app_secret: string },
  msg: MpXmlMessage,
): Promise<ChannelMedia | undefined> {
  const type = String(msg.MsgType ?? '').toLowerCase();
  const mediaId = msg.MediaId ? String(msg.MediaId) : '';

  if (type === 'image') {
    if (msg.PicUrl) {
      try {
        const saved = await persistRemoteMediaUrl(String(msg.PicUrl), {
          fileName: 'wechat-image.jpg',
          contentType: 'image/jpeg',
        });
        return { ...saved, kind: 'image', external_media_id: mediaId || undefined };
      } catch { /* fall through */ }
    }
    const buf = mediaId ? await downloadMp(channel, mediaId) : null;
    if (!buf) return undefined;
    const saved = await persistMediaBuffer(buf, { fileName: 'wechat-image.jpg', contentType: 'image/jpeg' });
    return { ...saved, kind: 'image', external_media_id: mediaId };
  }

  if (type === 'voice' && mediaId) {
    const buf = await downloadMp(channel, mediaId);
    if (!buf) return undefined;
    const saved = await persistMediaBuffer(buf, { fileName: 'wechat-voice.amr', contentType: 'audio/amr' });
    let transcript = '';
    try {
      const { transcribeWavBuffer } = await import('../../shared/services/funasr-asr.js');
      transcript = (await transcribeWavBuffer(buf)) || '';
    } catch { /* keep audio even if ASR fails */ }
    return {
      ...saved,
      kind: 'voice',
      transcript: transcript || undefined,
      external_media_id: mediaId,
    };
  }

  if ((type === 'video' || type === 'shortvideo' || type === 'file') && mediaId) {
    const buf = await downloadMp(channel, mediaId);
    if (!buf) return undefined;
    const kind = type === 'file' ? 'file' : 'video';
    const saved = await persistMediaBuffer(buf, {
      fileName: kind === 'video' ? 'wechat-video.mp4' : 'wechat-file.bin',
      contentType: kind === 'video' ? 'video/mp4' : 'application/octet-stream',
    });
    return { ...saved, kind, external_media_id: mediaId };
  }

  return undefined;
}

async function downloadMp(channel: { app_id: string; app_secret: string }, mediaId: string) {
  const { downloadWechatMpMedia } = await import('./wechat-mp.outgoing.js');
  return downloadWechatMpMedia(channel.app_id, channel.app_secret, mediaId);
}

/** @deprecated 使用 fetchWechatMpUserDisplayName */
export const fetchMpUserName = fetchWechatMpUserDisplayName;
