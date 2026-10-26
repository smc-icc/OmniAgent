import { createHmac } from 'node:crypto';
import type { HubSinkConfig } from '../config/schema.js';
import { HubDeliveryError } from '../core/errors.js';
import type { DeliveryItem, DeliveryResult, SinkAdapter } from './sink.js';
import { assertSafeHttpUrl } from './ssrf.js';

export function signHttpBody(secret: string, timestamp: string, rawBody: string): string {
  const hex = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `hmac-sha256=${hex}`;
}

export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  const sec = Number(trimmed);
  if (Number.isFinite(sec) && sec >= 0) return Math.min(sec * 1000, 300_000);
  const at = Date.parse(trimmed);
  if (Number.isFinite(at)) return Math.max(0, Math.min(at - Date.now(), 300_000));
  return undefined;
}

function classifyHttpStatus(status: number): 'ok' | 'retryable' | 'fatal' {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 429 || status >= 500) return 'retryable';
  return 'fatal';
}

export function createHttpSink(spec: HubSinkConfig, name: string): SinkAdapter {
  const url = spec.url?.trim();
  if (!url) throw new Error(`http sink ${name} 缺少 url`);
  const method = (spec.method ?? 'POST').toUpperCase();
  const timeoutMs = spec.timeoutMs ?? 5000;
  const headerName = spec.signing?.header ?? 'X-ICC-Signature';

  return {
    name,
    capabilities: { batch: true, maxBatchSize: spec.batch?.maxSize ?? 50, transactional: false, ordered: false },
    async init() {
      await assertSafeHttpUrl(url, { allowPrivate: spec.allowPrivate, allowHosts: spec.allowHosts });
    },
    async deliver(items: DeliveryItem[]): Promise<DeliveryResult> {
      const results: DeliveryResult['results'] = [];
      for (const item of items) {
        try {
          await assertSafeHttpUrl(url, { allowPrivate: spec.allowPrivate, allowHosts: spec.allowHosts });
          const rawBody = JSON.stringify(item.event);
          const timestamp = String(Date.now());
          const headers: Record<string, string> = {
            'content-type': 'application/json',
            'X-ICC-Event-Id': item.event.eventId,
            'X-ICC-Timestamp': timestamp,
            'X-ICC-Trace-Id': item.event.trace?.traceId ?? item.event.eventId,
            ...(spec.headers ?? {}),
          };
          if (spec.signing?.secret) {
            headers[headerName] = signHttpBody(spec.signing.secret, timestamp, rawBody);
          }
          const res = await fetch(url, {
            method,
            headers,
            body: rawBody,
            redirect: 'manual',
            signal: AbortSignal.timeout(timeoutMs),
          });
          const kind = classifyHttpStatus(res.status);
          if (kind === 'ok') {
            results.push({ eventId: item.event.eventId, ok: true });
            continue;
          }
          const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
          throw new HubDeliveryError(
            `http ${res.status} ${res.statusText}`.trim(),
            kind,
            res.status,
            retryAfterMs,
          );
        } catch (err) {
          if (err instanceof HubDeliveryError) {
            if (items.length === 1) throw err;
            results.push({
              eventId: item.event.eventId,
              ok: false,
              error: err.message,
              retryable: err.classification === 'retryable',
            });
            continue;
          }
          const msg = err instanceof Error ? err.message : String(err);
          results.push({
            eventId: item.event.eventId,
            ok: false,
            error: msg,
            retryable: true,
          });
        }
      }
      const failed = results.find((r) => !r.ok);
      if (failed && items.length === 1) {
        throw new HubDeliveryError(
          failed.error || 'http sink failed',
          failed.retryable === false ? 'fatal' : 'retryable',
        );
      }
      return { results };
    },
    async health() {
      try {
        await assertSafeHttpUrl(url, { allowPrivate: spec.allowPrivate, allowHosts: spec.allowHosts });
        return { ok: true };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    },
    async close() { /* no-op */ },
  };
}
