import { describe, expect, it } from 'vitest';
import { LoginCodeService, type LoginCodeRecord, type LoginCodeStore, type LoginCodeRepository } from '../../modules/auth/login-code.service.js';
import { AppError } from '../../shared/errors/index.js';

const manager = { userId: 1, accountId: 10, vdnId: 7 };
const target = { userId: 2, accountId: 10, vdnId: 7, operatorId: 20 };
function harness() {
  let now = Date.now(), enabled = true, issuerEnabled = true;
  const records = new Map<string, LoginCodeRecord>();
  const attempts = new Map<string, number>();
  const store: LoginCodeStore = {
    put: async record => {
      if ([...records.values()].filter(r => r.operatorId === record.operatorId && r.expiresAt > now).length >= 5) return false;
      records.set(record.id, record); return true;
    },
    take: async hash => {
      const record = [...records.values()].find(r => r.tokenHash === hash);
      if (!record) return null;
      records.delete(record.id); return record;
    },
    get: async id => records.get(id) ?? null,
    list: async ctx => [...records.values()].filter(r => r.accountId === ctx.accountId && r.vdnId === ctx.vdnId && r.operatorId === ctx.operatorId && r.expiresAt > now),
    revoke: async record => records.delete(record.id),
    limit: async (key, max) => { const count = (attempts.get(key) ?? 0) + 1; attempts.set(key, count); return count <= max; },
  };
  const repository: LoginCodeRepository = {
    assertOperator: async (ctx, id) => { if (ctx.accountId !== target.accountId || ctx.vdnId !== target.vdnId || id !== target.operatorId) throw new Error('VDN mismatch'); },
    target: async (ctx, id) => {
      await repository.assertOperator(ctx, id);
      if (!enabled) throw new Error('disabled target');
      return target;
    },
    validate: async record => {
      if (!enabled || !issuerEnabled || record.userId !== target.userId || record.vdnId !== target.vdnId) throw new AppError(403, 'identity unavailable');
      return { id: 2, name: 'Seat', email: 'seat@example.test', uid: 'work-2', provider: 'email', pubsub_token: null, confirmed_at: new Date(), created_at: new Date() };
    },
  };
  return { service: new LoginCodeService(store, repository, () => now), records,
    advance: (ms: number) => { now += ms; }, disable: () => { enabled = false; }, disableIssuer: () => { issuerEnabled = false; } };
}

describe('VDN administrator login codes', () => {
  it('issues for an existing seat without storing a plaintext credential', async () => {
    const h = harness(), issued = await h.service.issue(manager, 20);
    expect(issued.code).toMatch(/^XY-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/);
    expect(issued.expiresAt - issued.issuedAt).toBe(15 * 60_000);
    const stored = [...h.records.values()][0]!;
    expect(stored).toMatchObject({ userId: 2, accountId: 10, vdnId: 7, operatorId: 20, issuerId: 1 });
    expect(JSON.stringify(stored)).not.toContain(issued.code);
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('does not allow a manager to issue outside their VDN', async () => {
    const h = harness();
    await expect(h.service.issue({ ...manager, vdnId: 8 }, 20)).rejects.toThrow();
    expect(h.records.size).toBe(0);
  });
  it('does not issue for a disabled or unbound operator', async () => {
    const h = harness(); h.disable();
    await expect(h.service.issue(manager, 20)).rejects.toThrow();
    expect(h.records.size).toBe(0);
  });
  it('accepts a pasted code once and rejects replay', async () => {
    const h = harness(), issued = await h.service.issue(manager, 20);
    expect((await h.service.redeem(' ' + issued.code.toLowerCase() + ' ', 'ip-1')).user.id).toBe(2);
    await expect(h.service.redeem(issued.code, 'ip-1')).rejects.toMatchObject({ statusCode: 401 });
  });
  it('allows only one of concurrent exchanges to succeed', async () => {
    const h = harness(), issued = await h.service.issue(manager, 20);
    const results = await Promise.allSettled([h.service.redeem(issued.code, 'ip-1'), h.service.redeem(issued.code, 'ip-2')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('rejects a code at its expiration boundary', async () => {
    const h = harness(), issued = await h.service.issue(manager, 20); h.advance(15 * 60_000);
    await expect(h.service.redeem(issued.code, 'ip-1')).rejects.toMatchObject({ statusCode: 401 });
  });
  it('rechecks target and administrator authorization before issuing a session', async () => {
    for (const disable of ['disable', 'disableIssuer'] as const) {
      const h = harness(), issued = await h.service.issue(manager, 20); h[disable]();
      await expect(h.service.redeem(issued.code, 'ip-1')).rejects.toMatchObject({ statusCode: 401 });
    }
  });
  it('lists only metadata, and revocation prevents login', async () => {
    const h = harness(), issued = await h.service.issue(manager, 20);
    const listed = await h.service.list(manager, 20);
    expect(listed[0]).toMatchObject({ id: issued.id, expiresAt: issued.expiresAt });
    expect(JSON.stringify(listed)).not.toContain(issued.code);
    expect(JSON.stringify(listed)).not.toContain('tokenHash');
    await h.service.revoke(manager, 20, issued.id);
    await expect(h.service.redeem(issued.code, 'ip-1')).rejects.toMatchObject({ statusCode: 401 });
  });
  it('cannot revoke another VDN code', async () => {
    const h = harness(), issued = await h.service.issue(manager, 20);
    await expect(h.service.revoke({ ...manager, vdnId: 8 }, 20, issued.id)).rejects.toThrow();
    expect((await h.service.redeem(issued.code, 'ip-1')).user.id).toBe(2);
  });
  it('limits active credentials and repeated public guesses', async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) await h.service.issue(manager, 20);
    await expect(h.service.issue(manager, 20)).rejects.toMatchObject({ statusCode: 409 });
    for (let i = 0; i < 30; i++) await h.service.redeem('invalid', 'ip-1').catch(() => undefined);
    await expect(h.service.redeem('invalid', 'ip-1')).rejects.toMatchObject({ statusCode: 429 });
  });
});
