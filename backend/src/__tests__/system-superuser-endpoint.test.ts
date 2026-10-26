import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
const mocks = vi.hoisted(() => ({ sync: vi.fn(), env: { PLATFORM_SYNC_SECRET: '' } }));
vi.mock('../config/env.js', () => ({ env: mocks.env }));
vi.mock('../shared/services/system-superuser.js', () => ({ syncSystemSuperuser: mocks.sync }));
import { syncSystemSuperuserFromConfServer } from '../modules/platform_config/system-superuser-sync.js';
const password = 'synthetic-only-password';
const body = { uid: 'admin', email: 'root@example.test', password, account_id: 1 };
async function send(payload: Record<string, unknown> = body, token?: string | string[]) {
  const app = Fastify();
  app.post('/api/platform-config/system-superuser/sync', syncSystemSuperuserFromConfServer);
  try { return await app.inject({ method: 'POST', url: '/api/platform-config/system-superuser/sync',
    headers: token === undefined ? {} : { 'x-platform-sync-token': token }, payload }); }
  finally { await app.close(); }
}
beforeEach(() => { vi.resetAllMocks(); mocks.env.PLATFORM_SYNC_SECRET = 'synthetic-sync-token';
  mocks.sync.mockResolvedValue({ user_id: 7, email: body.email, system_superuser: true }); });
describe('singleton sync endpoint: mandatory token even in test/dev', () => {
  it('fails closed when no secret is configured', async () => {
    mocks.env.PLATFORM_SYNC_SECRET = ''; expect((await send()).statusCode).toBe(503);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it.each([{token: undefined}, {token: 'wrong'}, {token: 'synthetic-sync-tokeN'}, {token: ['synthetic-sync-token', 'bad']}])('rejects a missing/invalid header %j', async ({ token }) => {
    expect((await send(body, token)).statusCode).toBe(401); expect(mocks.sync).not.toHaveBeenCalled();
  });
  it.each([
    { ...body, uid: 'another' }, { ...body, account_id: 0 }, { ...body, email: 'invalid' },
    { ...body, password: 'a'.repeat(73) }, { ...body, type: 'SuperAdmin' },
  ])('rejects invalid payloads without leaking a password %j', async payload => {
    const res = await send(payload, 'synthetic-sync-token');
    expect(res.statusCode).toBe(400); expect(res.body).not.toContain(password); expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('accepts only the authenticated dedicated flow', async () => {
    const res = await send(body, 'synthetic-sync-token');
    expect(res.statusCode).toBe(200); expect(mocks.sync).toHaveBeenCalledWith(body);
    expect(res.json()).toMatchObject({ success: true, data: { user_id: 7 } }); expect(res.body).not.toContain(password);
  });
  it('does not leak database exception details or credentials on failure', async () => {
    mocks.sync.mockRejectedValue(new Error(`database failure password=${password}`));
    const res = await send(body, 'synthetic-sync-token');
    expect(res.statusCode).toBe(409); expect(res.body).not.toContain(password); expect(res.body).not.toContain('database failure');
  });
});
