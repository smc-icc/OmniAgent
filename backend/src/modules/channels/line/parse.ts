import type { ChannelMediaKind } from '../../../shared/services/channel-media.js';

export interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string; type?: string };
  message?: {
    type: string;
    id: string;
    text?: string;
    fileName?: string;
    fileSize?: number;
    duration?: number;
    title?: string;
    address?: string;
    stickerId?: string;
    packageId?: string;
  };
}

export function lineMessageKind(type: string): ChannelMediaKind | 'text' | 'skip' {
  const t = String(type || '').toLowerCase();
  if (t === 'text') return 'text';
  if (t === 'image' || t === 'sticker') return 'image';
  if (t === 'audio') return 'voice';
  if (t === 'video') return 'video';
  if (t === 'file') return 'file';
  if (t === 'location') return 'text';
  return 'skip';
}

export function lineMessageContent(ev: LineEvent): string {
  const msg = ev.message;
  if (!msg) return '';
  const type = String(msg.type || '').toLowerCase();
  if (type === 'text') return String(msg.text ?? '').trim();
  if (type === 'image') return '[图片]';
  if (type === 'audio') return '[语音]';
  if (type === 'video') return '[视频]';
  if (type === 'file') return msg.fileName ? `[文件] ${msg.fileName}` : '[文件]';
  if (type === 'sticker') return '[贴纸]';
  if (type === 'location') {
    const label = [msg.title, msg.address].filter(Boolean).join(' ');
    return label ? `[位置] ${label}` : '[位置]';
  }
  return '';
}
