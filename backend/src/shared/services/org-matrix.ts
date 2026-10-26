import { context } from '../../modules/access/access.context.js';
import { confTenancyEnabled } from './conf-tenancy.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { prisma } from '../../plugins/db.js';
import { loadGroupSkillMatrix, loadVdnDefaultItrFlowId } from './icc-groups-dal.js';

function inboxItrBinding(inbox: {
  id: number;
  name: string;
  channel_type: string | null;
  auto_assignment_config: unknown;
}) {
  const cfg =
    inbox.auto_assignment_config && typeof inbox.auto_assignment_config === 'object'
      ? (inbox.auto_assignment_config as Record<string, unknown>)
      : {};
  return {
    id: inbox.id,
    name: inbox.name,
    channel_type: inbox.channel_type,
    itr_flow_id: Number(cfg.itr_flow_id ?? cfg.itrFlowId ?? 0) || null,
    itr_enabled: cfg.itr_enabled !== false,
  };
}

async function listItrFlows(): Promise<Array<{ id: number; name: string }>> {
  const fallback = [
    { id: 1000, name: '默认直转人工' },
    { id: 1001, name: '标准在线转人工' },
    { id: 1002, name: '绑定验证流程' },
  ];
  try {
    const base = (env.ITR_HTTP_BASE || 'http://127.0.0.1:9400').replace(/\/$/, '');
    const r = await fetch(`${base}/health`);
    if (!r.ok) return fallback;
    const j = (await r.json()) as { flows?: Array<{ id?: number; name?: string }> };
    const items = (j.flows || [])
      .map((f) => ({ id: Number(f.id), name: String(f.name || f.id || '') }))
      .filter((f) => f.id > 0);
    return items.length ? items : fallback;
  } catch {
    return fallback;
  }
}

export async function buildOrgMatrix(opts: { vdnId: number; accountId: number }) {
  const vdnId = opts.vdnId > 0 ? opts.vdnId : env.OMNI_AGENT_VDN_ID || 1;
  const accountId = opts.accountId > 0 ? opts.accountId : 1;
  const [groups, vdnDefaultFlowId, inboxes, flows] = await Promise.all([
    loadGroupSkillMatrix(vdnId),
    loadVdnDefaultItrFlowId(vdnId),
    prisma.inboxes.findMany({
      where: { account_id: accountId },
      select: { id: true, name: true, channel_type: true, auto_assignment_config: true },
      orderBy: { id: 'asc' },
    }),
    listItrFlows(),
  ]);
  return {
    vdnId,
    vdnDefaultFlowId,
    groups,
    inboxes: inboxes.map(inboxItrBinding),
    flows,
  };
}

export async function getOrgMatrix(req: FastifyRequest, reply: FastifyReply) {
  if (confTenancyEnabled()) {
    const ctx = await context(req); return reply.send(await buildOrgMatrix({ vdnId: ctx.vdnId, accountId: ctx.accountId }));
  }
  const q = req.query as { vdnId?: string; account_id?: string };
  const vdnId = Number(q.vdnId || req.server.ccsBridge?.getSession(req.currentUser?.id ?? 0)?.vdnId || env.OMNI_AGENT_VDN_ID || 1);
  const accountId = Number(q.account_id || req.currentAccount?.id || req.currentUser?.accounts?.[0]?.id || 1);
  return reply.send(await buildOrgMatrix({ vdnId, accountId }));
}
