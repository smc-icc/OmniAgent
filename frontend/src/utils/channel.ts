/**
 * 渠道类型显示名。后端 channel_type 直接沿用 Chatwoot 的 Rails 类名（如 Channel::Email），
 * 不能直接展示给坐席，统一在此转成中文标签。
 */
const CHANNEL_LABELS: Record<string, string> = {
  'Channel::Api': 'API',
  'Channel::Email': '邮件',
  'Channel::FacebookPage': 'Facebook',
  'Channel::Instagram': 'Instagram',
  'Channel::Line': 'LINE',
  'Channel::Miniprogram': '小程序',
  'Channel::Sms': '短信',
  'Channel::Telegram': 'Telegram',
  'Channel::Tiktok': 'TikTok',
  'Channel::TwilioSms': '短信',
  'Channel::Voice': '语音',
  'Channel::WebWidget': '网页',
  'Channel::WechatMp': '微信公众号',
  'Channel::WecomContact': '企微客户',
  'Channel::WecomKf': '企微客服',
  'Channel::Weibo': '微博',
  'Channel::Whatsapp': 'WhatsApp',
}

export function channelLabel(channelType?: string | null): string {
  if (!channelType) return ''
  return CHANNEL_LABELS[channelType] ?? channelType.replace(/^Channel::/, '')
}
