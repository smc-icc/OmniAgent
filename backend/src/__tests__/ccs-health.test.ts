import { describe, expect, it, vi } from 'vitest';
import { createCcsHealthMonitor } from '../integrations/ccs/ccs-health.js';
import { handleCcsDown } from '../integrations/ccs/ccs-down.js';
import { isCcsObjName, isIsolatedCcsSessionObj, makeCcsSessionObjName } from '../integrations/ccs/ccs-session.js';
import { bindAgentId, clearAllSessions, getSessionByUserId, setCredentials } from '../integrations/ccs/session-manager.js';

describe('ccs health monitor', () => {
  it('does not kick while still unknown (CCS never came up)', async () => {
    const onDown = vi.fn();
    const mon = createCcsHealthMonitor({
      ping: async () => false,
      onDown,
      intervalMs: 10_000,
      failThreshold: 1,
      setIntervalFn: () => 1 as unknown as ReturnType<typeof setInterval>,
      clearIntervalFn: () => {},
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(mon.state()).toBe('unknown');
    expect(onDown).not.toHaveBeenCalled();
    mon.stop();
  });

  it('up → consecutive fails → onDown once', async () => {
    let ok = true;
    const onDown = vi.fn();
    const ticks: Array<() => void> = [];
    const mon = createCcsHealthMonitor({
      ping: async () => ok,
      onDown,
      intervalMs: 10,
      failThreshold: 2,
      setIntervalFn: (fn: () => void) => {
        ticks.push(fn);
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearIntervalFn: () => {},
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(mon.state()).toBe('up');

    ok = false;
    ticks[0]!();
    await new Promise((r) => setTimeout(r, 20));
    expect(mon.state()).toBe('up');
    expect(onDown).not.toHaveBeenCalled();

    ticks[0]!();
    await new Promise((r) => setTimeout(r, 20));
    expect(mon.state()).toBe('down');
    expect(onDown).toHaveBeenCalledTimes(1);
    mon.stop();
  });

  it('up → CCS bootId 变化 → 立刻 onDown（进程被换）', async () => {
    let boot = '100';
    const onDown = vi.fn();
    const ticks: Array<() => void> = [];
    const mon = createCcsHealthMonitor({
      ping: async () => ({ ok: true, bootId: boot }),
      onDown,
      intervalMs: 10,
      failThreshold: 2,
      setIntervalFn: (fn: () => void) => {
        ticks.push(fn);
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearIntervalFn: () => {},
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(mon.state()).toBe('up');

    boot = '200';
    ticks[0]!();
    await new Promise((r) => setTimeout(r, 20));
    expect(mon.state()).toBe('down');
    expect(onDown).toHaveBeenCalledTimes(1);
    mon.stop();
  });

  it('onDown 后 generation +1，snapshot 不含 per-user 字段', async () => {
    const mon = createCcsHealthMonitor({
      ping: async () => ({ ok: true, bootId: '1' }),
      onDown: vi.fn(),
      intervalMs: 10_000,
      failThreshold: 2,
      setIntervalFn: () => 1 as unknown as ReturnType<typeof setInterval>,
      clearIntervalFn: () => {},
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(mon.snapshot()).toEqual({
      state: 'up',
      up: true,
      bootId: '1',
      generation: 0,
    });
    mon.notifyDown();
    expect(mon.snapshot()).toMatchObject({
      state: 'down',
      up: false,
      bootId: '1',
      generation: 1,
    });
    mon.stop();
  });

  it('notifyDown 仅在 up 时立刻踢一次', async () => {
    const onDown = vi.fn();
    const mon = createCcsHealthMonitor({
      ping: async () => ({ ok: true, bootId: '1' }),
      onDown,
      intervalMs: 10_000,
      failThreshold: 2,
      setIntervalFn: () => 1 as unknown as ReturnType<typeof setInterval>,
      clearIntervalFn: () => {},
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(mon.state()).toBe('up');
    mon.notifyDown();
    expect(mon.state()).toBe('down');
    expect(onDown).toHaveBeenCalledTimes(1);
    mon.notifyDown();
    expect(onDown).toHaveBeenCalledTimes(1);
    mon.stop();
  });

  it('markReachable 后 notifyDown 才会踢（unknown 不踢）', () => {
    const onDown = vi.fn();
    const mon = createCcsHealthMonitor({
      ping: async () => false,
      onDown,
      intervalMs: 10_000,
      failThreshold: 1,
      setIntervalFn: () => 1 as unknown as ReturnType<typeof setInterval>,
      clearIntervalFn: () => {},
    });
    mon.notifyDown();
    expect(onDown).not.toHaveBeenCalled();
    mon.markReachable();
    expect(mon.state()).toBe('up');
    mon.notifyDown();
    expect(onDown).toHaveBeenCalledTimes(1);
    mon.stop();
  });

  it('unknown → up 触发 onUp（CCS 晚于 Omni 启动）', async () => {
    const onUp = vi.fn();
    const onDown = vi.fn();
    const mon = createCcsHealthMonitor({
      ping: async () => ({ ok: true, bootId: '9' }),
      onDown,
      onUp,
      intervalMs: 10_000,
      failThreshold: 2,
      setIntervalFn: () => 1 as unknown as ReturnType<typeof setInterval>,
      clearIntervalFn: () => {},
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(mon.state()).toBe('up');
    expect(onUp).toHaveBeenCalledTimes(1);
    expect(onDown).not.toHaveBeenCalled();
    mon.stop();
  });
});

describe('isCcsObjName', () => {
  it('recognizes CCS servant objects', () => {
    expect(isCcsObjName('SMC-ICC.CCSServer.AgentObj@tcp -h 1.2.3.4 -p 9105')).toBe(true);
    expect(isCcsObjName('SMC-ICC.OmniAgent.AgentObj')).toBe(false);
  });
});

describe('makeCcsSessionObjName', () => {
  it('strips business -t and does not fall back to the business obj', () => {
    const biz = 'SMC-ICC.CCSServer.AgentObj@tcp -h 172.22.0.4 -p 19391 -t 60000';
    const sess = makeCcsSessionObjName(biz);
    expect(sess).toBe('SMC-ICC.CCSServer.AgentObj@tcp -h 172.22.0.4 -p 19391');
    expect(isIsolatedCcsSessionObj(sess, biz)).toBe(true);
  });
  it('returns empty when host/port cannot be parsed', () => {
    expect(makeCcsSessionObjName('SMC-ICC.CCSServer.AgentObj')).toBe('');
    expect(isIsolatedCcsSessionObj('', 'SMC-ICC.CCSServer.AgentObj')).toBe(false);
  });
});

describe('handleCcsDown', () => {
  it('clears all sessions and emits ccs.down', () => {
    setCredentials(1, { workNO: '1001', extension: '9001', password: 'x' });
    bindAgentId(1, 10599);
    setCredentials(2, { workNO: '1002', extension: '9002', password: 'x' });
    const emitToAll = vi.fn();
    const clearedUsers: number[] = [];
    const { cleared } = handleCcsDown({
      listUserIds: () => [1, 2],
      clearSession: (id) => {
        clearedUsers.push(id);
      },
      clearQueue: vi.fn(),
      clearSignedIn: vi.fn(),
      emitToAll,
    });
    expect(cleared).toBe(2);
    expect(clearedUsers).toEqual([1, 2]);
    expect(emitToAll).toHaveBeenCalledWith(
      'ccs.down',
      expect.objectContaining({ reason: 'ccs_unreachable' }),
    );
    clearAllSessions();
    expect(getSessionByUserId(1)).toBeUndefined();
  });
});
