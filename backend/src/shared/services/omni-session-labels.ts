export type OmniSessionMethod =
  | 'inbound'
  | 'queue_take'
  | 'snatch'
  | 'intercept'
  | 'transfer'
  | 'leave_claim';

export type OmniReleaseCause =
  | 'agent_end'
  | 'visitor_end'
  | 'force_end'
  | 'snatch'
  | 'intercept'
  | 'transfer'
  | 'timeout'
  | 'queue_abandon'
  | 'queue_fail';

export type OmniSessionEventType =
  | 'queued'
  | 'assigned'
  | 'answered'
  | 'snatch'
  | 'barge'
  | 'listen'
  | 'intercept'
  | 'invite'
  | 'kick'
  | 'transfer'
  | 'force_end'
  | 'ended'
  | 'queue_abandon';

const METHOD_LABEL: Record<OmniSessionMethod, string> = {
  inbound: '进线',
  queue_take: '排队接',
  snatch: '抢接',
  intercept: '拦截',
  transfer: '转接',
  leave_claim: '留言认领',
};

const RELEASE_LABEL: Record<OmniReleaseCause, string> = {
  agent_end: '坐席结束',
  visitor_end: '访客结束',
  force_end: '强制结束',
  snatch: '被抢接',
  intercept: '被拦截',
  transfer: '已转接',
  timeout: '排队未接通',
  queue_abandon: '取消排队',
  queue_fail: '排队失败',
};

const EVENT_LABEL: Record<OmniSessionEventType, string> = {
  queued: '进入排队',
  assigned: '分配坐席',
  answered: '接通',
  snatch: '抢接',
  barge: '强插',
  listen: '监听',
  intercept: '拦截',
  invite: '邀请入会话',
  kick: '踢出会话',
  transfer: '转接',
  force_end: '强制结束',
  ended: '结束会话',
  queue_abandon: '取消排队',
};

export function omniMethodLabel(method: string | null | undefined): string {
  if (!method) return '进线';
  return METHOD_LABEL[method as OmniSessionMethod] || method;
}

export function omniReleaseLabel(cause: string | null | undefined): string {
  if (!cause) return '—';
  return RELEASE_LABEL[cause as OmniReleaseCause] || cause;
}

export function omniEventLabel(type: string | null | undefined): string {
  if (!type) return '—';
  return EVENT_LABEL[type as OmniSessionEventType] || type;
}

export function omniTalkSec(answeredAt: Date | null | undefined, endedAt: Date | null | undefined, stored = 0): number {
  if (stored > 0) return stored;
  if (!answeredAt) return 0;
  const end = endedAt ?? new Date();
  return Math.max(0, Math.round((end.getTime() - answeredAt.getTime()) / 1000));
}

export function omniWaitSec(queuedAt: Date | null | undefined, assignedAt: Date | null | undefined, stored = 0): number {
  if (stored > 0) return stored;
  if (!queuedAt || !assignedAt) return 0;
  return Math.max(0, Math.round((assignedAt.getTime() - queuedAt.getTime()) / 1000));
}

export function formatTalkDuration(sec: number): string {
  const n = Math.max(0, Math.floor(sec));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatDateTime(v: Date | string | null | undefined): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (!Number.isFinite(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
