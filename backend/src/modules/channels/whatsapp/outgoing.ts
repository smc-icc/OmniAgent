import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import {
  readPersistedMedia,
  requireHttpsMediaUrl,
  type ChannelMedia,
} from '../../../shared/services/channel-media.js';
import { isWhatsappCustomerWindowOpen, resolveWhatsappTemplate } from './window.js';

interface WhatsappCtx {
  token: string;
  phoneNumberId: string;
  to: string;
  windowUntil: unknown;
  cfg: Record<string, unknown>;
  templates: unknown;
}

async function loadWhatsappCtx(conversationId: number): Promise<WhatsappCtx | { error: string }> {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    include: { inbox: true },
  });
  if (!conv?.inbox || conv.inbox.channel_type !== CHANNEL_TYPES.WHATSAPP) {
    return { error: 'not whatsapp' };
  }

  const channel = await prisma.channel_whatsapp.findUnique({ where: { id: conv.inbox.channel_id } });
  if (!channel) return { error: 'channel not found' };

  const cfg = (channel.provider_config ?? {}) as Record<string, unknown>;
  const token = String(cfg.access_token ?? cfg.api_key ?? '');
  const phoneNumberId = String(cfg.phone_number_id ?? '');
  if (!token || !phoneNumberId) return { error: 'whatsapp token/phone_number_id missing' };

  const ci = await prisma.contact_inboxes.findFirst({
    where: { inbox_id: conv.inbox_id, contact_id: conv.contact_id ?? 0 },
  });
  if (!ci?.source_id) return { error: 'contact source_id missing' };

  const attrs = (conv.additional_attributes ?? {}) as Record<string, unknown>;
  return {
    token,
    phoneNumberId,
    to: ci.source_id,
    windowUntil: attrs.whatsapp_window_until,
    cfg,
    templates: channel.message_templates,
  };
}

async function graphSend(
  ctx: WhatsappCtx,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${ctx.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: ctx.to, ...payload }),
    });
    if (!res.ok) return { ok: false, error: await res.text() };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}

export async function sendWhatsappTemplate(
  conversationId: number,
  content?: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await loadWhatsappCtx(conversationId);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  const tpl = resolveWhatsappTemplate(ctx.cfg, ctx.templates);
  if (!tpl) {
    return {
      ok: false,
      error: 'WhatsApp 24h 会话窗已关闭，且未配置模板。请在 provider_config.template_name 填写已审核模板名',
    };
  }
  const template: Record<string, unknown> = {
    name: tpl.name,
    language: { code: tpl.language },
  };
  const body = String(content || '').trim();
  if (tpl.includeBody && body) {
    template.components = [{
      type: 'body',
      parameters: [{ type: 'text', text: body.slice(0, 1024) }],
    }];
  }
  return graphSend(ctx, { type: 'template', template });
}

export async function sendWhatsappText(
  conversationId: number,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await loadWhatsappCtx(conversationId);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  if (!isWhatsappCustomerWindowOpen(ctx.windowUntil)) {
    return sendWhatsappTemplate(conversationId, content);
  }
  return graphSend(ctx, { type: 'text', text: { body: content } });
}

function whatsappMediaType(kind: string): 'image' | 'audio' | 'video' | 'document' {
  if (kind === 'image') return 'image';
  if (kind === 'voice') return 'audio';
  if (kind === 'video') return 'video';
  return 'document';
}

async function uploadWhatsappMedia(
  ctx: WhatsappCtx,
  media: ChannelMedia,
): Promise<{ id: string } | { error: string }> {
  const buf = media.file_url ? await readPersistedMedia(media.file_url) : null;
  if (!buf) return { error: 'media file not found' };
  const type = whatsappMediaType(media.kind);
  try {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', type);
    form.append(
      'file',
      new Blob([new Uint8Array(buf)], { type: media.content_type || 'application/octet-stream' }),
      media.file_name || type,
    );
    const res = await fetch(`https://graph.facebook.com/v18.0/${ctx.phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.token}` },
      body: form,
    });
    const json = (await res.json()) as { id?: string; error?: { message?: string } };
    if (!res.ok || !json.id) {
      return { error: json.error?.message || `upload media HTTP ${res.status}` };
    }
    return { id: json.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'upload failed' };
  }
}

export async function sendWhatsappMedia(
  conversationId: number,
  media: ChannelMedia,
  caption?: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await loadWhatsappCtx(conversationId);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  if (!isWhatsappCustomerWindowOpen(ctx.windowUntil)) {
    return {
      ok: false,
      error: 'WhatsApp 24h 会话窗已关闭，不能发自由媒体；请先发已审核模板触达客户',
    };
  }

  const type = whatsappMediaType(media.kind);
  const text = (caption || media.caption || '').trim();
  const uploaded = await uploadWhatsappMedia(ctx, media);
  if ('id' in uploaded) {
    const body: Record<string, unknown> = { id: uploaded.id };
    if (text && type !== 'audio') body.caption = text;
    return graphSend(ctx, { type, [type]: body });
  }

  const link = media.file_url ? requireHttpsMediaUrl(media.file_url) : null;
  if (link) {
    const body: Record<string, unknown> = { link };
    if (text && type !== 'audio') body.caption = text;
    if (type === 'document' && media.file_name) body.filename = media.file_name;
    return graphSend(ctx, { type, [type]: body });
  }
  return { ok: false, error: uploaded.error };
}
