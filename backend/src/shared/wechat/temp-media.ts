/** 微信 / 企微临时素材：上传拿 media_id，下载拿 Buffer。 */

export type WechatTempMediaType = 'image' | 'voice' | 'video' | 'file';

export async function uploadWechatTempMedia(opts: {
  uploadUrl: string;
  type: WechatTempMediaType;
  body: Buffer;
  fileName: string;
  contentType?: string;
}): Promise<{ mediaId?: string; error?: string }> {
  const sep = opts.uploadUrl.includes('?') ? '&' : '?';
  const url = `${opts.uploadUrl}${sep}type=${encodeURIComponent(opts.type)}`;
  const form = new FormData();
  const blob = new Blob([opts.body], { type: opts.contentType || 'application/octet-stream' });
  form.append('media', blob, opts.fileName || 'file');
  try {
    const res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
    const data = (await res.json()) as { media_id?: string; errcode?: number; errmsg?: string };
    if (data.media_id) return { mediaId: data.media_id };
    return { error: data.errmsg ?? `errcode ${data.errcode ?? res.status}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'upload failed' };
  }
}

export async function downloadWechatTempMedia(downloadUrl: string): Promise<Buffer | null> {
  try {
    const res = await fetch(downloadUrl, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const ctype = res.headers.get('content-type') || '';
    if (ctype.includes('application/json')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 16 ? buf : null;
  } catch {
    return null;
  }
}

export function guessWechatMediaType(kind: string, contentType?: string): WechatTempMediaType {
  if (kind === 'voice') return 'voice';
  if (kind === 'video') return 'video';
  if (kind === 'image' || (contentType || '').startsWith('image/')) return 'image';
  return 'file';
}
