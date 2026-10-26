export const CHANNEL_TYPES = {
  WEB_WIDGET: 'Channel::WebWidget',
  API: 'Channel::Api',
  TELEGRAM: 'Channel::Telegram',
  LINE: 'Channel::Line',
  TWILIO_SMS: 'Channel::TwilioSms',
  SMS: 'Channel::Sms',
  EMAIL: 'Channel::Email',
  WHATSAPP: 'Channel::Whatsapp',
  FACEBOOK: 'Channel::FacebookPage',
  INSTAGRAM: 'Channel::Instagram',
  TIKTOK: 'Channel::Tiktok',
  WECHAT_MP: 'Channel::WechatMp',
  WECOM_KF: 'Channel::WecomKf',
  WECOM_CONTACT: 'Channel::WecomContact',
  WEIBO: 'Channel::Weibo',
  MINIPROGRAM: 'Channel::Miniprogram',
  VOICE: 'Channel::Voice',
} as const;

/** ConfServer omni-channels.json keys */
export type OmniChannelKey =
  | 'web_widget'
  | 'api'
  | 'telegram'
  | 'line'
  | 'twilio_sms'
  | 'sms'
  | 'email'
  | 'whatsapp'
  | 'facebook'
  | 'instagram'
  | 'tiktok'
  | 'wechat_mp'
  | 'wecom_kf'
  | 'wecom_contact'
  | 'weibo'
  | 'miniprogram';

export const OMNI_CHANNEL_KEYS: OmniChannelKey[] = [
  'web_widget',
  'api',
  'telegram',
  'line',
  'twilio_sms',
  'sms',
  'email',
  'whatsapp',
  'facebook',
  'instagram',
  'tiktok',
  'weibo',
  'miniprogram',
];

export const CHANNEL_KEY_TO_TYPE: Record<OmniChannelKey, string> = {
  web_widget: CHANNEL_TYPES.WEB_WIDGET,
  api: CHANNEL_TYPES.API,
  telegram: CHANNEL_TYPES.TELEGRAM,
  line: CHANNEL_TYPES.LINE,
  twilio_sms: CHANNEL_TYPES.TWILIO_SMS,
  sms: CHANNEL_TYPES.SMS,
  email: CHANNEL_TYPES.EMAIL,
  whatsapp: CHANNEL_TYPES.WHATSAPP,
  facebook: CHANNEL_TYPES.FACEBOOK,
  instagram: CHANNEL_TYPES.INSTAGRAM,
  tiktok: CHANNEL_TYPES.TIKTOK,
  wechat_mp: CHANNEL_TYPES.WECHAT_MP,
  wecom_kf: CHANNEL_TYPES.WECOM_KF,
  wecom_contact: CHANNEL_TYPES.WECOM_CONTACT,
  weibo: CHANNEL_TYPES.WEIBO,
  miniprogram: CHANNEL_TYPES.MINIPROGRAM,
};

export interface SyncResult {
  omni_channel_id: number;
  omni_inbox_id: number;
  webhook_url?: string;
  website_token?: string;
  widget_script_url?: string;
  extra?: Record<string, unknown>;
}
