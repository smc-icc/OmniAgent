import { describe, expect, it } from 'vitest';
import { RagflowClient } from '../../integrations/ragflow/ragflow.client.js';

const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('RAGFlow HTTP client', () => {
  it('surfaces HTTP 200 business failures', async () => {
    const client = new RagflowClient({ baseUrl: 'http://ragflow.test', apiKey: 'secret', fetchImpl: async () => response(200, { code: 101, message: 'invalid' }) });
    await expect(client.get('/datasets')).rejects.toMatchObject({ code: 101 });
  });

  it('retries a read after 429 and returns the successful payload', async () => {
    let attempts = 0;
    const client = new RagflowClient({ baseUrl: 'http://ragflow.test', apiKey: 'secret', retryDelayMs: 0, fetchImpl: async () => ++attempts === 1 ? response(429, { code: 429 }) : response(200, { code: 0, data: [] }) });
    await expect(client.get('/datasets')).resolves.toEqual([]);
    expect(attempts).toBe(2);
  });

  it('returns uncertain for a write that times out', async () => {
    const client = new RagflowClient({ baseUrl: 'http://ragflow.test', apiKey: 'secret', timeoutMs: 1, fetchImpl: async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) });
    await expect(client.post('/datasets', { name: 'x' })).resolves.toMatchObject({ state: 'uncertain' });
  });
});
