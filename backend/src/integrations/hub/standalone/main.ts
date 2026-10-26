/**
 * ICC Integration Hub 独立进程。
 * 不加载 OmniAgent 坐席路由 / Fastify app。
 *
 *   HUB_ENABLED=1 HUB_ROLE=standalone HUB_PORT=3010 pnpm hub:standalone
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { loadHubConfig } from '../config/loader.js';
import { startHub } from '../runtime.js';
import {
  handleHubHealth,
  handleHubLiveness,
  handleHubMetrics,
  handleListDlq,
  handleReplayDlq,
  handleReplayDlqBySink,
  handleHubArchive,
  handleHubReconcile,
} from '../admin/handlers.js';
import { createStandaloneMysqlPool } from './mysql-pool.js';

const log = {
  info(obj: object, msg: string) { console.log(JSON.stringify({ level: 'info', msg, ...obj })); },
  warn(obj: object, msg: string) { console.warn(JSON.stringify({ level: 'warn', msg, ...obj })); },
  error(obj: object, msg: string) { console.error(JSON.stringify({ level: 'error', msg, ...obj })); },
};

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, body: unknown, contentType?: string) {
  const json = typeof body === 'string';
  const payload = json ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': contentType ?? (json ? 'text/plain; charset=utf-8' : 'application/json') });
  res.end(payload);
}

function queryOf(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { out[k] = v; });
  return out;
}

async function main(): Promise<void> {
  const config = loadHubConfig(process.env);
  if (!config.enabled) {
    console.error('HUB_ENABLED=0，standalone 拒绝启动');
    process.exit(1);
  }
  if (config.role !== 'standalone') {
    log.warn({ role: config.role }, '建议 HUB_ROLE=standalone；本进程仍不加载坐席 API');
  }

  const mysql = createStandaloneMysqlPool();
  let prisma: PrismaClient | undefined;
  if (process.env.DATABASE_URL) {
    prisma = new PrismaClient();
    await prisma.$connect();
  }

  const handle = await startHub({ config, log, prisma, mysql });
  const port = Number(process.env.HUB_PORT || 3010);
  const host = process.env.HUB_HOST || '0.0.0.0';

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const method = req.method ?? 'GET';
      const path = url.pathname;

      if (method === 'GET' && (path === '/healthz' || path === '/livez')) {
        const r = handleHubLiveness(config);
        return send(res, r.status, r.body);
      }
      if (method === 'GET' && (path === '/readyz' || path === '/internal/hub/health')) {
        const r = await handleHubHealth(handle, config);
        return send(res, r.status, r.body);
      }
      if (method === 'GET' && path === '/internal/hub/metrics') {
        const format = url.searchParams.get('format') === 'prom' || String(req.headers.accept ?? '').includes('text/plain')
          ? 'prom' : 'json';
        const r = handleHubMetrics(handle, format);
        return send(res, r.status, r.body, r.contentType);
      }
      if (method === 'GET' && path === '/internal/hub/dlq') {
        const r = await handleListDlq(handle, queryOf(url));
        return send(res, r.status, r.body);
      }
      const replayOne = path.match(/^\/internal\/hub\/dlq\/(\d+)\/replay$/);
      if (method === 'POST' && replayOne) {
        const r = await handleReplayDlq(handle, Number(replayOne[1]));
        return send(res, r.status, r.body);
      }
      if (method === 'POST' && path === '/internal/hub/dlq/replay') {
        let body: { sink?: string; limit?: number } = {};
        try { body = JSON.parse(await readBody(req) || '{}') as { sink?: string; limit?: number }; } catch { /* */ }
        const r = await handleReplayDlqBySink(handle, body.sink ?? url.searchParams.get('sink') ?? undefined, body.limit);
        return send(res, r.status, r.body);
      }
      if (method === 'POST' && path === '/internal/hub/reconcile') {
        let body: { day?: string } = {};
        try { body = JSON.parse(await readBody(req) || '{}') as { day?: string }; } catch { /* */ }
        const r = await handleHubReconcile(handle, body.day ?? url.searchParams.get('day') ?? undefined);
        return send(res, r.status, r.body);
      }
      if (method === 'POST' && path === '/internal/hub/archive') {
        const r = await handleHubArchive(handle);
        return send(res, r.status, r.body);
      }
      send(res, 404, { error: 'not found' });
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'standalone request failed');
      send(res, 500, { error: 'internal' });
    }
  });

  server.listen(port, host, () => {
    log.info({ host, port, role: config.role }, 'ICC Integration Hub standalone listening');
  });

  const shutdown = async () => {
    server.close();
    await handle.stop();
    await mysql?.end();
    await prisma?.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
