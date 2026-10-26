import { describe, expect, it } from 'vitest';
// The evaluator is a standalone, dependency-free ESM CLI used on the server.
// @ts-expect-error JavaScript CLI deliberately has no generated declaration.
import { validateAnswer } from '../../../scripts/evaluate-knowledge-acceptance.mjs';
const test = { answered: true, requiredExact: ['ID123', '123.45', '2026-10-11'], forbiddenExact: ['TENANT_B'], allowedDocuments: ['a'] };
const answer = () => ({ answered: true, mode: 'extractive', answer: '[1] ID123 123.45 2026-10-11',
  sources: [{ number: 1, documentId: 'doc-a', versionId: 'v', chunkId: 'c', content: 'ID123 123.45 2026-10-11' }] });
describe('maintained corpus evaluator', () => {
  it('accepts exact source quotations with a permitted citation', () => expect(() => validateAnswer(test, answer(), { a: 'doc-a' })).not.toThrow());
  it('fails an altered identifier', () => expect(() => validateAnswer(test, { ...answer(), answer: 'ID124 123.45 2026-10-11' }, { a: 'doc-a' })).toThrow('required_literal_missing'));
  it('fails a cross-VDN citation', () => { const a = answer(); a.sources[0].documentId = 'doc-b'; expect(() => validateAnswer(test, a, { a: 'doc-a' })).toThrow('unauthorized_citation'); });
  it('fails leakage even if only present in the citation', () => { const a = answer(); a.sources[0].content += ' TENANT_B'; expect(() => validateAnswer(test, a, { a: 'doc-a' })).toThrow('forbidden_literal_exposed'); });
  it('fails an uncited model-written suffix', () => expect(() => validateAnswer(test, { ...answer(), answer: answer().answer + '\nInvented answer' }, { a: 'doc-a' })).toThrow('unattributed_answer_text'));
  it('requires an explicit refusal with no citations', () => expect(() => validateAnswer({ ...test, answered: false, requiredExact: [] }, { answered: false, answer: 'refused', sources: [] }, {})).not.toThrow());
});
