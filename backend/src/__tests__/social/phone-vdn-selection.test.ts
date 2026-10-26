import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/index.js';
import { PhoneAuthService, type PhoneTarget, type PhoneChallenge, type PhoneSelection, type PhoneChallengeStore } from '../../modules/auth/phone-auth.service.js';

function fixture() {
  let now = Date.now(), live = true;
  const targets = [{ userId: 2, accountId: 10, vdnId: 7, operatorId: 20, name: '公司 A' },
    { userId: 3, accountId: 11, vdnId: 8, operatorId: 21, name: '公司 B' }];
  let associations = targets.slice();
  const records = new Map<string, PhoneChallenge>(), selections = new Map<string, PhoneSelection>();
  const store: PhoneChallengeStore = {
    reserve: async r => { records.set(r.id, r); return true; },
    activate: async id => { const r = records.get(id); if (r) r.state = 'ready'; },
    discard: async id => { records.delete(id); }, limit: async () => true,
    verify: async (id, p) => { const r = records.get(id); if (!r || r.state !== 'ready' || r.expiresAt <= p.now || r.phoneHash !== p.phoneHash || r.deviceHash !== p.deviceHash || r.codeHash !== p.codeHash) return null; records.delete(id); return r; },
    saveSelection: async (hash, r) => { selections.set(hash, r); },
    consumeSelection: async (hash, p) => { const r = selections.get(hash); if (!r || r.expiresAt <= p.now || r.phoneHash !== p.phoneHash || r.deviceHash !== p.deviceHash || !r.targets.some(t => t.vdnId === p.vdnId)) return null; selections.delete(hash); return r; },
  };
  const delivered: string[] = [];
  const service = new PhoneAuthService(store, {
    list: async () => associations,
    validate: async (t, phone) => { if (!live || phone !== '+8613800000000' || !associations.some(a => a.userId === t.userId && a.accountId === t.accountId)) throw new AppError(403, 'revoked');
      return { id: t.userId, uid: 'work-' + t.userId, name: t.name ?? 'Seat', email: 'seat@example.test', provider: 'email', pubsub_token: null, confirmed_at: null, created_at: new Date() }; },
  }, { readiness: async () => ({ supported: true, ready: true, reason: '' }), send: async (_phone, code) => { delivered.push(code); } }, 'private-selection-fixture-key', () => now);
  const input = { phone: '13800000000', device_id: 'fixture-phone' };
  async function verify() { const request = await service.request(input, 'ip'); await service.drainDeliveries(); return service.signIn({ ...input, request_id: request.request_id, code: delivered.at(-1)! }, 'ip'); }
  async function verifySelection() { const r = await verify(); if (r.status !== 'select_vdn') throw new Error('Expected VDN selection'); return r; }
  return { service, verify, verifySelection, input, records, selections, delivered, single: () => { associations = [targets[0]!]; }, none: () => { associations = []; }, revoke: () => { live = false; }, move: () => { associations = targets.map(t => ({ ...t, accountId: t.accountId + 100 })); }, advance: (ms: number) => { now += ms; } };
}
describe('phone-first login and verified VDN selection', () => {
  it('sends an OTP without looking up VDNs, including an unbound phone', async () => { const f = fixture(); f.none(); const request = await f.service.request(f.input, 'ip'); await f.service.drainDeliveries(); expect(f.delivered).toHaveLength(1); expect(request).not.toHaveProperty('vdns'); expect(request).not.toHaveProperty('code'); });
  it('returns 未绑定 VDN after verification without issuing an identity', async () => { const f = fixture(); f.none(); expect(await f.verify()).toMatchObject({ status: 'unbound', message: expect.stringContaining('未绑定 VDN') }); });
  it('logs into the sole valid VDN immediately', async () => { const f = fixture(); f.single(); expect(await f.verify()).toMatchObject({ status: 'authenticated', user: { id: 2, uid: 'work-2' }, target: { vdnId: 7, accountId: 10 } }); expect(f.selections.size).toBe(0); });
  it('returns names and VDN IDs only for a verified phone with multiple associations', async () => { const f = fixture(); const result = await f.verifySelection(); expect(result).toMatchObject({ status: 'select_vdn', expires_in: 120, vdns: [{ vdn_id: 7, name: '公司 A' }, { vdn_id: 8, name: '公司 B' }] }); expect(result).not.toHaveProperty('user'); expect(result).not.toHaveProperty('headers'); expect(JSON.stringify(result)).not.toContain('userId'); expect(result.selection_ticket).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(JSON.stringify([...f.selections.values()])).not.toContain(f.input.phone); });
  it('selects only from recorded associations; wrong tenant/device/phone cannot burn the ticket', async () => { const f = fixture(); const result = await f.verifySelection(); const input = { ...f.input, selection_ticket: result.selection_ticket, vdn_id: 8 }; for (const changed of [{ vdn_id: 999 }, { device_id: 'other' }, { phone: '13900000000' }]) await expect(f.service.select({ ...input, ...changed }, 'ip')).rejects.toMatchObject({ statusCode: 401 }); expect(await f.service.select(input, 'ip')).toMatchObject({ status: 'authenticated', user: { id: 3 }, target: { accountId: 11, vdnId: 8 } }); });
  it('redeems a selection once, including concurrent choices', async () => { const f = fixture(); const r = await f.verifySelection(); const results = await Promise.allSettled([7, 8, 7, 8].map(vdn_id => f.service.select({ ...f.input, selection_ticket: r.selection_ticket, vdn_id }, 'ip'))); expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); });
  it('rejects selection expiry', async () => { const f = fixture(); const r = await f.verifySelection(); f.advance(120000); await expect(f.service.select({ ...f.input, selection_ticket: r.selection_ticket, vdn_id: 7 }, 'ip')).rejects.toMatchObject({ statusCode: 401 }); });
  it('revalidates revoked membership and tenant remapping before completing selection', async () => { for (const change of ['revoke', 'move'] as const) { const f = fixture(); const r = await f.verifySelection(); f[change](); await expect(f.service.select({ ...f.input, selection_ticket: r.selection_ticket, vdn_id: 7 }, 'ip')).rejects.toMatchObject({ statusCode: 403 }); expect(f.selections.size).toBe(0); } });
});
