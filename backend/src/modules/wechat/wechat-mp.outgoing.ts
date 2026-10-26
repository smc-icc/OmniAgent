import { prisma } from '../../plugins/db.js';
import { getWechatMpAccessToken } from '../../shared/services/wechat-token-cache.js';
import { CHANNEL_TYPES } from '../../shared/wechat/webhook-url.js';
import {
  deliverToPassiveSlot,
  enqueuePendingReply,
  isActiveReplyDisabled,
  isPassiveReplyEnabled,
} from '../../shared/services/wechat-mp-passive.js';
import { emojiToWechatFace } from '../../shared/wechat/faces.js';
import { guessWechatMediaType, uploadWechatTempMedia } from '../../shared/wechat/temp-media.js';
import {
  readPersistedMedia,
  toPublicMediaUrl,
  type ChannelMedia,
} from '../../shared/services/channel-media.js';
import { getPublicBaseUrl } from '../../shared/services/public-base-url.js';

interface SendResult {
  ok: boolean;
  error?: string;
  externalId?: string;
}

export async function sendWechatMpText(
  conversationId: number,
  messageId: number,
  content: string,
): Promise<SendResult> {
  // 微信系渠道没有 Unicode emoji：表情在协议里是 `[发呆]` 这样的文本，
  // 客户端才渲染成自家图集。出站前换回占位符。
  // 放在函数开头，主动发送与被动回复两条分支都能覆盖到。
  content = emojiToWechatFace(content);
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    include: { inbox: true },
  });
  if (!conv?.inbox || conv.inbox.channel_type !== CHANNEL_TYPES.WECHAT_MP) {
    return { ok: false, error: 'Not a WeChat MP conversation' };
  }

  const channel = await prisma.channel_wechat_mp.findUnique({
    where: { id: conv.inbox.channel_id },
  });
  if (!channel) return { ok: false, error: 'Channel not found' };

  const attrs = (conv.additional_attributes ?? {}) as Record<string, unknown>;
  const openid = attrs.wechat_mp_openid as string | undefined;
  if (!openid) return { ok: false, error: 'Missing wechat_mp_openid' };

  // 没有客服消息权限的公众号（未认证订阅号，含个人号）：客服消息 API 必然失败，
  // 不要发这个注定失败的请求，改走被动回复（投递等待槽）或积压队列。
  if (isActiveReplyDisabled(channel)) {
    return dispatchPassiveReply(channel, openid, content, messageId);
  }

  try {
    const token = await getWechatMpAccessToken(channel.app_id, channel.app_secret);
    const res = await fetch(
      `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: openid,
          msgtype: 'text',
          text: { content },
        }),
      },
    );
    const data = (await res.json()) as { errcode?: number; errmsg?: string };
    if (data.errcode && data.errcode !== 0) {
      const err = data.errmsg ?? `errcode ${data.errcode}`;
      if (channel.account_type === 'subscribe') {
        return {
          ok: false,
          error: `订阅号发送受限: ${err}。请确认已开通客服接口，或引导用户再次发送消息触发被动回复。`,
        };
      }
      return { ok: false, error: err };
    }

    await markMpSent(messageId);
    return { ok: true, externalId: `mp-out-${messageId}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Send failed' };
  }
}

export type MpNewsArticle = {
  title?: string;
  description?: string;
  url?: string;
  picUrl?: string;
  picurl?: string;
};

export async function sendWechatMpNews(
  conversationId: number,
  messageId: number,
  articles: MpNewsArticle[],
): Promise<SendResult> {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    include: { inbox: true },
  });
  if (!conv?.inbox || conv.inbox.channel_type !== CHANNEL_TYPES.WECHAT_MP) {
    return { ok: false, error: 'Not a WeChat MP conversation' };
  }
  const channel = await prisma.channel_wechat_mp.findUnique({
    where: { id: conv.inbox.channel_id },
  });
  if (!channel) return { ok: false, error: 'Channel not found' };
  const attrs = (conv.additional_attributes ?? {}) as Record<string, unknown>;
  const openid = attrs.wechat_mp_openid as string | undefined;
  if (!openid) return { ok: false, error: 'Missing wechat_mp_openid' };
  const list = articles
    .filter((a) => a && (a.title || a.url))
    .slice(0, 8)
    .map((a) => ({
      title: String(a.title || '').slice(0, 64),
      description: String(a.description || '').slice(0, 120),
      url: String(a.url || ''),
      picurl: String(a.picUrl || a.picurl || ''),
    }));
  if (!list.length) return { ok: false, error: 'no articles' };

  // 同上：无客服消息权限时不发客服消息 API。
  // 被动回复的 XML 这里只回文本（图文被动回复要 ThumbMediaId，代价远大于收益），
  // 所以把图文压成「标题 + 链接」。
  if (isActiveReplyDisabled(channel)) {
    const asText = list
      .map((a) => [a.title, a.url].filter(Boolean).join(' '))
      .filter(Boolean)
      .join('\n');
    return dispatchPassiveReply(channel, openid, asText, messageId);
  }

  try {
    const token = await getWechatMpAccessToken(channel.app_id, channel.app_secret);
    const res = await fetch(
      `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ touser: openid, msgtype: 'news', news: { articles: list } }),
      },
    );
    const data = (await res.json()) as { errcode?: number; errmsg?: string };
    if (data.errcode && data.errcode !== 0) {
      return { ok: false, error: data.errmsg ?? `errcode ${data.errcode}` };
    }
    await markMpSent(messageId, { kind: 'news', articles: list });
    return { ok: true, externalId: `mp-news-${messageId}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Send failed' };
  }
}

export async function sendWechatMpMedia(
  conversationId: number,
  messageId: number,
  media: ChannelMedia,
  caption?: string,
): Promise<SendResult> {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    include: { inbox: true },
  });
  if (!conv?.inbox || conv.inbox.channel_type !== CHANNEL_TYPES.WECHAT_MP) {
    return { ok: false, error: 'Not a WeChat MP conversation' };
  }
  const channel = await prisma.channel_wechat_mp.findUnique({
    where: { id: conv.inbox.channel_id },
  });
  if (!channel) return { ok: false, error: 'Channel not found' };
  const attrs = (conv.additional_attributes ?? {}) as Record<string, unknown>;
  const openid = attrs.wechat_mp_openid as string | undefined;
  if (!openid) return { ok: false, error: 'Missing wechat_mp_openid' };

  const textFallback = caption || media.caption || media.file_name || '[媒体]';
  if (isActiveReplyDisabled(channel)) {
    return dispatchPassiveReply(channel, openid, textFallback, messageId);
  }

  const buf = media.file_url ? await readPersistedMedia(media.file_url) : null;
  const wxType = guessWechatMediaType(media.kind, media.content_type);
  // 公众号客服消息没有通用 file，非图片/语音改发可点开的链接
  if (wxType === 'file' || wxType === 'video') {
    const url = media.file_url
      ? (media.file_url.startsWith('http') ? media.file_url : `${getPublicBaseUrl()}${media.file_url}`)
      : toPublicMediaUrl(media.file_url || '');
    return sendWechatMpText(conversationId, messageId, url ? `${textFallback}\n${url}` : textFallback);
  }
  if (!buf) return { ok: false, error: 'media file not found' };

  const token = await getWechatMpAccessToken(channel.app_id, channel.app_secret);
  const uploaded = await uploadWechatTempMedia({
    uploadUrl: `https://api.weixin.qq.com/cgi-bin/media/upload?access_token=${token}`,
    type: wxType,
    body: buf,
    fileName: media.file_name || (wxType === 'voice' ? 'voice.amr' : 'image.jpg'),
    contentType: media.content_type,
  });
  if (!uploaded.mediaId) return { ok: false, error: uploaded.error || 'upload media failed' };

  const payload =
    wxType === 'voice'
      ? { touser: openid, msgtype: 'voice', voice: { media_id: uploaded.mediaId } }
      : { touser: openid, msgtype: 'image', image: { media_id: uploaded.mediaId } };

  try {
    const res = await fetch(
      `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    const data = (await res.json()) as { errcode?: number; errmsg?: string };
    if (data.errcode && data.errcode !== 0) {
      return { ok: false, error: data.errmsg ?? `errcode ${data.errcode}` };
    }
    await markMpSent(messageId, { kind: media.kind, channel_media_id: uploaded.mediaId });
    return { ok: true, externalId: `mp-${wxType}-${messageId}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Send failed' };
  }
}

export async function downloadWechatMpMedia(appId: string, appSecret: string, mediaId: string): Promise<Buffer | null> {
  const mid = String(mediaId || '').trim();
  if (!mid) return null;
  try {
    const token = await getWechatMpAccessToken(appId, appSecret);
    const res = await fetch(
      `https://api.weixin.qq.com/cgi-bin/media/get?access_token=${token}&media_id=${encodeURIComponent(mid)}`,
    );
    if (!res.ok) return null;
    const ctype = res.headers.get('content-type') || '';
    if (ctype.includes('application/json')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 32 ? buf : null;
  } catch {
    return null;
  }
}

async function markMpSent(messageId: number, extra: Record<string, unknown> = {}, sent = true) {
  const msg = await prisma.messages.findUnique({
    where: { id: messageId },
    select: { content_attributes: true },
  });
  const prev = (msg?.content_attributes ?? {}) as Record<string, unknown>;
  await prisma.messages.update({
    where: { id: messageId },
    data: {
      content_attributes: {
        ...prev,
        ...extra,
        // 被动模式下入队的消息还没真正送到客户手里，不能标成已发送，
        // 否则坐席看不出「这条还压着」。
        channel_sent: sent,
        channel: 'wechat_mp',
      } as object,
    },
  });
}

/**
 * 被动回复模式下的出站：投递等待槽，或压入积压队列。
 *
 * 两种情况都不算发送失败 —— 消息没丢，只是送达时机取决于客户下次发言。
 * 这是被动回复的天花板：客户不说话，内容就送不出去，所以标记成 pending_passive
 * 让坐席知道状况，而不是让消息静默消失。
 */
async function dispatchPassiveReply(
  channel: { app_id: string; passive_reply_enabled: boolean; pending_reply_max: number },
  openid: string,
  content: string,
  messageId: number,
): Promise<SendResult> {
  if (!isPassiveReplyEnabled(channel)) {
    return {
      ok: false,
      error: '该公众号未开通客服消息权限，且未启用被动回复。请在渠道配置里打开「被动回复」。',
    };
  }
  if (deliverToPassiveSlot(channel.app_id, openid, content)) {
    // 正好有 webhook 在等 → 这条内容就是本次的被动回复，算真正送达
    await markMpSent(messageId, { passive_reply: true });
    return { ok: true, externalId: `mp-passive-${messageId}` };
  }
  const depth = await enqueuePendingReply(channel.app_id, openid, content, channel.pending_reply_max);
  await markMpSent(messageId, { pending_passive: true, pending_depth: depth }, false);
  return { ok: true, externalId: `mp-pending-${messageId}` };
}
