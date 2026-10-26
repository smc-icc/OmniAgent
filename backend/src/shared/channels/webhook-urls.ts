import { getPublicBaseUrl } from '../services/public-base-url.js';

export { getPublicBaseUrl };

export function telegramWebhookUrl(botToken: string): string {
  return `${getPublicBaseUrl()}/webhooks/telegram/${encodeURIComponent(botToken)}`;
}

export function lineWebhookUrl(lineChannelId: string): string {
  return `${getPublicBaseUrl()}/webhooks/line/${encodeURIComponent(lineChannelId)}`;
}

export function whatsappWebhookUrl(phoneNumber: string): string {
  return `${getPublicBaseUrl()}/webhooks/whatsapp/${encodeURIComponent(phoneNumber)}`;
}

export function smsWebhookUrl(phoneNumber: string): string {
  return `${getPublicBaseUrl()}/webhooks/sms/${encodeURIComponent(phoneNumber)}`;
}

export function apiWebhookUrl(identifier: string): string {
  return `${getPublicBaseUrl()}/webhooks/api/${encodeURIComponent(identifier)}`;
}

export function weiboWebhookUrl(identifier: string): string {
  return `${getPublicBaseUrl()}/webhooks/weibo/${encodeURIComponent(identifier)}`;
}

export function miniprogramWebhookUrl(identifier: string): string {
  return `${getPublicBaseUrl()}/webhooks/miniprogram/${encodeURIComponent(identifier)}`;
}

export function instagramWebhookUrl(): string {
  return `${getPublicBaseUrl()}/webhooks/instagram`;
}

export function facebookWebhookUrl(): string {
  return `${getPublicBaseUrl()}/webhooks/facebook`;
}

export function tiktokWebhookUrl(): string {
  return `${getPublicBaseUrl()}/webhooks/tiktok`;
}

export function widgetScriptUrl(websiteToken: string): string {
  return `${getPublicBaseUrl()}/widget?website_token=${encodeURIComponent(websiteToken)}`;
}
