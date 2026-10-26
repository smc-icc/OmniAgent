import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AuthorizationLedger, type EphemeralStore } from '../../modules/social-auth/authorization-ledger.js';
import { SocialAuthService, type SocialInstallation, type SocialRepository, type SocialAdapter } from '../../modules/social-auth/social-service.js';

const verifier = 'a'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
function fixture() {
  const values = new Map<string, string>();
  const store: EphemeralStore = {
    put: async (key, value) => { if (values.has(key)) return false; values.set(key, value); return true; },
    get: async key => values.get(key) ?? null,
    take: async key => { const value = values.get(key); values.delete(key); return value ?? null; },
  };
  const installation: SocialInstallation = {
    id: 'install-1', externalOrganizationId: 'corp-1', status: 'active', revision: 1, expiresAt: null,
    organization: { id: 'org-1', code: 'tenant-1', accountId: 7, vdnId: 9, enabled: true },
    app: { id: 'app-1', provider: 'feishu', clientId: 'client-1', enabled: true, approvedPlatforms: ['android'] },
  };
  let linked: { userId: number; organizationId: string; enabled: boolean } | null = null;
  let memberEnabled = true;
  let externalOrganizationId = 'corp-1';
  const repository: SocialRepository = {
    list: async code => code === 'tenant-1' ? [installation] : [],
    installation: async id => id === installation.id ? installation : null,
    identity: async () => linked,
    verifyAccount: async (email, password) => email === 'seat@example.test' && password === 'correct' ? 12 : null,
    assertAccount: async userId => { if (!memberEnabled || userId !== 12) throw new Error('member disabled'); },
    bind: async (_receipt, userId) => {
      if (linked && linked.userId !== userId) throw new Error('identity already bound');
      linked = { userId, organizationId: installation.organization.id, enabled: true };
    },
  };
  // Local protocol fixture, not proof of real provider support.
  const adapter: SocialAdapter = {
    platforms: ['android'], mode: 'browser',
    authorize: async (_installation, state) => ({ authorizationUrl: `https://accounts.example.test/authorize?state=${state}` }),
    complete: async () => ({ subjectId: 'subject-1', externalOrganizationId }),
    assertMember: async () => { if (!memberEnabled) throw new Error('member disabled'); },
  };
  const service = new SocialAuthService(new AuthorizationLedger(store), repository, { feishu: adapter });
  const begin = () => service.authorize({ provider: 'feishu', platform: 'android', organizationCode: 'tenant-1', proofChallenge: challenge, deviceId: 'device-1' });
  async function authorize() {
    const transaction = await begin();
    const { ticket } = await service.callback('feishu', transaction.transactionId, 'provider-code');
    return { ticket, state: transaction.transactionId };
  }
  return { installation, service, begin, authorize,
    linked: (userId = 12) => { linked = { userId, organizationId: 'org-1', enabled: true }; },
    disabled: () => { memberEnabled = false; },
    externalOrg: (value: string) => { externalOrganizationId = value; },
  };
}

describe('social authorization service', () => {
  it('returns no customer directory or unavailable platform providers', async () => {
    const f = fixture();
    expect(await f.service.providers('unknown-code', 'android')).toEqual([]);
    expect(await f.service.providers('tenant-1', 'harmonyos')).toEqual([]);
    expect((await f.service.providers('tenant-1', 'android'))[0]?.id).toBe('feishu');
    await expect(f.service.authorize({ provider: 'feishu', platform: 'ios', organizationCode: 'tenant-1', proofChallenge: challenge, deviceId: 'device-1' })).rejects.toThrow();
  });
  it('requires password verification before first binding and never registers an account', async () => {
    const f = fixture();
    const a = await f.authorize();
    const result = await f.service.exchange(a.ticket, a.state, verifier);
    expect(result.status).toBe('binding_required');
    if (result.status !== 'binding_required') throw new Error('expected binding');
    await expect(f.service.bind(result.bindingTicket, a.state, verifier, 'seat@example.test', 'wrong')).rejects.toThrow();
    const bound = await f.service.bind(result.bindingTicket, a.state, verifier, 'seat@example.test', 'correct');
    expect(bound.userId).toBe(12);
    expect(bound.installation.organization.accountId).toBe(7);
    await expect(f.service.bind(result.bindingTicket, a.state, verifier, 'seat@example.test', 'correct')).rejects.toThrow();
  });
  it('does not trust a different enterprise returned by a provider', async () => {
    const f = fixture();
    f.externalOrg('another-enterprise');
    const a = await f.begin();
    await expect(f.service.callback('feishu', a.transactionId, 'provider-code')).rejects.toThrow();
  });
  it('revalidates installation revision and revocation before exchanging', async () => {
    const f = fixture();
    f.linked();
    const a = await f.authorize();
    f.installation.status = 'revoked';
    await expect(f.service.exchange(a.ticket, a.state, verifier)).rejects.toThrow();
    f.installation.status = 'active';
    const b = await f.authorize();
    f.installation.revision++;
    await expect(f.service.exchange(b.ticket, b.state, verifier)).rejects.toThrow();
  });
  it('rejects disabled members and identities bound into another organization', async () => {
    const f = fixture();
    f.linked();
    const a = await f.authorize();
    f.disabled();
    await expect(f.service.exchange(a.ticket, a.state, verifier)).rejects.toThrow();
    const other = fixture();
    other.linked();
    const b = await other.authorize();
    other.installation.organization.id = 'different-org';
    await expect(other.service.exchange(b.ticket, b.state, verifier)).rejects.toThrow();
  });
  it('returns identity-only session material without provider tokens or CCS passwords', async () => {
    const f = fixture();
    f.linked();
    const a = await f.authorize();
    const result = await f.service.exchange(a.ticket, a.state, verifier);
    expect(result).toMatchObject({ status: 'authenticated', userId: 12, deviceId: 'device-1' });
    expect(JSON.stringify(result)).not.toMatch(/access_token|refresh_token|password/);
    await expect(f.service.exchange(a.ticket, a.state, verifier)).rejects.toThrow();
  });
  it('consumes cancelled state and rejects wrong callback providers', async () => {
    const f = fixture();
    const a = await f.begin();
    await f.service.cancel(a.transactionId);
    await expect(f.service.callback('feishu', a.transactionId, 'code')).rejects.toThrow();
    const b = await f.begin();
    await expect(f.service.callback('wechat', b.transactionId, 'code')).rejects.toThrow();
  });
});
