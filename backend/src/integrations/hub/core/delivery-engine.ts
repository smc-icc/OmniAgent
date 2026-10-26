import type { HubConfig } from '../config/schema.js';
import type { BusinessEvent } from '../contract/event.js';
import type { HubMetrics } from '../observability/metrics.js';
import type { HubStore } from '../store/memory.js';
import type { HubLogger, SinkAdapter } from '../sinks/sink.js';
import { routeEvent } from './router.js';
import { TransformError, transformEvent } from './transformer.js';
import { classifyError, errorMessage, HubDeliveryError } from './errors.js';
import { hashMod } from './hash.js';
import { ensureTraceId } from '../observability/tracing.js';

export interface DeliveryEngine {
  submit(event: BusinessEvent): Promise<void>;
  drain(): Promise<void>;
  pauseIngest(): boolean;
  replayToSink(event: BusinessEvent, sinkName: string): Promise<void>;
  isCircuitOpen(name: string): boolean;
  close(): Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoff(attempt: number, base: number, max: number): number {
  const exp = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.random() * 0.2 * exp;
  return Math.min(max, exp + jitter);
}

class Circuit {
  failures = 0;
  openUntil = 0;
  constructor(private threshold: number, private openMs: number) {}
  get open(): boolean { return Date.now() < this.openUntil; }
  success() { this.failures = 0; this.openUntil = 0; }
  fail() {
    this.failures += 1;
    if (this.failures >= this.threshold) this.openUntil = Date.now() + this.openMs;
  }
}

export function createDeliveryEngine(opts: {
  config: HubConfig;
  store: HubStore;
  sinks: Map<string, SinkAdapter>;
  log: HubLogger;
  metrics: HubMetrics;
  now?: () => number;
}): DeliveryEngine {
  const { config, store, sinks, log, metrics } = opts;
  const laneCount = config.delivery.laneCount;
  const queues: Array<Array<{
    event: BusinessEvent;
    resolve: () => void;
    reject: (err: unknown) => void;
  }>> = Array.from({ length: laneCount }, () => []);
  const running = new Array(laneCount).fill(false);
  const circuits = new Map<string, Circuit>();
  const paused = { value: false };
  let closed = false;

  function circuit(name: string): Circuit {
    let c = circuits.get(name);
    if (!c) {
      c = new Circuit(config.delivery.circuitFailureThreshold, config.delivery.circuitOpenMs);
      circuits.set(name, c);
    }
    return c;
  }

  function refreshCircuitMetric(): void {
    let n = 0;
    for (const c of circuits.values()) if (c.open) n += 1;
    metrics.setCircuitOpenCount(n);
  }

  async function deliverToSink(event: BusinessEvent, sinkName: string, transformName: string): Promise<void> {
    const existing = await store.getDelivery(event.eventId, sinkName);
    if (existing?.status === 'succeeded') return;

    const sink = sinks.get(sinkName);
    if (!sink) throw new Error(`sink 未注册: ${sinkName}`);
    const br = circuit(sinkName);
    if (br.open) {
      throw Object.assign(new Error(`sink ${sinkName} 熔断中`), { classification: 'retryable' as const });
    }

    const records = transformEvent(event, transformName, config.transforms);
    const started = Date.now();
    let attempt = existing?.attempts ?? 0;
    let lastErr: unknown;
    while (attempt < config.delivery.maxAttempts) {
      attempt += 1;
      await store.upsertDelivery({
        eventId: event.eventId,
        sink: sinkName,
        status: 'pending',
        attempts: attempt,
      });
      try {
        const result = await sink.deliver(records.map((record) => ({ event, record, sinkName })));
        const fail = result.results.find((r) => !r.ok);
        if (fail) {
          throw Object.assign(new Error(fail.error || 'sink item failed'), {
            classification: fail.retryable === false ? 'fatal' : 'retryable',
          });
        }
        await store.upsertDelivery({
          eventId: event.eventId,
          sink: sinkName,
          status: 'succeeded',
          attempts: attempt,
        });
        br.success();
        refreshCircuitMetric();
        metrics.incDelivered();
        metrics.observeLatency(Date.now() - started);
        return;
      } catch (err) {
        lastErr = err;
        const kind = classifyError(err);
        if (kind === 'fatal') break;
        br.fail();
        refreshCircuitMetric();
        metrics.incRetry();
        if (attempt >= config.delivery.maxAttempts) break;
        const retryAfter = err instanceof HubDeliveryError ? err.retryAfterMs : undefined;
        await sleep(Math.max(
          backoff(attempt, config.delivery.retryBaseMs, config.delivery.retryMaxMs),
          retryAfter ?? 0,
        ));
      }
    }
    const msg = errorMessage(lastErr);
    await store.upsertDelivery({
      eventId: event.eventId,
      sink: sinkName,
      status: 'dlq',
      attempts: attempt,
      lastError: msg,
    });
    await store.insertDlq({ eventId: event.eventId, sink: sinkName, event, error: msg });
    metrics.incFailed();
    metrics.setDlqSize(await store.countDlq());
    log.error({
      eventId: event.eventId,
      sink: sinkName,
      traceId: ensureTraceId(event),
      err: msg,
    }, 'hub delivery failed → DLQ');
  }

  async function processEvent(event: BusinessEvent): Promise<void> {
    const hits = routeEvent(event, config.routes);
    if (!hits.length) {
      metrics.incUnrouted();
      log.debug?.({ eventId: event.eventId, eventType: event.eventType }, 'hub unrouted');
      if (config.delivery.unroutedToDlq) {
        await store.insertDlq({ eventId: event.eventId, sink: '_unrouted', event, error: 'unrouted' });
      }
      return;
    }
    await Promise.all(hits.map(async ({ route }) => {
      const sinkNames = route.sinks.filter((s) => !config.sinksDisabled.includes(s));
    await Promise.all(sinkNames.map(async (sinkName) => {
        try {
          await deliverToSink(event, sinkName, route.transform);
        } catch (err) {
          if (err instanceof TransformError) {
            await store.upsertDelivery({
              eventId: event.eventId,
              sink: sinkName,
              status: 'dlq',
              attempts: 1,
              lastError: err.message,
            });
            await store.insertDlq({ eventId: event.eventId, sink: sinkName, event, error: err.message });
            metrics.incFailed();
            log.error({
              eventId: event.eventId,
              sink: sinkName,
              traceId: ensureTraceId(event),
              err: err.message,
            }, 'transform fatal → DLQ');
            return;
          }
          throw err;
        }
    }));
    }));
  }

  function kick(lane: number): void {
    if (running[lane] || closed) return;
    running[lane] = true;
    void (async () => {
      while (queues[lane].length && !closed) {
        const item = queues[lane].shift();
        if (!item) break;
        try {
          await processEvent(item.event);
          item.resolve();
        } catch (err) {
          log.error({
            eventId: item.event.eventId,
            traceId: ensureTraceId(item.event),
            err: errorMessage(err),
          }, 'hub lane error');
          item.reject(err);
        }
      }
      running[lane] = false;
    })();
  }

  return {
    async submit(event) {
      if (closed) throw new Error('delivery engine closed');
      const lane = hashMod(event.partitionKey, laneCount);
      const done = new Promise<void>((resolve, reject) => {
        queues[lane].push({ event, resolve, reject });
      });
      if (queues.reduce((n, q) => n + q.length, 0) > 10_000) paused.value = true;
      else paused.value = false;
      kick(lane);
      return done;
    },
    async drain() {
      for (let i = 0; i < 200; i++) {
        if (queues.every((q) => q.length === 0) && running.every((r) => !r)) return;
        await sleep(20);
      }
    },
    pauseIngest() { return paused.value; },
    async replayToSink(event, sinkName) {
      const hits = routeEvent(event, config.routes);
      const hit = hits.find((h) => h.route.sinks.includes(sinkName));
      const transformName = hit?.route.transform ?? 'passthrough';
      await store.upsertDelivery({
        eventId: event.eventId,
        sink: sinkName,
        status: 'pending',
        attempts: 0,
      });
      await deliverToSink(event, sinkName, transformName);
    },
    isCircuitOpen(name) { return circuit(name).open; },
    async close() {
      closed = true;
      for (const q of queues) {
        while (q.length) {
          const item = q.shift();
          item?.reject(new Error('delivery engine closed'));
        }
      }
    },
  };
}
