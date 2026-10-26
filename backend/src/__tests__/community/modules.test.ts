import { describe, it, expect } from 'vitest';
import { ModuleAuthority } from '../../modules/product-modules/authority.js';
import {
  moduleForRequest,
  voiceOperationAllowed,
} from '../../modules/product-modules/policy.js';
const response = (available = true) => ({
  schemaVersion: 1,
  revision: 1,
  deploymentId: 'test',
  edition: 'registered',
  license: { expiresAt: '2099-01-01T00:00:00Z' },
  modules: {
    omni: { available: true },
    icc: { available },
    ivr: { available: false },
    itr: { available: false },
    outbound: { available: false },
    aiqc: { available: false },
    'flow-designer': { available: false },
  },
  limits: { voiceSeats: 2, sipTrunks: 2 },
});
describe('Community authority', () => {
  it('defaults to Community and never requests ICC when no authority is configured', async () => {
    const a = new ModuleAuthority({});
    expect((await a.snapshot()).modules.icc.available).toBe(false);
    expect((await a.snapshot()).modules.omni.available).toBe(true);
  });
  it('uses the backend token, caches briefly and fails closed after loss of authority', async () => {
    let now = 0,
      calls = 0;
    const a = new ModuleAuthority({
      url: 'http://conf/api/smcicc/community/runtime',
      token: 'x'.repeat(32),
      now: () => now,
      fetch: async (_url, options) => {
        calls++;
        expect(
          (options?.headers as Record<string, string>)['x-smc-module-token'],
        ).toBe('x'.repeat(32));
        if (calls > 1) throw Error('offline');
        return new Response(JSON.stringify({ data: response() }));
      },
    });
    expect((await a.snapshot()).modules.icc.available).toBe(true);
    expect((await a.snapshot()).modules.icc.available).toBe(true);
    expect(calls).toBe(1);
    now = 6000;
    expect((await a.snapshot()).modules.icc.available).toBe(false);
  });
  it('rejects expired or malformed capabilities', async () => {
    const a = new ModuleAuthority({
      url: 'http://conf/runtime',
      token: 'x'.repeat(32),
      fetch: async () =>
        new Response(
          JSON.stringify({
            data: {
              ...response(),
              license: { expiresAt: '2020-01-01T00:00:00Z' },
            },
          }),
        ),
    });
    expect((await a.snapshot()).modules.icc.available).toBe(false);
  });
});
describe('commercial operation boundaries', () => {
  it('keeps core conversations, customers and internal chat available', () => {
    for (const url of [
      '/api/v1/accounts/1/conversations',
      '/api/customers',
      '/api/agent/internal-chats',
      '/api/agent/rest-requests',
    ])
      expect(moduleForRequest('GET', url)).toBeNull();
  });
  it('gates direct telephony, outbound, ITR and QC endpoints', () => {
    expect(moduleForRequest('GET', '/api/agent/sip-credentials')).toBe('icc');
    expect(moduleForRequest('POST', '/api/v1/outbound/tasks/1/start')).toBe(
      'outbound',
    );
    expect(moduleForRequest('GET', '/api/v1/monitor/agents')).toBe('icc');
    expect(moduleForRequest('POST', '/api/itr/callback/foo')).toBe('itr');
  });
  it('allows session cleanup after disabling ICC but rejects new calls and unknown RPCs', () => {
    expect(voiceOperationAllowed('DoHangup', false)).toBe(true);
    expect(voiceOperationAllowed('DoAgentSignOutGroup', false)).toBe(true);
    expect(voiceOperationAllowed('DoMakeCall', false)).toBe(false);
    expect(voiceOperationAllowed('future.NewCall', false)).toBe(false);
  });
});

it('explicit phone workspace lists and CSV exports require ICC, while media stays available', () => {
  for (const path of ['/api/omnichannel/contacts', '/api/omnichannel/contacts/export.csv']) {
    expect(moduleForRequest('GET', path + '?channel_group=phone&tab=history')).toBe('icc');
    expect(moduleForRequest('GET', path + '?channel_group=media&tab=history')).toBeNull();
    expect(moduleForRequest('GET', path)).toBeNull();
  }
});

it('accepts professional authority and propagates voice/video/seat quotas', async () => {
  const limits = {voiceSeats:2, concurrentCalls:2, videoConcurrentCalls:2, sipTrunks:2};
  const a = new ModuleAuthority({url:'http://conf/runtime', token:'x'.repeat(32), deploymentId:'test',
    fetch:async () => new Response(JSON.stringify({data:{...response(), edition:'professional', limits}}))});
  const snapshot = await a.snapshot();
  expect(snapshot.edition).toBe('professional');
  expect(snapshot.modules.icc.available).toBe(true);
  expect(snapshot.limits).toEqual(limits);
});
