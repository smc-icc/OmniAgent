import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { loadHubConfig } from '../integrations/hub/config/loader.js';
import { startHub, type HubHandle } from '../integrations/hub/runtime.js';
import { getIccMysqlPool } from '../shared/services/icc-groups-dal.js';
import { createSocketIoSink, voicemailSocketPayload } from '../integrations/hub/sinks/socketio.sink.js';
import type { SinkAdapter } from '../integrations/hub/sinks/sink.js';
import type { RedisStreamClient } from '../integrations/hub/ingest/mq.source.js';
import { verifyHttpSignature } from '../integrations/hub/sinks/http-verify.js';
import { isBusinessEvent } from '../integrations/hub/contract/event.js';
import {
  handleHubHealth,
  handleHubMetrics,
  handleListDlq,
  handleReplayDlq,
  handleReplayDlqBySink,
  handleHubArchive,
  handleHubReconcile,
} from '../integrations/hub/admin/handlers.js';

declare module 'fastify' {
  interface FastifyInstance {
    hub?: HubHandle;
  }
}

async function registerOmniNotify(fastify: FastifyInstance) {
  await fastify.register(async (app) => {
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
      done(null, body);
    });
    app.post('/internal/hub/events', async (req, reply) => {
      const secret = process.env.HUB_TO_OMNI_SECRET ?? '';
      if (!secret) return reply.code(503).send({ ok: false, error: 'HUB_TO_OMNI_SECRET unset' });
      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
      const ts = String(req.headers['x-icc-timestamp'] ?? '');
      const sig = String(req.headers['x-icc-signature'] ?? '');
      const v = verifyHttpSignature({ secret, timestamp: ts, rawBody, signature: sig });
      if (!v.ok) return reply.code(401).send({ ok: false, error: v.error });
      let event: unknown;
      try { event = JSON.parse(rawBody); } catch { return reply.code(400).send({ ok: false, error: 'invalid json' }); }
      if (!isBusinessEvent(event)) return reply.code(400).send({ ok: false, error: 'invalid event' });
      if (fastify.io) {
        if (event.eventType.startsWith('icc.voicemail.')) {
          fastify.io.emit('voicemail.created', voicemailSocketPayload(event));
        } else {
          fastify.io.emit(event.eventType, event);
        }
      }
      return { ok: true };
    });
  });
}

async function hubPlugin(fastify: FastifyInstance) {
  await registerOmniNotify(fastify);

  const config = loadHubConfig(process.env);
  if (!config.enabled) {
    fastify.log.info('ICC Integration Hub disabled (HUB_ENABLED=0); omni_notify 仍可收事件');
    return;
  }

  const mysql = await getIccMysqlPool();
  const extraSinks: SinkAdapter[] = [];
  if (fastify.io && (config.role === 'inline' || config.role === 'worker')) {
    extraSinks.push(createSocketIoSink({
      name: 'agent_ws',
      emit: (eventName, payload) => {
        fastify.io.emit(eventName, payload);
      },
    }));
  }
  const handle = await startHub({
    config,
    log: {
      info: (obj, msg) => fastify.log.info(obj, msg),
      warn: (obj, msg) => fastify.log.warn(obj, msg),
      error: (obj, msg) => fastify.log.error(obj, msg),
      debug: (obj, msg) => fastify.log.debug(obj, msg),
    },
    prisma: fastify.prisma,
    mysql,
    redis: fastify.redis as unknown as RedisStreamClient,
    extraSinks,
  });
  fastify.decorate('hub', handle);

  fastify.get('/internal/hub/health', async (_req, reply) => {
    const r = await handleHubHealth(handle, config);
    return reply.code(r.status).send(r.body);
  });

  fastify.get('/internal/hub/metrics', async (_req, reply) => {
    const accept = String(_req.headers.accept ?? '');
    const q = _req.query as { format?: string };
    const format = accept.includes('text/plain') || q.format === 'prom' ? 'prom' : 'json';
    const r = handleHubMetrics(handle, format);
    if (r.contentType) return reply.type(r.contentType).send(r.body);
    return r.body;
  });

  fastify.get('/internal/hub/dlq', async (req) => {
    const r = await handleListDlq(handle, req.query as { sink?: string; limit?: string });
    return r.body;
  });

  fastify.post('/internal/hub/dlq/:id/replay', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const r = await handleReplayDlq(handle, id);
    return reply.code(r.status).send(r.body);
  });

  fastify.post('/internal/hub/dlq/replay', async (req, reply) => {
    const body = (req.body ?? {}) as { sink?: string; limit?: number };
    const q = req.query as { sink?: string };
    const r = await handleReplayDlqBySink(handle, body.sink ?? q.sink, body.limit);
    return reply.code(r.status).send(r.body);
  });

  fastify.post('/internal/hub/reconcile', async (req, reply) => {
    const body = (req.body ?? {}) as { day?: string };
    const q = req.query as { day?: string };
    const r = await handleHubReconcile(handle, body.day ?? q.day);
    return reply.code(r.status).send(r.body);
  });

  fastify.post('/internal/hub/archive', async (_req, reply) => {
    const r = await handleHubArchive(handle);
    return reply.code(r.status).send(r.body);
  });

  fastify.addHook('onClose', async () => {
    await handle.stop();
  });
}

export default fp(hubPlugin, { name: 'icc-hub', dependencies: ['db'] });
