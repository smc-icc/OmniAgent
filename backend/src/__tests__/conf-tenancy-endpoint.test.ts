import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
const m = vi.hoisted(() => ({ vdn: vi.fn(), user: vi.fn(), env: { PLATFORM_SYNC_SECRET: '' } }));
vi.mock('../config/env.js', () => ({ env: m.env }));
vi.mock('../shared/services/conf-tenancy-sync.js', () => ({ syncVdn: m.vdn, syncManagedUser: m.user }));
vi.mock('../shared/services/conf-tenancy.js', () => ({ confTenancyEnabled: () => process.env.CONF_TENANCY_ENABLED === '1' }));
import { syncConfVdn, syncConfManagedUser } from '../modules/platform_config/conf-tenancy-sync.js';
const body = { action: 'upsert', vdn_id: 2, source_user_id: 20, work_no: '2001' };
async function send(payload: any = body, token: any = 'synthetic-token', kind = 'user') {
  const app = Fastify(); app.post('/sync', kind === 'user' ? syncConfManagedUser : syncConfVdn);
  try { return await app.inject({ method: 'POST', url: '/sync', payload, headers: token === undefined ? {} : { 'x-platform-sync-token': token } }); } finally { await app.close(); }
}
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('CONF_TENANCY_ENABLED', '1'); m.env.PLATFORM_SYNC_SECRET = 'synthetic-token'; m.user.mockResolvedValue({ user_id: 10 }); m.vdn.mockResolvedValue({ account_id: 71 }); });
afterEach(() => vi.unstubAllEnvs());
describe('minimal mandatory-secret source projection endpoints', () => {
  it('requires configured secret even in test mode', async () => { m.env.PLATFORM_SYNC_SECRET = ''; expect((await send()).statusCode).toBe(503); expect(m.user).not.toHaveBeenCalled(); });
  it.each(['', 'wrong', ['synthetic-token', 'wrong']])('rejects invalid token %j', async token => { expect((await send(body, token)).statusCode).toBe(401); expect(m.user).not.toHaveBeenCalled(); });
  it('rejects disabled tenancy', async () => { vi.stubEnv('CONF_TENANCY_ENABLED', '0'); expect((await send()).statusCode).toBe(409); expect(m.user).not.toHaveBeenCalled(); });
  it.each([{ ...body, role: 0 }, { ...body, password: 'never-accept-password' }, { ...body, enabled: true }, { ...body, account_id: 82 }, { ...body, source_user_id: 0 }, { ...body, vdn_id: -100 }])('rejects client authority/status/credentials %j', async payload => {
    const res = await send(payload); expect(res.statusCode).toBe(400); expect(res.body).not.toContain('never-accept-password'); expect(m.user).not.toHaveBeenCalled();
  });
  it('accepts authenticated identity references only', async () => { const res = await send(); expect(res.statusCode).toBe(200); expect(m.user).toHaveBeenCalledWith(body); });
  it('supports explicit VDN account binding with a trusted token', async () => { const payload = { action: 'upsert', vdn_id: 2, account_id: 71 }; expect((await send(payload, 'synthetic-token', 'vdn')).statusCode).toBe(200); expect(m.vdn).toHaveBeenCalledWith(payload); });
  it('never returns source/SQL secrets on rejection', async () => { m.user.mockRejectedValue(new Error('password=secret SQL exception')); const res = await send(); expect(res.statusCode).toBe(409); expect(res.body).not.toContain('secret SQL'); });
});
