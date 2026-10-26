import type { HubConfig } from '../config/schema.js';
import { prometheusText } from '../observability/metrics.js';
import type { HubHandle } from '../runtime.js';
import { localYmd } from './archive.js';

export interface AdminResponse {
  status: number;
  body: unknown;
  contentType?: string;
}

export async function handleHubHealth(handle: HubHandle, config: HubConfig): Promise<AdminResponse> {
  const snap = handle.metrics.snapshot();
  const sinks = await handle.sinkHealth();
  const sinkOk = Object.values(sinks).every((s) => s.ok);
  const ok = snap.oldestUnconsumedSeconds < 300 && sinkOk;
  return {
    status: ok ? 200 : 503,
    body: {
      ok,
      role: config.role,
      ingest: config.role === 'worker' || config.role === 'standalone' || config.runIngest,
      metrics: snap,
      sinks,
    },
  };
}

export function handleHubLiveness(config: HubConfig): AdminResponse {
  return { status: 200, body: { ok: true, role: config.role } };
}

export function handleHubMetrics(handle: HubHandle, format: 'json' | 'prom'): AdminResponse {
  const snap = handle.metrics.snapshot();
  if (format === 'prom') {
    return { status: 200, body: prometheusText(snap), contentType: 'text/plain; version=0.0.4' };
  }
  return { status: 200, body: snap };
}

export async function handleListDlq(handle: HubHandle, query: { sink?: string; limit?: string }): Promise<AdminResponse> {
  const items = await handle.store.listDlq({
    sink: query.sink,
    limit: query.limit ? Number(query.limit) : 100,
  });
  return { status: 200, body: { items } };
}

export async function handleReplayDlq(handle: HubHandle, id: number): Promise<AdminResponse> {
  if (!Number.isFinite(id)) return { status: 400, body: { ok: false, error: 'invalid id' } };
  const result = await handle.replayDlq(id);
  return { status: result.ok ? 200 : 409, body: result };
}

export async function handleReplayDlqBySink(handle: HubHandle, sink: string | undefined, limit?: number): Promise<AdminResponse> {
  if (!sink) return { status: 400, body: { ok: false, error: 'sink required' } };
  const result = await handle.replayDlqBySink(sink, limit ?? 50);
  return { status: 200, body: result };
}

export async function handleHubArchive(handle: HubHandle): Promise<AdminResponse> {
  const report = await handle.archiveOutbox();
  const status = report.errors.length ? 500 : 200;
  return { status, body: report };
}

export async function handleHubReconcile(handle: HubHandle, day?: string): Promise<AdminResponse> {
  const report = await handle.reconcileNow(day ?? localYmd(new Date()));
  return { status: report.leaveword.missing > 0 ? 409 : 200, body: report };
}
