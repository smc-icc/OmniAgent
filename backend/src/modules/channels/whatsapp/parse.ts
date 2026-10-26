import type { ChannelMediaKind } from '../../../shared/services/channel-media.js';

export interface WaInboundMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  image?: { id?: string; mime_type?: string; caption?: string; sha256?: string };
  audio?: { id?: string; mime_type?: string; voice?: boolean };
  video?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
  sticker?: { id?: string; mime_type?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
}

export interface WhatsappInboundHint {
  kind: ChannelMediaKind;
  mediaId: string;
  fileName?: string;
  contentType?: string;
  caption?: string;
}

export function extractWhatsappInbound(msg: WaInboundMessage): {
  content: string;
  hint?: WhatsappInboundHint;
} | null {
  const type = String(msg.type || '').toLowerCase();
  if (type === 'text') {
    const text = String(msg.text?.body ?? '').trim();
    return text ? { content: text } : null;
  }
  if (type === 'image' && msg.image?.id) {
    const caption = String(msg.image.caption ?? '').trim();
    return {
      content: caption || '[图片]',
      hint: {
        kind: 'image',
        mediaId: msg.image.id,
        fileName: 'whatsapp-image.jpg',
        contentType: msg.image.mime_type || 'image/jpeg',
        caption: caption || undefined,
      },
    };
  }
  if (type === 'audio' && msg.audio?.id) {
    return {
      content: '[语音]',
      hint: {
        kind: 'voice',
        mediaId: msg.audio.id,
        fileName: msg.audio.voice ? 'whatsapp-voice.ogg' : 'whatsapp-audio',
        contentType: msg.audio.mime_type,
      },
    };
  }
  if (type === 'video' && msg.video?.id) {
    const caption = String(msg.video.caption ?? '').trim();
    return {
      content: caption || '[视频]',
      hint: {
        kind: 'video',
        mediaId: msg.video.id,
        fileName: 'whatsapp-video.mp4',
        contentType: msg.video.mime_type || 'video/mp4',
        caption: caption || undefined,
      },
    };
  }
  if (type === 'document' && msg.document?.id) {
    const caption = String(msg.document.caption ?? '').trim();
    return {
      content: caption || msg.document.filename || '[文件]',
      hint: {
        kind: 'file',
        mediaId: msg.document.id,
        fileName: msg.document.filename || 'whatsapp-file',
        contentType: msg.document.mime_type,
        caption: caption || undefined,
      },
    };
  }
  if (type === 'sticker' && msg.sticker?.id) {
    return {
      content: '[贴纸]',
      hint: {
        kind: 'image',
        mediaId: msg.sticker.id,
        fileName: 'whatsapp-sticker.webp',
        contentType: msg.sticker.mime_type || 'image/webp',
      },
    };
  }
  if (type === 'location') {
    const label = [msg.location?.name, msg.location?.address].filter(Boolean).join(' ');
    return { content: label ? `[位置] ${label}` : '[位置]' };
  }
  return null;
}
