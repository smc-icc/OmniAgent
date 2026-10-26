/** SIP visitor usernames are opaque identities; only MediaType indicates audio/video. */
const VISITOR = /^(?:voice|video)_[a-f0-9]{12,32}$/i
export function callPartyName(value: unknown, mediaType?: unknown): string {
  const name = String(value ?? '')
  if (!VISITOR.test(name)) return name
  if (mediaType === 1 || mediaType === '1') return '视频访客'
  if (mediaType === 0 || mediaType === '0') return '语音访客'
  return '网页访客'
}
export function callPartyCode(value: unknown): string {
  const code = String(value ?? '')
  return VISITOR.test(code) ? `访客ID ${code.slice(6, 14)}` : code
}
