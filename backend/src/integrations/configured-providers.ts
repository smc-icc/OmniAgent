import { env, type EnvConfig } from '../config/env.js';
import { RagflowClient } from './ragflow/ragflow.client.js';

export type InstalledProvider = 'knowledge' | 'embedding' | 'reranker' | 'tts' | 'asr';
export interface ProviderConnection {
  readonly mode: 'local' | 'external';
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

/** Private server-side connection settings; never serialize this to a route. */
export function providerConnection(name: InstalledProvider, config: EnvConfig = env): ProviderConnection | null {
  const prefix = name.toUpperCase();
  const mode = config[`${prefix}_MODE` as keyof EnvConfig];
  if (mode === undefined || mode === '' || mode === 'skip') return null;
  const baseUrl = config[`${prefix}_BASE_URL` as keyof EnvConfig];
  const apiKey = config[`${prefix}_API_KEY` as keyof EnvConfig];
  const model = config[`${prefix}_MODEL` as keyof EnvConfig];
  if ((mode !== 'external' && mode !== 'local') || typeof baseUrl !== 'string'
      || typeof apiKey !== 'string' || typeof model !== 'string'
      || (mode === 'external' && !apiKey)) throw new Error('provider_config_invalid');
  try {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('invalid_url');
    }
  } catch { throw new Error('provider_config_invalid'); }
  return { mode, baseUrl, apiKey, model };
}

/** RAGFlow API base is the origin (not /api/v1); callers enforce tenant/document scope. */
export function configuredKnowledgeClient(config: EnvConfig = env, fetchImpl?: typeof fetch): RagflowClient | null {
  const connection = providerConnection('knowledge', config);
  if (!connection) return null;
  if (!connection.apiKey) return null; // Local RAGFlow needs an administrator-issued tenant key.
  return new RagflowClient({ baseUrl: connection.baseUrl, apiKey: connection.apiKey, fetchImpl });
}
