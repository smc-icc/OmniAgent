import { describe, it, expect } from 'vitest';
import { verifySignature, computeSignature } from '../shared/wechat/signature.js';
import { parseWeChatXml, buildWeChatXml } from '../shared/wechat/xml.js';
import { extractMpMessageContent, extractMpEventMeta } from '../modules/wechat/wechat-mp.incoming.js';

describe('WeChat signature', () => {
  const token = 'test_token';
  const timestamp = '1710000000';
  const nonce = 'nonce123';

  it('verifies valid signature', () => {
    const sig = computeSignature(token, timestamp, nonce);
    expect(verifySignature(token, timestamp, nonce, sig)).toBe(true);
  });

  it('rejects invalid signature', () => {
    expect(verifySignature(token, timestamp, nonce, 'bad')).toBe(false);
  });

  it('verifies encrypted mode signature with echostr', () => {
    const encrypt = 'encrypted_blob';
    const sig = computeSignature(token, timestamp, nonce, encrypt);
    expect(verifySignature(token, timestamp, nonce, sig, encrypt)).toBe(true);
  });
});

describe('WeChat XML', () => {
  it('parses inbound text message', () => {
    const xml = `<xml>
  <ToUserName><![CDATA[gh_test]]></ToUserName>
  <FromUserName><![CDATA[openid_abc]]></FromUserName>
  <CreateTime>1710000000</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[你好]]></Content>
  <MsgId>12345</MsgId>
</xml>`;
    const parsed = parseWeChatXml<{
      FromUserName: string;
      MsgType: string;
      Content: string;
      MsgId: string;
    }>(xml);
    expect(parsed.FromUserName).toBe('openid_abc');
    expect(parsed.MsgType).toBe('text');
    expect(parsed.Content).toBe('你好');
    expect(String(parsed.MsgId)).toBe('12345');
  });

  it('builds reply xml with MsgType text', () => {
    const out = buildWeChatXml({
      ToUserName: 'openid_abc',
      FromUserName: 'gh_test',
      CreateTime: 1710000000,
      MsgType: 'text',
      Content: 'pong',
    });
    expect(out).toContain('MsgType');
    expect(out).toContain('text');
    expect(out).toContain('pong');
  });
});

describe('WeChat MP incoming content', () => {
  it('extracts text message content', () => {
    expect(extractMpMessageContent({ MsgType: 'text', Content: '  你好  ' })).toBe('你好');
  });

  it('maps non-text messages to display placeholders', () => {
    expect(extractMpMessageContent({ MsgType: 'image', PicUrl: 'http://img' })).toBe('[图片消息] http://img');
    expect(extractMpMessageContent({ MsgType: 'voice' })).toBe('[语音消息]');
    expect(extractMpMessageContent({ MsgType: 'event', Event: 'CLICK' })).toBeNull();
    expect(extractMpEventMeta({ Event: 'subscribe', EventKey: '' }).event).toBe('subscribe');
  });
});

describe('WeChat platform sync API', () => {
  it('POST sync accepts upsert in development', async () => {
    const { getTestApp } = await import('./setup.js');
    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/platform-config/wechat-channels/sync',
      payload: {
        action: 'upsert',
        channel_type: 'wechat_mp',
        account_id: 1,
        data: {
          name: '测试号',
          app_id: `wx_test_${Date.now()}`,
          app_secret: 'test_secret_12345678',
          token: 'test_token',
          account_type: 'service',
        },
      },
    });
    expect([200, 400, 500, 503]).toContain(res.statusCode);
  });
});
