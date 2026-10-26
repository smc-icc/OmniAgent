/**
 * 断线窗口内按 userId 缓冲关键话务事件，重连后 flush 重放。
 * 有界：每用户最多 MAX_PER_USER 条，条目 TTL_MS 过期丢弃。
 */

export const CCS_BUFFERED_METHODS = new Set([
  'OnAgentOnCallOfferedEvt',
  'OnAgentOnAnsweredEvt',
  'OnAgentOnCallEndEvt',
  'OnAgentOnReleasedEvt',
  'OnAgentOnInterceptedEvt',
  'OnAgentAnswerCallAck',
  'OnAgentOnForceIdleEvt',
  'OnAgentOnForceBusyEvt',
  'OnAgentOnForceBlockEvt',
  'OnAgentSelfStatusUpdateEvt',
]);

const MAX_PER_USER = 32;
const TTL_MS = 60_000;

export interface QueuedCcsEmit {
  event: string;
  data: unknown;
  enqueuedAt: number;
}

const queues = new Map<number, QueuedCcsEmit[]>();

export function isBufferedCcsPayload(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const method = (data as { method?: unknown }).method;
  return typeof method === 'string' && CCS_BUFFERED_METHODS.has(method);
}

function trimExpired(q: QueuedCcsEmit[], now: number): void {
  while (q.length > 0 && now - q[0]!.enqueuedAt > TTL_MS) {
    q.shift();
  }
}

/** 无活跃 socket 时入队；有界 FIFO（超限丢最旧）。 */
export function enqueueCcsEmit(userId: number, event: string, data: unknown): void {
  const now = Date.now();
  const q = queues.get(userId) ?? [];
  trimExpired(q, now);
  q.push({ event, data, enqueuedAt: now });
  while (q.length > MAX_PER_USER) q.shift();
  queues.set(userId, q);
}

/** 重连时按序重放到该用户；返回实际发出条数。 */
export function flushCcsEmitQueue(
  userId: number,
  emit: (event: string, data: unknown) => void,
): number {
  const q = queues.get(userId);
  queues.delete(userId);
  if (!q?.length) return 0;
  const now = Date.now();
  let n = 0;
  for (const item of q) {
    if (now - item.enqueuedAt > TTL_MS) continue;
    emit(item.event, item.data);
    n += 1;
  }
  return n;
}

export function clearCcsEmitQueue(userId: number): void {
  queues.delete(userId);
}

export function clearAllCcsEmitQueues(): void {
  queues.clear();
}

/** 在线直推时可丢掉积压（实时事件已更新）。 */
export function trimCcsEmitQueue(userId: number): void {
  const q = queues.get(userId);
  if (!q?.length) return;
  trimExpired(q, Date.now());
  if (q.length === 0) queues.delete(userId);
  else queues.set(userId, q);
}

export function queuedCcsEmitCount(userId: number): number {
  return queues.get(userId)?.length ?? 0;
}
