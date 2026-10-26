import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../../config/env.js';
import { signMediaUrl } from '../../modules/access/access.media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const MEDIA_UPLOAD_DIR = env.LOCAL_UPLOAD_DIR
  ?? path.join(__dirname, '../../../data/uploads');

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

/** 写入 messages.content_attributes 的统一媒体模型 */
export type ChannelMediaKind =
  | 'text'
  | 'image'
  | 'voice'
  | 'video'
  | 'file'
  | 'news'
  | 'location'
  | 'red_packet'
  | 'shake'
  | 'sms'
  | 'tts'
  | 'weibo';

export interface ChannelMedia {
  kind: ChannelMediaKind;
  file_url?: string;
  file_name?: string;
  content_type?: string;
  byte_size?: number;
  caption?: string;
  /** 语音 ASR；ITR 只用这个，不要把二进制路径喂给流程 */
  transcript?: string;
  external_media_id?: string;
}

const OMNI_INTERNAL_ONLY = new Set<string>(['red_packet', 'shake']);
const OUTBOUND_MEDIA_KINDS = new Set<string>(['image', 'voice', 'video', 'file']);
const TEXT_LIKE_KINDS = new Set<string>([
  'text',
  'news',
  'sms',
  'tts',
  'weibo',
  'ai_auto',
  'location',
  'bot',
]);

/** 已实现出站媒体的渠道。P1 国内；P3 海外 IM。 */
const OUTBOUND_MEDIA_SUPPORT: Record<string, ReadonlySet<string>> = {
  'Channel::WechatMp': new Set(['image', 'file', 'voice']),
  'Channel::WecomKf': new Set(['image', 'file', 'voice', 'video']),
  'Channel::Email': new Set(['image', 'file']),
  'Channel::Telegram': new Set(['image', 'file', 'voice', 'video']),
  'Channel::Line': new Set(['image', 'file', 'voice', 'video']),
  'Channel::Whatsapp': new Set(['image', 'file', 'voice', 'video']),
  'Channel::FacebookPage': new Set(['image', 'file', 'voice', 'video']),
  'Channel::Instagram': new Set(['image', 'file', 'voice', 'video']),
};

export function isOmniInternalOnlyKind(kind: string | undefined | null): boolean {
  return OMNI_INTERNAL_ONLY.has(String(kind || ''));
}

export function isOutboundMediaKind(kind: string | undefined | null): boolean {
  return OUTBOUND_MEDIA_KINDS.has(String(kind || ''));
}

export function channelSupportsOutboundMedia(channelType: string, kind: string): boolean {
  return OUTBOUND_MEDIA_SUPPORT[channelType]?.has(kind) === true;
}

export type OutgoingAction =
  | { action: 'skip'; reason: 'widget' | 'internal_only' | 'unknown_channel' }
  | { action: 'send_text' }
  | { action: 'send_media'; mediaKind: string }
  | { action: 'unsupported'; error: string };

/**
 * 出站分发决策。Widget 消息已在 Omni 内，不用再推平台。
 * 红包/抖动只留坐席台。媒体 kind 若该渠道还没有 send*，明确失败，禁止把 `[图片]` 当文本发出。
 */
export function resolveOutgoingAction(channelType: string, kind: string | undefined | null): OutgoingAction {
  const k = String(kind || 'text');
  if (isOmniInternalOnlyKind(k)) {
    return { action: 'skip', reason: 'internal_only' };
  }
  if (channelType === 'Channel::WebWidget') {
    return { action: 'skip', reason: 'widget' };
  }
  if (!channelType) {
    return { action: 'skip', reason: 'unknown_channel' };
  }
  if (isOutboundMediaKind(k)) {
    if (channelSupportsOutboundMedia(channelType, k)) {
      return { action: 'send_media', mediaKind: k };
    }
    return {
      action: 'unsupported',
      error: `channel ${channelType} does not support outbound ${k} yet`,
    };
  }
  if (TEXT_LIKE_KINDS.has(k) || !k) {
    return { action: 'send_text' };
  }
  return {
    action: 'unsupported',
    error: `channel ${channelType} does not support outbound ${k} yet`,
  };
}

export function mediaToContentAttributes(media: ChannelMedia): Record<string, unknown> {
  const out: Record<string, unknown> = { kind: media.kind };
  if (media.file_url) out.file_url = media.file_url;
  if (media.file_name) out.file_name = media.file_name;
  if (media.content_type) out.content_type = media.content_type;
  if (media.byte_size != null) out.byte_size = media.byte_size;
  if (media.caption) out.caption = media.caption;
  if (media.transcript) out.transcript = media.transcript;
  if (media.external_media_id) out.external_media_id = media.external_media_id;
  return out;
}

export function mediaFromContentAttributes(attrs: unknown): ChannelMedia | null {
  const a = (attrs ?? {}) as Record<string, unknown>;
  const kind = String(a.kind || '');
  if (!kind || kind === 'text') return null;
  return {
    kind: kind as ChannelMediaKind,
    file_url: a.file_url ? String(a.file_url) : undefined,
    file_name: a.file_name ? String(a.file_name) : undefined,
    content_type: a.content_type ? String(a.content_type) : undefined,
    byte_size: a.byte_size != null ? Number(a.byte_size) : undefined,
    caption: a.caption ? String(a.caption) : undefined,
    transcript: a.transcript ? String(a.transcript) : undefined,
    external_media_id: a.external_media_id ? String(a.external_media_id) : undefined,
  };
}

export function sanitizeMediaFilename(name: string): string {
  const base = path.basename(name || 'file');
  return base.replace(/[^\w.\-()+ ]/g, '_') || 'file';
}

export function toPublicMediaUrl(fileUrl: string): string {
  let u = String(fileUrl || '').trim();
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/uploads/')) u = signMediaUrl(u);
  const base = (env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!base) return u;
  return `${base}${u.startsWith('/') ? '' : '/'}${u}`;
}

/** LINE / Meta 出站要它们的服务器来拉文件，必须是公网 HTTPS。 */
export function requireHttpsMediaUrl(fileUrl: string): string | null {
  const abs = toPublicMediaUrl(fileUrl);
  return /^https:\/\//i.test(abs) ? abs : null;
}

export function isBlockedMediaHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) return true;
  if (host === '127.0.0.1' || host.startsWith('127.')) return true;
  if (host === '0.0.0.0') return true;
  if (host.startsWith('10.')) return true;
  if (host.startsWith('192.168.')) return true;
  if (host.startsWith('169.254.')) return true;
  const m = /^172\.(\d+)\./.exec(host);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

export async function persistMediaBuffer(
  body: Buffer,
  opts: { fileName?: string; contentType?: string },
): Promise<ChannelMedia> {
  if (body.length > MAX_MEDIA_BYTES) {
    throw new Error('media exceeds 20MB');
  }
  const safeName = sanitizeMediaFilename(opts.fileName || 'file');
  const key = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;
  await fs.mkdir(MEDIA_UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(MEDIA_UPLOAD_DIR, key), body);
  return {
    kind: 'file',
    file_url: `/uploads/${key}`,
    file_name: safeName,
    content_type: opts.contentType || 'application/octet-stream',
    byte_size: body.length,
  };
}

/**
 * 把渠道临时 URL（微信 PicUrl、Telegram getFile 等）转存到 Omni，避免过期后坐席打不开。
 * 拒绝内网/回环主机，避免 SSRF。
 */
export async function persistRemoteMediaUrl(
  url: string,
  opts?: {
    fileName?: string;
    contentType?: string;
    timeoutMs?: number;
    headers?: Record<string, string>;
  },
): Promise<ChannelMedia> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('invalid media url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('media url must be http(s)');
  }
  if (isBlockedMediaHost(parsed.hostname)) {
    throw new Error('media url host not allowed');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 15000);
  try {
    const res = await fetch(parsed.toString(), {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: opts?.headers,
    });
    if (!res.ok) throw new Error(`media download HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_MEDIA_BYTES) throw new Error('media exceeds 20MB');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_MEDIA_BYTES) throw new Error('media exceeds 20MB');
    const nameFromUrl = path.basename(parsed.pathname) || 'file';
    const contentType = opts?.contentType || res.headers.get('content-type') || undefined;
    return persistMediaBuffer(buf, {
      fileName: opts?.fileName || nameFromUrl,
      contentType,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function attachmentFileType(kind: string | undefined): number {
  return kind === 'image' ? 0 : 1;
}

export function resolveLocalMediaPath(fileUrl: string): string | null {
  const raw = String(fileUrl || '').trim();
  if (!raw) return null;
  let name = '';
  try {
    const u = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://local');
    const m = /\/uploads\/([^/?#]+)/.exec(u.pathname);
    if (m) name = m[1];
  } catch {
    const m = /\/uploads\/([^/?#]+)/.exec(raw);
    if (m) name = m[1];
  }
  if (!name) return null;
  return path.join(MEDIA_UPLOAD_DIR, sanitizeMediaFilename(name));
}

export async function readPersistedMedia(fileUrl: string): Promise<Buffer | null> {
  const local = resolveLocalMediaPath(fileUrl);
  if (local) {
    try {
      return await fs.readFile(local);
    } catch {
      /* fall through */
    }
  }
  if (/^https?:\/\//i.test(fileUrl)) {
    try {
      const persisted = await persistRemoteMediaUrl(fileUrl);
      const p = resolveLocalMediaPath(persisted.file_url || '');
      if (p) return await fs.readFile(p);
    } catch {
      return null;
    }
  }
  return null;
}
