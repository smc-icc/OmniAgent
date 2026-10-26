import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ enabled: true, map: vi.fn(), vdn: vi.fn(), channel: vi.fn(), mp: vi.fn(), inbox: vi.fn() }));
vi.mock('../plugins/db.js', () => ({ prisma: { conf_vdn_accounts: { findUnique: m.map }, channel_wechat_mp: { findUnique: m.mp }, channel_api: { findUnique: m.channel }, channel_telegram: { findUnique: m.channel }, inboxes: { findMany: m.inbox } } }));
vi.mock('../shared/services/conf-tenancy.js', () => ({ confTenancyEnabled: () => m.enabled, sourceVdn: m.vdn }));
import { resolveChannelAccount, assertChannelOwnership } from '../shared/services/conf-channel-tenancy.js';
beforeEach(() => { m.enabled = true; m.map.mockReset().mockResolvedValue({ account_id: 70, vdn_id: 2, enabled: true }); m.vdn.mockReset().mockResolvedValue({ id: 2 }); m.channel.mockReset().mockResolvedValue({ id: 9, account_id: 70 }); m.mp.mockReset().mockResolvedValue(null); m.inbox.mockReset().mockResolvedValue([{ account_id: 70, channel_type: 'Channel::Telegram' }]); });
describe('trusted source channel tenant ownership', () => {
  it('derives account from a live persistent VDN mapping', async () => { expect(await resolveChannelAccount({ vdn_id: 2 })).toBe(70); });
  it('accepts an explicit account only if it has a live mapping', async () => { expect(await resolveChannelAccount({ account_id: 70 })).toBe(70); });
  it('never inherits account1 or conflicting selectors in managed mode', async () => { await expect(resolveChannelAccount({})).rejects.toMatchObject({ statusCode: 400 }); await expect(resolveChannelAccount({ vdn_id: 2, account_id: 1 })).rejects.toMatchObject({ statusCode: 403 }); });
  it('rejects deleted VDNs and tombstones', async () => { m.vdn.mockResolvedValue(null); await expect(resolveChannelAccount({ vdn_id: 2 })).rejects.toThrow(); m.vdn.mockResolvedValue({ id: 2 }); m.map.mockResolvedValue({ enabled: false }); await expect(resolveChannelAccount({ vdn_id: 2 })).rejects.toThrow(); });
  it('update/delete cannot use another account channel ID', async () => { m.channel.mockResolvedValue({ id: 9, account_id: 71 }); await expect(assertChannelOwnership(70, 'telegram', 9)).rejects.toMatchObject({ statusCode: 403 }); expect(m.inbox).not.toHaveBeenCalled(); });
  it('checks existing inbox account too', async () => { m.inbox.mockResolvedValue([{ account_id: 71, channel_type: 'Channel::Telegram' }]); await expect(assertChannelOwnership(70, 'telegram', 9)).rejects.toThrow(); });
  it('shared API table IDs cannot be relabeled into Weibo or miniprogram', async () => { m.inbox.mockResolvedValue([{ account_id: 70, channel_type: 'Channel::Api' }]); await expect(assertChannelOwnership(70, 'weibo', 9)).rejects.toThrow(); });
  it('duplicate AppID never implicitly takes over another tenant', async () => { m.mp.mockResolvedValue({ id: 9, account_id: 71 }); await expect(assertChannelOwnership(70, 'wechat_mp', null, { app_id: 'same-app' })).rejects.toMatchObject({ statusCode: 409 }); });
  it('nested account selector cannot overwrite mapped ownership', async () => { await expect(assertChannelOwnership(70, 'telegram', null, { account_id: 71 })).rejects.toThrow(); });
  it('new channels with no prior identity can be created for mapped account', async () => { await assertChannelOwnership(70, 'telegram'); expect(m.channel).not.toHaveBeenCalled(); });
  it('legacy mode retains account1 behavior only when the feature is off', async () => { m.enabled = false; expect(await resolveChannelAccount({})).toBe(1); await assertChannelOwnership(1, 'telegram', 9); expect(m.channel).not.toHaveBeenCalled(); });
});
