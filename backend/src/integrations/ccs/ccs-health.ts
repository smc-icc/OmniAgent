/**
 * CCS TARS 连通性监测。
 * 仅在已确认「曾经通」之后掉线，才视为断线（避免启动时 CCS 未起就踢坐席）。
 */

export type CcsHealthState = 'unknown' | 'up' | 'down';

/** 广播给全部连接的轻量快照。不含 per-user 字段，避免海量座席时 O(N) 组包。 */
export interface CcsHealthSnapshot {
  state: CcsHealthState;
  up: boolean;
  bootId: string;
  /** CCS 每断一次 +1；前端用它识别「断过又起来了」而不用再问 CCS。 */
  generation: number;
}

export interface CcsHealthMonitor {
  state: () => CcsHealthState;
  snapshot: () => CcsHealthSnapshot;
  stop: () => void;
  /** 订阅成功后立刻标可达，避免 onClose 发生在首次 ping 之前被当成 unknown 丢掉。 */
  markReachable: () => void;
  /** 对端 onClose 确认 CCS 已断时立刻踢坐席，不必等 failThreshold。 */
  notifyDown: () => void;
}

export type CcsPingResult = boolean | { ok: boolean; bootId?: string };

function normalizePing(r: CcsPingResult): { ok: boolean; bootId?: string } {
  return typeof r === 'boolean' ? { ok: r } : r;
}

export function createCcsHealthMonitor(opts: {
  ping: () => Promise<CcsPingResult>;
  onDown: () => void;
  onUp?: () => void;
  intervalMs?: number;
  failThreshold?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}): CcsHealthMonitor {
  const intervalMs = Math.max(500, opts.intervalMs ?? 3000);
  const failThreshold = Math.max(1, opts.failThreshold ?? 2);
  const setInt = opts.setIntervalFn ?? setInterval;
  const clearInt = opts.clearIntervalFn ?? clearInterval;

  let state: CcsHealthState = 'unknown';
  let fails = 0;
  let stopped = false;
  let inFlight = false;
  let lastBootId = '';
  let generation = 0;

  const fireDown = (): void => {
    generation += 1;
    state = 'down';
    opts.onDown();
  };

  const snapshot = (): CcsHealthSnapshot => ({
    state,
    up: state === 'up',
    bootId: lastBootId,
    generation,
  });

  const tick = async (): Promise<void> => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      let probed: { ok: boolean; bootId?: string } = { ok: false };
      try {
        probed = normalizePing(await opts.ping());
      } catch {
        probed = { ok: false };
      }
      if (stopped) return;

      if (probed.ok) {
        const boot = probed.bootId ?? '';
        if (state === 'up' && lastBootId && boot && boot !== lastBootId) {
          lastBootId = boot;
          fireDown();
          return;
        }
        if (boot) lastBootId = boot;
        fails = 0;
        if (state !== 'up') {
          state = 'up';
          opts.onUp?.();
        }
        return;
      }

      fails += 1;
      if (state === 'up' && fails >= failThreshold) {
        fireDown();
      }
    } finally {
      inFlight = false;
    }
  };

  void tick();
  const timer = setInt(() => {
    void tick();
  }, intervalMs);

  const markReachable = (): void => {
    if (stopped) return;
    fails = 0;
    if (state !== 'up') {
      state = 'up';
      opts.onUp?.();
    }
  };

  const notifyDown = (): void => {
    if (stopped || state !== 'up') return;
    fireDown();
  };

  return {
    state: () => state,
    snapshot,
    stop: () => {
      stopped = true;
      clearInt(timer);
    },
    markReachable,
    notifyDown,
  };
}
