import Fastify from 'fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ available: false, video: vi.fn(), binding: vi.fn(), session: vi.fn() }));
vi.mock('../../modules/product-modules/authority.js', () => ({ productModules: () => ({ snapshot: async () => ({ modules: { icc: { available: m.available } } }) }) }));
vi.mock('../../shared/services/video-agent-config.js', () => ({ getVideoAgentConfig: m.video }));
vi.mock('../../modules/extension-binding/service.js', () => ({ bindingSnapshot: m.binding }));
import { dashboardProfile, getAgentProfile } from '../../modules/omnichannel/omnichannel.routes.js';
const apps: ReturnType<typeof Fastify>[] = [];
beforeEach(() => { vi.resetAllMocks(); m.available = false; vi.stubEnv('OMNI_EXTENSION_BINDING_ENABLED', '0'); });
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(apps.splice(0).map(a => a.close())); });
function request() { return { currentUser: { id: 26, uid: 'online-only', name: 'Online agent' }, server: { ccsBridge: { getSession: m.session } } } as any; }
it('Community profile does not query extension, video or CCS configuration', async () => {
  vi.stubEnv('OMNI_EXTENSION_BINDING_ENABLED', '1');
  const send = vi.fn(v => v);
  await getAgentProfile(request(), { send } as any);
  expect(m.binding).not.toHaveBeenCalled(); expect(m.video).not.toHaveBeenCalled(); expect(m.session).not.toHaveBeenCalled();
  expect(send.mock.calls[0]?.[0]).toMatchObject({ name: 'Online agent', ccs_logged_in: false, extension: '' });
});
it('enabled ICC retains the configured video profile', async () => {
  m.available = true; m.video.mockResolvedValue({ enabled: true, revision: 7 });
  const send = vi.fn(v => v); await getAgentProfile(request(), { send } as any);
  expect(m.video).toHaveBeenCalledTimes(1); expect(send.mock.calls[0]?.[0].video_config).toEqual({ enabled: true, revision: 7 });
});
it('dashboard awaits profile errors so Fastify returns an HTTP error', async () => {
  m.available = true; m.video.mockRejectedValue(Object.assign(new Error('video unavailable'), { statusCode: 503 }));
  const app = Fastify(); apps.push(app);
  app.addHook('preHandler', async req => { (req as any).currentUser = { id: 26, uid: 'online-only' }; });
  app.get('/profile', dashboardProfile);
  expect((await app.inject('/profile')).statusCode).toBe(503);
});
