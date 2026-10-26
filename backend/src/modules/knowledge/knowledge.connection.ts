import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { RagflowClient } from '../../integrations/ragflow/ragflow.client.js';
import { AppError } from '../../shared/errors/index.js';

const connection = z.object({ accountId: z.number().int().positive(), vdnId: z.number().int().positive(),
  baseUrl: z.string().url(), apiKey: z.string().min(1), tenantId: z.string().min(1), embeddingModel: z.string().min(1), rerankModel: z.string().optional() }).strict();
export async function knowledgeConnection(accountId: number, vdnId: number) {
  const file = process.env.KNOWLEDGE_TENANT_CONFIG_FILE;
  if (!file) throw new AppError(503, '当前 VDN 尚未开通知识库服务', 'knowledge_not_provisioned');
  const configs = z.array(connection).parse(JSON.parse(await readFile(file, 'utf8')));
  const found = configs.filter(x => x.accountId === accountId && x.vdnId === vdnId);
  if (found.length !== 1 || configs.some(x => (x.accountId !== accountId || x.vdnId !== vdnId) && (x.apiKey === found[0]?.apiKey || x.tenantId === found[0]?.tenantId))) {
    throw new AppError(503, '知识库租户连接未配置或不独立', 'knowledge_not_provisioned');
  }
  const config = found[0]!;
  const url = new URL(config.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new AppError(503, '知识库服务连接配置无效');
  return { config, credentialRef: `vdn:${accountId}:${vdnId}`, client: new RagflowClient({ baseUrl: config.baseUrl, apiKey: config.apiKey, timeoutMs: 60_000 }) };
}
