/** ConfServer → Omni 坐席邮箱约定（纯函数，便于单测） */

export function isValidSyncEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** 配置台里的通讯邮箱。没有合法邮箱就留空，不再造工号@域名 充当登录名。 */
export function resolveSyncEmail(_workNo: string, email?: string | null): string | null {
  const e = String(email ?? '').trim();
  if (e && isValidSyncEmail(e)) return e.toLowerCase();
  return null;
}
