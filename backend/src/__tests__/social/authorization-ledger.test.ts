import { describe, expect, it } from 'vitest';
import { AuthorizationLedger, type EphemeralStore } from '../../modules/social-auth/authorization-ledger.js';
import { createHash } from 'node:crypto';

function store(): EphemeralStore {
  const values = new Map<string, string>();
  return { put: async (key, value) => { if (values.has(key)) return false; values.set(key, value); return true; },
    get: async key => values.get(key) ?? null,
    take: async key => { const value = values.get(key); values.delete(key); return value ?? null; } };
}
const context = { provider: 'wechat', appId: 'app1', organizationId: 'org1', installationId: 'install1',
  platform: 'android', proofChallenge: createHash('sha256').update('a'.repeat(43)).digest('base64url'), deviceId: 'device1' };
describe('social authorization ledger', () => {
  it('exchanges a valid receipt only once with the original proof verifier', async () => {
    const ledger = new AuthorizationLedger(store());
    const state = await ledger.begin(context);
    const ticket = await ledger.receipt({ ...await ledger.callback(state), subjectId: 'external-user' });
    expect((await ledger.exchange(ticket, state, 'a'.repeat(43))).subjectId).toBe('external-user');
    await expect(ledger.exchange(ticket, state, 'a'.repeat(43))).rejects.toThrow();
  });
  it('consumes authorization state atomically and rejects callback replay', async () => {
    const ledger = new AuthorizationLedger(store());
    const state = await ledger.begin(context);
    expect((await ledger.callback(state)).organizationId).toBe('org1');
    await expect(ledger.callback(state)).rejects.toThrow();
  });
  it('binds completion receipts to the original app transaction', async () => {
    const ledger = new AuthorizationLedger(store());
    const state = await ledger.begin(context);
    const ticket = await ledger.receipt({ ...await ledger.callback(state), subjectId: 'external-user' });
    await expect(ledger.exchange(ticket, 'another-state', 'a'.repeat(43))).rejects.toThrow();
    await expect(ledger.exchange(ticket, state, 'a'.repeat(43))).rejects.toThrow();
  });
  it('does not accept expired transactions or receipts', async () => {
    let now = 1000;
    const ledger = new AuthorizationLedger(store(), () => now);
    const state = await ledger.begin(context);
    now += 601000;
    await expect(ledger.callback(state)).rejects.toThrow();
  });
  it('returns an actionable expired-authorization error instead of an internal server error', async () => {
    const ledger = new AuthorizationLedger(store());
    const state = await ledger.begin(context);
    await ledger.cancel(state);
    await expect(ledger.callback(state)).rejects.toMatchObject({ statusCode: 410, errorCode: 'social_authorization_expired' });
  });
});
