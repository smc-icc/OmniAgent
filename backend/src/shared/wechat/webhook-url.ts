import { CHANNEL_TYPES } from '../channels/types.js';
import { getPublicBaseUrl } from '../services/public-base-url.js';

export { CHANNEL_TYPES, getPublicBaseUrl };

export function wechatMpWebhookUrl(appId: string): string {
  return `${getPublicBaseUrl()}/webhooks/wechat/mp/${encodeURIComponent(appId)}`;
}

export function wecomKfWebhookUrl(channelId: number): string {
  return `${getPublicBaseUrl()}/webhooks/wecom/kf/${channelId}`;
}

export function wecomContactWebhookUrl(channelId: number): string {
  return `${getPublicBaseUrl()}/webhooks/wecom/contact/${channelId}`;
}

/** 网页授权回调（state=conversationId） */
export function wechatOauthCallbackUrl(): string {
  return `${getPublicBaseUrl()}/webhooks/wechat/oauth`;
}
