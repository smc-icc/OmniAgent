export type ChannelGroup = 'media' | 'phone';

/**
 * 会话/客户列表行右侧的渠道图标标识。
 * 之前只有 4 种（wechat/web/weibo/phone），导致邮件、短信、API、小程序
 * 全部退化成「网页」图标，坐席根本分不清客户是从哪个渠道来的。
 */
export type ChannelSubtype =
  | 'wechat' // 微信公众号
  | 'wecom' // 企业微信（客服 / 客户联系）
  | 'miniprogram' // 小程序
  | 'web' // 网站 Widget
  | 'weibo' // 微博
  | 'email' // 邮件
  | 'sms' // 短信
  | 'api' // API / APP
  | 'social' // 其它社媒：Telegram / LINE / WhatsApp / Facebook / Instagram / TikTok
  | 'phone'; // 电话

const PHONE_CHANNEL_TYPES = new Set([
  'Channel::Voice',
  'voice',
]);

/** Chatwoot channel_type → OmniAgent 二分：仅 Voice 归电话，其余归多媒体 */
export function resolveChannelGroup(channelType: string | null | undefined): ChannelGroup {
  if (!channelType) return 'media';
  if (PHONE_CHANNEL_TYPES.has(channelType)) return 'phone';
  return 'media';
}

const SOCIAL_TYPES = [
  'telegram', 'line', 'whatsapp', 'facebook', 'instagram', 'tiktok',
];

/**
 * 会话行图标用细粒度 subtype（底部筛选仍用 channel_group）。
 * 判定优先看 channel_type（可靠），再用 inbox 名称兜底（历史数据里 name 更准）。
 */
export function resolveChannelSubtypes(
  channelType: string | null | undefined,
  inboxName?: string | null,
): ChannelSubtype[] {
  if (resolveChannelGroup(channelType) === 'phone') return ['phone'];

  const name = (inboxName ?? '').toLowerCase();
  const ct = (channelType ?? '').toLowerCase();

  // ── 按 channel_type 精确判定 ──
  if (ct.includes('wechatmp')) return ['wechat'];
  if (ct.includes('wecomkf') || ct.includes('wecomcontact')) return ['wecom'];
  if (ct.includes('miniprogram')) return ['miniprogram'];
  if (ct.includes('weibo')) return ['weibo'];
  if (ct.includes('twiliosms') || ct.includes('sms')) return ['sms'];
  if (ct.includes('email')) return ['email'];
  if (ct.includes('webwidget') || ct === 'web_widget') return ['web'];
  if (ct.includes('api')) return ['api'];
  if (SOCIAL_TYPES.some((t) => ct.includes(t))) return ['social'];

  // ── 名称兜底（老数据或自定义命名）──
  if (/微信|wechat/i.test(name)) return ['wechat'];
  if (/企业微信|企微|wecom/i.test(name)) return ['wecom'];
  if (/微博|weibo/i.test(name)) return ['weibo'];
  if (/邮件|邮箱|mail/i.test(name)) return ['email'];
  if (/短信|sms/i.test(name)) return ['sms'];

  return ['web'];
}

export function formatInboxSource(
  inboxName: string | null | undefined,
  channelType: string | null | undefined,
): string {
  if (inboxName?.trim()) return inboxName.trim();
  if (!channelType) return 'Web';
  if (resolveChannelGroup(channelType) === 'phone') return '电话';
  return '多媒体';
}
