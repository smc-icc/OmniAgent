import { productModules } from '../product-modules/authority.js';
import { getVideoAgentConfig } from '../../shared/services/video-agent-config.js';
import { resolveCcsWorkNo } from '../../integrations/ccs/ccs-workno.js';
import { activeVdn } from '../access/access.scope.js';
import { isReservedSystemIdentity } from '../../shared/services/system-superuser.js';
import { saveAnnouncement } from '../announcements/announcements.service.js';
import { z } from 'zod';
import { context as announcementContext } from '../access/access.context.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getAccess } from '../access/access.context.js';
import { mapContentAttributesToKind } from '../../shared/services/message-kind.js';
import { ensureKnowledgeBase } from '../../shared/services/knowledge-seed.js';
import { csvEscape, parseDayRange } from '../../shared/services/omni-metrics.js';
import { countAgentUnread } from '../../shared/services/conversation-unread.js';
import {
  resolveChannelGroup,
  resolveChannelSubtypes,
  formatInboxSource,
  type ChannelGroup,
} from '../../shared/services/channel-group.js';
import { listOmniSessionRecords } from '../../shared/services/omni-session-log.js';
import { readTtsWav } from '../../shared/services/cosyvoice-tts.js';
import {
  formatTalkDuration as formatOmniTalk,
  omniEventLabel,
  omniMethodLabel,
  omniReleaseLabel,
  omniTalkSec,
  omniWaitSec,
} from '../../shared/services/omni-session-labels.js';
import {
  treeForUi,
  getSignedInSkillIds,
  setSignedInSkillIds,
  mergeSignedInSkillIds,
  signInAllSkillGroups,
  signOutAllSkillGroups,
  buildDisplayLabel,
  getGroupTree,
  setGroupTree,
  normalizeSkillIds,
  hasCachedGroupTree,
  clearGroupTree,
  displayGroupName,
  applyMediaKindsToTree,
} from '../../shared/services/agent-skill-groups.js';
import { loadGroupsByVdnFromIccDb, loadGroupMediaKindsMap } from '../../shared/services/icc-groups-dal.js';
import { getOrgMatrix } from '../../shared/services/org-matrix.js';
import {
  loadAgentsByGroup,
  loadIvrFlows,
  mapCcsAgentsToOnlineTransferAgents,
  loadTransferGroupsWithSkills,
} from '../../shared/services/icc-transfer-catalog-dal.js';
import { handleInvoke, isSignedInSynced, markSignedInSynced, clearSignedInSynced } from '../../integrations/ccs/ccs-bridge.js';
import {
  requestCallQueueList,
  sessionReleased,
  pushOmniAcdQueuing,
  mediaModeNeedsCallerCount,
} from '../../integrations/ccs/acd-client.js';
import {
  partitionAgentGroups,
  signInImsAutoCheckIn,
  signInImsOnAcd,
  signOutImsOnAcd,
} from '../../integrations/ccs/ims-acd.js';
import { env } from '../../config/env.js';
import { asAttrMap, markConversationEnded, mergeAttrs, readLifecycle } from '../../shared/services/conversation-lifecycle.js';
import {
  lookupAgentDailyTraffic,
  lookupCallCdrsByNumber,
  lookupRecordFilesByNumber,
  lookupRecordPath,
} from '../../shared/services/icc-call-dal.js';
import { matchRecordFile, phonesOverlap } from '../../shared/services/recording-match.js';
import { listRecentRecordingFiles, readRecordingBytes } from '../../shared/services/recording-access.js';
import { getSessionByUserId, getSessionByAgentId } from '../../integrations/ccs/session-manager.js';
import {
  getMediaOnlineAgents,
  getMediaSnatchTargets,
  postMediaSnatch,
  getMediaQueueSessions,
  postMediaQueueTake,
  postMediaConference,
  postMediaMonitor,
  postMediaImsForce,
} from './workspace-media.js';
import { queueByConv } from '../itr/itr-queue.js';
import {
  appendInternalMessage,
  getInternalThread,
  listInternalThreads,
  markInternalRead,
  updateRestStatus,
} from '../../shared/services/agent-internal-chat.js';
import {
  DASHBOARD_QUICK_LINKS,
  buildDashboardMetrics,
  buildChannelVolume,
  listMemos,
  createMemo,
  patchMemo,
  listAnnouncements,
  markAnnouncementsRead,
  markAnnouncementUnread,
  listCalendarEvents,
  createCalendarEvent,
  patchCalendarEvent,
  deleteCalendarEvent,
  resolveAccountId,
} from '../../shared/services/dashboard.service.js';
import {
  listCustomers,
  getCustomerDetail,
  resolveAccountIdForUser,
  patchCustomer,
  listCustomerNotes,
  createCustomerNote,
  deleteCustomerNote,
  getCustomerLabels,
  putCustomerLabels,
  listCrmLabels,
  getCustomerTimeline,
  listCompanies,
  createCompany,
  patchCompany,
  deleteCompany,
  getCompanyDetail,
  listOpportunities,
  createOpportunity,
  patchOpportunity,
  deleteOpportunity,
} from '../../shared/services/customers.service.js';
import { hashPassword, verifyPassword } from '../../shared/utils/password.js';
import { trySyncIccPassword } from '../../shared/services/icc-metrics-dal.js';
import {
  getOrCreateBoard,
  patchBoardSettings,
  addStaff,
  removeStaff,
  addLeave,
  removeLeave,
  cycleCell,
  upsertNote,
  deleteNote,
  fillHolidays2026,
  boardToCsv,
} from '../../shared/services/agent-shifts.service.js';

// ── Agent Status ──
function fmtDuration(s: number) { return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }

/** CCS_AS_EXT_*（smc_common.h StatsBit 16/17/18） */
const CCS_AS_EXT_TEMP = 65536;
const CCS_AS_EXT_NOT_EXIST = 131072;
const CCS_AS_EXT_UNREG = 262144;

function mapCcsStatusToUi(
  loggedIn: boolean,
  agentStatus: number | null | undefined,
  workMode?: 'ready' | 'busy' | 'break' | 'acw' | 'blocked',
): string {
  if (!loggedIn) return 'offline';
  const st = typeof agentStatus === 'number' ? agentStatus : 0;
  if (st === CCS_AS_EXT_UNREG) return 'ext_unregistered';
  if (st === CCS_AS_EXT_TEMP) return 'ext_unavailable';
  if (st === CCS_AS_EXT_NOT_EXIST) return 'ext_not_exist';
  if (st === 32 || st === 16) return 'ready';
  if (st === 8) return 'blocked';
  if (st === 4) return 'break';
  if (st === 1024) return 'acw';
  // 强制示闲已把 workMode 写成 ready 时，即使 agentStatus 仍停在示忙位也跟 CCS 示闲
  if (workMode === 'ready' && st === 2) return 'ready';
  if (st === 2) return 'busy';
  return workMode || 'ready';
}

export async function getAgentStatus(req: FastifyRequest, reply: FastifyReply) {
  const userId = req.currentUser?.id;
  if (!userId) return reply.status(401).send({ error: 'unauthorized' });
  const session = req.server.ccsBridge?.getSession(userId);
  const ui_status = session
    ? mapCcsStatusToUi(session.loggedIn, session.agentStatus, session.workMode)
    : 'offline';
  return reply.send({ ui_status, online_seconds: session?.loggedIn ? 1 : 0, agent_id: session?.agentId ?? null });
}
export async function putAgentStatus(req: FastifyRequest, reply: FastifyReply) {
  const { ui_status } = req.body as { ui_status: string };
  const userId = req.currentUser?.id;
  if (!userId) return reply.status(401).send({ error: 'unauthorized' });
  const session = req.server.ccsBridge?.getSession(userId);

  // offline：走 CCS LoggedOff（与 WS disconnect grace 后 logoutUser 一致），勿误调 SetIdle
  if (ui_status === 'offline') {
    try {
      await req.server.ccsBridge?.logoutUser(userId);
    } catch {
      /* best effort */
    }
    return reply.send({ ok: true, ui_status });
  }

  if (!session?.loggedIn || !session.agentId) {
    return reply.status(400).send({ error: 'CCS agent not logged in' });
  }
  // 强制示闲之后迟到的 PUT busy 不得把 session 写回示忙
  if (ui_status === 'busy' && (session.agentStatus === 32 || session.agentStatus === 16
      || session.workMode === 'ready') && session.forceIdleAt
      && Date.now() - session.forceIdleAt < 5000) {
    return reply.send({ ok: true, ui_status: 'ready' });
  }
  if (ui_status === 'ready' || ui_status === 'busy' || ui_status === 'break' || ui_status === 'acw' || ui_status === 'blocked') {
    session.workMode = ui_status as typeof session.workMode;
  }
  // 示闲/示忙已由前端直调 CCS；这里只同步 session，避免二次 SetBusy 把强制示闲冲掉
  return reply.send({ ok: true, ui_status });
}

function resolveAgentUserId(req: FastifyRequest): number {
  return req.currentUser?.id ?? 0;
}

function skillGroupsPayload(userId: number) {
  const signed_in = getSignedInSkillIds(userId);
  return {
    tree: treeForUi(userId),
    signed_in,
    display_label: buildDisplayLabel(signed_in, userId),
  };
}

async function overlayGroupMediaKinds(userId: number, vdnId?: number): Promise<void> {
  if (!vdnId || vdnId <= 0) return;
  try {
    const map = await loadGroupMediaKindsMap(vdnId);
    if (map.size) applyMediaKindsToTree(userId, map);
  } catch {
    /* ICC 不可用时签入列表仍可工作，只是没有电话/在线标记 */
  }
}

/** 从 CCSServer DoAgentGetAllGroupInfo 拉取真实技能组并缓存；已缓存或未登录时跳过。 */
async function ensureGroupTree(req: FastifyRequest, userId: number): Promise<void> {
  const session = req.server.ccsBridge?.getSession(userId);
  if (!session?.loggedIn || session.agentId == null) return;
  // 空树不算缓存：CCS 曾因缺表返回空列表，避免永久卡在「未签入」
  if (hasCachedGroupTree(userId)) {
    await overlayGroupMediaKinds(userId, session.vdnId);
    return;
  }
  try {
    await Promise.race([
      req.server.ccsBridge!.handleInvoke(
        userId,
        `groups-${Date.now()}`,
        'DoAgentGetAllGroupInfo',
        { AgentID: session.agentId, VDNID: session.vdnId },
      ).then((ack) => {
        const listRaw = (ack as { AgentGroupInfoList?: unknown } | undefined)?.AgentGroupInfoList;
        const list = Array.isArray(listRaw)
          ? listRaw
          : listRaw && typeof listRaw === 'object' && Array.isArray((listRaw as { value?: unknown }).value)
            ? ((listRaw as { value: unknown[] }).value)
            : null;
        if (Array.isArray(list)) {
          const groups = (list as Array<{ AgentGroupID?: unknown; GroupName?: unknown }>)
            .filter((g) => typeof g?.AgentGroupID === 'number')
            .map((g) => ({ id: g.AgentGroupID as number, name: String(g.GroupName ?? '') }));
          if (groups.length > 0) {
            setGroupTree(userId, groups);
            const valid = new Set(groups.map((g) => String(g.id)));
            const current = getSignedInSkillIds(userId);
            const kept = current.filter((id) => valid.has(id));
            if (kept.length !== current.length) setSignedInSkillIds(userId, kept);
          }
        }
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DoAgentGetAllGroupInfo soft-timeout')), 4000),
      ),
    ]);
  } catch (e) {
    req.log?.error?.(e, 'DoAgentGetAllGroupInfo failed');
  }
  // CCS 空/失败：按 Fucus 同源 SQL 直查 icc（t_user_group + t_icc_grouptovdn），禁止硬编码组名
  if (!hasCachedGroupTree(userId)) {
    const fromDb = await loadGroupsByVdnFromIccDb(session.vdnId);
    if (fromDb.length > 0) setGroupTree(userId, fromDb);
    else clearGroupTree(userId);
  }
  await overlayGroupMediaKinds(userId, session.vdnId);
}

function requireLoggedInSession(req: FastifyRequest): { userId: number; agentId: number; vdnId: number } | null {
  const userId = resolveAgentUserId(req);
  const session = req.server.ccsBridge?.getSession(userId);
  if (!session?.loggedIn || session.agentId == null) return null;
  return { userId, agentId: session.agentId, vdnId: session.vdnId };
}

/** 从 CCSServer DoAgentGetGroupReq 同步坐席已签入组到本地缓存（每会话仅首次，防重复 30s 超时等待）。 */
async function syncSignedInFromCcs(req: FastifyRequest, userId: number): Promise<void> {
  if (isSignedInSynced(userId)) return;
  const session = req.server.ccsBridge?.getSession(userId);
  if (!session?.loggedIn || session.agentId == null) return;
  try {
    await req.server.ccsBridge!.handleInvoke(
      userId,
      `sg-sync-${Date.now()}`,
      'DoAgentGetGroupReq',
      { AgentID: session.agentId, AgentGroupID: -1 },
    );
    // 仅成功收到末包 Ack 后才标记；超时/失败必须可重试，否则会永久锁死 signed_in=[]
    markSignedInSynced(userId);
  } catch (e) {
    req.log?.error?.(e, 'DoAgentGetGroupReq failed');
  }
}

export async function getAgentSkillGroups(req: FastifyRequest, reply: FastifyReply) {
  const userId = resolveAgentUserId(req);
  await ensureGroupTree(req, userId);
  const q = req.query as { sync?: string } | undefined;
  if (q?.sync === '1' || q?.sync === 'true') {
    clearSignedInSynced(userId);
  }
  await syncSignedInFromCcs(req, userId);
  return reply.send(skillGroupsPayload(userId));
}

async function applyTasAndImsSignIn(opts: {
  userId: number;
  agentId: number;
  vdnId: number;
  groupIds: number[];
}): Promise<void> {
  const part = await partitionAgentGroups(opts.agentId, opts.groupIds);
  if (part.tasIds.length > 0) {
    const ack = await handleInvoke(opts.userId, `sg-in-${Date.now()}`, 'DoAgentSignInGroup', {
      AgentID: opts.agentId,
      agentGroupIDs: part.tasIds,
      count: part.tasIds.length,
    });
    const rc = Number((ack as { Result?: unknown } | undefined)?.Result ?? 0);
    if (rc !== 0 && rc !== 10) {
      throw new Error(`CCS SignInGroup Result=${rc}`);
    }
  }
  if (part.imsOnlyIds.length > 0 || part.imsSkillIds.length > 0) {
    await signInImsOnAcd({
      agentId: opts.agentId,
      vdnId: opts.vdnId,
      groupIds: part.imsOnlyIds,
      skillIds: part.imsSkillIds,
    });
    mergeSignedInSkillIds(opts.userId, part.imsOnlyIds);
  }
}

async function applyTasAndImsSignOut(opts: {
  userId: number;
  agentId: number;
  vdnId: number;
  groupIds: number[];
}): Promise<void> {
  const part = await partitionAgentGroups(opts.agentId, opts.groupIds);
  if (part.tasIds.length > 0) {
    await handleInvoke(opts.userId, `sg-out-${Date.now()}`, 'DoAgentSignOutGroup', {
      AgentID: opts.agentId,
      agentGroupIDs: part.tasIds,
      count: part.tasIds.length,
    });
  }
  if (part.imsOnlyIds.length > 0 || part.imsSkillIds.length > 0) {
    await signOutImsOnAcd({
      agentId: opts.agentId,
      vdnId: opts.vdnId,
      groupIds: part.imsOnlyIds,
      skillIds: part.imsSkillIds,
    });
  }
}

export async function putAgentSkillGroups(req: FastifyRequest, reply: FastifyReply) {
  const { signed_in } = req.body as { signed_in?: string[] };
  if (!Array.isArray(signed_in)) {
    return reply.status(400).send({ error: 'signed_in must be an array' });
  }
  const login = requireLoggedInSession(req);
  if (!login) {
    return reply.status(400).send({ error: 'CCS agent not logged in' });
  }
  await ensureGroupTree(req, login.userId);
  const current = getSignedInSkillIds(login.userId);
  const next = normalizeSkillIds(login.userId, signed_in);
  const toSignIn = next.filter((id) => !current.includes(id));
  const toSignOut = current.filter((id) => !next.includes(id));
  const session = req.server.ccsBridge?.getSession(login.userId);
    if (toSignIn.length > 0) {
    if (!session?.acdQueuingConfirmed) {
      return reply.status(400).send({ error: '请先选择接听模式' });
    }
    try {
      await pushConfirmedAcdQueuing({
        agentId: session.agentId ?? login.agentId,
        vdnId: session.vdnId,
        mediaQueuingMode: session.mediaQueuingMode,
        callerCount: session.callerCount,
      });
    } catch (e) {
      return reply.status(502).send({ error: e instanceof Error ? e.message : 'ACD queuing update failed' });
    }
  }
  try {
    if (toSignIn.length > 0) {
      await applyTasAndImsSignIn({
        userId: login.userId,
        agentId: login.agentId,
        vdnId: login.vdnId,
        groupIds: toSignIn.map(Number),
      });
    }
    if (toSignOut.length > 0) {
      await applyTasAndImsSignOut({
        userId: login.userId,
        agentId: login.agentId,
        vdnId: login.vdnId,
        groupIds: toSignOut.map(Number),
      });
    }
  } catch (e) {
    return reply.status(502).send({ error: e instanceof Error ? e.message : 'CCS sign in/out failed' });
  }
  setSignedInSkillIds(login.userId, next);
  return reply.send(skillGroupsPayload(login.userId));
}

export async function postAgentSkillGroupsSignInAll(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLoggedInSession(req);
  if (!login) {
    return reply.status(400).send({ error: 'CCS agent not logged in' });
  }
  const session = req.server.ccsBridge?.getSession(login.userId);
  if (!session?.acdQueuingConfirmed) {
    return reply.status(400).send({ error: '请先选择接听模式' });
  }
  await ensureGroupTree(req, login.userId);
  const all = (getGroupTree(login.userId) ?? []).filter((n) => n.type === 'skill').map((n) => Number(n.id));
  if (all.length === 0) {
    return reply.status(409).send({
      error: 'no_skill_groups',
      message: '未获取到可签入的技能组',
      ...skillGroupsPayload(login.userId),
    });
  }
  try {
    await pushConfirmedAcdQueuing({
      agentId: session.agentId ?? login.agentId,
      vdnId: session.vdnId,
      mediaQueuingMode: session.mediaQueuingMode,
      callerCount: session.callerCount,
    });
    await applyTasAndImsSignIn({
      userId: login.userId,
      agentId: login.agentId,
      vdnId: login.vdnId,
      groupIds: all,
    });
  } catch (e) {
    return reply.status(502).send({ error: e instanceof Error ? e.message : 'CCS sign-in-all failed' });
  }
  signInAllSkillGroups(login.userId);
  return reply.send(skillGroupsPayload(login.userId));
}

export async function postAgentSkillGroupsSignOutAll(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLoggedInSession(req);
  if (!login) {
    return reply.status(400).send({ error: 'CCS agent not logged in' });
  }
  await ensureGroupTree(req, login.userId);
  const all = (getGroupTree(login.userId) ?? []).filter((n) => n.type === 'skill').map((n) => Number(n.id));
  if (all.length > 0) {
    try {
      await applyTasAndImsSignOut({
        userId: login.userId,
        agentId: login.agentId,
        vdnId: login.vdnId,
        groupIds: all,
      });
    } catch (e) {
      return reply.status(502).send({ error: e instanceof Error ? e.message : 'CCS sign-out-all failed' });
    }
  }
  signOutAllSkillGroups(login.userId);
  return reply.send(skillGroupsPayload(login.userId));
}

function acdQueuingPayload(session: {
  mediaQueuingMode?: number;
  callerCount?: number;
  acdQueuingConfirmed?: boolean;
}) {
  return {
    media_queuing_mode: session.mediaQueuingMode ?? env.OMNI_ACD_MQM,
    caller_count: session.callerCount ?? env.OMNI_ACD_CALLER_COUNT,
    queuing_confirmed: session.acdQueuingConfirmed === true,
  };
}

async function pushConfirmedAcdQueuing(session: {
  agentId: number;
  vdnId: number;
  mediaQueuingMode?: number;
  callerCount?: number;
}) {
  await pushOmniAcdQueuing({
    agentId: session.agentId,
    vdnId: session.vdnId,
    mediaQueuingMode: session.mediaQueuingMode ?? env.OMNI_ACD_MQM,
    callerCount: session.callerCount ?? env.OMNI_ACD_CALLER_COUNT,
  });
}

export async function getAgentAcdQueuing(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLoggedInSession(req);
  if (!login) {
    return reply.status(400).send({ error: 'CCS agent not logged in' });
  }
  const session = req.server.ccsBridge?.getSession(login.userId);
  return reply.send(acdQueuingPayload(session ?? {}));
}

export async function putAgentAcdQueuing(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLoggedInSession(req);
  if (!login) {
    return reply.status(400).send({ error: 'CCS agent not logged in' });
  }
  const session = req.server.ccsBridge?.getSession(login.userId);
  if (!session?.agentId) {
    return reply.status(400).send({ error: 'CCS agent not logged in' });
  }
  const body = (req.body ?? {}) as { media_queuing_mode?: number; caller_count?: number };
  const mediaQueuingMode = Number.isFinite(Number(body.media_queuing_mode))
    ? Number(body.media_queuing_mode)
    : (session.mediaQueuingMode ?? env.OMNI_ACD_MQM);
  const callerCount = Number.isFinite(Number(body.caller_count))
    ? Math.max(1, Math.floor(Number(body.caller_count)))
    : (session.callerCount ?? env.OMNI_ACD_CALLER_COUNT);
  try {
    if (body.media_queuing_mode != null) {
      session.mediaQueuingMode = mediaQueuingMode;
    }
    if (body.caller_count != null) {
      session.callerCount = callerCount;
    }
    if (mediaModeNeedsCallerCount(session.mediaQueuingMode ?? mediaQueuingMode)
      && (session.callerCount == null || session.callerCount < 1)) {
      session.callerCount = env.OMNI_ACD_CALLER_COUNT;
    }
    await pushConfirmedAcdQueuing({
      agentId: session.agentId,
      vdnId: session.vdnId,
      mediaQueuingMode: session.mediaQueuingMode,
      callerCount: session.callerCount,
    });
    const imsGroups = await signInImsAutoCheckIn(session.agentId, session.vdnId);
    if (imsGroups.length > 0) {
      mergeSignedInSkillIds(login.userId, imsGroups);
    }
    session.acdQueuingConfirmed = true;
  } catch (e) {
    return reply.status(502).send({ error: e instanceof Error ? e.message : 'ACD queuing update failed' });
  }
  return reply.send(acdQueuingPayload(session));
}

/** 转移弹窗：组→技能、IVR 流程目录（仅含当前有签入坐席的组/技能） */
export async function getTransferCatalog(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLoggedInSession(req);
  if (!login) {
    return reply.status(400).send({ error: 'CCS agent not logged in' });
  }
  const q = req.query as { mode?: string };
  const mode = q.mode === 'agent' || q.mode === 'consult' ? 'agent' : 'skill';
  let online = [] as Awaited<ReturnType<typeof mapCcsAgentsToOnlineTransferAgents>>;
  try {
    const snap = await fetchWorkspaceSnapshot(req, login);
    const session = req.server.ccsBridge?.getSession(login.userId);
    online = await mapCcsAgentsToOnlineTransferAgents(login.vdnId, snap.agents, session?.workNO);
  } catch (e) {
    req.log?.error?.(e, 'transfer catalog snapshot failed');
  }
  const [groups, ivr_flows] = await Promise.all([
    loadTransferGroupsWithSkills(login.vdnId, { mode, online }),
    loadIvrFlows(login.vdnId),
  ]);
  return reply.send({ vdn_id: login.vdnId, groups, ivr_flows });
}

/** 转移弹窗：某组下坐席（仅已签入该组的在线坐席，可搜索） */
export async function getTransferAgents(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLoggedInSession(req);
  if (!login) {
    return reply.status(400).send({ error: 'CCS agent not logged in' });
  }
  const q = req.query as { groupId?: string; search?: string };
  const groupId = Number(q.groupId || 0);
  if (!groupId) return reply.status(400).send({ error: 'groupId required' });
  const session = req.server.ccsBridge?.getSession(login.userId);
  let online = [] as Awaited<ReturnType<typeof mapCcsAgentsToOnlineTransferAgents>>;
  try {
    const snap = await fetchWorkspaceSnapshot(req, login);
    online = await mapCcsAgentsToOnlineTransferAgents(login.vdnId, snap.agents, session?.workNO);
  } catch (e) {
    req.log?.error?.(e, 'transfer agents snapshot failed');
  }
  const agents = await loadAgentsByGroup(login.vdnId, groupId, q.search || '', {
    onlineOnly: true,
    excludeWorkNo: session?.workNO,
    online,
  });
  return reply.send({ group_id: groupId, agents });
}

type WorkspaceSnatchRow = {
  agentId: number
  workNo: string
  name: string
  callerNo: string
  logicNo: number
  ringStartTime: number
  groupIds: number[]
}

type WorkspaceQueueRow = {
  logicNo: number
  callerNo: string
  groupId: number
  skillId: number
  startTime: number
  enterAcdTime: number
  vipLevel: number
}

type WorkspaceOnlineAgent = {
  agentId: number
  workNo: string
  name: string
  status: number
  extension?: string
  groupIds: number[]
}

function parseWorkspaceSnapshot(src: unknown): {
  snatch: WorkspaceSnatchRow[]
  queue: WorkspaceQueueRow[]
  agents: WorkspaceOnlineAgent[]
} {
  const empty = { snatch: [] as WorkspaceSnatchRow[], queue: [] as WorkspaceQueueRow[], agents: [] as WorkspaceOnlineAgent[] };
  let j: Record<string, unknown> | null = null;
  if (typeof src === 'string') {
    const raw = src.trim();
    if (!raw.startsWith('{')) return empty;
    try {
      j = JSON.parse(raw) as Record<string, unknown>;
    } catch (e) {
      console.warn('[workspace] snapshot JSON parse failed', String(e), raw.slice(0, 180));
      return empty;
    }
  } else if (src && typeof src === 'object') {
    j = src as Record<string, unknown>;
  } else {
    return empty;
  }
  if (!j) return empty;
  if (
    typeof j.errMsg === 'string'
    && j.errMsg.trim().startsWith('{')
    && !Array.isArray(j.queue)
  ) {
    return parseWorkspaceSnapshot(j.errMsg);
  }
  try {
    const snatch: WorkspaceSnatchRow[] = [];
    if (Array.isArray(j.snatch)) {
      for (const row of j.snatch) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Record<string, unknown>;
        const groupIds = Array.isArray(r.groupIds)
          ? r.groupIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
          : [];
        snatch.push({
          agentId: Number(r.agentId) || 0,
          workNo: String(r.workNo ?? ''),
          name: String(r.name ?? ''),
          callerNo: String(r.callerNo ?? ''),
          logicNo: Number(r.logicNo) || 0,
          ringStartTime: Number(r.ringStartTime) || 0,
          groupIds,
        });
      }
    }
    const queue: WorkspaceQueueRow[] = [];
    if (Array.isArray(j.queue)) {
      for (const row of j.queue) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Record<string, unknown>;
        queue.push({
          logicNo: Number(r.logicNo) || 0,
          callerNo: String(r.callerNo ?? ''),
          groupId: Number(r.groupId) || 0,
          skillId: Number(r.skillId) || 0,
          startTime: Number(r.startTime) || 0,
          enterAcdTime: Number(r.enterAcdTime) || 0,
          vipLevel: Number(r.vipLevel) || 0,
        });
      }
    }
    const agents: WorkspaceOnlineAgent[] = [];
    if (Array.isArray(j.agents)) {
      for (const row of j.agents) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Record<string, unknown>;
        const groupIds = Array.isArray(r.groupIds)
          ? r.groupIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
          : [];
        agents.push({
          agentId: Number(r.agentId) || 0,
          workNo: String(r.workNo ?? ''),
          name: String(r.name ?? ''),
          status: Number(r.status) || 0,
          extension: String(r.extension ?? ''),
          groupIds,
        });
      }
    }
    return { snatch, queue, agents };
  } catch {
    return empty;
  }
}

async function fetchWorkspaceSnapshot(req: FastifyRequest, login: { userId: number; agentId: number; vdnId: number }) {
  const ack = await req.server.ccsBridge!.handleInvoke(
    login.userId,
    `ws-${Date.now()}`,
    'DoQuerySysStatus',
    { VDNID: login.vdnId, AgentID: login.agentId },
  );
  const snap = parseWorkspaceSnapshot(ack?.errMsg ?? ack?.ErrMsg ?? ack);
  const errMsg = ack?.errMsg;
  console.log(
    `[workspace] user=${login.userId} vdn=${login.vdnId} queue=${snap.queue.length} snatch=${snap.snatch.length} agents=${snap.agents.length}`
      + ` errMsgType=${typeof errMsg} errMsgLen=${typeof errMsg === 'string' ? errMsg.length : -1}`,
  );
  return snap;
}

function signedInGroupMeta(userId: number): Array<{ id: number; name: string }> {
  const tree = getGroupTree(userId) ?? [];
  const nameById = new Map(tree.map((n) => [String(n.id), n.label] as const));
  let signed = getSignedInSkillIds(userId);
  if (signed.length === 0) {
    signed = tree.filter((n) => n.type === 'skill').map((n) => n.id);
  }
  return signed
    .map((id) => {
      const nid = Number(id);
      return { id: nid, name: displayGroupName(nameById.get(String(id)) || nameById.get(String(nid)), nid) };
    })
    .filter((g) => Number.isFinite(g.id) && g.id > 0);
}

export async function getWorkspaceSnatchTargets(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLoggedInSession(req);
  if (!login) return reply.status(400).send({ error: 'CCS agent not logged in' });
  await ensureGroupTree(req, login.userId);
  if (getSignedInSkillIds(login.userId).length === 0) {
    clearSignedInSynced(login.userId);
    await syncSignedInFromCcs(req, login.userId);
  }
  let snap;
  try {
    snap = await fetchWorkspaceSnapshot(req, login);
  } catch (e) {
    return reply.status(502).send({ error: e instanceof Error ? e.message : 'CCS query failed' });
  }
  const groups = signedInGroupMeta(login.userId).map((g) => ({
    id: g.id,
    name: g.name,
    agents: snap.snatch
      .filter((a) => a.agentId !== login.agentId && a.groupIds.includes(g.id))
      .sort((a, b) => (a.ringStartTime || 0) - (b.ringStartTime || 0) || a.agentId - b.agentId)
      .map(({ groupIds: _g, ...rest }) => rest),
  }));
  return reply.send({ groups });
}

export async function getWorkspaceQueueCalls(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLoggedInSession(req);
  if (!login) return reply.status(400).send({ error: 'CCS agent not logged in' });
  await ensureGroupTree(req, login.userId);
  if (getSignedInSkillIds(login.userId).length === 0) {
    clearSignedInSynced(login.userId);
    await syncSignedInFromCcs(req, login.userId);
  }
  const signed = signedInGroupMeta(login.userId);
  const byGroup = new Map<number, WorkspaceQueueRow[]>();
  const used = new Set<number>();
  const errors: string[] = [];
  for (const g of signed) {
    try {
      const { ret, status, calls } = await requestCallQueueList({
        agentId: login.agentId,
        agentGroupId: g.id,
        vdnId: login.vdnId,
        skillId: -1,
      });
      if (ret !== 0 && status !== 0) {
        errors.push(`${g.id}:${status || ret}`);
        continue;
      }
      const rows: WorkspaceQueueRow[] = [];
      for (const c of calls) {
        if (c.logicNo <= 0 || used.has(c.logicNo)) continue;
        used.add(c.logicNo);
        rows.push(c);
      }
      rows.sort((a, b) => (a.enterAcdTime || 0) - (b.enterAcdTime || 0) || a.logicNo - b.logicNo);
      byGroup.set(g.id, rows);
    } catch (e) {
      errors.push(`${g.id}:${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (signed.length > 0 && byGroup.size === 0 && errors.length > 0) {
    return reply.status(502).send({ error: `ACD queue query failed: ${errors.join('; ')}` });
  }
  const groups = signed.map((g) => {
    const calls = byGroup.get(g.id) ?? [];
    return { id: g.id, name: g.name, count: calls.length, calls };
  });
  groups.sort((a, b) => b.count - a.count || a.id - b.id);
  const allCalls: WorkspaceQueueRow[] = [];
  const seen = new Set<number>();
  for (const g of groups) {
    for (const c of g.calls) {
      if (seen.has(c.logicNo)) continue;
      seen.add(c.logicNo);
      allCalls.push(c);
    }
  }
  if (allCalls.length > 0) {
    groups.unshift({ id: -1, name: '全部', count: allCalls.length, calls: allCalls });
  }
  console.log(
    `[workspace-queue] user=${login.userId} agent=${login.agentId} groups=${signed.length} total=${allCalls.length}`
      + (errors.length ? ` errs=${errors.join(';')}` : ''),
  );
  return reply.send({ groups, total: allCalls.length });
}

export async function postWorkspaceQueueTake(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLoggedInSession(req);
  if (!login) return reply.status(400).send({ error: 'CCS agent not logged in' });
  const body = (req.body ?? {}) as { logicNo?: number };
  const logicNo = Number(body.logicNo || 0);
  if (!logicNo) return reply.status(400).send({ error: 'logicNo required' });
  try {
    const ack = await req.server.ccsBridge!.handleInvoke(
      login.userId,
      `queue-take-${Date.now()}`,
      'DoAgentSnatchCall',
      { AgentID: login.agentId, DstAgentID: 0, CallID: logicNo, CallIDType: 0 },
    );
    const rc = Number(ack?.Status ?? ack?.Result ?? ack?.err ?? 0);
    if (rc !== 0) {
      return reply.status(502).send({ error: String(ack?.errMsg ?? `分配失败(${rc})`) });
    }
    return reply.send({ ok: true, logic_no: logicNo });
  } catch (e) {
    return reply.status(502).send({ error: e instanceof Error ? e.message : 'CCS invoke failed' });
  }
}

export async function getWorkspaceOnlineAgents(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLoggedInSession(req);
  if (!login) return reply.status(400).send({ error: 'CCS agent not logged in' });
  await ensureGroupTree(req, login.userId);
  if (getSignedInSkillIds(login.userId).length === 0) {
    clearSignedInSynced(login.userId);
    await syncSignedInFromCcs(req, login.userId);
  }
  let snap;
  try {
    snap = await fetchWorkspaceSnapshot(req, login);
  } catch (e) {
    return reply.status(502).send({ error: e instanceof Error ? e.message : 'CCS query failed' });
  }
  const groups = signedInGroupMeta(login.userId).map((g) => {
    const agents = snap.agents
      .filter((a) => a.agentId !== login.agentId && a.groupIds.includes(g.id))
      .sort((a, b) => a.workNo.localeCompare(b.workNo) || a.agentId - b.agentId)
      .map(({ groupIds: _g, ...rest }) => rest);
    return { id: g.id, name: g.name, count: agents.length, agents };
  });
  return reply.send({ groups });
}

/** 在线班长席（t_user_role=班长），供申请小休选审批人。 */
export async function getWorkspaceRestLeaders(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLoggedInSession(req);
  if (!login) return reply.status(400).send({ error: 'CCS agent not logged in' });
  let snap;
  try {
    snap = await fetchWorkspaceSnapshot(req, login);
  } catch (e) {
    return reply.status(502).send({ error: e instanceof Error ? e.message : 'CCS query failed' });
  }
  const { loadLeaderAgentIdsFromIccDb } = await import('../../shared/services/icc-groups-dal.js');
  const leaderIds = await loadLeaderAgentIdsFromIccDb(login.vdnId);
  const leaders = snap.agents
    .filter((a) => a.agentId > 0 && a.agentId !== login.agentId && leaderIds.has(a.agentId))
    .sort((a, b) => a.workNo.localeCompare(b.workNo) || a.agentId - b.agentId)
    .map(({ groupIds: _g, ...rest }) => rest);
  return reply.send({ leaders, leader_role_id: 7 });
}

export async function getInternalChats(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLoggedInSession(req);
  if (!login) return reply.status(400).send({ error: 'CCS agent not logged in' });
  return reply.send({ items: listInternalThreads(login.userId) });
}

export async function postInternalChat(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLoggedInSession(req);
  if (!login) return reply.status(400).send({ error: 'CCS agent not logged in' });
  const body = (req.body ?? {}) as { agentId?: number; workNo?: string; name?: string };
  const peerId = Number(body.agentId || 0);
  if (!peerId) return reply.status(400).send({ error: 'agentId required' });
  const existing = getInternalThread(login.userId, peerId);
  if (existing) return reply.send(existing);
  const th = appendInternalMessage(
    login.userId,
    { agentId: peerId, workNo: String(body.workNo || peerId), name: String(body.name || body.workNo || peerId) },
    { fromAgentId: login.agentId, text: '', ts: Date.now(), kind: 'im' },
  );
  th.messages = [];
  th.last = '';
  return reply.send(th);
}

export async function postInternalChatMessage(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLoggedInSession(req);
  if (!login) return reply.status(400).send({ error: 'CCS agent not logged in' });
  const peerId = Number((req.params as { peerId?: string }).peerId || 0);
  const body = (req.body ?? {}) as {
    text?: string;
    media?: {
      kind?: string;
      file_url?: string;
      file_name?: string;
      content_type?: string;
      byte_size?: number;
    };
  };
  const text = String(body.text ?? '').trim();
  const mediaRaw = body.media;
  const media =
    mediaRaw?.file_url &&
    (mediaRaw.kind === 'image' || mediaRaw.kind === 'video' || mediaRaw.kind === 'file')
      ? {
          kind: mediaRaw.kind as 'image' | 'video' | 'file',
          file_url: String(mediaRaw.file_url),
          file_name: mediaRaw.file_name ? String(mediaRaw.file_name) : undefined,
          content_type: mediaRaw.content_type ? String(mediaRaw.content_type) : undefined,
          byte_size: mediaRaw.byte_size ? Number(mediaRaw.byte_size) : undefined,
        }
      : undefined;
  if (!peerId || (!text && !media)) return reply.status(400).send({ error: 'peerId and text/media required' });
  const peer = getSessionByAgentId(peerId);
  const th = appendInternalMessage(
    login.userId,
    { agentId: peerId, workNo: peer?.workNO || String(peerId), name: peer?.workNO || String(peerId) },
    {
      fromAgentId: login.agentId,
      text: text || (media ? (media.kind === 'image' ? '[图片]' : media.kind === 'video' ? '[视频]' : `[文件] ${media.file_name || ''}`) : ''),
      ts: Date.now(),
      kind: 'im',
      media,
    },
  );
  return reply.send(th);
}

export async function postInternalChatRead(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLoggedInSession(req);
  if (!login) return reply.status(400).send({ error: 'CCS agent not logged in' });
  const peerId = Number((req.params as { peerId?: string }).peerId || 0);
  if (peerId) markInternalRead(login.userId, peerId);
  return reply.send({ ok: true });
}

export async function postInternalApproveRest(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLoggedInSession(req);
  if (!login) return reply.status(400).send({ error: 'CCS agent not logged in' });
  const peerId = Number((req.params as { peerId?: string }).peerId || 0);
  const body = (req.body as { status?: number; opinion?: string; durationSec?: number } | undefined) ?? {};
  const status = Number(body.status ?? 0);
  const opinion = String(body.opinion ?? '').trim();
  const durationSec = Math.max(0, Math.floor(Number(body.durationSec ?? 0) || 0));
  const th = updateRestStatus(login.userId, peerId, status === 0 ? 'approved' : 'rejected');
  try {
    const { prisma } = await import('../../plugins/db.js');
    const { decideRestRequest } = await import('../../shared/services/agent-rest-requests.js');
    const session = req.server.ccsBridge?.getSession(login.userId);
    await decideRestRequest(prisma, {
      applicantAgentId: peerId,
      leaderUserId: login.userId,
      leaderAgentId: login.agentId,
      leaderWorkNo: session?.workNO || String(login.agentId),
      leaderName: req.currentUser?.name || session?.workNO || String(login.agentId),
      status: status === 0 ? 'approved' : 'rejected',
      opinion: opinion || (status === 0 ? '同意' : '拒绝'),
      durationSec,
    });
  } catch (e) {
    req.log?.error?.(e, 'decideRestRequest failed');
  }
  return reply.send(th ?? { ok: true });
}

/** 坐席创建小休申请记录（CCS 申请成功后由前端调用）。 */
export async function postRestRequestRecord(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLoggedInSession(req);
  if (!login) return reply.status(400).send({ error: 'CCS agent not logged in' });
  const body = (req.body ?? {}) as {
    content?: string;
    leaderAgentId?: number;
    leaderWorkNo?: string;
    leaderName?: string;
    auxCode?: number;
    durationSec?: number;
  };
  const content = String(body.content ?? '').trim() || '申请小休';
  const leaderAgentId = Number(body.leaderAgentId || 0);
  const durationSec = Math.max(0, Math.floor(Number(body.durationSec ?? 0) || 0));
  const session = req.server.ccsBridge?.getSession(login.userId);
  const { prisma } = await import('../../plugins/db.js');
  const { createRestRequest } = await import('../../shared/services/agent-rest-requests.js');
  let leaderUserId: number | null = null;
  if (leaderAgentId > 0 && leaderAgentId !== login.agentId) {
    const leaderSess = getSessionByAgentId(leaderAgentId);
    leaderUserId = leaderSess?.userId ?? null;
    if (leaderUserId == null) {
      const u = await prisma.users.findFirst({
        where: { OR: [{ uid: String(body.leaderWorkNo || '') }, { id: leaderAgentId }] },
        select: { id: true },
      });
      leaderUserId = u?.id ?? null;
    }
  }
  const row = await createRestRequest(prisma, {
    applicantUserId: login.userId,
    applicantAgentId: login.agentId,
    applicantWorkNo: session?.workNO || req.currentUser?.uid || String(login.agentId),
    applicantName: req.currentUser?.name || session?.workNO || String(login.agentId),
    leaderUserId,
    leaderAgentId: leaderAgentId || null,
    leaderWorkNo: String(body.leaderWorkNo || ''),
    leaderName: String(body.leaderName || ''),
    content,
    auxCode: Number(body.auxCode || 0),
    durationSec,
    selfApproved: !leaderAgentId || leaderAgentId === login.agentId,
  });
  return reply.send(row);
}

/** view=mine 自己发起的；view=approved 自己审批过的。 */
export async function getRestRequestRecords(req: FastifyRequest, reply: FastifyReply) {
  const userId = resolveAgentUserId(req);
  const q = req.query as { view?: string; limit?: string };
  const view = q.view === 'approved' ? 'approved' : 'mine';
  const limit = Number(q.limit || 100);
  const { prisma } = await import('../../plugins/db.js');
  const {
    listMyRestRequests,
    listLeaderDecidedRestRequests,
  } = await import('../../shared/services/agent-rest-requests.js');
  if (view === 'approved') {
    const session = req.server.ccsBridge?.getSession(userId);
    const items = await listLeaderDecidedRestRequests(prisma, userId, session?.agentId ?? null, limit);
    return reply.send({ view, items });
  }
  const items = await listMyRestRequests(prisma, userId, limit);
  return reply.send({ view, items });
}

export async function getRestRequestMeta(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLoggedInSession(req);
  if (!login) {
    return reply.send({ is_leader: false });
  }
  const { loadLeaderAgentIdsFromIccDb } = await import('../../shared/services/icc-groups-dal.js');
  const leaders = await loadLeaderAgentIdsFromIccDb(login.vdnId);
  return reply.send({ is_leader: leaders.has(login.agentId) });
}

// ── Agent Profile ──

async function agentProfilePayload(req: FastifyRequest, userId = 1) {
  const voiceEnabled = (await productModules().snapshot()).modules.icc.available;
  const signed_in = getSignedInSkillIds(userId);
  const bound = voiceEnabled && process.env.OMNI_EXTENSION_BINDING_ENABLED === '1' ? await (await import('../extension-binding/service.js')).bindingSnapshot(req) : null;
  const user = req.currentUser;
  const session = voiceEnabled ? req.server.ccsBridge?.getSession(userId) : undefined;
  const attrs = (user as { custom_attributes?: Record<string, unknown> } | undefined)?.custom_attributes ?? {};
  return {
    id: session?.agentId ? String(session.agentId) : `U${userId}`,
    work_no: bound ? (user ? resolveCcsWorkNo({id:user.id,uid:user.uid ?? null}, env.CCS_WORK_NO_FIELD) : String(userId)) : session?.workNO || user?.uid || String(userId),
    name: user?.name || '坐席',
    extension: bound ? bound.binding.extension : session?.extension || '',
    team: buildDisplayLabel(signed_in),
    department: String(attrs.department ?? '新产品研发部'),
    title: String(attrs.title ?? '在线客服专员'),
    role: '客服代表',
    phone: bound ? bound.binding.extension : session?.extension || '',
    email: user?.email || '',
    avatar: '',
    ccs_logged_in: session?.loggedIn ?? false,
    ccs_status: session?.status ?? 'offline',
    video_config: voiceEnabled ? await getVideoAgentConfig({ userId,
      workNo: user ? resolveCcsWorkNo({ ...user, uid: user.uid ?? null }, env.CCS_WORK_NO_FIELD) : '',
      vdnId: activeVdn(0),
    }) : undefined,
  };
}

export async function getAgentProfile(req: FastifyRequest, reply: FastifyReply) {
  return reply.send(await agentProfilePayload(req, resolveAgentUserId(req)));
}

// ── Dashboard ──

export async function dashboardProfile(req: FastifyRequest, reply: FastifyReply) {
  return reply.send(await agentProfilePayload(req, resolveAgentUserId(req)));
}
export async function dashboardQuickLinks(_req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ items: [...DASHBOARD_QUICK_LINKS] });
}
export async function dashboardMemos(req: FastifyRequest, reply: FastifyReply) {
  const { prisma } = await import('../../plugins/db.js');
  const userId = resolveAgentUserId(req);
  const q = req.query as { include_done?: string };
  const includeDone = q.include_done === '1' || q.include_done === 'true';
  return reply.send(await listMemos(prisma, userId, includeDone));
}
export async function dashboardCreateMemo(req: FastifyRequest, reply: FastifyReply) {
  const body = (req.body ?? {}) as { title?: string; content?: string; due_at?: string | null };
  if (!body.title?.trim()) return reply.status(400).send({ error: 'title required' });
  const { prisma } = await import('../../plugins/db.js');
  const item = await createMemo(prisma, resolveAgentUserId(req), {
    title: body.title,
    content: body.content,
    due_at: body.due_at,
  });
  return reply.send(item);
}
export async function dashboardPatchMemo(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const memoId = parseInt(id, 10);
  if (!Number.isFinite(memoId)) return reply.status(400).send({ error: 'invalid id' });
  const body = (req.body ?? {}) as {
    title?: string;
    content?: string;
    due_at?: string | null;
    done?: boolean;
  };
  const { prisma } = await import('../../plugins/db.js');
  const item = await patchMemo(prisma, resolveAgentUserId(req), memoId, body);
  if (!item) return reply.status(404).send({ error: 'not found' });
  return reply.send(item);
}
export async function dashboardMetrics(req: FastifyRequest, reply: FastifyReply) {
  const q = req.query as { scope?: string };
  const scope = q.scope === 'team' ? 'team' : 'personal';
  const userId = resolveAgentUserId(req);
  const profile = await agentProfilePayload(req, userId);
  const { prisma } = await import('../../plugins/db.js');
  return reply.send(
    await buildDashboardMetrics(prisma, {
      userId,
      workNo: profile.work_no,
      scope,
    }),
  );
}
export async function dashboardChannelVolume(req: FastifyRequest, reply: FastifyReply) {
  const { prisma } = await import('../../plugins/db.js');
  const userId = resolveAgentUserId(req);
  const profile = await agentProfilePayload(req, userId);
  return reply.send(
    await buildChannelVolume(prisma, {
      userId,
      workNo: profile.work_no,
      personalOnly: true,
    }),
  );
}
export async function dashboardAnnouncements(req: FastifyRequest, reply: FastifyReply) {
  const { prisma } = await import('../../plugins/db.js');
  const userId = resolveAgentUserId(req);
  const accountId = await resolveAccountId(prisma, userId);
  const q = z.object({ unread_only: z.enum(['0', '1']).optional(), read_only: z.enum(['0', '1']).optional(), page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(100), query: z.string().trim().max(200).optional() }).parse(req.query);
  return reply.send(await listAnnouncements(prisma, accountId, userId, { unreadOnly: q.unread_only === '1', readOnly: q.read_only === '1', page: q.page, limit: q.limit, query: q.query }));
}
export async function dashboardCreateAnnouncement(req: FastifyRequest, reply: FastifyReply) {
  const { prisma } = await import('../../plugins/db.js');
  return reply.send(await saveAnnouncement(prisma, await announcementContext(req), null, req.body));
}
export async function dashboardMarkAnnouncementsRead(req: FastifyRequest, reply: FastifyReply) {
  const body = (req.body ?? {}) as { ids?: unknown; id?: unknown };
  const raw = Array.isArray(body.ids) ? body.ids : body.id != null ? [body.id] : [];
  const ids = z.array(z.coerce.number().int().positive()).max(10000).parse(raw);
  const { prisma } = await import('../../plugins/db.js');
  const marked = await markAnnouncementsRead(prisma, resolveAgentUserId(req), ids);
  return reply.send({ ok: true, marked });
}
export async function dashboardMarkAnnouncementRead(req: FastifyRequest, reply: FastifyReply) {
  const announcementId = Number((req.params as { id: string }).id);
  if (!Number.isSafeInteger(announcementId) || announcementId <= 0) {
    return reply.status(400).send({ error: 'invalid id' });
  }
  const { prisma } = await import('../../plugins/db.js');
  const marked = await markAnnouncementsRead(prisma, resolveAgentUserId(req), [announcementId]);
  return reply.send({ ok: true, marked });
}
export async function dashboardMarkAnnouncementUnread(req: FastifyRequest, reply: FastifyReply) {
  const announcementId = Number((req.params as { id: string }).id);
  if (!Number.isSafeInteger(announcementId) || announcementId <= 0) {
    return reply.status(400).send({ error: 'invalid id' });
  }
  const { prisma } = await import('../../plugins/db.js');
  const ok = await markAnnouncementUnread(prisma, resolveAgentUserId(req), announcementId);
  return reply.send({ ok });
}
export async function dashboardCalendarEvents(req: FastifyRequest, reply: FastifyReply) {
  const q = req.query as { month?: string };
  const { prisma } = await import('../../plugins/db.js');
  return reply.send(await listCalendarEvents(prisma, resolveAgentUserId(req), q.month));
}
export async function dashboardCreateCalendarEvent(req: FastifyRequest, reply: FastifyReply) {
  const body = (req.body ?? {}) as {
    date?: string;
    time?: string;
    location?: string;
    content?: string;
    note?: string;
    kinds?: string[];
  };
  if (!body.date) return reply.status(400).send({ error: 'date required' });
  const { prisma } = await import('../../plugins/db.js');
  const event = await createCalendarEvent(prisma, resolveAgentUserId(req), {
    date: body.date,
    time: body.time,
    location: body.location,
    content: body.content,
    note: body.note,
    kinds: body.kinds,
  });
  return reply.send(event);
}
export async function dashboardPatchCalendarEvent(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const eventId = parseInt(id, 10);
  if (!Number.isFinite(eventId)) return reply.status(400).send({ error: 'invalid id' });
  const body = (req.body ?? {}) as {
    date?: string;
    time?: string;
    location?: string;
    content?: string;
    note?: string;
    kinds?: string[];
  };
  const { prisma } = await import('../../plugins/db.js');
  const event = await patchCalendarEvent(prisma, resolveAgentUserId(req), eventId, body);
  if (!event) return reply.status(404).send({ error: 'not found' });
  return reply.send(event);
}
export async function dashboardDeleteCalendarEvent(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const eventId = parseInt(id, 10);
  if (!Number.isFinite(eventId)) return reply.status(400).send({ error: 'invalid id' });
  const { prisma } = await import('../../plugins/db.js');
  const ok = await deleteCalendarEvent(prisma, resolveAgentUserId(req), eventId);
  if (!ok) return reply.status(404).send({ error: 'not found' });
  return reply.send({ ok: true });
}

export async function changeAgentPassword(req: FastifyRequest, reply: FastifyReply) {
  const userId = resolveAgentUserId(req);
  const body = (req.body ?? {}) as { old_password?: string; new_password?: string };
  if (!body.old_password || !body.new_password) {
    return reply.status(400).send({ error: 'old_password and new_password required' });
  }
  if (body.new_password.length < 6) {
    return reply.status(400).send({ error: 'new_password too short' });
  }
  const { prisma } = await import('../../plugins/db.js');
  const user = await prisma.users.findUnique({ where: { id: userId } });
  if (!user) return reply.status(404).send({ error: 'user not found' });
  if (isReservedSystemIdentity('', user)) return reply.status(403).send({ error: '系统超级用户密码请在 ConfManager 修改' });
  const ok = await verifyPassword(body.old_password, user.encrypted_password);
  if (!ok) return reply.status(400).send({ error: '旧密码不正确' });
  await prisma.users.update({
    where: { id: userId },
    data: { encrypted_password: await hashPassword(body.new_password) },
  });
  void trySyncIccPassword(user.uid || '', body.new_password);
  return reply.send({ ok: true });
}

export async function customersList(req: FastifyRequest, reply: FastifyReply) {
  const q = req.query as { q?: string; page?: string; page_size?: string };
  const { prisma } = await import('../../plugins/db.js');
  const userId = resolveAgentUserId(req);
  const accountId = await resolveAccountIdForUser(prisma, userId);
  return reply.send(
    await listCustomers(prisma, {
      accountId,
      q: q.q,
      page: q.page ? parseInt(q.page, 10) : 1,
      pageSize: q.page_size ? parseInt(q.page_size, 10) : 20,
    }),
  );
}

export async function customersGet(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const contactId = parseInt(id, 10);
  if (!Number.isFinite(contactId)) return reply.status(400).send({ error: 'invalid id' });
  const { prisma } = await import('../../plugins/db.js');
  const userId = resolveAgentUserId(req);
  const accountId = await resolveAccountIdForUser(prisma, userId);
  const detail = await getCustomerDetail(prisma, { accountId, contactId });
  if (!detail) return reply.status(404).send({ error: 'not found' });
  return reply.send(detail);
}

export async function customersPatch(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const contactId = parseInt(id, 10);
  if (!Number.isFinite(contactId)) return reply.status(400).send({ error: 'invalid id' });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { prisma } = await import('../../plugins/db.js');
  const userId = resolveAgentUserId(req);
  const accountId = await resolveAccountIdForUser(prisma, userId);
  const detail = await patchCustomer(prisma, {
    accountId,
    contactId,
    body: {
      name: body.name as string | undefined,
      phone: body.phone as string | undefined,
      email: body.email as string | null | undefined,
      location: body.location as string | undefined,
      gender: body.gender as string | undefined,
      customer_type: body.customer_type as string | undefined,
      level: body.level as string | undefined,
      id_number: body.id_number as string | undefined,
      ethnicity: body.ethnicity as string | undefined,
      company_id: body.company_id as number | null | undefined,
      custom_attributes: body.custom_attributes as Record<string, unknown> | undefined,
    },
  });
  if (!detail) return reply.status(404).send({ error: 'not found' });
  return reply.send(detail);
}

export async function customersNotesList(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const contactId = parseInt(id, 10);
  if (!Number.isFinite(contactId)) return reply.status(400).send({ error: 'invalid id' });
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  return reply.send(await listCustomerNotes(prisma, { accountId, contactId }));
}

export async function customersNotesCreate(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const contactId = parseInt(id, 10);
  const body = (req.body ?? {}) as { content?: string };
  if (!Number.isFinite(contactId) || !body.content?.trim()) {
    return reply.status(400).send({ error: 'content required' });
  }
  const { prisma } = await import('../../plugins/db.js');
  const userId = resolveAgentUserId(req);
  const accountId = await resolveAccountIdForUser(prisma, userId);
  const note = await createCustomerNote(prisma, {
    accountId,
    contactId,
    userId,
    content: body.content,
  });
  if (!note) return reply.status(404).send({ error: 'not found' });
  return reply.send(note);
}

export async function customersNotesDelete(req: FastifyRequest, reply: FastifyReply) {
  const { id, noteId } = req.params as { id: string; noteId: string };
  const contactId = parseInt(id, 10);
  const nid = parseInt(noteId, 10);
  if (!Number.isFinite(contactId) || !Number.isFinite(nid)) {
    return reply.status(400).send({ error: 'invalid id' });
  }
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  const ok = await deleteCustomerNote(prisma, { accountId, contactId, noteId: nid });
  if (!ok) return reply.status(404).send({ error: 'not found' });
  return reply.send({ ok: true });
}

export async function customersLabelsGet(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const contactId = parseInt(id, 10);
  if (!Number.isFinite(contactId)) return reply.status(400).send({ error: 'invalid id' });
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  const data = await getCustomerLabels(prisma, { accountId, contactId });
  if (!data) return reply.status(404).send({ error: 'not found' });
  return reply.send(data);
}

export async function customersLabelsPut(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const contactId = parseInt(id, 10);
  const body = (req.body ?? {}) as { label_ids?: number[]; labels?: number[] };
  if (!Number.isFinite(contactId)) return reply.status(400).send({ error: 'invalid id' });
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  const labelIds = body.label_ids ?? body.labels ?? [];
  const data = await putCustomerLabels(prisma, {
    accountId,
    contactId,
    labelIds: Array.isArray(labelIds) ? labelIds.map(Number) : [],
  });
  if (!data) return reply.status(404).send({ error: 'not found' });
  return reply.send(data);
}

export async function customersTimeline(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const contactId = parseInt(id, 10);
  const q = req.query as { limit?: string };
  if (!Number.isFinite(contactId)) return reply.status(400).send({ error: 'invalid id' });
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  const data = await getCustomerTimeline(prisma, {
    accountId,
    contactId,
    limit: q.limit ? parseInt(q.limit, 10) : 50,
  });
  if (!data) return reply.status(404).send({ error: 'not found' });
  return reply.send(data);
}

export async function crmLabelsList(req: FastifyRequest, reply: FastifyReply) {
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  return reply.send(await listCrmLabels(prisma, accountId));
}

export async function companiesList(req: FastifyRequest, reply: FastifyReply) {
  const q = req.query as { q?: string };
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  return reply.send(await listCompanies(prisma, { accountId, q: q.q }));
}

export async function companiesCreate(req: FastifyRequest, reply: FastifyReply) {
  const body = (req.body ?? {}) as { name?: string; domain?: string; description?: string };
  if (!body.name?.trim()) return reply.status(400).send({ error: 'name required' });
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  return reply.send(
    await createCompany(prisma, {
      accountId,
      name: body.name,
      domain: body.domain,
      description: body.description,
    }),
  );
}

export async function companiesGet(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const companyId = parseInt(id, 10);
  if (!Number.isFinite(companyId)) return reply.status(400).send({ error: 'invalid id' });
  const q = req.query as { exclude_contact_id?: string };
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  const detail = await getCompanyDetail(prisma, {
    accountId,
    companyId,
    excludeContactId: q.exclude_contact_id ? parseInt(q.exclude_contact_id, 10) : undefined,
  });
  if (!detail) return reply.status(404).send({ error: 'not found' });
  return reply.send(detail);
}

export async function companiesPatch(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const companyId = parseInt(id, 10);
  if (!Number.isFinite(companyId)) return reply.status(400).send({ error: 'invalid id' });
  const body = (req.body ?? {}) as {
    name?: string;
    domain?: string | null;
    description?: string | null;
  };
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  const row = await patchCompany(prisma, { accountId, companyId, body });
  if (!row) return reply.status(404).send({ error: 'not found' });
  return reply.send(row);
}

export async function companiesDelete(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const companyId = parseInt(id, 10);
  if (!Number.isFinite(companyId)) return reply.status(400).send({ error: 'invalid id' });
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  const ok = await deleteCompany(prisma, { accountId, companyId });
  if (!ok) return reply.status(404).send({ error: 'not found' });
  return reply.send({ ok: true });
}

export async function opportunitiesList(req: FastifyRequest, reply: FastifyReply) {
  const q = req.query as { contact_id?: string; company_id?: string };
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  return reply.send(
    await listOpportunities(prisma, {
      accountId,
      contactId: q.contact_id ? parseInt(q.contact_id, 10) : undefined,
      companyId: q.company_id ? parseInt(q.company_id, 10) : undefined,
    }),
  );
}

export async function opportunitiesCreate(req: FastifyRequest, reply: FastifyReply) {
  const body = (req.body ?? {}) as {
    title?: string;
    stage?: string;
    amount?: number | null;
    contact_id?: number | null;
    company_id?: number | null;
    expected_close?: string | null;
  };
  if (!body.title?.trim()) return reply.status(400).send({ error: 'title required' });
  const { prisma } = await import('../../plugins/db.js');
  const userId = resolveAgentUserId(req);
  const accountId = await resolveAccountIdForUser(prisma, userId);
  return reply.send(
    await createOpportunity(prisma, {
      accountId,
      ownerId: userId,
      title: body.title,
      stage: body.stage,
      amount: body.amount,
      contactId: body.contact_id,
      companyId: body.company_id,
      expectedClose: body.expected_close,
    }),
  );
}

export async function opportunitiesPatch(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const oppId = parseInt(id, 10);
  if (!Number.isFinite(oppId)) return reply.status(400).send({ error: 'invalid id' });
  const body = (req.body ?? {}) as {
    title?: string;
    stage?: string;
    amount?: number | null;
    status?: string;
    expected_close?: string | null;
  };
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  const row = await patchOpportunity(prisma, { accountId, id: oppId, body });
  if (!row) return reply.status(404).send({ error: 'not found' });
  return reply.send(row);
}

export async function opportunitiesDelete(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const oppId = parseInt(id, 10);
  if (!Number.isFinite(oppId)) return reply.status(400).send({ error: 'invalid id' });
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  const ok = await deleteOpportunity(prisma, { accountId, id: oppId });
  if (!ok) return reply.status(404).send({ error: 'not found' });
  return reply.send({ ok: true });
}

// ── Agent Shifts（坐席排班）──

export async function agentShiftsGet(req: FastifyRequest, reply: FastifyReply) {
  const { prisma } = await import('../../plugins/db.js');
  const userId = resolveAgentUserId(req);
  const accountId = await resolveAccountIdForUser(prisma, userId);
  return reply.send(await getOrCreateBoard(prisma, { accountId, userId }));
}

export async function agentShiftsPatch(req: FastifyRequest, reply: FastifyReply) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  const data = await patchBoardSettings(prisma, {
    accountId,
    body: {
      name: body.name as string | undefined,
      rhythm: body.rhythm as string | undefined,
      sequence: body.sequence as string[] | undefined,
      start_date: body.start_date as string | undefined,
      duration: body.duration as number | undefined,
      need_per_shift: body.need_per_shift as number | undefined,
      time_day: body.time_day as string | undefined,
      time_mid: body.time_mid as string | undefined,
      time_night: body.time_night as string | undefined,
      hours_per_shift: body.hours_per_shift as number | undefined,
      hourly_rate: body.hourly_rate as number | undefined,
      night_bonus: body.night_bonus as number | undefined,
      theme: body.theme as string | undefined,
      clear_manuals: body.clear_manuals as boolean | undefined,
    },
  });
  if (!data) return reply.status(404).send({ error: 'not found' });
  return reply.send(data);
}

export async function agentShiftsAddStaff(req: FastifyRequest, reply: FastifyReply) {
  const body = (req.body ?? {}) as { name?: string };
  if (!body.name?.trim()) return reply.status(400).send({ error: 'name required' });
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  const data = await addStaff(prisma, { accountId, name: body.name });
  if (!data) return reply.status(404).send({ error: 'not found' });
  if ('error' in data && data.error === 'duplicate') {
    return reply.status(409).send({ error: 'duplicate name' });
  }
  return reply.send(data);
}

export async function agentShiftsRemoveStaff(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const staffId = parseInt(id, 10);
  if (!Number.isFinite(staffId)) return reply.status(400).send({ error: 'invalid id' });
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  const data = await removeStaff(prisma, { accountId, staffId });
  if (!data) return reply.status(404).send({ error: 'not found' });
  return reply.send(data);
}

export async function agentShiftsAddLeave(req: FastifyRequest, reply: FastifyReply) {
  const body = (req.body ?? {}) as {
    staff_name?: string;
    from_date?: string;
    to_date?: string;
    type?: string;
  };
  if (!body.staff_name || !body.from_date || !body.to_date) {
    return reply.status(400).send({ error: 'staff_name/from_date/to_date required' });
  }
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  const data = await addLeave(prisma, {
    accountId,
    staff_name: body.staff_name,
    from_date: body.from_date,
    to_date: body.to_date,
    type: body.type,
  });
  if (!data) return reply.status(404).send({ error: 'not found' });
  if ('error' in data) return reply.status(400).send({ error: data.error });
  return reply.send(data);
}

export async function agentShiftsRemoveLeave(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const leaveId = parseInt(id, 10);
  if (!Number.isFinite(leaveId)) return reply.status(400).send({ error: 'invalid id' });
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  const data = await removeLeave(prisma, { accountId, leaveId });
  if (!data) return reply.status(404).send({ error: 'not found' });
  return reply.send(data);
}

export async function agentShiftsCycleCell(req: FastifyRequest, reply: FastifyReply) {
  const body = (req.body ?? {}) as { staff_name?: string; date?: string };
  if (!body.staff_name || !body.date) {
    return reply.status(400).send({ error: 'staff_name/date required' });
  }
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  const data = await cycleCell(prisma, {
    accountId,
    staff_name: body.staff_name,
    date: body.date,
  });
  if (!data) return reply.status(404).send({ error: 'not found' });
  if ('error' in data && data.error === 'on_leave') {
    return reply.status(400).send({ error: 'on_leave' });
  }
  return reply.send(data);
}

export async function agentShiftsUpsertNote(req: FastifyRequest, reply: FastifyReply) {
  const body = (req.body ?? {}) as { date?: string; text?: string };
  if (!body.date) return reply.status(400).send({ error: 'date required' });
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  const data = await upsertNote(prisma, {
    accountId,
    date: body.date,
    text: body.text ?? '',
  });
  if (!data) return reply.status(404).send({ error: 'not found' });
  return reply.send(data);
}

export async function agentShiftsDeleteNote(req: FastifyRequest, reply: FastifyReply) {
  const q = req.query as { date?: string };
  if (!q.date) return reply.status(400).send({ error: 'date required' });
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  const data = await deleteNote(prisma, { accountId, date: q.date });
  if (!data) return reply.status(404).send({ error: 'not found' });
  return reply.send(data);
}

export async function agentShiftsFillHolidays(req: FastifyRequest, reply: FastifyReply) {
  const { prisma } = await import('../../plugins/db.js');
  const accountId = await resolveAccountIdForUser(prisma, resolveAgentUserId(req));
  const data = await fillHolidays2026(prisma, { accountId });
  if (!data) return reply.status(404).send({ error: 'not found' });
  return reply.send(data);
}

export async function agentShiftsExportCsv(req: FastifyRequest, reply: FastifyReply) {
  const { prisma } = await import('../../plugins/db.js');
  const userId = resolveAgentUserId(req);
  const accountId = await resolveAccountIdForUser(prisma, userId);
  const data = await getOrCreateBoard(prisma, { accountId, userId });
  const csv = boardToCsv(data);
  reply.header('Content-Type', 'text/csv; charset=utf-8');
  reply.header('Content-Disposition', `attachment; filename="agent-shifts.csv"`);
  return reply.send(csv);
}

// ── Navigation ──

export async function navigationTree(req: FastifyRequest, reply: FastifyReply) {
  const canManageAccess = req.currentUser ? await getAccess(req).then(a => a.permissions.includes('access.manage')).catch(() => false) : false;
  return reply.send([
    { key: 'dashboard', label: '个人仪表盘', icon: 'Odometer' },
    { key: 'omnichannel', label: '全媒体服务', icon: 'ChatLineSquare' },
    { key: 'voicemail', label: '语音信箱', icon: 'Microphone' },
    { key: 'business-nav', label: '业务导航', icon: 'Guide' },
    { key: 'outbound', label: '外呼任务', icon: 'Phone' },
    { key: 'monitor', label: '监控看板', icon: 'Monitor' },
    { key: 'inspection', label: '质检管理', icon: 'Checked' },
    ...(canManageAccess ? [{ key: 'access-management', label: '角色权限管理', icon: 'User' }] : []),
  ]);
}

// ── Omnichannel Contacts (real DB data) ──

function agentVisibleConversationScope(userId: number, status: 0 | 1) {
  return [
    { assignee_id: userId },
    { participants: { some: { user_id: userId } } },
    // 新会话进来（微信/Widget 等）时还没人认领，assignee_id 为空。
    // 如果这里不带出来，坐席在列表里看不到它，会以为"消息没收到"。
    // 只对「打开」状态的会话放开，历史里不显示未分配的老会话。
    ...(status === 0 ? [{ assignee_id: null }] : []),
  ];
}

async function loadOmnichannelContactPayload(req: FastifyRequest, limit = 50) {
    const { tab, channel_group: channelGroupParam, q, from, to } = req.query as {
      tab?: string;
      channel_group?: string;
      q?: string;
      from?: string;
      to?: string;
    };
    const voiceEnabled = (await productModules().snapshot()).modules.icc.available;
    const status = tab === 'history' ? 1 : 0;
    const channelGroupFilter =
      !voiceEnabled ? 'media' : channelGroupParam === 'media' || channelGroupParam === 'phone'
        ? (channelGroupParam as ChannelGroup)
        : null;
    const search = q?.trim().toLowerCase() ?? '';
    const createdAt = parseDayRange(from, to);

    const { prisma } = await import('../../plugins/db.js');
    const userId = resolveAgentUserId(req);
    const convInclude = {
        contact: { select: { id: true, name: true, email: true, phone_number: true } },
        messages: {
        orderBy: { created_at: 'desc' as const },
          take: 1,
          select: { content: true, created_at: true, message_type: true },
        },
        inbox: { select: { id: true, name: true, channel_type: true } },
    };
    const conversations = await (prisma as any).conversations.findMany({
      where: {
        status,
        ...(createdAt ? { created_at: createdAt } : {}),
        OR: agentVisibleConversationScope(userId, status),
      },
      orderBy: { last_activity_at: 'desc' },
      take: Math.max(200, limit),
      include: convInclude,
    });

    const summaryUnread: Record<ChannelGroup, number> = { media: 0, phone: 0 };

    const toRow = async (c: any) => {
        const channelType = c.inbox?.channel_type as string | null | undefined;
        const inboxName = c.inbox?.name as string | null | undefined;
        const channelGroup = resolveChannelGroup(channelType);
        const channels = resolveChannelSubtypes(channelType, inboxName);
        const unread = status === 1
          ? 0
          : await countAgentUnread(c.id, c.agent_last_seen_at);

        if (status === 0) {
          summaryUnread[channelGroup] += unread;
        }

        const attrs = asAttrMap(c.additional_attributes);
        const callMethod = channelGroup === 'phone' ? resolveCallMethodFromAttrs(attrs) : '';
        const answeredAt = typeof attrs.answered_at === 'string' ? attrs.answered_at : null;
        const talkSec = typeof attrs.talk_time_sec === 'number' ? attrs.talk_time_sec : null;
        const callConnected = channelGroup === 'phone'
          ? !!(answeredAt || (talkSec != null && talkSec > 0))
          : null;
        return {
          id: `c${c.id}`,
          conversation_id: c.id,
          name: c.contact?.name ?? '匿名用户',
          code: c.contact?.phone_number ?? c.contact?.email ?? '未知',
          last_message: c.messages?.[0]?.content ?? '',
          time_label: formatInboundDateTime(
            typeof attrs.offered_at === 'string' ? attrs.offered_at : null,
            c.created_at,
            c.last_activity_at,
            channelGroup === 'phone',
          ),
          unread,
          channel_group: channelGroup,
          channel_type: channelType ?? null,
          channels,
          tags: callMethod ? [callMethod] : [],
          visit_count: 1,
          source: formatInboxSource(inboxName, channelType),
          omni_lifecycle: readLifecycle(attrs),
          observe_only: Array.isArray(attrs.omni_observers)
            && (attrs.omni_observers as unknown[]).map((n) => Number(n)).includes(userId),
          session_ended_at: typeof attrs.session_ended_at === 'string' ? attrs.session_ended_at : null,
          talk_time_sec: talkSec,
          recording_path: typeof attrs.recording_path === 'string' ? attrs.recording_path : null,
          call_method: callMethod || null,
          call_connected: callConnected,
          queued: false as boolean,
          queue_position: null as number | null,
          queue_ewt: null as number | null,
        };
    };

    const visible = conversations.filter((c: any) => voiceEnabled || resolveChannelGroup(c.inbox?.channel_type) !== 'phone');
    const mapped = await Promise.all(visible.map(toRow));

    if (status === 0) {
      const queuedIds = [...queueByConv.values()].map((q) => q.conversationId).filter((id) => id > 0);
      const have = new Set(mapped.map((m) => m.conversation_id as number));
      const missing = queuedIds.filter((id) => !have.has(id));
      if (missing.length > 0) {
        const extra = await (prisma as any).conversations.findMany({
          where: { id: { in: missing }, status: 0 },
          include: convInclude,
        });
        mapped.unshift(...(await Promise.all(extra.filter((c: any) => voiceEnabled || resolveChannelGroup(c.inbox?.channel_type) !== 'phone').map(toRow))));
      }
      for (const row of mapped) {
        const q = queueByConv.get(String(row.conversation_id));
        if (!q) continue;
        row.queued = true;
        row.queue_position = Math.max(1, Number(q.queueLen ?? 1) || 1);
        row.queue_ewt = q.ewt ?? null;
        if (!row.last_message) row.last_message = '排队转人工中';
      }
    }

    let items = mapped;
    if (channelGroupFilter) {
      items = items.filter((row) => row.channel_group === channelGroupFilter);
    }
    if (search) {
      items = items.filter(
        (row) =>
          row.name.toLowerCase().includes(search)
          || row.code.toLowerCase().includes(search)
          || row.last_message.toLowerCase().includes(search)
          || row.source.toLowerCase().includes(search),
      );
    }
    items = items.slice(0, Math.max(1, limit));

    return {
      items,
      channel_summary: [
        { channel_group: 'media' as const, unread: summaryUnread.media },
        ...(voiceEnabled ? [{ channel_group: 'phone' as const, unread: summaryUnread.phone }] : []),
      ],
    };
}

const emptyContactPayload = {
  items: [] as unknown[],
      channel_summary: [
    { channel_group: 'media' as const, unread: 0 },
    { channel_group: 'phone' as const, unread: 0 },
  ],
};

export async function omnichannelContacts(req: FastifyRequest, reply: FastifyReply) {
  try {
    return reply.send(await loadOmnichannelContactPayload(req, 50));
  } catch {
    return reply.send(emptyContactPayload);
  }
}

export async function omnichannelContactsExport(req: FastifyRequest, reply: FastifyReply) {
  try {
    const data = await loadOmnichannelContactPayload(req, 2000);
    const lines = ['\ufeff会话ID,访客,号码/邮箱,来源,最后消息,时间,渠道,生命周期'];
    for (const row of data.items as Array<Record<string, unknown>>) {
      lines.push(
        [
          csvEscape(row.conversation_id ?? row.id),
          csvEscape(row.name),
          csvEscape(row.code),
          csvEscape(row.source),
          csvEscape(row.last_message),
          csvEscape(row.time_label),
          csvEscape(row.channel_group),
          csvEscape(row.omni_lifecycle),
        ].join(','),
      );
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="omni-history.csv"');
    return reply.send(lines.join('\n'));
  } catch {
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    return reply.send('\ufeff会话ID,访客,号码/邮箱,来源,最后消息,时间,渠道,生命周期\n');
  }
}

// ── Session Messages ──
export async function sessionMessages(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = req.params as { id: string };
    const convId = parseInt(id.replace('c', ''), 10);
    const { prisma } = await import('../../plugins/db.js');

    const msgs = await (prisma as any).messages.findMany({
      where: { conversation_id: convId },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        content: true,
        message_type: true,
        created_at: true,
        sender_type: true,
        content_attributes: true,
      },
    });

    const messages = msgs.map((m: any) => {
      const attrs = (m.content_attributes ?? {}) as Record<string, unknown>;
      const richKind = mapContentAttributesToKind(m.content_attributes, m.message_type);
      const created = new Date(m.created_at);
      const from =
        m.message_type === 1 ? 'agent' : m.message_type === 0 ? 'customer' : 'agent';
      let kind = m.message_type === 2 && richKind === 'text' ? 'bot' : richKind;
      if (kind === 'ai_auto') kind = 'text';

      return {
        id: String(m.id),
        text: m.content ?? '',
        from,
        kind,
        time: created.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        day: created.toLocaleDateString('zh-CN'),
        content_attributes: attrs,
        file_url: attrs.file_url as string | undefined,
        file_name: attrs.file_name as string | undefined,
        byte_size: attrs.byte_size as number | undefined,
        content_type: attrs.content_type as string | undefined,
        red_packet_title: attrs.title as string | undefined,
        red_packet_amount: attrs.amount as string | number | undefined,
        articles: Array.isArray(attrs.articles) ? attrs.articles : undefined,
      };
    });

    return reply.send({ messages });
  } catch {
    return reply.send({ messages: [] });
  }
}

// ── Customer Profile（全媒体侧栏兼容：id 可为 contactId 或 c{convId}）──
export async function customerProfile(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = req.params as { id: string };
    const { prisma } = await import('../../plugins/db.js');
    const userId = resolveAgentUserId(req);
    const accountId = await resolveAccountIdForUser(prisma, userId);

    let contactId = parseInt(id, 10);
    if (!Number.isFinite(contactId) && /^c\d+$/i.test(id)) {
      const convId = parseInt(id.replace(/^c/i, ''), 10);
      const conv = await prisma.conversations.findFirst({
        where: { id: convId, account_id: accountId },
        select: { contact_id: true },
      });
      contactId = conv?.contact_id ?? NaN;
    }
    if (!Number.isFinite(contactId)) return reply.send({});

    const detail = await getCustomerDetail(prisma, { accountId, contactId });
    if (!detail) return reply.send({});
    return reply.send({
      id: detail.id,
      name: detail.name,
      phone: detail.phone,
      email: detail.email,
      gender: detail.gender,
      customer_type: detail.customer_type,
      level: detail.level,
      id_number: detail.id_number,
      ethnicity: detail.ethnicity,
      address: detail.location,
      location: detail.location,
      labels: detail.labels,
      tags: detail.labels.map((l) => l.title),
      company: detail.company,
      company_id: detail.company_id,
      source: 'Omni',
      custom_attributes: detail.custom_attributes,
      orders: [],
      visits: [],
      return_visits: [],
      conversations: detail.conversations,
      call_records: detail.call_records,
      notes: detail.notes,
      opportunities: detail.opportunities,
    });
  } catch {
    return reply.send({});
  }
}

export async function afterSales(_req: FastifyRequest, reply: FastifyReply) {
  return reply.send([]);
}
export async function ecomOrders(_req: FastifyRequest, reply: FastifyReply) {
  return reply.send([]);
}
export async function knowledge(req: FastifyRequest, reply: FastifyReply) {
  const q = String((req.query as { q?: string }).q || '').trim();
  const tagIdRaw = String((req.query as { tag_id?: string }).tag_id || '').trim();
  try {
    await ensureKnowledgeBase();
    const { prisma } = await import('../../plugins/db.js');
    const cats = await prisma.categories.findMany({
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      take: 40,
      select: { id: true, name: true },
    });
    const tagId = /^\d+$/.test(tagIdRaw) ? Number(tagIdRaw) : 0;
    const where: Record<string, unknown> = { status: 1 };
    if (tagId > 0) where.category_id = tagId;
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { content: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [rows, total, grouped] = await Promise.all([
      prisma.articles.findMany({
        where: where as never,
        orderBy: { updated_at: 'desc' },
        take: 40,
        select: {
          id: true,
          title: true,
          description: true,
          content: true,
          updated_at: true,
          category_id: true,
        },
      }),
      prisma.articles.count({ where: { status: 1 } }),
      prisma.articles.groupBy({
        by: ['category_id'],
        where: { status: 1 },
        _count: { id: true },
      }),
    ]);
    const counts = new Map<number, number>();
    for (const g of grouped) {
      if (g.category_id) counts.set(g.category_id, g._count.id);
    }
    const catTags = cats.map((c) => ({
      id: String(c.id),
      label: c.name || `分类 ${c.id}`,
      count: counts.get(c.id) || 0,
    }));
    const tags = [{ id: 'all', label: '全部', count: total }, ...catTags];
    const articles = rows.map((a) => ({
      id: String(a.id),
      title: a.title || '未命名',
      summary: String(a.description || a.content || '').slice(0, 160),
      content: String(a.content || a.description || ''),
      updated_at: a.updated_at
        ? a.updated_at.toISOString().slice(0, 16).replace('T', ' ')
        : '',
    }));
    return reply.send({ tags, articles });
  } catch (err) {
    req.log?.warn({ err }, 'knowledge query failed');
    return reply.send({ tags: [], articles: [] });
  }
}

export async function omniSessionReports(req: FastifyRequest, reply: FastifyReply) {
  const days = Math.min(30, Math.max(1, Number((req.query as { days?: string }).days || 1) || 1));
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  if (days > 1) from.setDate(from.getDate() - (days - 1));
  try {
    const { prisma } = await import('../../plugins/db.js');
    const { queueByConv } = await import('../itr/itr-queue.js');
    const where = { created_at: { gte: from } };
    const [agg, ended, assigned, recent, csat, byChannelRows, byAgentRows] = await Promise.all([
      prisma.omni_session_records.aggregate({
        where,
        _count: { id: true },
        _avg: { wait_sec: true, talk_sec: true },
      }),
      prisma.omni_session_records.count({ where: { ...where, ended_at: { not: null } } }),
      prisma.omni_session_records.count({ where: { ...where, assigned_at: { not: null } } }),
      prisma.omni_session_records.findMany({
        where,
        orderBy: { id: 'desc' },
        take: 30,
        select: {
          id: true,
          conversation_id: true,
          visitor_name: true,
          channel: true,
          method: true,
          wait_sec: true,
          talk_sec: true,
          assignee_name: true,
          assignee_work_no: true,
          created_at: true,
          ended_at: true,
        },
      }),
      prisma.csat_survey_responses.aggregate({
        where: { created_at: { gte: from } },
        _avg: { rating: true },
        _count: { id: true },
      }),
      prisma.omni_session_records.groupBy({
        by: ['channel'],
        where,
        _count: { id: true },
        _avg: { wait_sec: true, talk_sec: true },
      }),
      prisma.omni_session_records.groupBy({
        by: ['assignee_name'],
        where: { ...where, assignee_name: { not: '' } },
        _count: { id: true },
      }),
    ]);
    const csatPct =
      csat._count.id && csat._avg.rating != null
        ? Math.round((csat._avg.rating / 5) * 1000) / 10
        : null;
    return reply.send({
      from: from.toISOString(),
      days,
      kpis: {
        sessions: agg._count.id,
        queued: queueByConv.size,
        assigned,
        ended,
        avg_wait_sec: Math.round(agg._avg.wait_sec || 0),
        avg_talk_sec: Math.round(agg._avg.talk_sec || 0),
        csat_pct: csatPct,
        csat_count: csat._count.id,
      },
      recent: recent.map((r) => ({
        id: r.id,
        conversation_id: r.conversation_id,
        visitor_name: r.visitor_name,
        channel: r.channel,
        method: r.method,
        wait_sec: r.wait_sec,
        talk_sec: r.talk_sec,
        assignee: r.assignee_name || r.assignee_work_no || '',
        created_at: r.created_at.toISOString(),
        ended_at: r.ended_at?.toISOString() || '',
      })),
      by_channel: byChannelRows.map((r) => ({
        channel: r.channel || 'media',
        sessions: r._count.id,
        avg_wait_sec: Math.round(r._avg.wait_sec || 0),
        avg_talk_sec: Math.round(r._avg.talk_sec || 0),
      })),
      by_agent: byAgentRows.map((r) => ({
        agent: r.assignee_name || '',
        sessions: r._count.id,
      })),
    });
  } catch {
    return reply.send({
      from: from.toISOString(),
      days,
      kpis: {
        sessions: 0,
        queued: 0,
        assigned: 0,
        ended: 0,
        avg_wait_sec: 0,
        avg_talk_sec: 0,
        csat_pct: null,
        csat_count: 0,
      },
      recent: [],
      by_channel: [],
      by_agent: [],
    });
  }
}

function parseSessionConvId(id: string): number {
  const m = String(id).match(/^c?(\d+)$/);
  return m ? parseInt(m[1], 10) : NaN;
}

function formatTalkDuration(sec: number): string {
  const n = Math.max(0, Math.round(sec));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function toBeginSec(d: Date | string | null | undefined): number {
  if (!d) return 0;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

async function resolveRecordingsForPhone(phone: string) {
  const [dbFiles, fsFiles] = await Promise.all([
    lookupRecordFilesByNumber(phone, 80),
    listRecentRecordingFiles().catch(() => []),
  ]);
  return { dbFiles, fsFiles };
}

function recordingForCdr(
  row: {
    caller: string;
    called: string;
    beginTime?: Date | string | null;
    endTime?: Date | string | null;
    talkTimeLong?: number;
    callId?: number | null;
  },
  dbFiles: Awaited<ReturnType<typeof lookupRecordFilesByNumber>>,
  fsFiles: Awaited<ReturnType<typeof listRecentRecordingFiles>>,
  fallbackPath = '',
): string {
  const beginSec = toBeginSec(row.beginTime ?? null);
  const found = matchRecordFile(
    {
      caller: row.caller,
      called: row.called,
      beginSec,
      endSec: toBeginSec(row.endTime ?? null) || null,
      talkSec: row.talkTimeLong,
      logicNo: row.callId ?? null,
    },
    dbFiles,
    fsFiles,
  );
  return found || fallbackPath;
}

function downloadFileName(caller: string, called: string, offeredAt: string | Date | null): string {
  const stamp = formatDateTime(offeredAt).replace(/[: ]/g, '-') || 'call';
  const a = (caller || 'unknown').replace(/[^\w.-]/g, '');
  const b = (called || 'unknown').replace(/[^\w.-]/g, '');
  return `${a}-${b}-${stamp}.wav`;
}

async function buildCallRecordItems(
  phone: string,
  opts: { currentCallId?: number | null; currentRecordingPath?: string } = {},
) {
  const rows = await lookupCallCdrsByNumber(phone, 50);
  const { dbFiles, fsFiles } = phone ? await resolveRecordingsForPhone(phone) : { dbFiles: [], fsFiles: [] };
  return rows.map((row) => {
    const offered = row.beginTime;
    const ended = row.endTime;
    const talk = Number.isFinite(row.talkTimeLong) ? row.talkTimeLong : 0;
    const isCurrent = opts.currentCallId != null && row.callId === opts.currentCallId;
    const recordingPath = recordingForCdr(
      {
        caller: row.callingNo || row.caller,
        called: row.called,
        beginTime: row.beginTime,
        endTime: row.endTime,
        talkTimeLong: talk,
        callId: row.callId,
      },
      dbFiles,
      fsFiles,
      isCurrent ? (opts.currentRecordingPath || '') : '',
    );
    return {
      call_id: row.callId,
      caller: row.caller,
      called: row.called,
      offered_at: offered ? offered.toISOString() : null,
      offered_at_label: formatDateTime(offered),
      ended_at: ended ? ended.toISOString() : null,
      ended_at_label: formatDateTime(ended),
      talk_time_sec: talk,
      talk_time_label: talk > 0 ? formatTalkDuration(talk) : '0:00',
      direction: row.direction === 0 ? 'outbound' : (row.direction === 2 ? 'outbound' : 'inbound'),
      method: row.method || '来电',
      method_label: row.method || '来电',
      release_cause: row.releaseCause ?? 0,
      hangup_reason: row.hangupReason || '—',
      connected: !!(row.answerTime || (talk > 0)),
      recording_path: recordingPath || null,
      has_recording: !!recordingPath,
      is_current: isCurrent,
    };
  });
}

function resolveCallMethodFromAttrs(attrs: Record<string, unknown>): string {
  const method = typeof attrs.call_method === 'string' ? attrs.call_method.trim() : '';
  if (method) return method;
  const offered = Number(attrs.call_offered_type ?? 0);
  if (offered === 2) return '坐席呼坐席';
  if (offered === 10) return '外呼';
  if (offered === 7) return '转接';
  return '来电';
}

export async function omnichannelAgentStats(req: FastifyRequest, reply: FastifyReply) {
  try {
    const userId = resolveAgentUserId(req);
    const voiceEnabled = (await productModules().snapshot()).modules.icc.available;
    const session = voiceEnabled && userId ? getSessionByUserId(userId) : undefined;
    const workNo = session?.workNO || '';
    const traffic = workNo
      ? await lookupAgentDailyTraffic(workNo)
      : { answered: 0, missed: 0 };

    let sessionPending = 0;
    let sessionDone = 0;
    if (userId) {
      const { prisma } = await import('../../plugins/db.js');
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const select = { inbox: { select: { channel_type: true } } };
      const [pending, done] = await Promise.all([
        prisma.conversations.findMany({
          where: { status: 0, OR: agentVisibleConversationScope(userId, 0) },
          select,
        }),
        prisma.conversations.findMany({
          where: {
            status: 1,
            AND: [
              { OR: agentVisibleConversationScope(userId, 1) },
              {
                OR: [
                  { last_activity_at: { gte: startOfDay } },
                  { updated_at: { gte: startOfDay } },
                ],
              },
            ],
          },
          select,
        }),
      ]);
      const isMedia = (c: { inbox: { channel_type: string | null } | null }) =>
        resolveChannelGroup(c.inbox?.channel_type) === 'media';
      sessionPending = pending.filter(isMedia).length;
      sessionDone = done.filter(isMedia).length;
    }

    return reply.send({
      session_pending: sessionPending,
      session_done: sessionDone,
      answered: traffic.answered,
      missed: traffic.missed,
    });
  } catch (err) {
    req.log.error(err);
    return reply.send({
      session_pending: 0,
      session_done: 0,
      answered: 0,
      missed: 0,
    });
  }
}

export async function callRecordingByQuery(req: FastifyRequest, reply: FastifyReply) {
  try {
    const q = req.query as { caller?: string; called?: string; offered_at?: string; download?: string };
    const caller = String(q.caller ?? '').trim();
    const called = String(q.called ?? '').trim();
    const offered = String(q.offered_at ?? '').trim();
    if (!offered || (!caller && !called)) {
      return reply.status(400).send({ error: '缺少通话定位参数' });
    }
    const phone = caller || called;
    const { dbFiles, fsFiles } = await resolveRecordingsForPhone(phone);
    const path = recordingForCdr(
      { caller, called, beginTime: offered },
      dbFiles,
      fsFiles,
    );
    if (!path) return reply.status(404).send({ error: '录音尚未就绪' });
    const buf = await readRecordingBytes(path);
    const asDownload = q.download === '1' || q.download === 'true';
    const filename = downloadFileName(caller, called, offered);
    reply.header('Content-Type', 'audio/wav');
    reply.header('Content-Length', String(buf.length));
    reply.header('Cache-Control', 'private, max-age=60');
    reply.header(
      'Content-Disposition',
      `${asDownload ? 'attachment' : 'inline'}; filename="${filename}"`,
    );
    return reply.send(buf);
  } catch (err) {
    req.log.error(err);
    const message = err instanceof Error ? err.message : 'Failed to read recording';
    return reply.status(502).send({ error: message });
  }
}

export async function callRecordsByPhone(req: FastifyRequest, reply: FastifyReply) {
  try {
    const phone = String((req.query as { phone?: string }).phone ?? '').trim();
    if (!phone) return reply.send({ items: [] });
    return reply.send({ items: await buildCallRecordItems(phone) });
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({ error: 'Failed to load call records' });
  }
}

async function loadConversationCallMeta(convId: number) {
  const { prisma } = await import('../../plugins/db.js');
  const conv = await (prisma as any).conversations.findUnique({
    where: { id: convId },
    include: {
      inbox: { select: { channel_type: true, name: true } },
      contact: { select: { phone_number: true, name: true } },
    },
  });
  if (!conv) return null;
  const attrs = asAttrMap(conv.additional_attributes);
  const callIdRaw = attrs.ccs_call_id;
  const callId = typeof callIdRaw === 'number' ? callIdRaw : Number(callIdRaw);
  let recordingPath = typeof attrs.recording_path === 'string' ? attrs.recording_path : '';
  let recordingStatus = typeof attrs.recording_status === 'string' ? attrs.recording_status : 'none';
  if (!recordingPath && Number.isFinite(callId)) {
    const found = await lookupRecordPath(callId);
    if (found) {
      recordingPath = found;
      recordingStatus = 'ready';
      const next = mergeAttrs(conv.additional_attributes, {
        recording_path: found,
        recording_status: 'ready',
      });
      await (prisma as any).conversations.update({
        where: { id: convId },
        data: { additional_attributes: next as object },
      });
    }
  }
  const talkSec = typeof attrs.talk_time_sec === 'number' ? attrs.talk_time_sec : null;
  return {
    conv,
    attrs,
    callId: Number.isFinite(callId) ? callId : null,
    recordingPath,
    recordingStatus: recordingPath ? 'ready' : recordingStatus,
    talkSec,
  };
}

async function buildOmniSessionRecordPayload(
  convId: number,
  conv: {
    contact?: { phone_number?: string | null; name?: string | null } | null;
  },
  attrs: Record<string, unknown>,
) {
  const { records, events } = await listOmniSessionRecords(convId);
  const visitor = String(conv.contact?.name || conv.contact?.phone_number || attrs.caller || '');
  const eventRows = events.map((ev) => ({
    event_type: ev.event_type,
    event_label: omniEventLabel(ev.event_type),
    summary: ev.summary,
    actor_work_no: ev.actor_work_no,
    actor_name: ev.actor_name,
    target_work_no: ev.target_work_no,
    created_at: ev.created_at.toISOString(),
    created_at_label: formatDateTime(ev.created_at),
    session_record_id: ev.session_record_id,
  }));
  const items = records.map((row, idx) => {
    const talk = omniTalkSec(row.answered_at, row.ended_at, row.talk_sec);
    const wait = omniWaitSec(row.queued_at, row.assigned_at, row.wait_sec);
    const start = row.queued_at || row.assigned_at || row.created_at;
    return {
      call_id: row.id,
      caller: row.visitor_name || visitor,
      called: row.assignee_work_no || row.assignee_name || '',
      offered_at: start ? start.toISOString() : null,
      offered_at_label: formatDateTime(start),
      ended_at: row.ended_at ? row.ended_at.toISOString() : null,
      ended_at_label: formatDateTime(row.ended_at),
      talk_time_sec: talk,
      talk_time_label: talk > 0 ? formatOmniTalk(talk) : '0:00',
      wait_sec: wait,
      direction: 'inbound',
      method: row.method,
      method_label: omniMethodLabel(row.method),
      hangup_reason: row.release_reason || omniReleaseLabel(row.release_cause),
      release_cause: 0,
      connected: !!row.answered_at,
      recording_path: null,
      has_recording: false,
      is_current: !row.ended_at || idx === 0,
      is_media: true,
      assignee_work_no: row.assignee_work_no,
      assignee_name: row.assignee_name,
      skill_group_name: row.skill_group_name,
    };
  });
  const current = records[0];
  const currentTalk = current
    ? omniTalkSec(current.answered_at, current.ended_at, current.talk_sec)
    : 0;
  return {
    conversation_id: convId,
    is_voice: false,
    caller: current?.visitor_name || visitor,
    called: current?.assignee_work_no || '',
    skill_group_name: current?.skill_group_name || '',
    ccs_call_id: null,
    talk_time_sec: currentTalk,
    talk_time_label: currentTalk > 0 ? formatOmniTalk(currentTalk) : '',
    offered_at: current?.queued_at?.toISOString() || current?.assigned_at?.toISOString() || null,
    answered_at: current?.answered_at?.toISOString() || null,
    ended_at: current?.ended_at?.toISOString() || null,
    recording_status: 'none',
    has_recording: false,
    items,
    events: eventRows,
  };
}

export async function sessionCallRecord(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = req.params as { id: string };
    const convId = parseSessionConvId(id);
    if (!Number.isFinite(convId)) {
      return reply.status(400).send({ error: 'Invalid conversation id' });
    }
    const meta = await loadConversationCallMeta(convId);
    if (!meta) return reply.status(404).send({ error: 'Conversation not found' });
    const { attrs, callId, recordingPath, recordingStatus, talkSec, conv } = meta;
    if (resolveChannelGroup(conv.inbox?.channel_type) === 'media') {
      return reply.send(await buildOmniSessionRecordPayload(convId, conv, attrs));
    }
    const isVoice = conv.inbox?.channel_type === 'Channel::Voice'
      || attrs.channel === 'voice'
      || callId != null
      || !!recordingPath;
    const caller = typeof attrs.caller === 'string' ? attrs.caller : (conv.contact?.phone_number ?? '');
    const called = typeof attrs.called === 'string' ? attrs.called : '';
    const phone = caller || called;
    const { accessScope } = await import('../access/access.scope.js');
    const limited = !!accessScope.getStore() && !accessScope.getStore()!.all;
    let items = limited ? [] : await buildCallRecordItems(phone, {
      currentCallId: callId,
      currentRecordingPath: recordingPath,
    });
    if (!items.length && (callId != null || caller || called)) {
      const offered = typeof attrs.offered_at === 'string' ? attrs.offered_at : null;
      const ended = typeof attrs.ended_at === 'string' ? attrs.ended_at : null;
      const { dbFiles, fsFiles } = phone && !limited
        ? await resolveRecordingsForPhone(phone)
        : { dbFiles: [], fsFiles: [] };
      const resolved = recordingForCdr(
        { caller, called, beginTime: offered, endTime: ended, talkTimeLong: talkSec ?? 0, callId },
        dbFiles,
        fsFiles,
        recordingPath,
      );
      items = [{
        call_id: callId,
        caller,
        called,
        offered_at: offered,
        offered_at_label: formatDateTime(offered),
        ended_at: ended,
        ended_at_label: formatDateTime(ended),
        talk_time_sec: talkSec ?? 0,
        talk_time_label: talkSec != null ? formatTalkDuration(talkSec) : '',
        direction: 'inbound',
        method: '来电',
        method_label: '来电',
        release_cause: 0,
        hangup_reason: '—',
        connected: !!(talkSec && talkSec > 0) || typeof attrs.answered_at === 'string',
        recording_path: resolved || null,
        has_recording: !!resolved,
        is_current: true,
      }];
    }
    const anyRecording = items.some((it) => it.has_recording) || !!recordingPath;
    return reply.send({
      conversation_id: convId,
      is_voice: isVoice,
      caller,
      called,
      skill_group_name: typeof attrs.skill_group_name === 'string' ? attrs.skill_group_name : '',
      ccs_call_id: callId,
      talk_time_sec: talkSec,
      talk_time_label: talkSec != null ? formatTalkDuration(talkSec) : '',
      offered_at: typeof attrs.offered_at === 'string' ? attrs.offered_at : null,
      answered_at: typeof attrs.answered_at === 'string' ? attrs.answered_at : null,
      ended_at: typeof attrs.ended_at === 'string' ? attrs.ended_at : null,
      recording_status: anyRecording ? 'ready' : recordingStatus,
      has_recording: anyRecording,
      items,
    });
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({ error: 'Failed to load call record' });
  }
}

async function resolveSessionRecordingPath(
  convId: number,
  query: { caller?: string; called?: string; offered_at?: string },
): Promise<{ path: string; caller: string; called: string; offeredAt: string | null } | null> {
  const meta = await loadConversationCallMeta(convId);
  if (!meta) return null;
  const { attrs, conv, recordingPath, callId, talkSec } = meta;
  const convCaller = typeof attrs.caller === 'string' ? attrs.caller : (conv.contact?.phone_number ?? '');
  const convCalled = typeof attrs.called === 'string' ? attrs.called : '';
  const qCaller = String(query.caller ?? '').trim();
  const qCalled = String(query.called ?? '').trim();
  const qOffered = String(query.offered_at ?? '').trim();
  const { accessScope } = await import('../access/access.scope.js');
  if (accessScope.getStore() && !accessScope.getStore()!.all) {
    const offeredAt = typeof attrs.offered_at === 'string' ? attrs.offered_at : null;
    if ((qCaller && qCaller !== convCaller) || (qCalled && qCalled !== convCalled) || (qOffered && qOffered !== offeredAt)) throw Object.assign(new Error('录音不属于获授权会话'), { statusCode: 403 });
    return { path: recordingPath, caller: convCaller, called: convCalled, offeredAt };
  }
  const wantsSpecific = !!(qCaller || qCalled || qOffered);
  if (wantsSpecific) {
    const allowed = phonesOverlap(
      convCaller || conv.contact?.phone_number || '',
      convCalled,
      qCaller || convCaller,
      qCalled || convCalled,
    );
    if (!allowed && convCaller && qCaller && qCalled) {
      throw Object.assign(new Error('录音不属于当前会话'), { statusCode: 403 });
    }
    const phone = qCaller || qCalled || convCaller || convCalled;
    const { dbFiles, fsFiles } = await resolveRecordingsForPhone(phone);
    const path = recordingForCdr(
      {
        caller: qCaller || convCaller,
        called: qCalled || convCalled,
        beginTime: qOffered || null,
        talkTimeLong: talkSec ?? 0,
        callId,
      },
      dbFiles,
      fsFiles,
      recordingPath,
    );
    if (!path) return { path: '', caller: qCaller || convCaller, called: qCalled || convCalled, offeredAt: qOffered || null };
    return { path, caller: qCaller || convCaller, called: qCalled || convCalled, offeredAt: qOffered || null };
  }
  if (recordingPath) {
    return {
      path: recordingPath,
      caller: convCaller,
      called: convCalled,
      offeredAt: typeof attrs.offered_at === 'string' ? attrs.offered_at : null,
    };
  }
  const phone = convCaller || convCalled;
  if (!phone) return { path: '', caller: convCaller, called: convCalled, offeredAt: null };
  const { dbFiles, fsFiles } = await resolveRecordingsForPhone(phone);
  const path = recordingForCdr(
    {
      caller: convCaller,
      called: convCalled,
      beginTime: typeof attrs.offered_at === 'string' ? attrs.offered_at : null,
      endTime: typeof attrs.ended_at === 'string' ? attrs.ended_at : null,
      talkTimeLong: talkSec ?? 0,
      callId,
    },
    dbFiles,
    fsFiles,
  );
  return {
    path: path || '',
    caller: convCaller,
    called: convCalled,
    offeredAt: typeof attrs.offered_at === 'string' ? attrs.offered_at : null,
  };
}

export async function sessionRecording(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = req.params as { id: string };
    const convId = parseSessionConvId(id);
    if (!Number.isFinite(convId)) {
      return reply.status(400).send({ error: 'Invalid conversation id' });
    }
    const q = req.query as { caller?: string; called?: string; offered_at?: string; download?: string };
    const resolved = await resolveSessionRecordingPath(convId, q);
    if (!resolved) return reply.status(404).send({ error: 'Conversation not found' });
    if (!resolved.path) {
      return reply.status(404).send({ error: '录音尚未就绪' });
    }
    const buf = await readRecordingBytes(resolved.path);
    const asDownload = q.download === '1' || q.download === 'true';
    const filename = downloadFileName(resolved.caller, resolved.called, resolved.offeredAt);
    reply.header('Content-Type', 'audio/wav');
    reply.header('Content-Length', String(buf.length));
    reply.header('Cache-Control', 'private, max-age=60');
    reply.header(
      'Content-Disposition',
      `${asDownload ? 'attachment' : 'inline'}; filename="${filename}"`,
    );
    return reply.send(buf);
  } catch (err) {
    const status = err && typeof err === 'object' && 'statusCode' in err
      ? Number((err as { statusCode?: number }).statusCode)
      : 0;
    if (status === 403) return reply.status(403).send({ error: (err as Error).message });
    req.log.error(err);
    const message = err instanceof Error ? err.message : 'Failed to read recording';
    return reply.status(502).send({ error: message });
  }
}

export async function sessionEnd(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = req.params as { id: string };
    const convId = parseSessionConvId(id);
    if (!Number.isFinite(convId)) {
      return reply.status(400).send({ error: 'Invalid conversation id' });
    }
    const { prisma } = await import('../../plugins/db.js');
    const conv = await (prisma as any).conversations.findUnique({
      where: { id: convId },
      include: { inbox: { select: { channel_type: true } } },
    });
    if (!conv) return reply.status(404).send({ error: 'Conversation not found' });
    if (conv.status !== 0) {
      return reply.send({ ok: true, conversation_id: convId, omni_lifecycle: 'ended', already_resolved: true });
    }

    const attrs = asAttrMap(conv.additional_attributes);
    const userId = resolveAgentUserId(req);
    const session = req.server.ccsBridge?.getSession(userId);
    const requestId = Number(attrs.acd_request_id ?? 0);
    const acdAgentId = Number(session?.agentId ?? attrs.acd_agent_id ?? 0);
    const vdnId = activeVdn(Number(attrs.acd_vdn_id ?? session?.vdnId ?? env.OMNI_AGENT_VDN_ID));
    if (requestId && acdAgentId) {
      try {
        await sessionReleased({ agentId: acdAgentId, vdnId, requestId });
      } catch (err) {
        req.log.warn({ err }, 'end session ACD SessionReleased failed');
      }
    }

    const updated = await markConversationEnded(convId, {
      omni_release_cause: 'agent_end',
      actor_user_id: userId,
    });

    const callId = typeof attrs.ccs_call_id === 'number' ? attrs.ccs_call_id : Number(attrs.ccs_call_id);
    const liveCallId = session?.currentCall && typeof session.currentCall.CallID === 'number'
      ? session.currentCall.CallID
      : undefined;
    const shouldRelease = !!(session?.loggedIn && session.agentId
      && Number.isFinite(callId)
      && liveCallId === callId);
    if (shouldRelease) {
      try {
        await req.server.ccsBridge!.handleInvoke(userId, `end-${Date.now()}`, 'DoAgentReleaseCall', {
          AgentID: session!.agentId,
          CallID: liveCallId ?? callId,
          CallIDType: 0,
        });
      } catch (err) {
        req.log.warn({ err }, 'end session CCS release failed');
      }
    }

    req.server.emitToAccount(conv.account_id, 'conversation.lifecycle_changed', {
      conversation_id: convId,
      omni_lifecycle: 'ended',
    });

    return reply.send({
      ok: true,
      conversation_id: convId,
      omni_lifecycle: readLifecycle(updated?.additional_attributes),
    });
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({ error: 'Failed to end session' });
  }
}

export async function sessionShake(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = req.params as { id: string };
    const convId = parseSessionConvId(id);
    const { prisma } = await import('../../plugins/db.js');

    const conv = await (prisma as any).conversations.findUnique({
      where: { id: convId },
      select: { inbox_id: true, account_id: true },
    });
    if (!conv) return reply.status(404).send({ error: 'Conversation not found' });

    const msg = await (prisma as any).messages.create({
      data: {
        account_id: conv.account_id,
        inbox_id: conv.inbox_id,
        conversation_id: convId,
        content: '[窗口抖动]',
        message_type: 1,
        content_type: 0,
        content_attributes: { kind: 'shake' },
        private: false,
        sender_type: 'User',
      },
    });

    await (prisma as any).conversations.update({
      where: { id: convId },
      data: { last_activity_at: new Date() },
    });

    req.server.emitToAccount(conv.account_id, 'message.created', {
      id: msg.id,
      content: msg.content,
      message_type: 'outgoing',
      content_attributes: msg.content_attributes,
      conversation_id: convId,
      account_id: conv.account_id,
      created_at: msg.created_at.getTime(),
    });

    return reply.send({ ok: true, message_id: msg.id });
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({ error: 'Failed to send shake' });
  }
}

export async function getSessionAi(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = req.params as { id: string };
    const convId = parseSessionConvId(id);
    const { prisma } = await import('../../plugins/db.js');
    const conv = await (prisma as any).conversations.findUnique({
      where: { id: convId },
      select: { custom_attributes: true },
    });
    if (!conv) return reply.status(404).send({ error: 'Conversation not found' });
    const ca = (conv.custom_attributes ?? {}) as Record<string, unknown>;
    return reply.send({
      auto_reply: !!ca.ai_auto_reply,
      assistant_id: (ca.ai_assistant_id as number | undefined) ?? null,
    });
  } catch {
    return reply.send({ auto_reply: false, assistant_id: null });
  }
}

export async function putSessionAi(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = req.params as { id: string };
    const convId = parseSessionConvId(id);
    const body = req.body as { auto_reply: boolean; assistant_id?: number | null };
    const { prisma } = await import('../../plugins/db.js');

    const conv = await (prisma as any).conversations.findUnique({
      where: { id: convId },
      select: { custom_attributes: true },
    });
    if (!conv) return reply.status(404).send({ error: 'Conversation not found' });

    const current = (conv.custom_attributes ?? {}) as Record<string, unknown>;
    const next = {
      ...current,
      ai_auto_reply: !!body.auto_reply,
      ...(body.assistant_id !== undefined ? { ai_assistant_id: body.assistant_id } : {}),
    };
    if (!body.auto_reply) {
      delete next.ai_assistant_id;
    }

    await (prisma as any).conversations.update({
      where: { id: convId },
      data: { custom_attributes: next },
    });

    return reply.send({
      ok: true,
      auto_reply: next.ai_auto_reply,
      assistant_id: (next.ai_assistant_id as number | undefined) ?? null,
    });
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({ error: 'Failed to update AI settings' });
  }
}

function formatDateTime(input: Date | string | null | undefined): string {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(d.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d).replace('T', ' ');
}

/** 电话会话显示呼入时间；其它渠道显示最后活动时间。一律 yyyy-MM-dd HH:mm:ss */
function formatInboundDateTime(
  offeredAt: string | null,
  createdAt: Date | null | undefined,
  lastActivityAt: Date | null | undefined,
  isPhone: boolean,
): string {
  if (isPhone) {
    return formatDateTime(offeredAt) || formatDateTime(createdAt) || formatDateTime(lastActivityAt);
  }
  return formatDateTime(lastActivityAt) || formatDateTime(createdAt);
}

export async function omnichannelRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.get('/api/agent/status', auth, getAgentStatus);
  fastify.put('/api/agent/status', auth, putAgentStatus);
  fastify.get('/api/agent/profile', getAgentProfile);
  fastify.get('/api/agent/skill-groups', getAgentSkillGroups);
  fastify.put('/api/agent/skill-groups', putAgentSkillGroups);
  fastify.post('/api/agent/skill-groups/sign-in-all', postAgentSkillGroupsSignInAll);
  fastify.post('/api/agent/skill-groups/sign-out-all', postAgentSkillGroupsSignOutAll);
  fastify.get('/api/omnichannel/org-matrix', auth, getOrgMatrix);
  fastify.get('/api/agent/acd-queuing', auth, getAgentAcdQueuing);
  fastify.put('/api/agent/acd-queuing', auth, putAgentAcdQueuing);
  fastify.get('/api/agent/transfer/catalog', auth, getTransferCatalog);
  fastify.get('/api/agent/transfer/agents', auth, getTransferAgents);
  fastify.get('/api/omnichannel/workspace/online-agents', auth, getMediaOnlineAgents);
  fastify.get('/api/omnichannel/workspace/snatch-targets', auth, getMediaSnatchTargets);
  fastify.post('/api/omnichannel/workspace/snatch', auth, postMediaSnatch);
  fastify.get('/api/omnichannel/workspace/queue-sessions', auth, getMediaQueueSessions);
  fastify.post('/api/omnichannel/workspace/queue-take', auth, postMediaQueueTake);
  fastify.post('/api/omnichannel/workspace/conference', auth, postMediaConference);
  fastify.post('/api/omnichannel/workspace/monitor', auth, postMediaMonitor);
  fastify.post('/api/omnichannel/workspace/ims-force', auth, postMediaImsForce);
  fastify.get('/api/agent/workspace/snatch-targets', auth, getWorkspaceSnatchTargets);
  fastify.get('/api/agent/workspace/queue-calls', auth, getWorkspaceQueueCalls);
  fastify.post('/api/agent/workspace/queue-take', auth, postWorkspaceQueueTake);
  fastify.get('/api/agent/workspace/online-agents', auth, getWorkspaceOnlineAgents);
  fastify.get('/api/agent/workspace/rest-leaders', auth, getWorkspaceRestLeaders);
  fastify.get('/api/agent/internal-chats', auth, getInternalChats);
  fastify.post('/api/agent/internal-chats', auth, postInternalChat);
  fastify.post('/api/agent/internal-chats/:peerId/messages', auth, postInternalChatMessage);
  fastify.post('/api/agent/internal-chats/:peerId/read', auth, postInternalChatRead);
  fastify.post('/api/agent/internal-chats/:peerId/approve-rest', auth, postInternalApproveRest);
  fastify.get('/api/agent/rest-requests', auth, getRestRequestRecords);
  fastify.get('/api/agent/rest-requests/meta', auth, getRestRequestMeta);
  fastify.post('/api/agent/rest-requests', auth, postRestRequestRecord);
  fastify.post('/api/agent/change-password', auth, changeAgentPassword);
  fastify.get('/api/dashboard/profile', auth, dashboardProfile);
  fastify.get('/api/dashboard/quick-links', auth, dashboardQuickLinks);
  fastify.get('/api/dashboard/memos', auth, dashboardMemos);
  fastify.post('/api/dashboard/memos', auth, dashboardCreateMemo);
  fastify.patch('/api/dashboard/memos/:id', auth, dashboardPatchMemo);
  fastify.get('/api/dashboard/metrics', auth, dashboardMetrics);
  fastify.get('/api/dashboard/channel-volume', auth, dashboardChannelVolume);
  fastify.get('/api/dashboard/announcements', auth, dashboardAnnouncements);
  fastify.post('/api/dashboard/announcements', auth, dashboardCreateAnnouncement);
  fastify.post('/api/dashboard/announcements/read', auth, dashboardMarkAnnouncementsRead);
  fastify.post('/api/dashboard/announcements/:id/read', auth, dashboardMarkAnnouncementRead);
  fastify.post('/api/dashboard/announcements/:id/unread', auth, dashboardMarkAnnouncementUnread);
  fastify.get('/api/dashboard/calendar-events', auth, dashboardCalendarEvents);
  fastify.post('/api/dashboard/calendar-events', auth, dashboardCreateCalendarEvent);
  fastify.patch('/api/dashboard/calendar-events/:id', auth, dashboardPatchCalendarEvent);
  fastify.delete('/api/dashboard/calendar-events/:id', auth, dashboardDeleteCalendarEvent);
  fastify.get('/api/customers', auth, customersList);
  fastify.get('/api/customers/:id', auth, customersGet);
  fastify.patch('/api/customers/:id', auth, customersPatch);
  fastify.get('/api/customers/:id/notes', auth, customersNotesList);
  fastify.post('/api/customers/:id/notes', auth, customersNotesCreate);
  fastify.delete('/api/customers/:id/notes/:noteId', auth, customersNotesDelete);
  fastify.get('/api/customers/:id/labels', auth, customersLabelsGet);
  fastify.put('/api/customers/:id/labels', auth, customersLabelsPut);
  fastify.get('/api/customers/:id/timeline', auth, customersTimeline);
  fastify.get('/api/crm/labels', auth, crmLabelsList);
  fastify.get('/api/companies', auth, companiesList);
  fastify.post('/api/companies', auth, companiesCreate);
  fastify.get('/api/companies/:id', auth, companiesGet);
  fastify.patch('/api/companies/:id', auth, companiesPatch);
  fastify.delete('/api/companies/:id', auth, companiesDelete);
  fastify.get('/api/opportunities', auth, opportunitiesList);
  fastify.post('/api/opportunities', auth, opportunitiesCreate);
  fastify.patch('/api/opportunities/:id', auth, opportunitiesPatch);
  fastify.delete('/api/opportunities/:id', auth, opportunitiesDelete);
  fastify.get('/api/agent-shifts', auth, agentShiftsGet);
  fastify.patch('/api/agent-shifts', auth, agentShiftsPatch);
  fastify.post('/api/agent-shifts/staff', auth, agentShiftsAddStaff);
  fastify.delete('/api/agent-shifts/staff/:id', auth, agentShiftsRemoveStaff);
  fastify.post('/api/agent-shifts/leaves', auth, agentShiftsAddLeave);
  fastify.delete('/api/agent-shifts/leaves/:id', auth, agentShiftsRemoveLeave);
  fastify.post('/api/agent-shifts/cell', auth, agentShiftsCycleCell);
  fastify.post('/api/agent-shifts/notes', auth, agentShiftsUpsertNote);
  fastify.delete('/api/agent-shifts/notes', auth, agentShiftsDeleteNote);
  fastify.post('/api/agent-shifts/holidays-2026', auth, agentShiftsFillHolidays);
  fastify.get('/api/agent-shifts/export.csv', auth, agentShiftsExportCsv);
  fastify.get('/api/navigation/tree', navigationTree);
  fastify.get('/api/omnichannel/contacts', omnichannelContacts);
  fastify.get('/api/omnichannel/contacts/export.csv', auth, omnichannelContactsExport);
  fastify.get('/api/omnichannel/agent-stats', auth, omnichannelAgentStats);
  fastify.get('/api/omnichannel/sessions/:id/messages', sessionMessages);
  fastify.get('/api/omnichannel/call-records', auth, callRecordsByPhone);
  fastify.get('/api/omnichannel/recordings', auth, callRecordingByQuery);
  fastify.get('/api/omnichannel/sessions/:id/call-record', auth, sessionCallRecord);
  fastify.get('/api/omnichannel/sessions/:id/recording', auth, sessionRecording);
  fastify.post('/api/omnichannel/sessions/:id/end', auth, sessionEnd);
  fastify.post('/api/omnichannel/sessions/:id/shake', auth, sessionShake);
  fastify.get('/api/omnichannel/sessions/:id/ai', auth, getSessionAi);
  fastify.put('/api/omnichannel/sessions/:id/ai', auth, putSessionAi);
  fastify.get('/api/omnichannel/customers/:id', customerProfile);
  fastify.get('/api/omnichannel/after-sales', afterSales);
  fastify.get('/api/omnichannel/ecom-orders', ecomOrders);
  fastify.get('/api/omnichannel/knowledge', knowledge);
  fastify.get('/api/omnichannel/reports/sessions', auth, omniSessionReports);
  fastify.get('/api/omnichannel/tts/:file', async (req, reply) => {
    const file = String((req.params as { file: string }).file || '');
    const buf = await readTtsWav(file);
    if (!buf) return reply.code(404).send({ error: 'not found' });
    reply.header('Content-Type', 'audio/wav');
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(buf);
  });
}
