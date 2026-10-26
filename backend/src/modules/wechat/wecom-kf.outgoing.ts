import { prisma } from '../../plugins/db.js';
import { getWecomAccessToken } from '../../shared/services/wechat-token-cache.js';
import { CHANNEL_TYPES } from '../../shared/wechat/webhook-url.js';
import { emojiToWechatFace } from '../../shared/wechat/faces.js';
import { guessWechatMediaType, uploadWechatTempMedia } from '../../shared/wechat/temp-media.js';
import { readPersistedMedia, type ChannelMedia } from '../../shared/services/channel-media.js';

export async function sendWecomKfText(
  conversationId: number,
  messageId: number,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    include: { inbox: true },
  });
  if (!conv?.inbox || conv.inbox.channel_type !== CHANNEL_TYPES.WECOM_KF) {
    return { ok: false, error: 'Not a WeCom KF conversation' };
  }

  const channel = await prisma.channel_wecom_kf.findUnique({
    where: { id: conv.inbox.channel_id },
  });
  if (!channel) return { ok: false, error: 'Channel not found' };

  const attrs = (conv.additional_attributes ?? {}) as Record<string, unknown>;
  const externalUserId = attrs.wecom_kf_external_userid as string | undefined;
  const openKfid = (attrs.wecom_kf_open_kfid as string | undefined) ?? channel.open_kfid;
  if (!externalUserId || !openKfid) {
    return { ok: false, error: 'Missing external_userid or open_kfid' };
  }

  try {
    const token = await getWecomAccessToken(channel.corp_id, channel.secret);
    const res = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: externalUserId,
          open_kfid: openKfid,
          msgtype: 'text',
          text: { content: emojiToWechatFace(content) },
        }),
      },
    );
    const data = (await res.json()) as { errcode?: number; errmsg?: string; msgid?: string };
    if (data.errcode && data.errcode !== 0) {
      return { ok: false, error: data.errmsg ?? `errcode ${data.errcode}` };
    }

    await markKfSent(messageId, data.msgid, {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Send failed' };
  }
}

export async function sendWecomKfMedia(
  conversationId: number,
  messageId: number,
  media: ChannelMedia,
): Promise<{ ok: boolean; error?: string }> {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    include: { inbox: true },
  });
  if (!conv?.inbox || conv.inbox.channel_type !== CHANNEL_TYPES.WECOM_KF) {
    return { ok: false, error: 'Not a WeCom KF conversation' };
  }
  const channel = await prisma.channel_wecom_kf.findUnique({
    where: { id: conv.inbox.channel_id },
  });
  if (!channel) return { ok: false, error: 'Channel not found' };
  const attrs = (conv.additional_attributes ?? {}) as Record<string, unknown>;
  const externalUserId = attrs.wecom_kf_external_userid as string | undefined;
  const openKfid = (attrs.wecom_kf_open_kfid as string | undefined) ?? channel.open_kfid;
  if (!externalUserId || !openKfid) {
    return { ok: false, error: 'Missing external_userid or open_kfid' };
  }

  const buf = media.file_url ? await readPersistedMedia(media.file_url) : null;
  if (!buf) return { ok: false, error: 'media file not found' };

  const wxType = guessWechatMediaType(media.kind, media.content_type);
  try {
    const token = await getWecomAccessToken(channel.corp_id, channel.secret);
    const uploaded = await uploadWechatTempMedia({
      uploadUrl: `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${token}`,
      type: wxType,
      body: buf,
      fileName: media.file_name || 'file',
      contentType: media.content_type,
    });
    if (!uploaded.mediaId) return { ok: false, error: uploaded.error || 'upload media failed' };

    const body: Record<string, unknown> = {
      touser: externalUserId,
      open_kfid: openKfid,
      msgtype: wxType,
    };
    if (wxType === 'image') body.image = { media_id: uploaded.mediaId };
    else if (wxType === 'voice') body.voice = { media_id: uploaded.mediaId };
    else if (wxType === 'video') body.video = { media_id: uploaded.mediaId };
    else body.file = { media_id: uploaded.mediaId };

    const res = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const data = (await res.json()) as { errcode?: number; errmsg?: string; msgid?: string };
    if (data.errcode && data.errcode !== 0) {
      return { ok: false, error: data.errmsg ?? `errcode ${data.errcode}` };
    }
    await markKfSent(messageId, data.msgid, { kind: media.kind, channel_media_id: uploaded.mediaId });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Send failed' };
  }
}

async function markKfSent(messageId: number, msgid: string | undefined, extra: Record<string, unknown>) {
  const msg = await prisma.messages.findUnique({
    where: { id: messageId },
    select: { content_attributes: true },
  });
  const prev = (msg?.content_attributes ?? {}) as Record<string, unknown>;
  await prisma.messages.update({
    where: { id: messageId },
    data: {
      source_id: msgid ?? undefined,
      content_attributes: {
        ...prev,
        ...extra,
        channel_sent: true,
        channel: 'wecom_kf',
      } as object,
    },
  });
}
