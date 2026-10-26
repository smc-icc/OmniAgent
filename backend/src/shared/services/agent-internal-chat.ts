/**
 * 坐席间消息 / 班长小休申请：仅落 Omni 内存（不改 TARS）。
 * 按 userId → peerAgentId 分会话。
 */
export type InternalKind = 'im' | 'rest_request'

export type InternalMediaKind = 'image' | 'video' | 'file'

export type InternalMedia = {
  kind: InternalMediaKind
  file_url: string
  file_name?: string
  content_type?: string
  byte_size?: number
}

export type InternalMsg = {
  id: string
  fromAgentId: number
  text: string
  ts: number
  kind: InternalKind
  restStatus?: 'pending' | 'approved' | 'rejected'
  /** 申请时长（分钟），来自 AUXCode */
  restMinutes?: number
  media?: InternalMedia
}

export type InternalThread = {
  peerAgentId: number
  workNo: string
  name: string
  kind: InternalKind
  last: string
  unread: number
  messages: InternalMsg[]
}

const MEDIA_PREFIX = '__OMNI_MEDIA__'

export function parseInternalMediaText(text: string): { media?: InternalMedia; text: string; last: string } {
  const raw = String(text || '')
  if (!raw.startsWith(MEDIA_PREFIX)) {
    return { text: raw, last: raw }
  }
  const nl = raw.indexOf('\n')
  const jsonPart = nl >= 0 ? raw.slice(MEDIA_PREFIX.length, nl) : raw.slice(MEDIA_PREFIX.length)
  const caption = nl >= 0 ? raw.slice(nl + 1) : ''
  try {
    const o = JSON.parse(jsonPart) as { k?: string; u?: string; n?: string; t?: string; s?: number }
    const kind = o.k === 'image' || o.k === 'video' || o.k === 'file' ? o.k : null
    if (!kind || !o.u) return { text: raw, last: raw }
    const media: InternalMedia = {
      kind,
      file_url: o.u,
      file_name: o.n || undefined,
      content_type: o.t || undefined,
      byte_size: o.s || undefined,
    }
    const last =
      kind === 'image' ? '[图片]' : kind === 'video' ? '[视频]' : `[文件] ${media.file_name || ''}`.trim()
    return { media, text: caption || last, last }
  } catch {
    return { text: raw, last: raw }
  }
}

const byUser = new Map<number, Map<number, InternalThread>>()

function threadsOf(userId: number): Map<number, InternalThread> {
  let m = byUser.get(userId)
  if (!m) {
    m = new Map()
    byUser.set(userId, m)
  }
  return m
}

function nextId(): string {
  return `im-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function listInternalThreads(userId: number): InternalThread[] {
  return [...threadsOf(userId).values()].sort((a, b) => {
    const at = a.messages.at(-1)?.ts ?? 0
    const bt = b.messages.at(-1)?.ts ?? 0
    return bt - at
  })
}

export function getInternalThread(userId: number, peerAgentId: number): InternalThread | undefined {
  return threadsOf(userId).get(peerAgentId)
}

export function appendInternalMessage(
  userId: number,
  peer: { agentId: number; workNo: string; name: string },
  msg: Omit<InternalMsg, 'id'> & { id?: string },
  opts?: { unread?: boolean; kind?: InternalKind },
): InternalThread {
  const map = threadsOf(userId)
  let th = map.get(peer.agentId)
  if (!th) {
    th = {
      peerAgentId: peer.agentId,
      workNo: peer.workNo,
      name: peer.name || peer.workNo,
      kind: opts?.kind ?? msg.kind ?? 'im',
      last: '',
      unread: 0,
      messages: [],
    }
    map.set(peer.agentId, th)
  }
  if (opts?.kind) th.kind = opts.kind
  if (peer.workNo) th.workNo = peer.workNo
  if (peer.name) th.name = peer.name

  let text = msg.text
  let media = msg.media
  let last = msg.text
  if (!media) {
    const parsed = parseInternalMediaText(msg.text)
    media = parsed.media
    text = parsed.text
    last = parsed.last
  } else {
    last =
      media.kind === 'image'
        ? '[图片]'
        : media.kind === 'video'
          ? '[视频]'
          : `[文件] ${media.file_name || ''}`.trim()
    if (!text) text = last
  }

  const full: InternalMsg = {
    id: msg.id ?? nextId(),
    fromAgentId: msg.fromAgentId,
    text,
    ts: msg.ts,
    kind: msg.kind,
    restStatus: msg.restStatus,
    restMinutes: msg.restMinutes,
    media,
  }
  th.messages.push(full)
  th.last = last
  if (opts?.unread) th.unread += 1
  return th
}

export function markInternalRead(userId: number, peerAgentId: number): void {
  const th = threadsOf(userId).get(peerAgentId)
  if (th) th.unread = 0
}

export function updateRestStatus(
  userId: number,
  peerAgentId: number,
  status: 'approved' | 'rejected',
): InternalThread | undefined {
  const th = threadsOf(userId).get(peerAgentId)
  if (!th) return undefined
  for (let i = th.messages.length - 1; i >= 0; i--) {
    const m = th.messages[i]
    if (m.kind === 'rest_request' && m.restStatus === 'pending') {
      m.restStatus = status
      th.last = status === 'approved' ? '已同意小休' : '已拒绝小休'
      break
    }
  }
  return th
}
