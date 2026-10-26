import type { RagflowClient } from '../../integrations/ragflow/ragflow.client.js';

export const parserProfile = { layout_recognize: 'Plain Text', chunk_token_num: 256, auto_keywords: 0, auto_questions: 0,
  children_delimiter: '', raptor: { use_raptor: false }, graphrag: { use_graphrag: false } };
export function uncertain(value: unknown): boolean { return !!value && typeof value === 'object' && (value as any).state === 'uncertain'; }
export function providerId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw new Error('invalid_provider_id');
  return value;
}
export async function findDataset(client: RagflowClient, name: string) {
  let match: any;
  // RAGFlow's exact-name filter reports an absent dataset as permission denied.
  // Keyword lookup returns an empty page and still enforces the token's tenant.
  for (let page = 1; page <= 100; page++) {
    const params = new URLSearchParams({ keywords: name, page: String(page), page_size: '100', orderby: 'create_time', desc: 'false' });
    const data = await client.get<any>(`/datasets?${params}`);
    if (!Array.isArray(data)) throw new Error('invalid_dataset_list');
    for (const row of data.filter(x => x.name === name)) {
      if (match) throw new Error('ambiguous_dataset');
      match = row;
    }
    if (data.length < 100) return match;
  }
  throw new Error('dataset_list_limit');
}
export async function findProviderDocument(client: RagflowClient, dataset: string, query: { name?: string; id?: string }) {
  if (!query.id && !query.name) throw new Error('document_query_required');
  let match: any;
  for (let page = 1; page <= 100; page++) {
    // The plural ID filter returns [] after deletion, unlike the singular ID
    // filter which reports absence as a permission error in this API version.
    const params = new URLSearchParams({ page: String(page), page_size: '100', orderby: 'create_time', desc: 'false',
      ...(query.id ? { ids: providerId(query.id) } : { keywords: query.name! }) });
    const data = await client.get<any>(`/datasets/${providerId(dataset)}/documents?${params}`);
    if (!Array.isArray(data?.docs)) throw new Error('invalid_document_list');
    for (const row of data.docs.filter((x: any) => query.id ? x.id === query.id : x.name === query.name)) {
      if (match) throw new Error('ambiguous_document');
      match = row;
    }
    if (data.docs.length < 100) return match;
  }
  throw new Error('document_list_limit');
}
