import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { EnvConfig } from '../../config/env.js';
import { configuredKnowledgeClient, providerConnection } from '../../integrations/configured-providers.js';

function config(values: Record<string, string>): EnvConfig {
  return values as unknown as EnvConfig;
}

describe('private installed-provider connections', () => {
  it('skip/unspecified returns no connection even with a stale key', () => {
    expect(providerConnection('knowledge', config({ KNOWLEDGE_MODE: 'skip', KNOWLEDGE_API_KEY: 'stale' }))).toBeNull();
    expect(providerConnection('tts', config({}))).toBeNull();
  });
  it('accepts local services without a cloud key but requires a tenant key for the RAGFlow client', () => {
    const local = config({ KNOWLEDGE_MODE: 'local', KNOWLEDGE_BASE_URL: 'http://ragflow-api:80', KNOWLEDGE_API_KEY: '', KNOWLEDGE_MODEL: '' });
    expect(providerConnection('knowledge', local)?.mode).toBe('local');
    expect(configuredKnowledgeClient(local)).toBeNull();
  });
  it.each(['ftp://bad.test', 'https://user:private@bad.test', 'https://bad.test?api_key=private', 'https://bad.test#private'])('rejects invalid URL without echoing secrets: %s', (url) => {
    const c = config({ TTS_MODE: 'external', TTS_BASE_URL: url, TTS_API_KEY: 'private-sentinel', TTS_MODEL: 'model' });
    expect(() => providerConnection('tts', c)).toThrow('provider_config_invalid');
    try { providerConnection('tts', c); } catch (error) { expect(String(error)).not.toContain('private'); }
  });
  it('rejects an external service with no key', () => {
    expect(() => providerConnection('asr', config({ ASR_MODE: 'external', ASR_BASE_URL: 'http://asr.test', ASR_MODEL: 'model', ASR_API_KEY: '' }))).toThrow('provider_config_invalid');
  });
  it('uses the supplied RAGFlow origin and Bearer key in a private server-side request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { ok: true } }), { status: 200 }));
    const c = config({ KNOWLEDGE_MODE: 'external', KNOWLEDGE_BASE_URL: 'https://knowledge.test', KNOWLEDGE_API_KEY: 'synthetic-key', KNOWLEDGE_MODEL: '' });
    const client = configuredKnowledgeClient(c, fetchImpl);
    expect(await client?.get('/system/ping')).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith('https://knowledge.test/api/v1/system/ping', expect.objectContaining({ headers: { Authorization: 'Bearer synthetic-key' } }));
  });
});
