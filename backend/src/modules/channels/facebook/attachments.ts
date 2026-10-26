import { persistRemoteMediaUrl, type ChannelMedia, type ChannelMediaKind } from '../../../shared/services/channel-media.js';

export interface MessengerAttachment {
  type?: string;
  payload?: { url?: string; title?: string };
}

export interface MessengerMessage {
  mid?: string;
  text?: string;
  attachments?: MessengerAttachment[];
}

export function messengerAttachmentKind(type: string | undefined): ChannelMediaKind | null {
  const t = String(type || '').toLowerCase();
  if (t === 'image') return 'image';
  if (t === 'audio') return 'voice';
  if (t === 'video') return 'video';
  if (t === 'file') return 'file';
  return null;
}

export function messengerPlaceholder(kind: ChannelMediaKind): string {
  if (kind === 'image') return '[图片]';
  if (kind === 'voice') return '[语音]';
  if (kind === 'video') return '[视频]';
  return '[文件]';
}

export async function persistMessengerAttachment(
  att: MessengerAttachment,
): Promise<ChannelMedia | undefined> {
  const kind = messengerAttachmentKind(att.type);
  const url = att.payload?.url;
  if (!kind || !url) return undefined;
  try {
    const saved = await persistRemoteMediaUrl(url, {
      fileName: att.payload?.title
        || (kind === 'image' ? 'messenger-image.jpg'
          : kind === 'voice' ? 'messenger-audio'
            : kind === 'video' ? 'messenger-video.mp4'
              : 'messenger-file'),
    });
    return { ...saved, kind };
  } catch {
    return undefined;
  }
}

export const MESSENGER_WINDOW_MS = 24 * 60 * 60 * 1000;

export function nextMessengerWindowUntil(now = Date.now()): number {
  return now + MESSENGER_WINDOW_MS;
}

export function isMessengerWindowOpen(until: unknown, now = Date.now()): boolean {
  if (until == null || until === '') return true;
  const n = Number(until);
  return Number.isFinite(n) && n > now;
}
