import { api } from './client'
export type SearchKind = 'conversations' | 'messages' | 'knowledge' | 'documents' | 'announcements' | 'calendar' | 'tickets' | 'contacts' | 'memos'
export interface SearchItem { id: number; title: string; snippet: string; route: string; updated_at?: string }
export interface GlobalSearchResponse { query: string; total: number; results: Record<SearchKind, SearchItem[]> }
export async function globalSearch(q: string, types?: SearchKind[]) {
  const { data } = await api.get<GlobalSearchResponse>('/api/search/global', { params: { q, types: types?.length ? types.join(',') : undefined, limit: 8 } })
  return data
}
