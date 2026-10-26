import { describe, expect, it, vi } from 'vitest';
import type { RagflowClient } from '../../integrations/ragflow/ragflow.client.js';
import { findDataset, findProviderDocument } from '../../modules/knowledge/knowledge.provider.js';

describe('knowledge dataset reconciliation', () => {
  it('uses keyword lookup so an absent dataset can be created without treating permission errors as absence', async () => {
    const get = vi.fn().mockResolvedValue([]);
    expect(await findDataset({ get } as unknown as RagflowClient, 'omni_base')).toBeUndefined();
    const query = new URL(get.mock.calls[0][0], 'http://ragflow-api').searchParams;
    expect(query.get('keywords')).toBe('omni_base');
    expect(query.has('name')).toBe(false);
  });
  it('matches exact names, not a partial keyword match', async () => {
    const get = vi.fn().mockResolvedValue([{ id: 'other', name: 'omni_base_extra' }, { id: 'expected', name: 'omni_base' }]);
    expect(await findDataset({ get } as unknown as RagflowClient, 'omni_base')).toMatchObject({ id: 'expected' });
  });
  it('checks subsequent pages before deciding absence', async () => {
    const get = vi.fn().mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => ({ name: `other_${i}` })))
      .mockResolvedValueOnce([{ id: 'expected', name: 'omni_base' }]);
    expect(await findDataset({ get } as unknown as RagflowClient, 'omni_base')).toMatchObject({ id: 'expected' });
    expect(new URL(get.mock.calls[1][0], 'http://ragflow-api').searchParams.get('page')).toBe('2');
  });
  it('rejects duplicate exact matches even across pages', async () => {
    const get = vi.fn().mockResolvedValueOnce([{ id: 'one', name: 'omni_base' }, ...Array.from({ length: 99 }, () => ({ name: 'other' }))])
      .mockResolvedValueOnce([{ id: 'two', name: 'omni_base' }]);
    await expect(findDataset({ get } as unknown as RagflowClient, 'omni_base')).rejects.toThrow('ambiguous_dataset');
  });
  it('does not turn an upstream permission failure into absence', async () => {
    const get = vi.fn().mockRejectedValue(new Error('permission_denied'));
    await expect(findDataset({ get } as unknown as RagflowClient, 'omni_base')).rejects.toThrow('permission_denied');
  });
  it('rejects malformed provider responses', async () => {
    const get = vi.fn().mockResolvedValue({ docs: [] });
    await expect(findDataset({ get } as unknown as RagflowClient, 'omni_base')).rejects.toThrow('invalid_dataset_list');
  });
});

describe('knowledge document reconciliation', () => {
  it('uses the plural ID filter to verify physical absence after deletion', async () => {
    const get = vi.fn().mockResolvedValue({ docs: [], total: 0 });
    expect(await findProviderDocument({ get } as unknown as RagflowClient, 'dataset', { id: 'document' })).toBeUndefined();
    const query = new URL(get.mock.calls[0][0], 'http://ragflow-api').searchParams;
    expect(query.get('ids')).toBe('document');
    expect(query.has('id')).toBe(false);
  });
  it('filters the response to the exact requested ID', async () => {
    const get = vi.fn().mockResolvedValue({ docs: [{ id: 'other' }, { id: 'document' }] });
    expect(await findProviderDocument({ get } as unknown as RagflowClient, 'dataset', { id: 'document' })).toMatchObject({ id: 'document' });
  });
  it('checks all name lookup pages and rejects ambiguity', async () => {
    const get = vi.fn().mockResolvedValueOnce({ docs: [{ id: 'one', name: 'original.txt' }, ...Array.from({ length: 99 }, () => ({ name: 'other' }))] })
      .mockResolvedValueOnce({ docs: [{ id: 'two', name: 'original.txt' }] });
    await expect(findProviderDocument({ get } as unknown as RagflowClient, 'dataset', { name: 'original.txt' })).rejects.toThrow('ambiguous_document');
  });
  it('never treats provider authorization errors as confirmed absence', async () => {
    const get = vi.fn().mockRejectedValue(new Error('permission_denied'));
    await expect(findProviderDocument({ get } as unknown as RagflowClient, 'dataset', { id: 'document' })).rejects.toThrow('permission_denied');
  });
});
