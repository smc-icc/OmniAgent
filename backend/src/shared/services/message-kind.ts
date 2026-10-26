export type RichMessageKind =
  | 'text'
  | 'image'
  | 'voice'
  | 'video'
  | 'file'
  | 'red_packet'
  | 'shake'
  | 'ai_auto'
  | 'news'
  | 'sms'
  | 'tts'
  | 'weibo';

const RICH_KINDS = new Set<string>([
  'image',
  'voice',
  'video',
  'file',
  'red_packet',
  'shake',
  'ai_auto',
  'news',
  'sms',
  'sms_outbound',
  'tts',
  'weibo',
]);

export function mapContentAttributesToKind(
  contentAttributes: unknown,
  messageType: number,
): RichMessageKind {
  const attrs = (contentAttributes ?? {}) as Record<string, unknown>;
  const kind = attrs.kind as string | undefined;
  if (kind && RICH_KINDS.has(kind)) {
    return kind === 'sms_outbound' ? 'sms' : (kind as RichMessageKind);
  }
  if (messageType === 2) return 'text';
  return 'text';
}

export function fileExtension(name: string): string | null {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : null;
}
