import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/index.js';
import { PhoneAuthService, type PhoneChallenge, type PhoneChallengeStore, type PhoneAuthRepository } from '../../modules/auth/phone-auth.service.js';

function harness() {
  let now = Date.now(), ready = true, registered = true, live = true, deliveryFails = false;
  const records = new Map<string, PhoneChallenge>(), cooldown = new Map<string, number>(), rates = new Map<string, number>();
  const delivered: { phone: string; code: string }[] = [];
  const store: PhoneChallengeStore = {
    reserve: async r => { if ((cooldown.get(r.phoneHash) ?? 0) > now) return false; cooldown.set(r.phoneHash, now + 60000);
      for (const old of records.values()) if (old.phoneHash === r.phoneHash) records.delete(old.id);
      records.set(r.id, { ...r }); return true; },
    activate: async id => { const r = records.get(id); if (r) r.state = 'ready'; },
    discard: async id => { records.delete(id); },
    verify: async (id, input) => {
      const r = records.get(id);
      if (!r || r.expiresAt <= now || r.state !== 'ready' || r.phoneHash !== input.phoneHash || r.deviceHash !== input.deviceHash) return null;
      if (r.codeHash !== input.codeHash) { if (++r.attempts >= 5) records.delete(id); return null; }
      records.delete(id); return r;
    },
    saveSelection: async () => {}, consumeSelection: async () => null,
    limit: async (key, max) => { const n = (rates.get(key) ?? 0) + 1; rates.set(key, n); return n <= max; },
  };
  const repository: PhoneAuthRepository = {
    list: async phone => registered && phone === '+8613800000000' ? [{ userId: 2, accountId: 10, vdnId: 7, operatorId: 20 }] : [],
    validate: async (target, phone) => {
      if (!live || target.userId !== 2 || phone !== '+8613800000000') throw new AppError(403, 'identity revoked');
      return { id: 2, email: 'seat@example.test', name: 'Seat', uid: 'work-2', provider: 'email', pubsub_token: null, confirmed_at: null, created_at: new Date() };
    },
  };
  const service = new PhoneAuthService(store, repository, {
    readiness: async () => ({ supported: true, ready, reason: ready ? '' : '短信服务尚未配置' }),
    send: async (phone, code) => { if (deliveryFails) throw new Error('provider private error'); delivered.push({ phone, code }); },
  }, 'isolated-test-secret-with-more-than-32-bytes', () => now);
  const request = { phone: '13800000000', device_id: 'phone-a' };
  const issue = async () => { const result = await service.request(request, 'ip-a'); await service.drainDeliveries(); return result; };
  return { service, issue, request, records, delivered, advance: (ms: number) => { now += ms; },
    configure: (value: boolean) => { ready = value; }, unknown: () => { registered = false; }, revoke: () => { live = false; }, failDelivery: () => { deliveryFails = true; } };
}
describe('SMS authentication security and lifecycle', () => {
  it('stores only keyed OTP/phone/device hashes and keeps the code out of the response', async () => {
    const h = harness(), response = await h.issue(), message = h.delivered[0]!;
    expect(message.code).toMatch(/^\d{6}$/);
    expect(message.phone).toBe('+8613800000000');
    expect(response).toMatchObject({ expires_in: 300, retry_after: 60 });
    expect(response).not.toHaveProperty('code');
    const stored = [...h.records.values()][0]!;
    expect(stored).not.toHaveProperty('code');
    expect(stored.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.codeHash).not.toBe(message.code);
    expect(JSON.stringify([...h.records.values()])).not.toContain('13800000000');
  });
  it('uses one nonce once and preserves the existing seat UID', async () => {
    const h = harness(), response = await h.issue();
    const input = { ...h.request, request_id: response.request_id, code: h.delivered[0]!.code };
    expect(await h.service.signIn(input, 'ip-a')).toMatchObject({ status: 'authenticated', user: { uid: 'work-2' } });
    await expect(h.service.signIn(input, 'ip-a')).rejects.toMatchObject({ statusCode: 401 });
  });
  it('binds the challenge to phone and initiating device without burning it on selector injection', async () => {
    const h = harness(), response = await h.issue();
    const input = { ...h.request, request_id: response.request_id, code: h.delivered[0]!.code };
    for (const changed of [{ phone: '13900000000' }, { device_id: 'another-phone' }]) {
      await expect(h.service.signIn({ ...input, ...changed }, 'ip-a')).rejects.toMatchObject({ statusCode: 401 });
    }
    expect(await h.service.signIn(input, 'ip-a')).toMatchObject({ status: 'authenticated', user: { id: 2 } });
  });
  it('rejects expired and exhausted codes', async () => {
    const h = harness(), response = await h.issue(), code = h.delivered[0]!.code;
    for (let i = 0; i < 5; i++) await h.service.signIn({ ...h.request, request_id: response.request_id, code: code === '000000' ? '999999' : '000000' }, 'ip-a').catch(() => undefined);
    await expect(h.service.signIn({ ...h.request, request_id: response.request_id, code }, 'ip-a')).rejects.toMatchObject({ statusCode: 401 });
    const expired = harness(), old = await expired.issue(); expired.advance(300000);
    await expect(expired.service.signIn({ ...expired.request, request_id: old.request_id, code: expired.delivered[0]!.code }, 'ip-a')).rejects.toMatchObject({ statusCode: 401 });
  });
  it('verifies unbound numbers without disclosing associations before proof', async () => {
    const h = harness(); h.unknown(); const response = await h.issue();
    expect(response).toMatchObject({ expires_in: 300, retry_after: 60 });
    expect(h.delivered).toHaveLength(1);
    expect(await h.service.signIn({ ...h.request, request_id: response.request_id, code: h.delivered[0]!.code }, 'ip-a')).toMatchObject({ status: 'unbound' });
    expect(JSON.stringify(response)).not.toContain('registered');
  });
  it('rechecks membership and phone binding before creating a session', async () => {
    const h = harness(), response = await h.issue(); h.revoke();
    expect(await h.service.signIn({ ...h.request, request_id: response.request_id, code: h.delivered[0]!.code }, 'ip-a')).toMatchObject({ status: 'unbound' });
  });
  it('blocks cooldown races and invalidates an older OTP when sending a new one', async () => {
    const h = harness(), old = await h.issue();
    await expect(h.service.request(h.request, 'ip-b')).rejects.toMatchObject({ statusCode: 429 });
    h.advance(60000); const newer = await h.issue();
    await expect(h.service.signIn({ ...h.request, request_id: old.request_id, code: h.delivered[0]!.code }, 'ip-a')).rejects.toMatchObject({ statusCode: 401 });
    expect(await h.service.signIn({ ...h.request, request_id: newer.request_id, code: h.delivered[1]!.code }, 'ip-a')).toMatchObject({ status: 'authenticated', user: { id: 2 } });
  });
  it('shares recipient cooldowns across devices', async () => {
    const h = harness(); await h.issue();
    await expect(h.service.request({ ...h.request, device_id: 'other-device' }, 'another-ip')).rejects.toMatchObject({ statusCode: 429 });
    expect(h.records.size).toBe(1);
  });
  it('rejects missing provider configuration and does not leave usable challenges after failed delivery', async () => {
    const disabled = harness(); disabled.configure(false);
    await expect(disabled.service.request(disabled.request, 'ip-a')).rejects.toMatchObject({ statusCode: 503 });
    expect(disabled.records.size).toBe(0);
    const failed = harness(); failed.failDelivery(); await failed.issue();
    expect(failed.records.size).toBe(0);
    expect(failed.delivered).toHaveLength(0);
  });
});
