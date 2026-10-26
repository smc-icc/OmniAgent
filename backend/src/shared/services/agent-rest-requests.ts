/**
 * 话务小休申请记录：坐席看自己发起的；班长看自己审批过的。
 */
import type { PrismaClient } from '@prisma/client';

export type RestRequestStatus = 'pending' | 'approved' | 'rejected' | 'self_approved';

export type RestRequestRow = {
  id: number;
  applicant_agent_id: number;
  applicant_work_no: string;
  applicant_name: string;
  leader_agent_id: number | null;
  leader_work_no: string;
  leader_name: string;
  content: string;
  status: RestRequestStatus;
  requested_at: string;
  approved_at: string | null;
  approve_opinion: string;
  duration_sec: number;
};

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function mapRow(r: {
  id: number;
  applicant_agent_id: number;
  applicant_work_no: string;
  applicant_name: string;
  leader_agent_id: number | null;
  leader_work_no: string;
  leader_name: string;
  content: string;
  status: string;
  requested_at: Date;
  approved_at: Date | null;
  approve_opinion: string;
  duration_sec: number;
}): RestRequestRow {
  return {
    id: r.id,
    applicant_agent_id: r.applicant_agent_id,
    applicant_work_no: r.applicant_work_no,
    applicant_name: r.applicant_name,
    leader_agent_id: r.leader_agent_id,
    leader_work_no: r.leader_work_no,
    leader_name: r.leader_name,
    content: r.content,
    status: r.status as RestRequestStatus,
    requested_at: r.requested_at.toISOString(),
    approved_at: iso(r.approved_at),
    approve_opinion: r.approve_opinion,
    duration_sec: r.duration_sec ?? 0,
  };
}

export async function createRestRequest(
  prisma: PrismaClient,
  input: {
    applicantUserId: number;
    applicantAgentId: number;
    applicantWorkNo: string;
    applicantName: string;
    leaderUserId?: number | null;
    leaderAgentId?: number | null;
    leaderWorkNo?: string;
    leaderName?: string;
    content: string;
    auxCode?: number;
    /** 申请时长（秒） */
    durationSec?: number;
    /** 无班长自己批时直接通过 */
    selfApproved?: boolean;
  },
): Promise<RestRequestRow> {
  const self = !!input.selfApproved || !input.leaderAgentId || input.leaderAgentId === input.applicantAgentId;
  const now = new Date();
  const durationSec = Math.max(0, Math.floor(Number(input.durationSec ?? 0) || 0));
  const row = await prisma.agent_rest_requests.create({
    data: {
      applicant_user_id: input.applicantUserId,
      applicant_agent_id: input.applicantAgentId,
      applicant_work_no: input.applicantWorkNo || String(input.applicantAgentId),
      applicant_name: input.applicantName || input.applicantWorkNo || String(input.applicantAgentId),
      leader_user_id: self ? input.applicantUserId : (input.leaderUserId ?? null),
      leader_agent_id: self ? input.applicantAgentId : (input.leaderAgentId ?? null),
      leader_work_no: self
        ? (input.applicantWorkNo || String(input.applicantAgentId))
        : (input.leaderWorkNo || String(input.leaderAgentId ?? '')),
      leader_name: self
        ? (input.applicantName || input.applicantWorkNo || '本人')
        : (input.leaderName || input.leaderWorkNo || String(input.leaderAgentId ?? '')),
      content: (input.content || '申请小休').trim() || '申请小休',
      status: self ? 'self_approved' : 'pending',
      requested_at: now,
      approved_at: self ? now : null,
      approve_opinion: self ? '无班长在线，系统自动通过' : '',
      duration_sec: durationSec,
      aux_code: input.auxCode ?? 0,
    },
  });
  return mapRow(row);
}

/** 班长侧收到申请事件时：若尚无 pending 记录则补一条。 */
export async function ensurePendingRestRequest(
  prisma: PrismaClient,
  input: {
    applicantAgentId: number;
    applicantWorkNo: string;
    applicantName: string;
    leaderUserId: number;
    leaderAgentId: number;
    leaderWorkNo: string;
    leaderName: string;
    content: string;
    durationSec?: number;
    auxCode?: number;
  },
): Promise<RestRequestRow | null> {
  const recent = await prisma.agent_rest_requests.findFirst({
    where: {
      applicant_agent_id: input.applicantAgentId,
      leader_agent_id: input.leaderAgentId,
      status: 'pending',
      requested_at: { gte: new Date(Date.now() - 10 * 60 * 1000) },
    },
    orderBy: { requested_at: 'desc' },
  });
  if (recent) {
    const patch: { content?: string; duration_sec?: number; aux_code?: number } = {};
    if (input.content && recent.content !== input.content) patch.content = input.content;
    if (input.durationSec != null && input.durationSec > 0 && recent.duration_sec !== input.durationSec) {
      patch.duration_sec = input.durationSec;
    }
    if (input.auxCode != null && recent.aux_code !== input.auxCode) patch.aux_code = input.auxCode;
    if (Object.keys(patch).length) {
      const updated = await prisma.agent_rest_requests.update({
        where: { id: recent.id },
        data: patch,
      });
      return mapRow(updated);
    }
    return mapRow(recent);
  }
  const applicantUser = await prisma.users.findFirst({
    where: {
      OR: [
        { uid: input.applicantWorkNo },
        { email: { contains: input.applicantWorkNo } },
      ],
    },
    select: { id: true, name: true },
  });
  if (!applicantUser) return null;
  return createRestRequest(prisma, {
    applicantUserId: applicantUser.id,
    applicantAgentId: input.applicantAgentId,
    applicantWorkNo: input.applicantWorkNo,
    applicantName: input.applicantName || applicantUser.name,
    leaderUserId: input.leaderUserId,
    leaderAgentId: input.leaderAgentId,
    leaderWorkNo: input.leaderWorkNo,
    leaderName: input.leaderName,
    content: input.content,
    durationSec: input.durationSec,
    auxCode: input.auxCode,
  });
}

export async function decideRestRequest(
  prisma: PrismaClient,
  input: {
    applicantAgentId: number;
    leaderUserId: number;
    leaderAgentId: number;
    leaderWorkNo: string;
    leaderName: string;
    status: 'approved' | 'rejected';
    opinion: string;
    /** 审批生效时长（秒）；同意时写入 */
    durationSec?: number;
  },
): Promise<RestRequestRow | null> {
  const pending = await prisma.agent_rest_requests.findFirst({
    where: {
      applicant_agent_id: input.applicantAgentId,
      status: 'pending',
      OR: [
        { leader_agent_id: input.leaderAgentId },
        { leader_agent_id: null },
      ],
    },
    orderBy: { requested_at: 'desc' },
  });
  if (!pending) return null;
  const durationSec =
    input.status === 'approved'
      ? Math.max(0, Math.floor(Number(input.durationSec ?? pending.duration_sec) || 0))
      : pending.duration_sec;
  const updated = await prisma.agent_rest_requests.update({
    where: { id: pending.id },
    data: {
      status: input.status,
      approved_at: new Date(),
      approve_opinion: (input.opinion || '').trim(),
      leader_user_id: input.leaderUserId,
      leader_agent_id: input.leaderAgentId,
      leader_work_no: input.leaderWorkNo || String(input.leaderAgentId),
      leader_name: input.leaderName || input.leaderWorkNo || String(input.leaderAgentId),
      duration_sec: durationSec,
    },
  });
  return mapRow(updated);
}

export async function listMyRestRequests(
  prisma: PrismaClient,
  applicantUserId: number,
  limit = 100,
): Promise<RestRequestRow[]> {
  const rows = await prisma.agent_rest_requests.findMany({
    where: { applicant_user_id: applicantUserId },
    orderBy: { requested_at: 'desc' },
    take: Math.min(Math.max(limit, 1), 200),
  });
  return rows.map(mapRow);
}

export async function listLeaderDecidedRestRequests(
  prisma: PrismaClient,
  leaderUserId: number,
  leaderAgentId: number | null,
  limit = 100,
): Promise<RestRequestRow[]> {
  const rows = await prisma.agent_rest_requests.findMany({
    where: {
      status: { in: ['approved', 'rejected'] },
      OR: [
        { leader_user_id: leaderUserId },
        ...(leaderAgentId ? [{ leader_agent_id: leaderAgentId }] : []),
      ],
    },
    orderBy: { approved_at: 'desc' },
    take: Math.min(Math.max(limit, 1), 200),
  });
  return rows.map(mapRow);
}
