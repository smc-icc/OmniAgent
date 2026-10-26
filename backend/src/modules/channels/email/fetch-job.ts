import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { resolveInbox, processIncomingMessage, type ChannelIncomingHooks } from '../../../shared/services/channel-incoming.js';
import { persistMediaBuffer, type ChannelMedia } from '../../../shared/services/channel-media.js';

async function loadImapDeps() {
  try {
    const [{ ImapFlow }, { simpleParser }] = await Promise.all([
      import('imapflow'),
      import('mailparser'),
    ]);
    return { ImapFlow, simpleParser };
  } catch {
    return null;
  }
}

/**
 * 邮件正文取纯文本。
 * 优先 text/plain；只有 HTML 时剥掉 head/script/style 与标签后再用，
 * 否则会把 `<meta http-equiv="Content-Type" ...>` 之类的源码当成客户消息内容。
 */
function pickEmailText(parsed: { text?: string | null; html?: string | false | null }): string {
  const plain = typeof parsed.text === 'string' ? parsed.text.trim() : '';
  if (plain) return plain;

  const html = typeof parsed.html === 'string' ? parsed.html : '';
  if (!html) return '';
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 上一轮尚未跑完就跳过，避免同一账号并发 IMAP 连接（公共邮箱服务对此敏感） */
let polling = false;

export async function pollEmailInboxes(hooks: ChannelIncomingHooks): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    await pollEmailInboxesInner(hooks);
  } finally {
    polling = false;
  }
}

async function pollEmailInboxesInner(hooks: ChannelIncomingHooks): Promise<void> {
  const deps = await loadImapDeps();
  if (!deps) return;

  const { ImapFlow, simpleParser } = deps;
  const channels = await prisma.channel_email.findMany({
    where: { imap_enabled: true, imap_address: { not: '' } },
  });

  for (const ch of channels) {
    const inbox = await resolveInbox(CHANNEL_TYPES.EMAIL, ch.id);
    if (!inbox) continue;

    // imapflow 动态 import 下类型解析与运行时 API 不一致，这里放宽为 any。
    const client: any = new ImapFlow({
      host: ch.imap_address,
      port: ch.imap_port || 993,
      secure: ch.imap_enable_ssl,
      auth: { user: ch.imap_login, pass: ch.imap_password },
      logger: false,
      // 公共邮箱服务端响应偏慢，放宽超时（默认值容易在慢链路上直接 ETIMEOUT）
      socketTimeout: 120000,
      greetingTimeout: 60000,
    });

    // 关键：imapflow 用事件 emit 错误，try/catch 捕获不到；
    // 不挂 error 监听就会出现未捕获异常（容器日志里的 "Emitted 'error' event on ImapFlow"）。
    const asyncErrors: unknown[] = [];
    client.on('error', (e: unknown) => {
      asyncErrors.push(e);
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      const pending: Array<{ uid: number; source: Buffer }> = [];
      try {
        // 只取「未读」且「晚于渠道接入时间」的邮件：
        //  - seen:false  —— 已处理过的不会再进来
        //  - since       —— 渠道接入前的存量邮件（公共邮箱常有上千封未读）不算新咨询
        // 两个条件都由 IMAP 服务端过滤，代价与邮箱总量无关。
        //
        // 注意：必须先把邮件「收齐」再退出迭代。imapflow 的 fetch 是流式迭代，
        // 迭代期间再发其它 IMAP 命令会打断它 —— 这正是"只处理第一封就停"的原因。
        for await (const msg of client.fetch(
          { seen: false, since: ch.created_at },
          { source: true, uid: true },
        )) {
          if (msg.source) pending.push({ uid: msg.uid, source: msg.source });
        }

        // 收齐后立刻批量标记已读（很快）：避免下一轮重复拉取、避免被当成新咨询重放
        if (pending.length) {
          await client
            .messageFlagsAdd({ uid: pending.map((p) => p.uid) }, ['\\Seen'], { uid: true })
            .catch(() => {});
        }
      } finally {
        lock.release();
      }
      // 先断开 IMAP：后续逐封业务处理（DB + ITR 调用）很慢，
      // 继续持有连接会因 socket 长时间空闲触发 ETIMEOUT。
      await client.logout();

      // 业务处理（此时已不占用 IMAP 连接）
      for (const item of pending) {
        try {
          const parsed = await simpleParser(item.source) as {
            from?: { value?: Array<{ address?: string; name?: string }> };
            text?: string | null;
            html?: string | false | null;
            subject?: string;
            attachments?: Array<{ filename?: string | null; contentType?: string | null; content?: Buffer }>;
          };
          const from = parsed.from?.value?.[0]?.address;
          const text = pickEmailText(parsed);
          const atts = Array.isArray(parsed.attachments) ? parsed.attachments : [];
          if (!from || (!text && !atts.length)) continue;

          const firstMedia = atts[0] ? await persistEmailAttachment(atts[0]) : undefined;
          const body = (text || (firstMedia ? `[附件] ${firstMedia.file_name}` : '') || parsed.subject || '[邮件]').slice(0, 10000);

          await processIncomingMessage(
            {
              accountId: ch.account_id,
              inboxId: inbox.id,
              sourceId: from,
              contactName: parsed.from?.value?.[0]?.name ?? from,
              content: body,
              media: firstMedia,
              externalMessageId: `imap-${item.uid}`,
              contactPrefix: 'email',
            },
            hooks,
          );

          for (let i = 1; i < atts.length; i++) {
            const extra = await persistEmailAttachment(atts[i]);
            if (!extra) continue;
            await processIncomingMessage(
              {
                accountId: ch.account_id,
                inboxId: inbox.id,
                sourceId: from,
                contactName: parsed.from?.value?.[0]?.name ?? from,
                content: `[附件] ${extra.file_name}`,
                media: extra,
                externalMessageId: `imap-${item.uid}-att-${i}`,
                contactPrefix: 'email',
              },
              hooks,
            );
          }
        } catch (e) {
          console.warn(
            `[email-imap] 处理 uid=${item.uid} 失败：${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    } catch (e) {
      // 不要静默吞掉：IMAP 失败（凭据错误 / 网络 / 服务商限频）必须能从容器日志看见
      console.warn(
        `[email-imap] poll failed for ${ch.imap_login}@${ch.imap_address}: ${e instanceof Error ? e.message : String(e)}`,
      );
      await client.logout().catch(() => {});
    }

    if (asyncErrors.length) {
      const first = asyncErrors[0] as { message?: string } | undefined;
      console.warn(
        `[email-imap] ${ch.imap_login}@${ch.imap_address} 连接期间出现 ${asyncErrors.length} 次异步错误，首个：${first?.message ?? String(first)}`,
      );
    }
  }
}

async function persistEmailAttachment(att: {
  filename?: string | null;
  contentType?: string | null;
  content?: Buffer;
}): Promise<ChannelMedia | undefined> {
  if (!att?.content || !Buffer.isBuffer(att.content) || att.content.length < 1) return undefined;
  const ctype = String(att.contentType || 'application/octet-stream');
  const kind = ctype.startsWith('image/') ? 'image' : 'file';
  const saved = await persistMediaBuffer(att.content, {
    fileName: att.filename || (kind === 'image' ? 'email-image' : 'email-file'),
    contentType: ctype,
  });
  return { ...saved, kind };
}
