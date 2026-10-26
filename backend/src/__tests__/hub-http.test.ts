import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventTypes } from '../integrations/hub/contract/event-types.js';
import type { BusinessEvent } from '../integrations/hub/contract/event.js';
import { HubDeliveryError } from '../integrations/hub/core/errors.js';
import { createHttpSink, parseRetryAfterMs, signHttpBody } from '../integrations/hub/sinks/http.sink.js';
import { assertSafeHttpUrl, isPrivateIp } from '../integrations/hub/sinks/ssrf.js';
import type { DeliveryItem } from '../integrations/hub/sinks/sink.js';

function item(): DeliveryItem {
  const event: BusinessEvent = {
    eventId: '00000000-0000-4000-8000-0000000000aa',
    eventType: EventTypes.VOICEMAIL_CREATED,
    eventVersion: 1,
    occurredAt: '2026-08-26T03:00:00.000Z',
    source: { system: 'icc', component: 'ivr' },
    tenant: { vdnId: 1 },
    subject: { type: 'voicemail', id: '1' },
    partitionKey: 'voicemail:1',
    payload: { leavewordId: 1 },
  };
  return { event, record: {}, sinkName: 'partner_http' };
}

describe('hub http sink', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('signs HMAC(timestamp.body) and sends idempotency headers', async () => {
    const seen: Array<{ sig: string | null; ts: string | null; id: string | null; trace: string | null; body: string }> = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({
        sig: headers.get('X-ICC-Signature'),
        ts: headers.get('X-ICC-Timestamp'),
        id: headers.get('X-ICC-Event-Id'),
        trace: headers.get('X-ICC-Trace-Id'),
        body: String(init?.body ?? ''),
      });
      return new Response('ok', { status: 200 });
    });
    const sink = createHttpSink({
      kind: 'http',
      url: 'http://8.8.8.8/icc/events',
      signing: { algorithm: 'hmac-sha256', secret: 's3cret' },
      allowPrivate: false,
    }, 'partner_http');
    const it = item();
    const r = await sink.deliver([it]);
    expect(r.results[0]?.ok).toBe(true);
    expect(seen[0]?.id).toBe(it.event.eventId);
    expect(seen[0]?.trace).toBe(it.event.eventId);
    expect(seen[0]?.sig).toBe(signHttpBody('s3cret', seen[0]!.ts!, seen[0]!.body));
  });

  it('treats 4xx as fatal and 5xx as retryable', async () => {
    vi.stubGlobal('fetch', async () => new Response('no', { status: 400 }));
    const sink = createHttpSink({ kind: 'http', url: 'http://8.8.8.8/x' }, 'h');
    await expect(sink.deliver([item()])).rejects.toBeInstanceOf(HubDeliveryError);
    try {
      await sink.deliver([item()]);
    } catch (e) {
      expect((e as HubDeliveryError).classification).toBe('fatal');
    }

    vi.stubGlobal('fetch', async () => new Response('err', { status: 503, headers: { 'Retry-After': '2' } }));
    try {
      await sink.deliver([item()]);
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(HubDeliveryError);
      expect((e as HubDeliveryError).classification).toBe('retryable');
      expect((e as HubDeliveryError).retryAfterMs).toBe(2000);
    }
  });

  it('rejects private URLs (SSRF)', async () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('10.1.2.3')).toBe(true);
    expect(isPrivateIp('192.168.0.1')).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    await expect(assertSafeHttpUrl('http://127.0.0.1/secret')).rejects.toMatchObject({ classification: 'fatal' });
    await expect(assertSafeHttpUrl('http://169.254.169.254/latest')).rejects.toMatchObject({ classification: 'fatal' });
    const sink = createHttpSink({ kind: 'http', url: 'http://127.0.0.1/' }, 'ssrf');
    await expect(sink.deliver([item()])).rejects.toMatchObject({ classification: 'fatal' });
  });

  it('parses Retry-After seconds', () => {
    expect(parseRetryAfterMs('3')).toBe(3000);
    expect(parseRetryAfterMs(null)).toBeUndefined();
  });
});
