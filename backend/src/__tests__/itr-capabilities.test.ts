import { describe, it, expect } from 'vitest';
import { isSafeSelectSql } from '../shared/services/itr-sql.js';
import { matchFaqArticles, wantsStaffTransfer, formatFaqReply } from '../shared/services/itr-robot.js';
import { weiboWebhookUrl, apiWebhookUrl } from '../shared/channels/webhook-urls.js';
import { CHANNEL_TYPES } from '../shared/channels/types.js';
import { pickItrFlowId } from '../modules/itr/itr-flow-pick.js';
import { deriveItrWsUrl } from '../integrations/itr/itr-observe-url.js';

describe('ITR SQL guard', () => {
  it('allows a single SELECT', () => {
    const r = isSafeSelectSql('SELECT ID, Name FROM t_user_group WHERE VDNID=1');
    expect(r.ok).toBe(true);
  });

  it('blocks writes and multi-statement', () => {
    expect(isSafeSelectSql('DELETE FROM t_user_group').ok).toBe(false);
    expect(isSafeSelectSql('SELECT 1; DROP TABLE x').ok).toBe(false);
    expect(isSafeSelectSql('UPDATE t SET a=1').ok).toBe(false);
  });
});

describe('ITR robot FAQ', () => {
  it('detects staff transfer intent', () => {
    expect(wantsStaffTransfer('转人工')).toBe(true);
    expect(wantsStaffTransfer('保修政策')).toBe(false);
  });

  it('matches articles by keyword', () => {
    const hit = matchFaqArticles('怎么转人工', [
      { title: '如何转人工坐席', description: '回复人工', content: '走 ACD 排队' },
      { title: '保修', content: '一年保修' },
    ]);
    expect(hit?.title).toContain('转人工');
    expect(formatFaqReply(hit!).includes('ACD')).toBe(true);
  });
});

describe('Weibo / API webhook URLs', () => {
  it('builds inbound paths', () => {
    expect(apiWebhookUrl('abc123')).toContain('/webhooks/api/abc123');
    expect(weiboWebhookUrl('wb01')).toContain('/webhooks/weibo/wb01');
    expect(CHANNEL_TYPES.WEIBO).toBe('Channel::Weibo');
    expect(CHANNEL_TYPES.MINIPROGRAM).toBe('Channel::Miniprogram');
  });
});

describe('ITR flow pick order', () => {
  it('prefers conv then inbox then vdn then env', () => {
    expect(pickItrFlowId({ conv: 9, inbox: 8, vdn: 1000, envDefault: 1001 })).toBe(9);
    expect(pickItrFlowId({ conv: 0, inbox: 8, vdn: 1000, envDefault: 1001 })).toBe(8);
    expect(pickItrFlowId({ conv: 0, inbox: 0, vdn: 1000, envDefault: 1001 })).toBe(1000);
    expect(pickItrFlowId({ conv: 0, inbox: 0, vdn: 0, envDefault: 1001 })).toBe(1001);
  });
});

describe('media kind', () => {
  it('maps TAS vs online', async () => {
    const { mediaKind, uniqueMediaKinds } = await import('../shared/services/media-kind.js');
    expect(mediaKind(1)).toBe('tas');
    expect(mediaKind(5)).toBe('ims');
    expect(mediaKind(0)).toBeNull();
    expect(uniqueMediaKinds([1, 5, 1])).toEqual(['tas', 'ims']);
  });
});

describe('ITR observe WS URL', () => {
  it('derives ws path from HTTP base', () => {
    expect(deriveItrWsUrl('http://172.22.0.4:9400', '')).toBe('ws://172.22.0.4:9400/ws/observe');
    expect(deriveItrWsUrl('https://itr.example/x', '')).toBe('wss://itr.example/ws/observe');
    expect(deriveItrWsUrl('http://127.0.0.1:9400', 'ws://custom:9/obs')).toBe('ws://custom:9/obs');
  });
});
