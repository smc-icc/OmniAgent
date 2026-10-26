import { describe, it, expect } from 'vitest';
import { applySensitiveFilter, normalizeOmniOps, DEFAULT_OMNI_OPS } from '../shared/services/omni-ops.js';
import { signApiPayload, verifyApiHmac, canonicalJsonBody } from '../modules/channels/api/hmac.js';
import { normalizeApiInbound } from '../modules/channels/api/normalize-inbound.js';
import { miniprogramWebhookUrl, apiWebhookUrl } from '../shared/channels/webhook-urls.js';
import { CHANNEL_TYPES, OMNI_CHANNEL_KEYS } from '../shared/channels/types.js';

describe('omni ops sensitive filter', () => {
  it('masks hits', () => {
    const ops = normalizeOmniOps({ sensitive_words: ['投诉315'], sensitive_mode: 'mask' });
    const r = applySensitiveFilter('我要投诉315曝光', ops);
    expect(r.hit).toBe(true);
    expect(r.blocked).toBe(false);
    expect(r.text.includes('投诉315')).toBe(false);
  });

  it('blocks hits', () => {
    const ops = normalizeOmniOps({ sensitive_words: ['曝光'], sensitive_mode: 'block' });
    const r = applySensitiveFilter('要曝光', ops);
    expect(r.blocked).toBe(true);
    expect(r.text).toContain('拦截');
  });

  it('fills defaults', () => {
    const ops = normalizeOmniOps({});
    expect(ops.connect_tip).toBe(DEFAULT_OMNI_OPS.connect_tip);
    expect(ops.sensitive_mode).toBe('mask');
  });
});

describe('API HMAC', () => {
  it('signs and verifies', () => {
    const body = canonicalJsonBody({ from: 'u1', content: 'hi' });
    const sig = signApiPayload('secret', body);
    expect(verifyApiHmac('secret', body, sig)).toBe(true);
    expect(verifyApiHmac('secret', body, 'ab')).toBe(false);
    expect(verifyApiHmac('secret', body, 'sha256=' + sig)).toBe(true);
  });
});

describe('inbound normalize', () => {
  it('maps weibo comment payload', () => {
    const n = normalizeApiInbound({
      comment: { id: 'c1', text: '求售后', user: { id: 88, screen_name: '微博用户' } },
    });
    expect(n.from).toBe('88');
    expect(n.content).toBe('求售后');
    expect(n.name).toBe('微博用户');
    expect(n.message_id).toBe('c1');
  });

  it('keeps lab from/content', () => {
    const n = normalizeApiInbound({ from: 'a1', content: 'hello' });
    expect(n.from).toBe('a1');
    expect(n.content).toBe('hello');
  });
});

describe('miniprogram channel registry', () => {
  it('registers miniprogram type and webhook', () => {
    expect(OMNI_CHANNEL_KEYS).toContain('miniprogram');
    expect(CHANNEL_TYPES.MINIPROGRAM).toBe('Channel::Miniprogram');
    expect(miniprogramWebhookUrl('mp01')).toContain('/webhooks/miniprogram/mp01');
    expect(apiWebhookUrl('x')).toContain('/webhooks/api/x');
  });
});

describe('asr transcript extract', () => {
  it('reads TARS FunASR payload segments', async () => {
    const { extractAsrTranscript } = await import('../shared/services/funasr-asr.js');
    expect(extractAsrTranscript({
      engine: 'funasr',
      segments: [{ role: 'customer', text: '转人工' }],
    })).toBe('转人工');
  });
});
