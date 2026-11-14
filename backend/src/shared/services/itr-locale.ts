/** Supported visitor locale persisted with the conversation, never inferred from user text. */
export function conversationLocale(raw: unknown): 'zh' | 'en' {
  const attrs = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return /^en(?:[-_]|$)/i.test(String(attrs.locale ?? '').trim()) ? 'en' : 'zh';
}
