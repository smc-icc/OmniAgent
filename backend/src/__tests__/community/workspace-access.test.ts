import Fastify from 'fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ enabled: false, type: 'Channel::Voice', handler: vi.fn() }));
vi.mock('../../modules/product-modules/authority.js', () => ({ productModules: () => ({ snapshot: async () => ({ modules: { icc: { available: m.enabled } } }) }) }));
vi.mock('../../shared/services/conf-tenancy.js', () => ({ confTenancyEnabled: () => false }));
vi.mock('../../modules/access/access.context.js', () => ({ context: vi.fn(), getAccess: async () => ({ userId: 1, accountId: 1, vdnId: 1, permissions: ['conversation.read'], scopes: { 'conversation.read': ['account'] } }) }));
vi.mock('../../plugins/db.js', () => ({ prisma: { users: { findMany: async () => [{ id: 1 }] }, conversations: { findFirst: async () => ({ id: 289, inbox: { channel_type: m.type } }) } } }));
vi.mock('../../modules/access/access.scope.js', async original => ({ ...await original() as any, resolveScope: async () => ({ userId: 1, accountId: 1, vdnId: 1, all: true, userIds: [1] }), conversationScope: () => ({}) }));
import { installAccessGuard } from '../../modules/access/access.guard.js';
import { registerErrorHandler } from '../../shared/errors/index.js';
const apps: ReturnType<typeof Fastify>[] = [];
beforeEach(() => { vi.resetAllMocks(); m.enabled = false; m.type = 'Channel::Voice'; });
afterEach(async () => { await Promise.all(apps.splice(0).map(a => a.close())); });
async function call() {
  const app = Fastify(); apps.push(app); registerErrorHandler(app);
  app.decorate('authenticate', async () => {});
  app.addHook('onRequest', async req => { (req as any).currentUser = { id: 1, uid: '1001' }; });
  installAccessGuard(app);
  app.get('/api/omnichannel/sessions/:id/messages', async () => { m.handler(); return { items: [] }; });
  return app.inject('/api/omnichannel/sessions/c289/messages');
}
it('Community blocks direct phone conversation URLs before reading their messages', async () => {
  const response = await call(); expect(response.statusCode).toBe(403); expect(m.handler).not.toHaveBeenCalled();
});
it('Community keeps direct online conversation URLs accessible', async () => {
  m.type = 'Channel::WebWidget'; expect((await call()).statusCode).toBe(200); expect(m.handler).toHaveBeenCalledOnce();
});
it('valid enabled ICC allows the same phone conversation URL', async () => {
  m.enabled = true; expect((await call()).statusCode).toBe(200); expect(m.handler).toHaveBeenCalledOnce();
});
