import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ config: vi.fn() }));
vi.mock('../shared/services/video-agent-config.js', () => ({ getVideoAgentConfig: m.config }));
vi.mock('../modules/product-modules/authority.js', () => ({ productModules: () => ({ snapshot: async () => ({ modules: { icc: { available: true } } }) }) }));
import { getAgentProfile } from '../modules/omnichannel/omnichannel.routes.js';
import { accessScope } from '../modules/access/access.scope.js';
beforeEach(() => { vi.stubEnv('OMNI_EXTENSION_BINDING_ENABLED', '0'); });
it('includes the safe video config in the current agent profile', async () => {
  const config = { enabled: true, same_extension: false, phone_extension: '', extension: '9902', web_sip_enabled: true, web_video_enabled: true, video_extension_mode: 'independent_video', web_enabled: true, mobile_enabled: false, password_configured: true, revision: 7 };
  m.config.mockResolvedValue(config);
  const send = vi.fn(value => value);
  await accessScope.run({ vdnId: 2 } as any, () => getAgentProfile({ currentUser: { id: 10, uid: 'seat10', name: 'Seat' }, server: {} } as any, { send } as any));
  const payload = send.mock.calls[0]![0] as { video_config: typeof config };
  expect(payload.video_config).toEqual(config); expect(payload.video_config).not.toHaveProperty('password');
  expect(m.config).toHaveBeenCalledWith({ userId: 10, workNo: 'seat10', vdnId: 2 });
});

