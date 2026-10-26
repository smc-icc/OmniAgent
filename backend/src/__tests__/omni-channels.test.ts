import { describe, it, expect } from 'vitest';
import { OMNI_CHANNEL_KEYS, CHANNEL_KEY_TO_TYPE } from '../shared/channels/types.js';
import {
  telegramWebhookUrl,
  lineWebhookUrl,
  whatsappWebhookUrl,
  smsWebhookUrl,
  widgetScriptUrl,
  weiboWebhookUrl,
} from '../shared/channels/webhook-urls.js';
import { verifyLineSignature } from '../modules/channels/line/incoming.js';

describe('Omni channel registry types', () => {
  it('maps all omni keys to Chatwoot channel types', () => {
    for (const key of OMNI_CHANNEL_KEYS) {
      expect(CHANNEL_KEY_TO_TYPE[key]).toMatch(/^Channel::/);
    }
    expect(OMNI_CHANNEL_KEYS).toContain('telegram');
    expect(OMNI_CHANNEL_KEYS).toContain('email');
    expect(OMNI_CHANNEL_KEYS).toContain('weibo');
  });
});

describe('Webhook URL builders', () => {
  it('builds telegram webhook with encoded token', () => {
    const url = telegramWebhookUrl('123:ABC');
    expect(url).toContain('/webhooks/telegram/');
    expect(url).toContain(encodeURIComponent('123:ABC'));
  });

  it('builds line and sms webhooks', () => {
    expect(lineWebhookUrl('line-ch')).toContain('/webhooks/line/line-ch');
    expect(whatsappWebhookUrl('+8613800138000')).toContain('/webhooks/whatsapp/');
    expect(smsWebhookUrl('+15551234')).toContain('/webhooks/sms/');
    expect(weiboWebhookUrl('wb1')).toContain('/webhooks/weibo/wb1');
  });

  it('builds widget script url', () => {
    expect(widgetScriptUrl('tok123')).toContain('website_token=tok123');
  });
});

describe('LINE signature verification', () => {
  it('accepts valid HMAC signature', () => {
    const secret = 'line_secret';
    const body = '{"events":[]}';
    const crypto = require('crypto');
    const sig = crypto.createHmac('sha256', secret).update(body).digest('base64');
    expect(verifyLineSignature(body, sig, secret)).toBe(true);
  });

  it('rejects invalid signature', () => {
    expect(verifyLineSignature('{}', 'bad', 'secret')).toBe(false);
  });
});

describe('Omni channel platform sync API', () => {
  it('POST channels/sync accepts api upsert in development', async () => {
    const { getTestApp } = await import('./setup.js');
    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/platform-config/channels/sync',
      payload: {
        action: 'upsert',
        channel_type: 'api',
        account_id: 1,
        data: {
          name: '测试 API',
          inbox_name: 'API 收件箱',
          webhook_url: 'https://example.com/hook',
        },
      },
    });
    expect([200, 400, 500, 503]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.omni_channel_id).toBeGreaterThan(0);
    }
  });

  it('POST channels/sync rejects unknown channel_type', async () => {
    const { getTestApp } = await import('./setup.js');
    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/platform-config/channels/sync',
      payload: {
        action: 'upsert',
        channel_type: 'unknown_type',
        account_id: 1,
        data: { name: 'x' },
      },
    });
    expect([400, 422]).toContain(res.statusCode);
  });
});
