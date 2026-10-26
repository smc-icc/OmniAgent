import type { FastifyInstance } from 'fastify';
import { prisma } from '../../plugins/db.js';
import { parseWeChatXml } from '../../shared/wechat/xml.js';
import { decryptWeChatMessage } from '../../shared/wechat/crypto.js';
import { resolveInbox, processIncomingMessage } from '../../shared/services/channel-incoming.js';
import { CHANNEL_TYPES } from '../../shared/wechat/webhook-url.js';
import { getWecomAccessToken } from '../../shared/services/wechat-token-cache.js';
import { fetchWecomKfCustomerDisplayName } from '../../shared/services/wechat-user-profile.js';
import { persistMediaBuffer, type ChannelMedia } from '../../shared/services/channel-media.js';
import { downloadWechatTempMedia } from '../../shared/wechat/temp-media.js';

/**
 * 同一渠道的拉取必须串行。
 *
 * 企业微信会用多个 kf_msg_or_event 几乎同时通知我们，而 sync_msg 的游标存在 Redis 里：
 * 两个请求同时读到同一个旧游标，就会分别拉回同一批消息（企业微信每次分配的 msgid 不同，
 * 按 msgid 去重拦不住），客户于是收到两套欢迎语+菜单。
 * 用「渠道 id → 上一次拉取的 Promise」做单飞，保证同一渠道同一时刻只有一次拉取在跑。
 */
const kfSyncInFlight = new Map<number, Promise<void>>();

function runExclusive(channelId: number, task: () => Promise<void>): Promise<void> {
  const running = kfSyncInFlight.get(channelId);
  if (running) return running; // 已有拉取在跑：它拉完会带上这批消息，直接复用
  const p = task().finally(() => {
    if (kfSyncInFlight.get(channelId) === p) kfSyncInFlight.delete(channelId);
  });
  kfSyncInFlight.set(channelId, p);
  return p;
}

interface WecomXml {
  ToUserName?: string;
  FromUserName?: string;
  CreateTime?: string | number;
  MsgType?: string;
  Event?: string;
  Token?: string;
  OpenKfId?: string;
  Encrypt?: string;
}

interface KfSyncMsg {
  msgid?: string;
  open_kfid?: string;
  external_userid?: string;
  send_time?: number;
  origin?: number;
  msgtype?: string;
  text?: { content?: string };
  image?: { media_id?: string };
  voice?: { media_id?: string };
  video?: { media_id?: string };
  file?: { media_id?: string; filename?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  link?: { title?: string; desc?: string; url?: string; pic_url?: string };
}

export async function parseWecomWebhookBody(
  rawBody: string,
  channel: { corp_id: string; encoding_aes_key: string | null },
  query: Record<string, string>,
): Promise<string> {
  if (channel.encoding_aes_key && query.msg_signature) {
    const parsed = parseWeChatXml<{ xml: WecomXml }>(rawBody);
    const encrypt = parsed.xml?.Encrypt ?? (parsed as unknown as WecomXml).Encrypt;
    if (encrypt) {
      return decryptWeChatMessage(channel.encoding_aes_key, channel.corp_id, encrypt);
    }
  }
  return rawBody;
}

export async function syncKfMessages(
  channelId: number,
  server: FastifyInstance,
): Promise<void> {
  // 串行化入口：并发通知只跑一次拉取，避免同一批消息被消费两遍。
  return runExclusive(channelId, () => doSyncKfMessages(channelId, server));
}

async function doSyncKfMessages(
  channelId: number,
  server: FastifyInstance,
): Promise<void> {
  const channel = await prisma.channel_wecom_kf.findUnique({ where: { id: channelId } });
  if (!channel) return;

  const inbox = await resolveInbox(CHANNEL_TYPES.WECOM_KF, channel.id);
  if (!inbox) return;

  const token = await getWecomAccessToken(channel.corp_id, channel.secret);
  const cursorKey = `wecom:kf:cursor:${channelId}`;
  let cursor = '';
  try {
    const { redis } = await import('../../plugins/redis.js');
    cursor = (await redis.get(cursorKey)) ?? '';
  } catch { /* */ }

  // 必须带超时：syncKfMessages 用 runExclusive 做单飞（同一渠道的拉取串行），
  // 一旦这个 fetch 永久挂起，kfSyncInFlight 会一直持有那个 Promise，
  // 后续所有 kf_msg_or_event 回调都被“复用”到它上面、再也不拉消息，
  // 而且不产生任何日志 —— 症状正是「企微客服发消息一点反应没有」。
  const res = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cursor,
        limit: 100,
        open_kfid: channel.open_kfid ?? undefined,
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  const data = (await res.json()) as {
    errcode?: number;
    errmsg?: string;
    next_cursor?: string;
    msg_list?: KfSyncMsg[];
  };
  if (data.errcode && data.errcode !== 0) {
    server.log.warn({ errcode: data.errcode, errmsg: data.errmsg }, 'WeCom KF sync_msg failed');
    return;
  }

  if (data.next_cursor) {
    try {
      const { redis } = await import('../../plugins/redis.js');
      await redis.set(cursorKey, data.next_cursor);
    } catch { /* */ }
  }

  for (const item of data.msg_list ?? []) {
    if (item.origin !== 3) continue;
    const parsed = await parseKfCustomerMessage(item, token);
    if (!parsed) continue;
    const externalUserId = item.external_userid;
    if (!externalUserId) continue;

    const contactName = await fetchWecomKfCustomerDisplayName(
      channel.corp_id,
      channel.secret,
      externalUserId,
    );

    await processIncomingMessage(
      {
        accountId: inbox.account_id,
        inboxId: inbox.id,
        sourceId: externalUserId,
        contactName,
        content: parsed.content,
        media: parsed.media,
        externalMessageId: item.msgid,
        conversationAttributes: {
          wecom_kf_external_userid: externalUserId,
          wecom_kf_open_kfid: item.open_kfid ?? channel.open_kfid,
        },
      },
      {
        emitToAccount: server.emitToAccount.bind(server),
        enqueue: server.enqueue.bind(server),
      },
    );
  }
}

async function parseKfCustomerMessage(
  item: KfSyncMsg,
  accessToken: string,
): Promise<{ content: string; media?: ChannelMedia } | null> {
  const type = String(item.msgtype || '');
  if (type === 'text') {
    const content = item.text?.content?.trim();
    return content ? { content } : null;
  }
  if (type === 'location') {
    const name = item.location?.name || item.location?.address || '';
    return { content: name ? `[位置] ${name}` : '[位置消息]' };
  }
  if (type === 'link') {
    const title = item.link?.title || item.link?.url || '';
    return { content: title ? `[链接] ${title}` : '[链接消息]' };
  }

  const mediaId =
    item.image?.media_id || item.voice?.media_id || item.video?.media_id || item.file?.media_id || '';
  if (!mediaId || !['image', 'voice', 'video', 'file'].includes(type)) return null;

  const buf = await downloadWechatTempMedia(
    `https://qyapi.weixin.qq.com/cgi-bin/media/get?access_token=${accessToken}&media_id=${encodeURIComponent(mediaId)}`,
  );
  if (!buf) {
    return { content: type === 'image' ? '[图片消息]' : type === 'voice' ? '[语音消息]' : type === 'video' ? '[视频消息]' : '[文件消息]' };
  }

  const fileName =
    item.file?.filename
    || (type === 'image' ? 'wecom-image.jpg' : type === 'voice' ? 'wecom-voice.amr' : type === 'video' ? 'wecom-video.mp4' : 'wecom-file.bin');
  const contentType =
    type === 'image' ? 'image/jpeg' : type === 'voice' ? 'audio/amr' : type === 'video' ? 'video/mp4' : 'application/octet-stream';
  const saved = await persistMediaBuffer(buf, { fileName, contentType });
  const media: ChannelMedia = { ...saved, kind: type as ChannelMedia['kind'], external_media_id: mediaId };

  if (type === 'voice') {
    try {
      const { transcribeWavBuffer } = await import('../../shared/services/funasr-asr.js');
      const spoken = await transcribeWavBuffer(buf);
      if (spoken) media.transcript = spoken;
    } catch { /* keep audio */ }
  }

  const content = media.transcript
    || (type === 'image' ? '[图片]' : type === 'voice' ? '[语音]' : type === 'video' ? '[视频]' : `[文件] ${fileName}`);
  return { content, media };
}

export async function handleKfCallbackEvent(
  channelId: number,
  xml: string,
  server: FastifyInstance,
): Promise<void> {
  const msg = parseWeChatXml<WecomXml>(xml);
  if (msg.Event === 'kf_msg_or_event') {
    await syncKfMessages(channelId, server);
    return;
  }
  // 客户联系事件也会推到这个口子。
  //
  // 企微的「微信客服」没有独立的接收事件服务器，必须挂在**自建应用**的
  // 「接收消息」上；而那个自建应用同时承载客户联系，于是
  // change_external_contact 与 kf_msg_or_event 走的是同一个 URL。
  // 之前这里只认 kf_msg_or_event，客户事件就被静默丢掉了 ——
  // 「配好了却一条事件都收不到」就是这个原因。
  //
  // 按 corp_id 找到对应的 wecom_contact 渠道，交给客户联系自己的处理逻辑；
  // 没配的话只记一条告警，不影响微信客服。
  if (msg.Event === 'change_external_contact') {
    const kfChannel = await prisma.channel_wecom_kf.findUnique({
      where: { id: channelId },
      select: { corp_id: true },
    });
    if (kfChannel) {
      const contactChannel = await prisma.channel_wecom_contact.findFirst({
        where: { corp_id: kfChannel.corp_id },
        select: { id: true },
      });
      if (contactChannel) {
        const { handleContactIncoming } = await import('./wecom-contact.incoming.js');
        await handleContactIncoming(contactChannel.id, xml, server);
      } else {
        server.log.warn(
          { channelId, corpId: kfChannel.corp_id },
          'WeCom contact event received but no wecom_contact channel for this corp_id',
        );
      }
    }
  }
}
