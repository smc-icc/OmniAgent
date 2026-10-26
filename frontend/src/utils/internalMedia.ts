/** 坐席间多媒体：经 CCS 文本通道携带的媒体载荷。 */

export type InternalMediaKind = 'image' | 'video' | 'file'

export type InternalMedia = {
  kind: InternalMediaKind
  file_url: string
  file_name?: string
  content_type?: string
  byte_size?: number
}

const PREFIX = '__OMNI_MEDIA__'

export function encodeInternalMediaMessage(media: InternalMedia, caption = ''): string {
  const payload = JSON.stringify({
    k: media.kind,
    u: media.file_url,
    n: media.file_name || '',
    t: media.content_type || '',
    s: media.byte_size || 0,
  })
  const head = `${PREFIX}${payload}`
  const cap = caption.trim()
  return cap ? `${head}\n${cap}` : head
}

export function decodeInternalMediaMessage(text: string): {
  media?: InternalMedia
  text: string
} {
  const raw = String(text || '')
  if (!raw.startsWith(PREFIX)) return { text: raw }
  const nl = raw.indexOf('\n')
  const jsonPart = nl >= 0 ? raw.slice(PREFIX.length, nl) : raw.slice(PREFIX.length)
  const caption = nl >= 0 ? raw.slice(nl + 1) : ''
  try {
    const o = JSON.parse(jsonPart) as {
      k?: string
      u?: string
      n?: string
      t?: string
      s?: number
    }
    const kind = o.k === 'image' || o.k === 'video' || o.k === 'file' ? o.k : null
    if (!kind || !o.u) return { text: raw }
    return {
      media: {
        kind,
        file_url: o.u,
        file_name: o.n || undefined,
        content_type: o.t || undefined,
        byte_size: o.s || undefined,
      },
      text: caption,
    }
  } catch {
    return { text: raw }
  }
}

export function internalMediaLabel(media: InternalMedia): string {
  if (media.kind === 'image') return '[图片]'
  if (media.kind === 'video') return '[视频]'
  return `[文件] ${media.file_name || ''}`.trim()
}

export function guessInternalMediaKind(file: File): InternalMediaKind {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return 'file'
}
