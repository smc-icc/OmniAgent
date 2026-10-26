import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import {
  aiqcAckAlert,
  aiqcAnalytics,
  aiqcCreateRectification,
  aiqcCreateRulePackage,
  aiqcCreateRuleVersion,
  aiqcGetPublishedRules,
  aiqcGetResultDetail,
  aiqcListAlerts,
  aiqcListAppeals,
  aiqcListAuditLogs,
  aiqcListRectifications,
  aiqcListRulePackages,
  aiqcPublishRuleVersion,
  aiqcQueryResults,
  aiqcResolveAppeal,
  aiqcReview,
  aiqcSubmit,
  aiqcSubmitAppeal,
  aiqcUpdateRectification,
  type AIQCResponse,
} from '../../integrations/aiqc/aiqc-client.js';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? value as JsonRecord : {};
}

function stateForUi(value: unknown): string {
  const state = String(value || '');
  return ({ pending: 'queued', done: 'completed', cancelled: 'closed' } as Record<string, string>)[state] || state;
}

function sendAIQC(reply: FastifyReply, response: AIQCResponse, payload?: unknown) {
  if (response.result === 0) return reply.send(payload ?? response.payload ?? {});
  const status = response.result === 1 ? 400 : response.result === 2 ? 404 : response.result === 3 ? 409 : 502;
  return reply.code(status).send({
    error: 'aiqc_error',
    code: response.result,
    message: response.message,
    state: response.state,
  });
}

function normalizeItem(value: unknown) {
  const row = asRecord(value);
  const meta = asRecord(row.meta);
  return {
    id: String(row.taskId ?? row.id ?? ''),
    agent: String(meta.agent ?? meta.agentName ?? ''),
    work_no: String(meta.workNo ?? meta.work_no ?? ''),
    call_id: String(meta.callId ?? meta.call_id ?? row.sessionRef ?? ''),
    duration: Number(meta.duration ?? meta.durationSec ?? 0),
    score: Number(row.score ?? 0),
    findings_count: Number(row.findingsCount ?? 0),
    risk_level: String(row.riskLevel ?? 'low'),
    status: stateForUi(row.state),
    created_at: String(row.createdAt ?? new Date(0).toISOString()),
    session_ref: String(row.sessionRef ?? ''),
    policy_id: String(row.policyId ?? ''),
  };
}

function userContext(req: FastifyRequest) {
  return {
    actorId: req.currentUser?.id ?? 0,
    actorName: req.currentUser?.name ?? '',
    accountId: req.currentAccount?.id ?? 0,
  };
}

function validRecordingUri(value: string): boolean {
  if (!value || value.length > 2048 || /[\r\n]/.test(value)) return false;
  return /^(s3|https?|sftp|file):\/\//i.test(value) || value.startsWith('/');
}

export async function aiqcRoutes(fastify: FastifyInstance) {
  const protectedRoute = { preHandler: [fastify.authenticate] };

  fastify.post('/api/v1/qc/tasks', protectedRoute, async (req, reply) => {
    const body = asRecord(req.body);
    const sessionRef = String(body.session_ref ?? '').trim();
    const recordingUri = String(body.recording_uri ?? '').trim();
    if (!sessionRef) return reply.code(400).send({ error: 'session_ref_required' });
    if (!validRecordingUri(recordingUri)) {
      return reply.code(400).send({ error: 'invalid_recording_uri' });
    }
    const requestedEngine = String(
      body.asr_engine ?? asRecord(body.meta).asrEngine ?? 'funasr',
    ).trim().toLowerCase();
    if (!['funasr', 'whisper'].includes(requestedEngine)) {
      return reply.code(400).send({ error: 'invalid_asr_engine' });
    }
    const taskId = randomUUID();
    const response = await aiqcSubmit({
      taskId,
      sessionRef,
      recordingUri,
      policyId: String(body.policy_id ?? ''),
      meta: {
        ...asRecord(body.meta),
        asrEngine: requestedEngine,
        ...userContext(req),
      },
    });
    return sendAIQC(reply, response, { task_id: taskId, state: stateForUi(response.state) });
  });

  fastify.get('/api/v1/qc/results/stats', protectedRoute, async (req, reply) => {
    const response = await aiqcAnalytics({ type: 'overview', ...asRecord(req.query), ...userContext(req) });
    if (response.result !== 0) return sendAIQC(reply, response);
    const payload = asRecord(response.payload);
    const counts = asRecord(payload.byState);
    return reply.send({
      total_this_month: Number(payload.total ?? 0),
      avg_score: Number(payload.avgScore ?? 0),
      passed_rate: Number(payload.passedRate ?? 0),
      queued_count: Number(counts.pending ?? counts.queued ?? 0),
      reviewing_count: Number(counts.reviewing ?? 0),
      failed_count: Number(counts.failed ?? 0),
      high_risk_count: Number(payload.highRiskCount ?? 0),
    });
  });

  fastify.get('/api/v1/qc/results', protectedRoute, async (req, reply) => {
    const query = asRecord(req.query);
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.max(1, Math.min(100, Number(query.page_size ?? 20)));
    const status = String(query.status ?? '');
    const response = await aiqcQueryResults({
      state: ({ queued: 'pending', completed: 'done', closed: 'cancelled' } as Record<string, string>)[status] || status,
      sessionRef: query.session_ref,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      ...userContext(req),
    });
    if (response.result !== 0) return sendAIQC(reply, response);
    const payload = asRecord(response.payload);
    const items = Array.isArray(payload.items) ? payload.items.map(normalizeItem) : [];
    return reply.send({ items, total: Number(payload.total ?? items.length), page, page_size: pageSize });
  });

  fastify.get('/api/v1/qc/results/:id', protectedRoute, async (req, reply) => {
    const { id } = req.params as { id: string };
    const response = await aiqcGetResultDetail(id);
    if (response.result !== 0) return sendAIQC(reply, response);
    const detail = asRecord(response.payload);
    return reply.send({
      ...normalizeItem(detail),
      policy_name: String(detail.policyName ?? ''),
      dimensions: Array.isArray(detail.dimensions) ? detail.dimensions : [],
      transcript: Array.isArray(detail.transcript) ? detail.transcript : [],
      findings: Array.isArray(detail.findings) ? detail.findings : [],
    });
  });

  fastify.post('/api/v1/qc/results/:id/review', protectedRoute, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = asRecord(req.body);
    const score = Number(body.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      return reply.code(400).send({ error: 'invalid_score' });
    }
    const response = await aiqcReview(id, {
      score,
      comment: String(body.comment ?? ''),
      reviewerId: req.currentUser?.id ?? 0,
      reviewerName: req.currentUser?.name ?? '',
    });
    return sendAIQC(reply, response);
  });

  fastify.post('/api/internal/aiqc/task-updated', async (req, reply) => {
    const token = String(req.headers['x-aiqc-token'] ?? '').trim();
    if (!env.AIQC_CALLBACK_TOKEN || token !== env.AIQC_CALLBACK_TOKEN) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const event = asRecord(req.body);
    fastify.io?.emit('aiqc.task.updated', event);
    return reply.send({ ok: true });
  });

  // ── Analytics (six types) ──────────────────────────────────────────

  fastify.get('/api/v1/qc/analytics/:type', protectedRoute, async (req, reply) => {
    const { type } = req.params as { type: string };
    const allowed = ['overview', 'hot-topics', 'hot-keywords', 'repeat-calls', 'business-focus', 'results'];
    if (!allowed.includes(type)) return reply.code(400).send({ error: 'unknown_analytics_type' });
    const response = await aiqcAnalytics({ type, ...asRecord(req.query), ...userContext(req) });
    return sendAIQC(reply, response, response.payload ?? {});
  });

  // ── Realtime alerts ────────────────────────────────────────────────

  fastify.get('/api/v1/qc/alerts', protectedRoute, async (req, reply) => {
    const response = await aiqcListAlerts({ ...asRecord(req.query), ...userContext(req) });
    return sendAIQC(reply, response, response.payload ?? { items: [] });
  });

  fastify.post('/api/v1/qc/alerts/:id/ack', protectedRoute, async (req, reply) => {
    const { id } = req.params as { id: string };
    const alertId = Number(id);
    if (!Number.isInteger(alertId)) return reply.code(400).send({ error: 'invalid_alert_id' });
    const response = await aiqcAckAlert(alertId, req.currentUser?.name ?? '');
    return sendAIQC(reply, response, response.payload ?? {});
  });

  // ── Rule packages / versions ───────────────────────────────────────

  fastify.get('/api/v1/qc/rules/packages', protectedRoute, async (_req, reply) => {
    const response = await aiqcListRulePackages();
    return sendAIQC(reply, response, response.payload ?? { items: [] });
  });

  fastify.post('/api/v1/qc/rules/packages', protectedRoute, async (req, reply) => {
    const body = asRecord(req.body);
    const response = await aiqcCreateRulePackage({ ...body, actor: req.currentUser?.name ?? '' });
    return sendAIQC(reply, response, response.payload ?? {});
  });

  fastify.post('/api/v1/qc/rules/versions', protectedRoute, async (req, reply) => {
    const body = asRecord(req.body);
    const response = await aiqcCreateRuleVersion({ ...body, actor: req.currentUser?.name ?? '' });
    return sendAIQC(reply, response, response.payload ?? {});
  });

  fastify.post('/api/v1/qc/rules/versions/:id/publish', protectedRoute, async (req, reply) => {
    const { id } = req.params as { id: string };
    const versionId = Number(id);
    if (!Number.isInteger(versionId)) return reply.code(400).send({ error: 'invalid_version_id' });
    const response = await aiqcPublishRuleVersion(versionId, req.currentUser?.name ?? '');
    return sendAIQC(reply, response, response.payload ?? {});
  });

  fastify.get('/api/v1/qc/rules/published', protectedRoute, async (req, reply) => {
    const packageCode = String(asRecord(req.query).package_code ?? '');
    const response = await aiqcGetPublishedRules(packageCode || undefined);
    return sendAIQC(reply, response, response.payload ?? {});
  });

  // ── Appeals ────────────────────────────────────────────────────────

  fastify.get('/api/v1/qc/appeals', protectedRoute, async (req, reply) => {
    const response = await aiqcListAppeals({ ...asRecord(req.query), ...userContext(req) });
    return sendAIQC(reply, response, response.payload ?? { items: [] });
  });

  fastify.post('/api/v1/qc/results/:id/appeal', protectedRoute, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = asRecord(req.body);
    const reason = String(body.reason ?? '').trim();
    if (!reason) return reply.code(400).send({ error: 'reason_required' });
    const response = await aiqcSubmitAppeal({
      taskId: id,
      reason,
      appellantId: req.currentUser?.name ?? '',
    });
    return sendAIQC(reply, response, response.payload ?? {});
  });

  fastify.post('/api/v1/qc/appeals/:id/resolve', protectedRoute, async (req, reply) => {
    const { id } = req.params as { id: string };
    const appealId = Number(id);
    if (!Number.isInteger(appealId)) return reply.code(400).send({ error: 'invalid_appeal_id' });
    const body = asRecord(req.body);
    const state = String(body.state ?? '');
    if (!['adjudicated', 'rejected'].includes(state)) {
      return reply.code(400).send({ error: 'invalid_state' });
    }
    const response = await aiqcResolveAppeal({
      appealId,
      state,
      resolution: String(body.resolution ?? ''),
      actor: req.currentUser?.name ?? '',
    });
    return sendAIQC(reply, response, response.payload ?? {});
  });

  // ── Rectifications ─────────────────────────────────────────────────

  fastify.get('/api/v1/qc/rectifications', protectedRoute, async (req, reply) => {
    const response = await aiqcListRectifications({ ...asRecord(req.query), ...userContext(req) });
    return sendAIQC(reply, response, response.payload ?? { items: [] });
  });

  fastify.post('/api/v1/qc/results/:id/rectification', protectedRoute, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = asRecord(req.body);
    const title = String(body.title ?? '').trim();
    if (!title) return reply.code(400).send({ error: 'title_required' });
    const response = await aiqcCreateRectification({
      taskId: id,
      title,
      assignee: String(body.assignee ?? ''),
      description: String(body.description ?? ''),
      dueAt: String(body.due_at ?? ''),
      actor: req.currentUser?.name ?? '',
    });
    return sendAIQC(reply, response, response.payload ?? {});
  });

  fastify.post('/api/v1/qc/rectifications/:id/state', protectedRoute, async (req, reply) => {
    const { id } = req.params as { id: string };
    const rectificationId = Number(id);
    if (!Number.isInteger(rectificationId)) return reply.code(400).send({ error: 'invalid_rectification_id' });
    const body = asRecord(req.body);
    const state = String(body.state ?? '');
    if (!['open', 'in_progress', 'closed'].includes(state)) {
      return reply.code(400).send({ error: 'invalid_state' });
    }
    const response = await aiqcUpdateRectification({
      rectificationId,
      state,
      actor: req.currentUser?.name ?? '',
    });
    return sendAIQC(reply, response, response.payload ?? {});
  });

  // ── Audit logs ─────────────────────────────────────────────────────

  fastify.get('/api/v1/qc/audit-logs', protectedRoute, async (req, reply) => {
    const response = await aiqcListAuditLogs({ ...asRecord(req.query), ...userContext(req) });
    return sendAIQC(reply, response, response.payload ?? { items: [] });
  });
}
