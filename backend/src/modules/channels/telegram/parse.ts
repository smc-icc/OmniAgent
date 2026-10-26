import type { ChannelMediaKind } from '../../../shared/services/channel-media.js';

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string; first_name?: string; username?: string };
  text?: string;
  caption?: string;
  from?: { id: number; first_name?: string; username?: string };
  photo?: Array<{ file_id: string; file_size?: number }>;
  document?: { file_id: string; file_name?: string; mime_type?: string };
  voice?: { file_id: string; mime_type?: string };
  audio?: { file_id: string; file_name?: string; mime_type?: string };
  video?: { file_id: string; file_name?: string; mime_type?: string };
  video_note?: { file_id: string };
  animation?: { file_id: string; file_name?: string; mime_type?: string };
  sticker?: { file_id: string; emoji?: string };
}

export interface TelegramInboundHint {
  kind: ChannelMediaKind;
  fileId: string;
  fileName?: string;
  contentType?: string;
  caption?: string;
}

export function extractTelegramInbound(msg: TelegramMessage): {
  content: string;
  hint?: TelegramInboundHint;
} | null {
  if (msg.chat.type !== 'private') return null;

  const caption = String(msg.caption ?? '').trim();
  if (msg.photo?.length) {
    const best = msg.photo[msg.photo.length - 1];
    return {
      content: caption || '[图片]',
      hint: {
        kind: 'image',
        fileId: best.file_id,
        fileName: 'telegram-photo.jpg',
        contentType: 'image/jpeg',
        caption: caption || undefined,
      },
    };
  }
  if (msg.voice) {
    return {
      content: caption || '[语音]',
      hint: {
        kind: 'voice',
        fileId: msg.voice.file_id,
        fileName: 'telegram-voice.ogg',
        contentType: msg.voice.mime_type || 'audio/ogg',
      },
    };
  }
  if (msg.audio) {
    return {
      content: caption || msg.audio.file_name || '[音频]',
      hint: {
        kind: 'voice',
        fileId: msg.audio.file_id,
        fileName: msg.audio.file_name || 'telegram-audio',
        contentType: msg.audio.mime_type,
        caption: caption || undefined,
      },
    };
  }
  if (msg.video || msg.video_note) {
    return {
      content: caption || '[视频]',
      hint: {
        kind: 'video',
        fileId: (msg.video ?? msg.video_note)!.file_id,
        fileName: msg.video?.file_name || 'telegram-video.mp4',
        contentType: msg.video?.mime_type || 'video/mp4',
        caption: caption || undefined,
      },
    };
  }
  if (msg.animation) {
    return {
      content: caption || '[动画]',
      hint: {
        kind: 'image',
        fileId: msg.animation.file_id,
        fileName: msg.animation.file_name || 'telegram-animation.gif',
        contentType: msg.animation.mime_type || 'image/gif',
        caption: caption || undefined,
      },
    };
  }
  if (msg.document) {
    return {
      content: caption || msg.document.file_name || '[文件]',
      hint: {
        kind: 'file',
        fileId: msg.document.file_id,
        fileName: msg.document.file_name || 'telegram-file',
        contentType: msg.document.mime_type,
        caption: caption || undefined,
      },
    };
  }
  if (msg.sticker) {
    return {
      content: msg.sticker.emoji ? `[贴纸] ${msg.sticker.emoji}` : '[贴纸]',
      hint: {
        kind: 'image',
        fileId: msg.sticker.file_id,
        fileName: 'telegram-sticker.webp',
        contentType: 'image/webp',
      },
    };
  }
  const text = String(msg.text ?? '').trim();
  if (!text) return null;
  return { content: text };
}
