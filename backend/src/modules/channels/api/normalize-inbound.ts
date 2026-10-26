import type { ApiInboundPayload } from './incoming.js';

function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return '';
  return String(v).trim();
}

function nested(v: unknown, ...keys: string[]): unknown {
  let cur: unknown = v;
  for (const k of keys) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** 兼容实验室 {from,content} 与微博开放平台评论/私信字段。 */
export function normalizeApiInbound(payload: Record<string, unknown> | null | undefined): ApiInboundPayload {
  const p = payload || {};
  const from =
    str(p.from) ||
    str(p.source_id) ||
    str(p.uid) ||
    str(p.user_id) ||
    str(p.sender_id) ||
    str(p.openid) ||
    str(nested(p, 'user', 'id')) ||
    str(nested(p, 'comment', 'user', 'id')) ||
    str(nested(p, 'sender', 'id'));
  const content =
    str(p.content) ||
    str(p.text) ||
    str(nested(p, 'text', 'content')) ||
    str(nested(p, 'comment', 'text')) ||
    str(nested(p, 'direct_message', 'text'));
  const name =
    str(p.name) ||
    str(nested(p, 'user', 'screen_name')) ||
    str(nested(p, 'comment', 'user', 'screen_name')) ||
    str(nested(p, 'sender', 'screen_name')) ||
    from;
  const messageId =
    str(p.message_id) ||
    str(p.id) ||
    str(p.mid) ||
    str(nested(p, 'comment', 'id')) ||
    str(nested(p, 'direct_message', 'id'));
  return {
    from,
    source_id: from,
    content,
    text: content,
    name,
    message_id: messageId || undefined,
    id: messageId || undefined,
  };
}
