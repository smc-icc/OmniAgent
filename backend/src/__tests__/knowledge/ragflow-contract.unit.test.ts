import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/ragflow/source-derived-cases.json';
import {
  assertTestTarget, inspectEnvelope, inspectRunState, assertSources,
  contractRetrievalBody, redactEvidence,
} from '../../integrations/ragflow/ragflow.contract.js';

describe('RAGFlow contract safety', () => {
  const target = {
    environment: 'isolated-test', baseUrl: 'http://localhost:19380',
    allowedOrigin: 'http://localhost:19380', dedicatedTenant: true,
    datasetPrefix: 'omni-contract-', credentialFile: '/run/secrets/test-key',
    embeddingModel: 'test-embedding', imageDigest: `sha256:${'a'.repeat(64)}`,
    sourceCommit: '183bed69ded49c60bb1804419c9e13a9ca3abd70', apiScheme: 'python',
  };
  it('requires an explicitly isolated tenant and exact allowed origin before writes', () => {
    expect(() => assertTestTarget(target)).not.toThrow();
    for (const change of [
      { environment: 'production' }, { dedicatedTenant: false },
      { baseUrl: 'http://other-host:19380' }, { baseUrl: 'http://key@localhost:19380' },
      { baseUrl: 'http://localhost:19380/api/v1' }, { datasetPrefix: '' },
      { imageDigest: 'latest' }, { apiScheme: 'go' }, { sourceCommit: 'other' },
    ]) expect(() => assertTestTarget({ ...target, ...change })).toThrow();
  });
  it('rejects HTTP 200 business failures and preserves partial upload IDs for reconciliation', () => {
    expect(inspectEnvelope(200, fixtures.cases.businessFailure).state).toBe('failed');
    expect(inspectEnvelope(200, fixtures.cases.partialUpload)).toMatchObject({
      state: 'partial', successfulIds: ['fixture-successful-document'],
    });
    expect(inspectEnvelope(503, { code: 0, data: [] }).state).toBe('failed');
    expect(() => inspectEnvelope(200, { code: '0' })).toThrow('invalid_envelope');
  });
  it.each([
    [0, 'queued'], ['0', 'queued'], ['UNSTART', 'queued'],
    [1, 'parsing'], ['RUNNING', 'parsing'], [2, 'cancelled'], ['CANCEL', 'cancelled'],
    [3, 'done'], ['DONE', 'done'], [4, 'failed'], ['FAIL', 'failed'],
    [5, 'queued'], ['SCHEDULE', 'queued'],
  ])('maps documented run %s to %s', (run, expected) => {
    expect(inspectRunState(run)).toBe(expected);
  });
  it('fails closed on unknown run states', () => {
    for (const state of [null, undefined, true, 6, 'COMPLETED', '', 'constructor']) {
      expect(() => inspectRunState(state)).toThrow('unknown_run_state');
    }
  });
  it('prevents accidental empty allowlists and disables expansion', () => {
    expect(() => contractRetrievalBody('ds', [], 'q')).toThrow('empty_document_allowlist');
    expect(contractRetrievalBody('ds', ['doc'], 'q')).toMatchObject({
      document_ids: ['doc'], use_kg: false, toc_enhance: false,
      include_knowledge_compilation: false, keyword: false, cross_languages: [],
    });
  });
  it('rejects the entire retrieval when any source is foreign or missing', () => {
    const allowed = { id: 'c1', dataset_id: 'ds', document_id: 'a', content: 'allowed' };
    expect(() => assertSources([allowed], 'ds', ['a'])).not.toThrow();
    for (const foreign of [{ ...allowed, document_id: 'b' }, { ...allowed, dataset_id: 'other' }, { content: 'no source' }]) {
      expect(() => assertSources([allowed, foreign], 'ds', ['a'])).toThrow('unauthorized_retrieval_source');
    }
  });
  it('records shapes and positions without retaining secret, text or URL fields', () => {
    const result = redactEvidence({ code: 500, message: 'secret', data: {
      id: 'raw-id', content: 'customer text', authorization: 'Bearer secret',
      positions: [[2, 10, 20, 30, 40]], arbitrary: 'secret',
    } });
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/secret|customer text|raw-id/);
    expect(json).toContain('[2,10,20,30,40]');
  });
});
