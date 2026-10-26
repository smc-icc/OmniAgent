export interface HubMetricsSnapshot {
  deliveredTotal: number;
  failedTotal: number;
  retryTotal: number;
  unroutedTotal: number;
  dlqSize: number;
  lagSeconds: number;
  outboxBacklog: number;
  oldestUnconsumedSeconds: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  circuitOpenCount: number;
}

function percentile(samples: number[], p: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

export function createHubMetrics() {
  const counters = {
    deliveredTotal: 0,
    failedTotal: 0,
    retryTotal: 0,
    unroutedTotal: 0,
    dlqSize: 0,
    lagSeconds: 0,
    outboxBacklog: 0,
    oldestUnconsumedSeconds: 0,
    circuitOpenCount: 0,
  };
  const latencies: number[] = [];

  return {
    incDelivered(n = 1) { counters.deliveredTotal += n; },
    incFailed(n = 1) { counters.failedTotal += n; },
    incRetry(n = 1) { counters.retryTotal += n; },
    incUnrouted(n = 1) { counters.unroutedTotal += n; },
    setDlqSize(n: number) { counters.dlqSize = n; },
    setLagSeconds(n: number) { counters.lagSeconds = n; },
    setOutboxBacklog(n: number) { counters.outboxBacklog = n; },
    setOldestUnconsumedSeconds(n: number) { counters.oldestUnconsumedSeconds = n; },
    setCircuitOpenCount(n: number) { counters.circuitOpenCount = n; },
    observeLatency(ms: number) {
      latencies.push(ms);
      if (latencies.length > 500) latencies.shift();
    },
    snapshot(): HubMetricsSnapshot {
      return {
        ...counters,
        latencyP50Ms: percentile(latencies, 50),
        latencyP95Ms: percentile(latencies, 95),
        latencyP99Ms: percentile(latencies, 99),
      };
    },
  };
}

export function prometheusText(snap: HubMetricsSnapshot): string {
  const lines = [
    ['hub_delivered_total', snap.deliveredTotal],
    ['hub_failed_total', snap.failedTotal],
    ['hub_retry_total', snap.retryTotal],
    ['hub_unrouted_total', snap.unroutedTotal],
    ['hub_dlq_size', snap.dlqSize],
    ['hub_lag_seconds', snap.lagSeconds],
    ['hub_outbox_backlog', snap.outboxBacklog],
    ['hub_oldest_unconsumed_seconds', snap.oldestUnconsumedSeconds],
    ['hub_latency_p50_ms', snap.latencyP50Ms],
    ['hub_latency_p95_ms', snap.latencyP95Ms],
    ['hub_latency_p99_ms', snap.latencyP99Ms],
    ['hub_circuit_open_count', snap.circuitOpenCount],
  ] as const;
  return lines.map(([k, v]) => `${k} ${v}`).join('\n') + '\n';
}

export type HubMetrics = ReturnType<typeof createHubMetrics>;
