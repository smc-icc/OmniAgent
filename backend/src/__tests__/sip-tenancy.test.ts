import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ live: vi.fn(), session: vi.fn(), query: vi.fn(), managed: true,
  env: { SIP_SBC_HOST: 'omni.seami.cloud', SIP_REALM: 'cloud.invalid', SIP_SBC_PORT: 5064,
    SIP_SBC_TRANSPORT: 'tls', SIP_SRTP: 'required', SIP_CODECS: 'PCMA,PCMU',
    SIP_REGISTER_EXPIRES_S: 300, SIP_STUN_SERVER: '', SIP_ICE_ENABLED: false, SIP_CREDENTIALS_TTL_S: 300 } }));
vi.mock('../config/env.js', () => ({ env: m.env }));
vi.mock('../shared/services/conf-tenancy.js', () => ({ confTenancyEnabled: () => m.managed, assertLiveBinding: m.live }));
vi.mock('../integrations/ccs/session-manager.js', () => ({ getSessionByUserId: m.session }));
vi.mock('../modules/access/access.db.js', () => ({ database: async () => ({ query: m.query }), rows: async (_db: unknown, sql: string, params: unknown[]) => m.query(sql, params) }));
import { getSipCredentials } from '../shared/services/sip-credentials.js';
import { ownedCcsPayload, loginCallbackSession } from '../shared/services/voice-tenant.js';

beforeEach(() => {
  vi.resetAllMocks(); m.managed = true; m.env.SIP_SBC_TRANSPORT = 'tls'; m.env.SIP_SRTP = 'required';
  m.live.mockResolvedValue({ binding: { vdn_id: 2, work_no: '2001', source_user_id: 21 },
    map: { account_id: 82, vdn_id: 2, enabled: true }, user: { id: 21, work_no: '2001' } });
  m.session.mockReturnValue(undefined);
  m.query.mockImplementation(async (sql: string) => {
    if (sql.includes('AS phone_extension')) return [{ source_user_id: 21, phone_extension: '9002' }];
    if (sql.includes('t_icc_agent_video_config')) return [];
    if (sql.includes('COALESCE')) return [{ extension: '9002' }];
    if (sql.includes('FROM t_icc_base_extension')) return [{ vdn: 2, enabled: 1 }];
    return [{ password: 'synthetic-private', domain: 'cloud.invalid' }];
  });
});
describe('ICC controls cannot borrow another signed-in agent', () => {
  const session = { loggedIn: true, agentId: 30, vdnId: 2, workNO: '2001' };
  it('binds an omitted AgentID to the actual signed-in session', () => {
    expect(ownedCcsPayload(session, 'DoAgentReleaseCall', { CallID: 50 })).toEqual({ CallID: 50, AgentID: 30 });
  });
  it('denies a foreign AgentID or VDN', () => {
    expect(() => ownedCcsPayload(session, 'DoAgentReleaseCall', { AgentID: 40 })).toThrow(expect.objectContaining({ statusCode: 403 }));
    expect(() => ownedCcsPayload(session, 'DoAgentCallOut', { VDNID: 1 })).toThrow(expect.objectContaining({ statusCode: 403 }));
  });
  it('does not allow call control without a signed-in agent', () => {
    expect(() => ownedCcsPayload({ ...session, loggedIn: false, agentId: null }, 'DoAgentAnswerCall', {})).toThrow(expect.objectContaining({ statusCode: 403 }));
  });
  it('login cannot substitute another work number', () => {
    expect(() => ownedCcsPayload(session, 'DoAgentLoginEx', { workNO: 'other-user' })).toThrow(expect.objectContaining({ statusCode: 403 }));
  });
  it('duplicate WorkNO callbacks never select the first tenant by accident', () => {
    const pending = new Map([['x', { method: 'DoAgentLoginEx' }]]);
    const one = { userId: 10, workNO: '2001', vdnId: 1, pending };
    const two = { userId: 20, workNO: '2001', vdnId: 2, pending };
    expect(loginCallbackSession([one, two], { workNO: '2001' })).toBeUndefined();
    expect(loginCallbackSession([one, two], { workNO: '2001', VDNID: 2 })).toBe(two);
  });
});
describe('SIP identity is owned by the live tenant binding', () => {
  it('credential reads join the enabled parent, exact VDN and exact realm', async () => {
    await getSipCredentials({ userId: 10, workNo: '2001', vdnId: 2 });
    const [sql, params] = m.query.mock.calls.find(([sql]) => sql.includes('t_icc_sip_directory'))!;
    expect(sql).toContain('JOIN t_icc_base_extension');
    expect(sql).toContain('d.vdn_id = ?');
    expect(sql).toContain('e.IsValid = 1');
    expect(sql).not.toContain("domain = '*'");
    expect(params).toEqual(['9002', 2, 'cloud.invalid']);
  });
  it('returns the authenticated account/VDN rather than a process default', async () => {
    const r = await getSipCredentials({ userId: 10, workNo: '2001', vdnId: 2 });
    expect(r).toMatchObject({ username: '9002', identity: { user_id: 10, account_id: 82, vdn_id: 2 },
      proxy: { host: 'omni.seami.cloud', port: 5064, transport: 'tls' }, srtp: 'required' });
  });
  it.each([{ vdnId: 1 }, { workNo: 'other-user' }])('rejects foreign caller identity %j', async changes => {
    await expect(getSipCredentials({ userId: 10, workNo: '2001', vdnId: 2, ...changes })).rejects.toMatchObject({ statusCode: 403 });
  });
  it('does not return credentials after source membership is revoked', async () => {
    m.live.mockRejectedValue(Object.assign(new Error('revoked'), { statusCode: 403 }));
    await expect(getSipCredentials({ userId: 10, workNo: '2001', vdnId: 2 })).rejects.toMatchObject({ statusCode: 403 });
  });
  it('rejects a stale signed-in extension from a different VDN', async () => {
    m.session.mockReturnValue({ extension: '9001', vdnId: 1, workNO: '2001', loggedIn: true });
    await expect(getSipCredentials({ userId: 10, workNo: '2001', vdnId: 2 })).rejects.toMatchObject({ statusCode: 403 });
  });
  it('a stale signed-in extension cannot borrow another same-VDN agent phone', async () => {
    m.session.mockReturnValue({ extension: '9003', vdnId: 2, workNO: '2001', loggedIn: true });
    await expect(getSipCredentials({ userId: 10, workNo: '2001', vdnId: 2 })).rejects.toMatchObject({ statusCode: 409 });
  });
  it.each([[], [{ vdn: 1, enabled: 1 }], [{ vdn: 2, enabled: 0 }], [{ vdn: 2, enabled: 1 }, { vdn: 1, enabled: 1 }]].map(extensions => ({ extensions })))('rejects missing, foreign, disabled or ambiguous extension ownership', async ({ extensions }) => {
    m.query.mockImplementation(async (sql: string) => sql.includes('AS phone_extension') ? [{ source_user_id: 21, phone_extension: '9002' }]
      : sql.includes('t_icc_agent_video_config') ? [] : sql.includes('COALESCE') ? [{ extension: '9002' }]
      : sql.includes('FROM t_icc_base_extension') ? extensions : [{ password: 'synthetic-private', domain: 'cloud.invalid' }]);
    await expect(getSipCredentials({ userId: 10, workNo: '2001', vdnId: 2 })).rejects.toMatchObject({ statusCode: 403 });
  });
  it('does not silently downgrade managed accounts to UDP or optional SRTP', async () => {
    m.env.SIP_SBC_TRANSPORT = 'udp';
    await expect(getSipCredentials({ userId: 10, workNo: '2001', vdnId: 2 })).rejects.toMatchObject({ statusCode: 503 });
    m.env.SIP_SBC_TRANSPORT = 'tls'; m.env.SIP_SRTP = 'optional';
    await expect(getSipCredentials({ userId: 10, workNo: '2001', vdnId: 2 })).rejects.toMatchObject({ statusCode: 503 });
  });
});
