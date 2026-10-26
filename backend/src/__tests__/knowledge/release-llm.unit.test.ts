import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const mocks = vi.hoisted(() => ({
  config: {} as Record<string, string | undefined>,
  getConfig: vi.fn(), create: vi.fn(), construct: vi.fn(),
}));
vi.mock('../../config/env.js', () => ({ env: mocks.config }));
vi.mock('../../plugins/platform_config.js', () => ({ getConfig: mocks.getConfig }));
vi.mock('openai', () => ({ default: class {
  constructor(options: unknown) { mocks.construct(options); }
  chat = { completions: { create: mocks.create } };
} }));
import llmPlugin from '../../plugins/llm.js';

beforeEach(() => {
  for (const key of Object.keys(mocks.config)) delete mocks.config[key];
  vi.clearAllMocks();
  mocks.getConfig.mockResolvedValue('legacy-database-key');
  mocks.create.mockResolvedValue({ choices: [{ message: { content: 'isolated answer' } }] });
});

describe('release LLM configuration authority', () => {
  it('skip avoids the database and provider even if a stale key exists', async () => {
    Object.assign(mocks.config, { OPENAI_MODE: 'skip', OPENAI_API_KEY: 'stale-key' });
    mocks.getConfig.mockRejectedValue(new Error('DB must not be queried'));
    const app = Fastify();
    try {
      await app.register(llmPlugin); await app.ready();
      await app.llm.chat([{ role: 'user', content: 'hi' }]);
      expect(mocks.getConfig).not.toHaveBeenCalled();
      expect(mocks.construct).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it('external uses install-time URL/key/model, not an old database key', async () => {
    Object.assign(mocks.config, { OPENAI_MODE: 'external', OPENAI_API_KEY: 'install-key', OPENAI_BASE_URL: 'https://llm.test/v1', OPENAI_MODEL: 'configured-model' });
    const app = Fastify();
    try {
      await app.register(llmPlugin); await app.ready();
      expect(await app.llm.chat([{ role: 'user', content: 'hi' }])).toBe('isolated answer');
      expect(mocks.getConfig).not.toHaveBeenCalled();
      expect(mocks.construct).toHaveBeenCalledWith({ apiKey: 'install-key', baseURL: 'https://llm.test/v1' });
      expect(mocks.create).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'configured-model' }));
      await app.llm.chat([], { model: 'explicit-model' });
      expect(mocks.create).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'explicit-model' }));
    } finally { await app.close(); }
  });
  it('keeps legacy DB-first behavior if the installer did not set a mode', async () => {
    mocks.config.OPENAI_API_KEY = 'legacy-env-key';
    const app = Fastify();
    try {
      await app.register(llmPlugin); await app.ready();
      expect(mocks.getConfig).toHaveBeenCalledWith('openai_api_key');
      expect(mocks.construct).toHaveBeenCalledWith({ apiKey: 'legacy-database-key' });
    } finally { await app.close(); }
  });
});
