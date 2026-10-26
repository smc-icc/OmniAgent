import { AppError } from '../../shared/errors/index.js';
import { assertVoiceIdle } from '../../modules/extension-binding/policy.js';
import { callbackServantName, callbackMatches } from '../../modules/extension-binding/callback-lease.js';
import type { FastifyInstance } from 'fastify';
import { assertCurrentLogin, getLoginSession, isCurrentSession, markLoginVoiceSignedIn, markLoginVoiceSignedOut, newSessionId } from '../../shared/services/login-session.js';
import { invokeDoAgent } from './ccs-client.js';
import {
  bindAgentId,
  clearSession,
  expectedAckForDo,
  getSessionByAgentId,
  getSessionByUserId,
  isVoiceSessionCurrent,
  listActiveSessions,
  setCredentials,
  unbindAgentId,
  type CcsUserSession,
} from './session-manager.js';
import {
  getSignedInSkillIds,
  setSignedInSkillIds,
  mergeSignedInSkillIds,
  setGroupTree,
  hasCachedGroupTree,
  buildDisplayLabel,
} from '../../shared/services/agent-skill-groups.js';
import { loadGroupsByVdnFromIccDb } from '../../shared/services/icc-groups-dal.js';
import { persistVoiceFromCcs } from '../../shared/services/voice-session.js';
import { prisma } from '../../plugins/db.js';
import { ensureConversationParticipant } from '../../shared/services/conversation-participation.js';
import { readLifecycle } from '../../shared/services/conversation-attrs.js';
import { resolveChannelGroup } from '../../shared/services/channel-group.js';
import { channelOfConversation, resolveRoutes } from '../../shared/services/channel-route.js';
import { resolveVoiceActor, ownedCcsPayload, loginCallbackSession } from '../../shared/services/voice-tenant.js';
import { confTenancyEnabled } from '../../shared/services/conf-tenancy.js';
import { accessScope } from '../../modules/access/access.scope.js';

/** agent_struct.h 的 CallEndEvtType：振铃超时（坐席没接）。 */
const CALL_END_EVT_TIMEOUT = 1;

/**
 * 坐席「超时未接」：派单给坐席后坐席没接（CCS 的 CallEndEvtType = CEE_TimeOut）。
 * 与「坐席接了但没回复」是两条独立路由，触发点 on_agent_no_answer。
 *
 * ACD 排队时 requestId 用的就是会话 id（见 /api/itr/callback/transfer），呼叫的 pid
 * 也是它，所以先按会话 id 试；查不到就当纯粹的语音呼叫，不路由。
 */
async function routeAgentNoAnswer(
  payload: Record<string, unknown>,
  call: Record<string, unknown> | null,
  session: CcsUserSession,
): Promise<void> {
  try {
    const convId = Number(call?.CallID ?? payload.CallID ?? 0);
    if (!Number.isFinite(convId) || convId <= 0) return;
    const actor = confTenancyEnabled() ? await resolveVoiceActor({ userId: session.userId, vdnId: session.vdnId }) : null;
    const conv = await prisma.conversations
      .findUnique({ where: { id: convId }, select: { id: true, account_id: true } })
      .catch(() => null);
    if (!conv || (actor && conv.account_id !== actor.accountId)) return;
    const { channelType, channelId } = await channelOfConversation(convId);
    if (channelId <= 0) return;
    const { normalizeRouteChannelType } = await import('../../shared/services/channel-route.js');
    const routeType = normalizeRouteChannelType(channelType);
    if (!routeType) return;
    const targets = await resolveRoutes(channelId, 'on_agent_no_answer', routeType);
    if (!targets.length) return;
    const { executeRoutes } = await import('../../modules/itr/route-exec.js');
    const out = await executeRoutes(convId, targets);
    console.log('[acd-route] agent no-answer routed', {
      convId,
      ok: out.ok,
      used: out.used?.appType ?? null,
      message: out.message,
    });
  } catch (e) {
    console.warn('[acd-route] agent no-answer failed', e);
  }
}
import { clearCcsEmitQueue } from './ccs-event-queue.js';
import { partitionAgentGroups, signInImsOnAcd, signInImsAutoCheckIn, signOutImsOnAcd, signOutImsOnLogout } from './ims-acd.js';
import {
  appendInternalMessage,
} from '../../shared/services/agent-internal-chat.js';
import { env } from '../../config/env.js';
import { getRuntimeCcsBootId } from '../../shared/services/omni-runtime-persist.js';

export type EmitToUser = (userId: number, event: string, payload: unknown) => void;

const CCS_SOCKET_EVENT = 'ccs.agent';

export interface CcsBridgeOptions {
  vdnId: number;
  servantObjName: string;
  servantHost: string;
  servantPort: number;
  invokeTimeoutMs: number;
  /** Resolve ICC WorkNO from OmniAgent user id when client payload is empty. */
  resolveWorkNoForUser?: (userId: number) => Promise<string>;
  /**
   * 坐席 UI 是否在线（有活跃 WebSocket）。仅用于日志与 CallEnd 后补注销判断。
   * 代答门禁不依赖此回调。
   */
  isUserOnline?: (userId: number) => boolean;
  /**
   * 坐席是否有「前台可见」的 UI（移动端切后台不算）。
   * 为 false 时来电必须额外走离线推送，否则手机 App 醒不过来。
   */
  isUiForeground?: (userId: number) => boolean;
  emitToAccount?: (accountId: number, event: string, data: unknown) => void;
}

let emitToUser: EmitToUser = () => {};
let bridgeOptions: CcsBridgeOptions | null = null;

export function initCcsBridge(emit: EmitToUser, options: CcsBridgeOptions): void {
  emitToUser = emit;
  bridgeOptions = options;
}

function push(userId: number, op: 'ack' | 'evt', method: string, payload: Record<string, unknown>, reqId?: string): void {
  emitToUser(userId, CCS_SOCKET_EVENT, { op, method, payload, ...(reqId ? { reqId } : {}) });
}

/** UI 不在前台时的来电兜底：走厂商推送唤醒 App。失败不影响话务本身。 */
function notifyIncomingCallByPush(userId: number, payload: Record<string, unknown>): void {
  const caller = String(payload.Caller ?? payload.sCallerNO ?? '');
  void import('../../shared/services/push.js')
    .then(({ pushIncomingCall }) => pushIncomingCall(userId, {
      kind: 'incoming_call',
      call_id: String(payload.CallID ?? ''),
      call_id_type: Number(payload.CallIDType ?? 0),
      caller,
      called: String(payload.Called ?? ''),
      title: '来电',
      body: caller ? `来自 ${caller}` : '有新的来电',
    }))
    .catch((err) => console.warn('[push] incoming call push failed', (err as Error).message));
}

function notifySkillGroupsChanged(userId: number): void {
  const signed_in = getSignedInSkillIds(userId);
  push(userId, 'evt', 'omni.skillGroupsChanged', {
    signed_in,
    display_label: buildDisplayLabel(signed_in, userId),
  });
}

/** CCS 只管 TAS 自动签入；登录后把 AutoCheckIn 的 IMS 组/技能签进 ACD，否则转人工 AgentSignInCount=0。 */
function signInImsAfterCcsLogin(session: CcsUserSession): Promise<void> {
  const agentId = session.agentId;
  const userId = session.userId;
  if (agentId == null) return Promise.resolve();
  session.acdQueuingConfirmed = true;
  return signInImsAutoCheckIn(agentId, session.vdnId)
    .then((imsGroups) => {
      const s = getSessionByUserId(userId);
      if (!s?.loggedIn || s.agentId !== agentId) return;
      if (imsGroups.length > 0) mergeSignedInSkillIds(userId, imsGroups);
      notifySkillGroupsChanged(userId);
      console.log(
        `[ims-acd] login auto check-in user=${userId} agentId=${agentId} groups=[${imsGroups.join(',')}]`,
      );
    })
    .catch((err: unknown) => {
      console.warn(
        '[ims-acd] login auto check-in failed',
        err instanceof Error ? err.message : err,
      );
    });
}

/** ACD Result=10 = 已签入，与路由层一致按成功处理。 */
function isAcdSignInOk(ret: number, rsp: Record<string, unknown> | undefined): boolean {
  const rc = Number(rsp?.Result ?? ret ?? 0);
  return rc === 0 || rc === 10;
}

function agentIdFromPayload(payload: Record<string, unknown>): number | undefined {
  const id = payload.AgentID ?? payload.agentID ?? payload.AgentId;
  if (typeof id === 'number') return id;
  if (typeof id === 'string') return parseInt(id, 10);
  return undefined;
}

function firstVoiceStatus(raw: unknown): number | undefined {
  const asInt = (x: unknown): number | undefined => {
    if (typeof x === 'number' && Number.isFinite(x)) return x;
    if (typeof x === 'string' && x.trim() !== '') {
      const n = Number(x);
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  };
  const direct = asInt(raw);
  if (direct != null) return direct;
  if (Array.isArray(raw)) return asInt(raw[0]);
  if (raw && typeof raw === 'object') {
    const v = (raw as { value?: unknown }).value;
    if (Array.isArray(v)) return asInt(v[0]);
  }
  return undefined;
}

function updateSessionFromEvt(session: CcsUserSession, method: string, payload: Record<string, unknown>): void {
  if (!isVoiceSessionCurrent(session)) return;
  switch (method) {
    case 'OnAgentLoginExAck': {
      const result = payload.Result as number | undefined;
      if (result === 0 && payload.AgentID != null) {
        bindAgentId(session.userId, payload.AgentID as number);
        session.loggedIn = true;
        markLoginVoiceSignedIn(session.userId, session.loginSessionId);
        session.status = 'idle';
        session.workMode = 'ready';
        session.mediaQueuingMode = env.OMNI_ACD_MQM;
        session.callerCount = env.OMNI_ACD_CALLER_COUNT;
        session.acdQueuingConfirmed = false;
        session.skillsToRestore = null;
        session.skillsRestoreInFlight = false;
        // 丢掉上一会话残留组 ID，避免 GET/PUT 用旧列表把 IMS 组签出
        setSignedInSkillIds(session.userId, []);
        clearSignedInSynced(session.userId);
        void signInImsAfterCcsLogin(session);
      }
      // autoAnswer = CCS 会话存活时「自动摘机 vs 手动摘机」；与当前有无 WS 无关
      session.autoAnswer = (payload.AutoAnswer as number | undefined) === 1;
      break;
    }
    case 'OnAgentLoggedOffAck':
      // CCS 对「agent 已不存在」也会回非 0（例如 ACD_AgentIDErr）。此时本地若继续
      // 认为已登录，后续 restore 会一直发 DoAgentSetIdle / DoAgentGetGroupReq，
      // 而 CCS 对这些请求根本不回调，只能等满超时（前端 15s 先报错）。
      // 因此只要 ack 回来就清本地登录态；Result 仅用于日志。
      if (payload.Result !== 0) {
        console.warn(
          `[ccs-uiOffline] LoggedOff ack non-zero result=${String(payload.Result)} user=${session.userId} agentId=${session.agentId ?? '-'} — clearing local session`,
        );
      }
      unbindAgentId(session.userId);
      session.loggedIn = false;
      session.status = 'offline';
      session.skillsToRestore = null;
      session.agentStatusToRestore = null;
      session.skillsRestoreInFlight = false;
      session.pendingLogoutAfterCall = false;
      session.uiOfflineGraceElapsed = false;
      session.acdQueuingConfirmed = false;
      clearSignedInSynced(session.userId);
      setSignedInSkillIds(session.userId, []);
      notifySkillGroupsChanged(session.userId);
      answerInFlightUsers.delete(session.userId);
      break;
    case 'OnAgentOnForceLogOutEvt':
      unbindAgentId(session.userId);
      session.loggedIn = false;
      session.status = 'offline';
      session.currentCall = null;
      session.skillsToRestore = null;
      session.agentStatusToRestore = null;
      session.skillsRestoreInFlight = false;
      session.pendingLogoutAfterCall = false;
      session.uiOfflineGraceElapsed = false;
      session.acdQueuingConfirmed = false;
      clearSignedInSynced(session.userId);
      setSignedInSkillIds(session.userId, []);
      notifySkillGroupsChanged(session.userId);
      answerInFlightUsers.delete(session.userId);
      break;
    case 'OnAgentOnCallOfferedEvt':
      session.status = 'ringing';
      session.currentCall = payload;
      break;
    case 'OnAgentOnCallEndEvt':
    case 'OnAgentOnReleasedEvt':
    case 'OnAgentOnInterceptedEvt': {
      // 「坐席超时未接」：振铃超时导致呼叫结束。依据 agent_struct.h 的 CallEndEvtType
      //（CEE_OK=0 / CEE_TimeOut=1 / CEE_Loot=2 / CEE_Transfer=3 / CEE_LogOut=4），
      // 只有 CEE_TimeOut 才是「派单给坐席、坐席没接」。这是独立的触发点
      //（on_agent_no_answer），与「坐席接了但没回复」（on_agent_no_reply）分开配置。
      const prevCall = session.currentCall as Record<string, unknown> | null;
      const endedType = Number(prevCall?.CallEndEvtType ?? payload.CallEndEvtType ?? -1);
      session.status = session.loggedIn ? 'idle' : 'offline';
      session.currentCall = null;
      answerInFlightUsers.delete(session.userId);
      if (method === 'OnAgentOnCallEndEvt' && endedType === CALL_END_EVT_TIMEOUT) {
        void routeAgentNoAnswer(payload, prevCall, session);
      }
      break;
    }
    case 'OnAgentOnAnsweredEvt':
      session.status = 'talking';
      break;
    case 'OnAgentOnHeldEvt':
      session.status = 'hold';
      break;
    case 'OnAgentOnRetrievedEvt':
    case 'OnAgentCallComeBackEvt':
      session.status = 'talking';
      break;
    case 'OnAgentSetIdleAck':
      session.workMode = 'ready';
      break;
    case 'OnAgentSetBusyAck':
    case 'OnAgentOnForceBusyEvt':
      if (method === 'OnAgentSetBusyAck' && session.forceIdleAt
          && Date.now() - session.forceIdleAt < 5000) {
        console.log(`[ccs-cb] ignore late SetBusyAck after ForceIdle user=${session.userId}`);
        break;
      }
      session.forceIdleAt = 0;
      session.workMode = 'busy';
      session.agentStatus = 2;
      break;
    case 'OnAgentOnForceIdleEvt':
      session.workMode = 'ready';
      session.agentStatus = 32;
      session.forceIdleAt = Date.now();
      console.log(`[ccs-cb] ForceIdle applied user=${session.userId} agentStatus=32 workMode=ready`);
      break;
    case 'OnAgentOnForceBlockEvt':
      session.workMode = 'blocked';
      session.agentStatus = 8;
      break;
    case 'OnAgentOnStartRestEvt':
      session.workMode = 'break';
      break;
    case 'OnAgentOnRestTimeOverEvt':
    case 'OnAgentOnNotAgreeRestEvt':
      if (session.workMode === 'break') session.workMode = 'ready';
      break;
    case 'OnAgentSelfStatusUpdateEvt':
      {
        const n = firstVoiceStatus(payload.Status ?? payload.AgentStatus);
        if (typeof n === 'number') session.agentStatus = n;
        const voice = typeof n === 'number' ? n : session.agentStatus;
        const CALL = 64 | 128 | 256 | 512 | 2048; // Ring | CallOut | Talking | Hold | InspectStatus
        if (voice & CALL) break;
        if (voice === 1024) session.workMode = 'acw';
        else if (voice === 4) session.workMode = 'break';
        else if (voice === 2) session.workMode = 'busy';
        else if (voice === 8) session.workMode = 'blocked';
        else if (voice === 32 || voice === 16) {
          session.workMode = 'ready';
        }
      }
      break;
    default:
      break;
  }
}

/** OnAgentGetGroupReqAck 分包累积器：userId → 已签入组 ID（末包 AgentInfoCount=-1 时写回缓存）。 */
const groupReqAccumulator = new Map<number, number[]>();
/** 该 userId 是否已从 CCS 同步过签入组状态（避免每次 GET 都触发）。 */
const signedInSynced = new Set<number>();
/** 该坐席正在发 DoAgentAnswerCall（防 Offered + 重连补答连打两次）。与 CallID 无关。 */
const answerInFlightUsers = new Set<number>();
/**
 * WS 重连后 restore 技能的连续失败次数：userId → count。
 *
 * 为什么需要：agent 在 CCS 侧已经 LoggedOff 时，CCS 不会为它的
 * DoAgentSignInGroup / DoAgentSetIdle 回调任何 Ack，后端只能等满
 * CCS_INVOKE_TIMEOUT_MS(30s)。若每次都"保留 skillsToRestore 下次再试"，
 * 每次 WS 重连都会重演一次，把 /api/agent/* 接口拖到前端 15s 超时。
 * 连续失败达到上限即放弃恢复、清空待恢复列表，要求用户重新接入。
 */
const restoreFailCounts = new Map<number, number>();
/** restore 连续失败上限：超过即放弃，避免无 Ack 场景下的无限重试。 */
const RESTORE_MAX_ATTEMPTS = 3;

/** 代答门禁：loggedIn && autoAnswer && agentId（与 WS / 技能签出无关）。 */
export function canAutoAnswer(session: CcsUserSession): boolean {
  return session.loggedIn && session.autoAnswer && session.agentId != null;
}

/** Focus：ACD 来电可自动摘机；转接/咨询（CallOfferedType=7）与坐席互呼（2）必须振铃由坐席接听。 */
function isAgentCallOfferPayload(payload: Record<string, unknown> | null | undefined): boolean {
  if (!payload) return false;
  const t = Number(payload.CallOfferedType ?? 0);
  const data = String(payload.CallData ?? '');
  return t === 2 || data.startsWith('agent_');
}

function isTransferOffer(payload: Record<string, unknown> | null | undefined): boolean {
  const t = Number(payload?.CallOfferedType ?? 0)
  // 转接/互呼/质检/外呼：勿 DoAgentAnswerCall（话机自己响/已由 TAS CallOut）
  return t === 2 || t === 5 || t === 6 || t === 7 || t === 9 || t === 10 || t === 12
}

function isAgentInCall(status: CcsUserSession['status']): boolean {
  return status === 'talking' || status === 'ringing' || status === 'hold';
}

/**
 * autoAnswer 是坐席配置：Offered 就立刻 DoAgentAnswerCall。
 * 不按客户 CallID 去重（转接目标与转回原坐席都必须代答）。
 * 仅按坐席挡住 Offered 与重连补答同时在飞的第二次 RPC。
 */
function tryAutoAnswerCall(
  session: CcsUserSession,
  callId: number,
  source: 'offered' | 'reconnect-flush',
): void {
  if (!(callId > 0) || session.agentId == null) return;
  if (!canAutoAnswer(session)) return;
  if (answerInFlightUsers.has(session.userId)) {
    console.log(
      `[ccs-autoAnswer] skip in-flight user=${session.userId} agentId=${session.agentId} source=${source}`,
    );
    return;
  }
  answerInFlightUsers.add(session.userId);
  const uiOnline = bridgeOptions?.isUserOnline?.(session.userId) ?? false;
  console.log(
    `[ccs-autoAnswer] DoAgentAnswerCall CallID=${callId} user=${session.userId} agentId=${session.agentId} ui=${uiOnline ? 'online' : 'offline'} source=${source}`,
  );
  void invokeDoAgent('DoAgentAnswerCall', {
    AgentID: session.agentId,
    CallID: callId,
    CallIDType: 0,
  })
    .then(({ ret, rsp }) => {
      void ret;
      void rsp;
    })
    .catch((err: unknown) => {
      void err;
    })
    .finally(() => {
      answerInFlightUsers.delete(session.userId);
    });
}

/**
 * 重连 flush 后：若仍 ringing 且仍允许代答，补一次代答。
 */
export function maybeRetryAutoAnswerOnReconnect(userId: number): void {
  const session = getSessionByUserId(userId);
  if (!session || !canAutoAnswer(session)) return;
  if (session.status !== 'ringing') return;
  if (isTransferOffer(session.currentCall as Record<string, unknown> | null)) return;
  const callId = session.currentCall?.CallID;
  if (typeof callId !== 'number' || !(callId > 0)) return;
  tryAutoAnswerCall(session, callId, 'reconnect-flush');
}

/**
 * 最后一条坐席 UI 连接离开时立刻退 ACD 队（关浏览器不再接新会话）。
 * LoggedOff 仍走注销宽限；重连则 restoreSkillsAndStatus。
 */
export function signOutAllSkillsDueToUiOffline(userId: number): void {
  const session = getSessionByUserId(userId);
  if (!session?.loggedIn || session.agentId == null) return;
  if (session.skillsToRestore != null) return; // 已因离线签出过

  const ids = getSignedInSkillIds(userId);
  session.skillsToRestore = ids;
  session.agentStatusToRestore = session.agentStatus;
  const agentId = session.agentId;

  console.log(
    `[ccs-uiOffline] WS offline sign-out skills user=${userId} agentId=${agentId} ids=[${ids.join(',')}] agentStatus=${session.agentStatus} callStatus=${session.status}`,
  );

  if (ids.length > 0) {
    const vdnId = session.vdnId;
    void partitionAgentGroups(agentId, ids.map(Number))
      .then(async (part) => {
        if (part.tasIds.length > 0) {
          await invokeDoAgent('DoAgentSignOutGroup', {
            AgentID: agentId,
            agentGroupIDs: part.tasIds,
            count: part.tasIds.length,
          });
        }
        if (part.imsOnlyIds.length > 0 || part.imsSkillIds.length > 0) {
          await signOutImsOnAcd({
            agentId,
            vdnId,
            groupIds: part.imsOnlyIds,
            skillIds: part.imsSkillIds,
          });
        }
      })
      .catch((err: unknown) => {
        console.warn(
          `[ccs-uiOffline] SignOutGroup failed user=${userId}`,
          err instanceof Error ? err.message : err,
        );
      });
  }
  // 本地缓存清空（skillsToRestore 另存）；下次 GET 必须再问 CCS
  setSignedInSkillIds(userId, []);
  clearSignedInSynced(userId);
  notifySkillGroupsChanged(userId);
}

/**
 * WS 恢复：按保存列表 SignIn 全部技能 + 恢复示闲/示忙；清延期注销标记。
 */
export function restoreSkillsAndStatus(userId: number): void {
  const session = getSessionByUserId(userId);
  if (!session || !isVoiceSessionCurrent(session)) return;
  const restoreSid = session.loginSessionId ?? getLoginSession(userId)?.sessionId;
  const restorationCurrent = () => getSessionByUserId(userId) === session && isCurrentSession(userId, restoreSid);

  session.pendingLogoutAfterCall = false;
  session.uiOfflineGraceElapsed = false;

  const ids = session.skillsToRestore;
  const statusToRestore = session.agentStatusToRestore;

  if (!session.loggedIn || session.agentId == null) return;
  if (ids == null) return; // 未因离线签出，无需恢复
  if (session.skillsRestoreInFlight) return;

  const agentId = session.agentId;
  session.skillsRestoreInFlight = true;
  console.log(
    `[ccs-uiOffline] restore skills user=${userId} agentId=${agentId} ids=[${ids.join(',')}] agentStatus=${statusToRestore}`,
  );

  const restoreStatus = (): void => {
    if (statusToRestore == null || !restorationCurrent()) return;
    if (statusToRestore === 1) {
      void handleInvoke(userId, `restore-busy-${newSessionId()}`, 'DoAgentSetBusy', { AgentID: agentId }, restoreSid)
        .then(() => {
          if (restorationCurrent()) session.agentStatus = 1;
        })
        .catch((err: unknown) => {
          console.warn(
            `[ccs-uiOffline] SetBusy restore failed user=${userId}`,
            err instanceof Error ? err.message : err,
          );
        });
    } else {
      void handleInvoke(userId, `restore-idle-${newSessionId()}`, 'DoAgentSetIdle', { AgentID: agentId }, restoreSid)
        .then(() => {
          if (restorationCurrent()) session.agentStatus = 0;
        })
        .catch((err: unknown) => {
          console.warn(
            `[ccs-uiOffline] SetIdle restore failed user=${userId}`,
            err instanceof Error ? err.message : err,
          );
        });
    }
  };

  const finishOk = (signedIn: string[]): void => {
    if (!restorationCurrent()) return;
    const s = getSessionByUserId(userId);
    if (s) {
      s.skillsToRestore = null;
      s.agentStatusToRestore = null;
      s.skillsRestoreInFlight = false;
    }
    restoreFailCounts.delete(userId);
    setSignedInSkillIds(userId, signedIn);
    clearSignedInSynced(userId);
    notifySkillGroupsChanged(userId);
    restoreStatus();
  };

  const finishFail = (reason: string): void => {
    if (!restorationCurrent()) return;
    console.warn(`[ccs-uiOffline] SignInGroup restore failed user=${userId} ${reason}`);
    const s = getSessionByUserId(userId);
    const attempts = (restoreFailCounts.get(userId) ?? 0) + 1;
    restoreFailCounts.set(userId, attempts);
    if (s) s.skillsRestoreInFlight = false;
    if (attempts >= RESTORE_MAX_ATTEMPTS) {
      // 连续失败说明对端已不可恢复（典型是 agent 在 CCS 侧已 LoggedOff，
      // CCS 对它的 SignInGroup / SetIdle 都不回调，只能等满 30s）。
      // 放弃恢复并清空待恢复列表，否则每次 WS 重连都会重演一次超时，
      // 把 /api/agent/* 接口拖到前端 15s 超时。用户需重新接入。
      console.warn(
        `[ccs-uiOffline] restore giving up after ${attempts} attempts user=${userId} agentId=${agentId} — session needs re-attach`,
      );
      restoreFailCounts.delete(userId);
      if (s) {
        s.skillsToRestore = null;
        s.agentStatusToRestore = null;
      }
      notifySkillGroupsChanged(userId);
      return;
    }
    // 尚未到上限：保留 skillsToRestore，下次重连再试；缓存保持空，勿写回旧组。
    // 注意这里不再调 restoreStatus()：技能都没恢复成功时恢复示闲/示忙没有意义，
    // 而 DoAgentSetIdle 正是无 Ack 场景下拖满超时的那一步。
    notifySkillGroupsChanged(userId);
  };

  if (ids.length === 0) {
    // 没有技能要恢复时不应再发 DoAgentSetIdle/SetBusy：这条路径在 agent 已
    // LoggedOff 的场景下必然等满超时，而它本来就没有可恢复的内容。
    // 直接清标记收尾即可。
    const s0 = getSessionByUserId(userId);
    if (s0) {
      s0.skillsToRestore = null;
      s0.agentStatusToRestore = null;
      s0.skillsRestoreInFlight = false;
    }
    setSignedInSkillIds(userId, []);
    clearSignedInSynced(userId);
    notifySkillGroupsChanged(userId);
    console.log(
      `[ccs-uiOffline] restore skipped (no skills to restore) user=${userId} agentId=${agentId} agentStatus=${statusToRestore}`,
    );
    return;
  }

  const vdnId = session.vdnId;
  void partitionAgentGroups(agentId, ids.map(Number))
    .then(async (part) => {
      if (!restorationCurrent()) return;
      if (part.tasIds.length > 0) {
        const { ret, rsp } = await invokeDoAgent('DoAgentSignInGroup', {
          AgentID: agentId,
          agentGroupIDs: part.tasIds,
          count: part.tasIds.length,
        });
        if (!isAcdSignInOk(ret, rsp)) {
          finishFail(`Result=${String(rsp?.Result ?? ret)}`);
          return;
        }
      }
      if (part.imsOnlyIds.length > 0 || part.imsSkillIds.length > 0) {
        if (!restorationCurrent()) return;
        await signInImsOnAcd({
          agentId,
          vdnId,
          groupIds: part.imsOnlyIds,
          skillIds: part.imsSkillIds,
        });
      }
      finishOk(ids);
    })
    .catch((err: unknown) => {
      finishFail(err instanceof Error ? err.message : String(err));
    });
}

/**
 * logout grace 到期：空闲则立刻 LoggedOff；通话中则延期到挂机。
 * @returns 'logged_off' | 'deferred' | 'noop'
 */
export function onUiOfflineGraceElapsed(userId: number): 'logged_off' | 'deferred' | 'noop' {
  const session = getSessionByUserId(userId);
  if (!session?.loggedIn) return 'noop';

  session.uiOfflineGraceElapsed = true;

  if (isAgentInCall(session.status)) {
    session.pendingLogoutAfterCall = true;
    console.log(
      `[ccs-uiOffline] grace deferred logout user=${userId} status=${session.status}`,
    );
    return 'deferred';
  }

  console.log(`[ccs-uiOffline] grace → LoggedOff user=${userId} status=${session.status}`);
  clearCcsEmitQueue(userId);
  void logoutUser(userId).catch(() => {
    /* ignore */
  });
  return 'logged_off';
}

/**
 * CallEnd / Released：若待挂机注销，或（无 WS 且 grace 已过）→ LoggedOff + 清 session/队列。
 */
export function maybeLogoutAfterCallEnd(userId: number): void {
  const session = getSessionByUserId(userId);
  if (!session?.loggedIn) return;

  const noWs = !(bridgeOptions?.isUserOnline?.(userId) ?? false);
  const shouldLogout =
    session.pendingLogoutAfterCall || (noWs && session.uiOfflineGraceElapsed);

  if (!shouldLogout) return;

  console.log(
    `[ccs-uiOffline] CallEnd → LoggedOff user=${userId} pending=${session.pendingLogoutAfterCall} noWs=${noWs} graceElapsed=${session.uiOfflineGraceElapsed}`,
  );
  session.pendingLogoutAfterCall = false;
  clearCcsEmitQueue(userId);
  void logoutUser(userId).catch(() => {
    /* ignore */
  });
}

export function isSignedInSynced(userId: number): boolean {
  return signedInSynced.has(userId);
}

export function markSignedInSynced(userId: number): void {
  signedInSynced.add(userId);
}

export function clearSignedInSynced(userId: number): void {
  signedInSynced.delete(userId);
}

export function clearAllSignedInSynced(): void {
  signedInSynced.clear();
}

/** Handle On* callbacks from TARS servant. */
const callbackTails = new Map<number,Promise<void>>();
export function handleOnAgentCallback(method: string, payload: Record<string, unknown>, servantName?: string): void {
  const agentId = agentIdFromPayload(payload);
  const leaseSession=servantName && bridgeOptions ? listActiveSessions().find(s=>callbackMatches(servantName,bridgeOptions!.servantObjName,s.loginSessionId,s.bindingVersion)) : undefined;
  const session = leaseSession ?? (agentId != null ? getSessionByAgentId(agentId) : method === 'OnAgentLoginExAck' ? loginCallbackSession(listActiveSessions(), payload) : undefined);
  if(session && !isVoiceSessionCurrent(session))return;
  if (process.env.OMNI_EXTENSION_BINDING_ENABLED === '1' && session?.bindingVersion != null) {
    if(!bridgeOptions || !callbackMatches(servantName,bridgeOptions.servantObjName,session.loginSessionId,session.bindingVersion))return;
    const next=(callbackTails.get(session.userId) ?? Promise.resolve()).then(async () => {
      const { database, rows } = await import('../../modules/access/access.db.js');
      const [current] = await rows<{ sid:string; version:number; extension:string; state:string; work_no:string }>(await database(), `SELECT v.LoginSID AS sid,b.Version AS version,u.ExtensionTel AS extension,u.WorkNO AS work_no,v.State AS state FROM t_omni_extension_voice v JOIN t_user_users u ON u.ID=v.UserID AND u.VDNID=v.VDNID JOIN t_omni_extension_binding b ON b.UserID=u.ID AND b.VDNID=u.VDNID WHERE v.OmniUserID=? AND u.IsValid=1`, [session.userId]);
      if (current && current.sid === session.loginSessionId && Number(current.version) === session.bindingVersion && current.extension === session.extension && current.work_no === session.workNO && !['signed_out','logged_out','unbound'].includes(current.state) && getSessionByUserId(session.userId) === session) applyOnAgentCallback(method,payload,session);
    }).catch(()=>undefined);
    callbackTails.set(session.userId,next);
    void next.finally(()=>{if(callbackTails.get(session.userId)===next)callbackTails.delete(session.userId)});
    return;
  }
  if(process.env.OMNI_EXTENSION_BINDING_ENABLED==='1' && servantName?.includes('.sid_'))return;
  applyOnAgentCallback(method,payload);
}
function applyOnAgentCallback(method: string, payload: Record<string, unknown>, callbackSession?: CcsUserSession): void {
  const agentId = agentIdFromPayload(payload);
  let session = callbackSession ?? (agentId != null ? getSessionByAgentId(agentId) : undefined);

  if (!session && method === 'OnAgentLoginExAck' && payload.workNO) {
    session = loginCallbackSession(listActiveSessions(), payload);
  }
  if (session && !isVoiceSessionCurrent(session)) return;
  if (session?.loginSessionId && method.endsWith('Ack')) {
    const pending = [...session.pending.values()].find(p => p.ackMethod === method || p.method === method.replace(/^On/, 'Do').replace(/Ack$/, ''))
      ?? (method === 'OnAgentCallOutAck' && session.pending.size === 1 ? [...session.pending.values()][0] : undefined);
    if (!pending || !isCurrentSession(session.userId, pending.loginSessionId)) return;
  }

  if (method === 'OnAgentGetAllGroupInfoAck') {
    const listRaw = payload.AgentGroupInfoList;
    const list = Array.isArray(listRaw)
      ? listRaw
      : listRaw && typeof listRaw === 'object' && Array.isArray((listRaw as { value?: unknown }).value)
        ? (listRaw as { value: unknown[] }).value
        : [];
    const groups = (list as Array<{ AgentGroupID?: unknown; GroupName?: unknown }>)
      .filter((g) => typeof g?.AgentGroupID === 'number')
      .map((g) => ({ id: g.AgentGroupID as number, name: String(g.GroupName ?? '') }));
    if (session && groups.length > 0 && !hasCachedGroupTree(session.userId)) {
      setGroupTree(session.userId, groups);
    } else if (session && groups.length === 0 && !hasCachedGroupTree(session.userId)) {
      void loadGroupsByVdnFromIccDb(session.vdnId).then((fb) => {
        if (fb.length && !hasCachedGroupTree(session!.userId)) setGroupTree(session!.userId, fb);
      });
    }
  }

  if (!session) {
    console.log(`[ccs-cb] method=${method} agentId=${agentId ?? 'n/a'} session=none`);
    return;
  }

  // 互呼已建立会话后，分机会议腿会再推一次普通 Offered（9001→9002），不得再开第二条来电
  if (
    method === 'OnAgentOnCallOfferedEvt'
    && isAgentCallOfferPayload(session.currentCall)
    && !isAgentCallOfferPayload(payload)
  ) {
    console.log(
      `[ccs-cb] skip SIP-leg Offered during agent-call user=${session.userId} CallID=${String(payload.CallID ?? '')} Caller=${String(payload.Caller ?? '')} Called=${String(payload.Called ?? '')}`,
    );
    return;
  }

  console.log(
    `[ccs-cb] method=${method} agentId=${agentId ?? session.agentId ?? 'n/a'} session=${session.userId}`,
  );

  updateSessionFromEvt(session, method, payload);

  if (method === 'OnAgentMsgEvt') {
    const srcId = Number(payload.SrcAgentID ?? 0);
    const text = String(payload.MsgData ?? '');
    if (srcId && text) {
      const src = getSessionByAgentId(srcId);
      appendInternalMessage(
        session.userId,
        { agentId: srcId, workNo: src?.workNO || String(srcId), name: src?.workNO || String(srcId) },
        { fromAgentId: srcId, text, ts: Date.now(), kind: 'im' },
        { unread: true, kind: 'im' },
      );
    }
  }
  if (method === 'OnAgentOnRequestRestEvt') {
    const srcId = Number(payload.SrcAgentID ?? 0);
    const desc = String(payload.Describe ?? '申请小休');
    const auxCode = Number(payload.AUXCode ?? 0);
    const minutes = auxCode > 0 ? auxCode : 0;
    const durationSec = minutes > 0 ? minutes * 60 : 0;
    const text =
      minutes > 0 ? `${desc || '申请小休'}（${minutes}分钟）` : desc || '申请小休';
    if (srcId) {
      const src = getSessionByAgentId(srcId);
      const workNo = src?.workNO || String(srcId);
      appendInternalMessage(
        session.userId,
        { agentId: srcId, workNo, name: workNo },
        {
          fromAgentId: srcId,
          text,
          ts: Date.now(),
          kind: 'rest_request',
          restStatus: 'pending',
          restMinutes: minutes || undefined,
        },
        { unread: true, kind: 'rest_request' },
      );
      console.log(
        `[ccs-cb] rest-request stored leaderUser=${session.userId} srcAgent=${srcId} workNo=${workNo} desc=${desc} minutes=${minutes}`,
      );
      void import('../../shared/services/agent-rest-requests.js')
        .then(async ({ ensurePendingRestRequest }) => {
          const { prisma } = await import('../../plugins/db.js');
          await ensurePendingRestRequest(prisma, {
            applicantAgentId: srcId,
            applicantWorkNo: workNo,
            applicantName: workNo,
            leaderUserId: session.userId,
            leaderAgentId: session.agentId ?? 0,
            leaderWorkNo: session.workNO || String(session.agentId ?? ''),
            leaderName: session.workNO || String(session.agentId ?? ''),
            content: text,
            durationSec,
            auxCode,
          });
        })
        .catch((e) => console.warn('[ccs-cb] ensurePendingRestRequest failed', e));
    }
  }

  if (
    method === 'OnAgentOnCallOfferedEvt'
    || method === 'OnAgentOnAnsweredEvt'
    || method === 'OnAgentOnCallEndEvt'
    || method === 'OnAgentOnReleasedEvt'
  ) {
    void persistVoiceFromCcs(
      method,
      payload,
      { userId: session.userId, vdnId: session.vdnId, agentId: session.agentId },
      {
        emitToAccount: bridgeOptions?.emitToAccount,
        emitToUser,
      },
    );
  }

  // 代答：canAutoAnswer（loggedIn && autoAnswer && agentId）。与 WS / 技能签出无关。
  const uiOnline = bridgeOptions?.isUserOnline?.(session.userId) ?? false;
  if (method === 'OnAgentOnCallOfferedEvt') {
    const callId = payload.CallID as number | undefined;
    const willAnswer =
      canAutoAnswer(session) && typeof callId === 'number' && !isTransferOffer(payload);
    if (willAnswer && typeof callId === 'number') {
      tryAutoAnswerCall(session, callId, 'offered');
    }
    if (!(bridgeOptions?.isUiForeground?.(session.userId) ?? uiOnline)) {
      notifyIncomingCallByPush(session.userId, payload);
    }
  }

  // 挂机：延期 LoggedOff 或（无 WS 且 grace 已过）→ 清 session
  if (method === 'OnAgentOnCallEndEvt' || method === 'OnAgentOnReleasedEvt'
    || method === 'OnAgentOnInterceptedEvt') {
    maybeLogoutAfterCallEnd(session.userId);
  }

  // 坐席已签入组同步：OnAgentGetGroupReqAck 为分包（每包一个组，末包 AgentInfoCount=-1）。
  // 中间包累积组 ID；末包写回本地 signed_in 缓存并标记已同步。
  // 幂等性：仅当存在累积记录或尚未同步时写入，避免重复末包清空已同步缓存。
  if (method === 'OnAgentGetGroupReqAck') {
    if ((payload as Record<string, unknown>).AgentInfoCount === -1) {
      const acc = groupReqAccumulator.get(session.userId);
      groupReqAccumulator.delete(session.userId);
      if (acc !== undefined || !signedInSynced.has(session.userId)) {
        // CCS 只知道 TAS 组；与 Omni 已签 IMS 组合并，避免把组 12 从缓存抹掉后被 PUT 签出
        mergeSignedInSkillIds(session.userId, (acc ?? []).map(String));
        signedInSynced.add(session.userId);
      }
    } else if (typeof (payload as Record<string, unknown>).AgentGroupID === 'number') {
      const acc = groupReqAccumulator.get(session.userId) ?? [];
      acc.push((payload as Record<string, unknown>).AgentGroupID as number);
      groupReqAccumulator.set(session.userId, acc);
    }
  }

  if (method.endsWith('Ack')) {
    // 分包类 Ack（GetUserList* / GetAcdSkillList* / GetGroupReq）：仅最后一包（Count=-1）匹配 pending，
    // 中间包只透传前端（前端按 Sequence 累积；last 包表示结束）。
    const isChunked =
      method === 'OnAgentGetUserListByGroupIDAck' ||
      method === 'OnAgentGetUserListBySkillIDAck' ||
      method === 'OnAgentGetAcdSkillListByGroupIDAck' ||
      method === 'OnAgentGetGroupReqAck';
    const countField =
      method === 'OnAgentGetAcdSkillListByGroupIDAck'
        ? 'SkillCount'
        : method === 'OnAgentGetGroupReqAck'
          ? 'AgentInfoCount'
          : 'AgentCount';
    const isLastChunk = !isChunked || (payload as Record<string, unknown>)[countField] === -1;
    if (isLastChunk) {
      if (payload.Result == null && payload.Status != null) {
        payload.Result = payload.Status;
      }
      const tryMatch = (s: typeof session) => {
        for (const [reqId, pending] of s.pending) {
          if (pending.ackMethod === method || pending.method === method.replace(/^On/, 'Do').replace(/Ack$/, '')) {
            clearTimeout(pending.timer);
            s.pending.delete(reqId);
            pending.resolve(payload);
            push(s.userId, 'ack', method, payload, reqId);
            return true;
          }
        }
        if (method === 'OnAgentCallOutAck' && s.pending.size === 1) {
          const [reqId, pending] = [...s.pending][0];
          clearTimeout(pending.timer);
          s.pending.delete(reqId);
          pending.resolve(payload);
          push(s.userId, 'ack', method, payload, reqId);
          return true;
        }
        return false;
      };
      if (tryMatch(session)) return;
      if (!confTenancyEnabled()) {
        for (const other of listActiveSessions()) {
          if (other.userId !== session.userId && tryMatch(other)) return;
        }
      }
    }
  }

  push(session.userId, method.endsWith('Ack') ? 'ack' : 'evt', method, payload);
}

export async function handleInvoke(
  userId: number,
  reqId: string,
  method: string,
  payload: Record<string, unknown>,
  expectedSid?: string,
): Promise<Record<string, unknown> | undefined> {
  if (expectedSid != null) assertCurrentLogin(userId, expectedSid);
  const session = getSessionByUserId(userId);
  if (!session) throw new Error('No CCS session for user');
  const invocationSid = expectedSid ?? session.loginSessionId;
  const assertInvocationCurrent = () => {
    assertCurrentLogin(userId, invocationSid);
    if (getSessionByUserId(userId) !== session) throw new Error('session_replaced');
  };
  assertInvocationCurrent();
  if(process.env.OMNI_EXTENSION_BINDING_ENABLED==='1' && session.bindingVersion!=null){
    const {database,rows}=await import('../../modules/access/access.db.js');
    const [current]=await rows<{sid:string;version:number;extension:string;operation:string|null}>(await database(),`SELECT v.LoginSID AS sid,b.Version AS version,u.ExtensionTel AS extension,o.ID AS operation FROM t_omni_extension_voice v JOIN t_user_users u ON u.ID=v.UserID AND u.VDNID=v.VDNID JOIN t_omni_extension_binding b ON b.UserID=u.ID AND b.VDNID=u.VDNID LEFT JOIN t_omni_extension_operation o ON o.UserID=u.ID AND o.VDNID=u.VDNID AND o.ActiveUserID=u.ID WHERE v.OmniUserID=? AND u.IsValid=1`,[userId]);
    if(!current || current.sid!==invocationSid || session.loginSessionId!==invocationSid || Number(current.version)!==session.bindingVersion || current.extension!==session.extension)throw new AppError(409,'话务会话或绑定版本已变化，请重新签入');
    if(current.operation && !['DoAgentSetBusy','DoAgentLoggedOff'].includes(method) && !method.startsWith('DoAgentGet') && !['DoGetAgentInterfaceVersion','DoAgentQueryCallData'].includes(method))throw new AppError(409,'分机正在变更，请稍后重试话务操作');
    assertInvocationCurrent();
  }
  if (confTenancyEnabled()) {
    const actor = await resolveVoiceActor({ userId, vdnId: accessScope.getStore()?.vdnId ?? session.vdnId });
    if (expectedSid != null) assertCurrentLogin(userId, expectedSid);
    assertInvocationCurrent();
    if (method !== 'DoAgentLoginEx' && session.vdnId !== actor.vdnId) {
      throw new Error('CCS session tenant mismatch');
    }
    payload = ownedCcsPayload({ ...session, vdnId: actor.vdnId, workNO: actor.workNo }, method, payload);
    if (method === 'DoAgentLoginEx') {
      session.vdnId = actor.vdnId;
      session.workNO = actor.workNo;
    }
  }

  if (method === 'DoAgentLoginEx') {
    const opts = bridgeOptions!;
    const callbackName=process.env.OMNI_EXTENSION_BINDING_ENABLED==='1' ? callbackServantName(opts.servantObjName,session.loginSessionId!,session.bindingVersion!) : opts.servantObjName;
    payload.AgentPrxEndpoint = `${callbackName}@tcp -h ${opts.servantHost} -p ${opts.servantPort}`;
    payload.VDNID = payload.VDNID ?? opts.vdnId;

    const fromPayload = String(payload.workNO ?? '').trim();
    const fromSession = session.workNO.trim();
    let workNO = fromPayload || fromSession;
    if (!workNO && opts.resolveWorkNoForUser) {
      workNO = await opts.resolveWorkNoForUser(userId);
    }
    payload.workNO = workNO;
    session.workNO = workNO;

    payload.password = String(payload.password ?? session.password ?? '').trim() || session.password;
    payload.extension = String(payload.extension ?? session.extension ?? '').trim() || session.extension;
    if (session.loggedIn && session.agentId && session.agentId > 0 && getRuntimeCcsBootId()) {
      const ack = {
        Result: 0,
        AgentID: session.agentId,
        AutoAnswer: session.autoAnswer ? 1 : 0,
      };
      push(userId, 'ack', 'OnAgentLoginExAck', ack, reqId);
      return ack;
    }
  } else if (session.agentId != null && payload.AgentID == null) {
    payload.AgentID = session.agentId;
  }

  const ackMethod = expectedAckForDo(method);
  if (method === 'DoAgentSendMsg') {
    const { ret, rsp } = await invokeDoAgent(method, payload);
    assertInvocationCurrent();
    const ack = { Result: rsp?.err ?? ret, Status: rsp.err ?? ret, errMsg: rsp.errMsg, AgentID: payload.AgentID };
    push(userId, 'ack', 'OnAgentSendMsgAck', ack, reqId);
    return ack;
  }
  if (ackMethod) {
    const ackPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        session!.pending.delete(reqId);
        reject(new Error(`Timeout waiting for ${ackMethod}`));
      }, bridgeOptions?.invokeTimeoutMs ?? 30000);
      session!.pending.set(reqId, { reqId, method, ackMethod, resolve, reject, timer, loginSessionId: invocationSid });
    });

    // 先发 invoke，但以 On*Ack 为准：CCS 同步 RPC 常在回调返回后才结束，
    // 若先 await invoke，会在短超时下丢掉已到达的 Ack（DoAgentGetAllGroupInfo 典型）。
    const invokePromise = invokeDoAgent(method, payload).catch((err: unknown) => ({ __invokeErr: err }));
    try {
      const ackPayload = await ackPromise;
      void invokePromise;
      assertInvocationCurrent();
      updateSessionFromEvt(session, ackMethod, ackPayload);
      if (method === 'DoAgentLoggedOff' && ackPayload.Result === 0) {
        markLoginVoiceSignedOut(userId, invocationSid);
        if (process.env.OMNI_EXTENSION_BINDING_ENABLED === '1' && invocationSid && session.bindingVersion != null) {
          const { persistVoiceState } = await import('../../modules/extension-binding/voice.js');
          await persistVoiceState(userId,invocationSid,session.bindingVersion,'signed_out');
        }
      }
      return ackPayload;
    } catch (err) {
      const pending = session.pending.get(reqId);
      if (pending) {
        clearTimeout(pending.timer);
        session.pending.delete(reqId);
      }
      if (getSessionByUserId(userId) === session && isCurrentSession(userId, invocationSid)) {
        push(userId, 'ack', ackMethod ?? `${method}Ack`, { Result: -1, errMsg: String(err) }, reqId);
      }
      throw err;
    }
  }

  const { ret, rsp } = await invokeDoAgent(method, payload);
  assertInvocationCurrent();
  push(userId, 'ack', method, { Result: ret, ...rsp }, reqId);
  return { Result: ret, ...rsp };
}

export function registerUserCredentials(
  userId: number,
  creds: { workNO: string; extension: string; password: string; vdnId?: number },
  expectedSid?: string,
): void {
  const existing = getSessionByUserId(userId);
  setCredentials(userId, {
    workNO: creds.workNO.trim() || existing?.workNO || '',
    extension: creds.extension.trim() || existing?.extension || '',
    password: creds.password || existing?.password || '',
    vdnId: creds.vdnId ?? existing?.vdnId,
  }, expectedSid);
}

/**
 * 坐席签出时只释放活动多媒体接待，持久保留未完成记录的参与权和待完成归属。
 *
 * 不释放会变成「有归属的孤儿」：客户再发消息时 relayVisitorToItr 看到
 * assignee_id 就认为「有坐席接管」，只把消息推给坐席；而坐席已经下线，
 * 于是消息既不进 ITR、也没有任何自动回复 —— 表现就是「客户发消息一点反应没有」。
 *
 * on_idle_timeout 兜不住这种情形：它的计时是「客户最后一次发言后 N 秒没有新消息」，
 * 客户不再发言就永远不触发，会话会长时间占着（实测有整整一周前的会话仍被占用）。
 *
 * 放在 logoutUser 而不是 UI 断线那一刻，是因为 logoutUser 已经是「宽限期过完、
 * 确认真的登出」的语义 —— 短暂断线走不到这里，不会误释放。
 */
async function releaseConversationsOfAgent(userId: number): Promise<void> {
  try {
    const convs = await prisma.conversations.findMany({
      where: { assignee_id: userId, status: 0 },
      select: { id: true, account_id: true, additional_attributes: true, inbox: { select: { channel_type: true } } },
    });
    if (!convs.length) return;
    const { markItrHosted } = await import('../../modules/itr/itr-queue.js');
    let released = 0;
    for (const conv of convs) {
      await ensureConversationParticipant(conv, userId);
      const attrs = (conv.additional_attributes ?? {}) as Record<string, unknown>;
      // Hangup/end and manual completion are separate states. Finished contact
      // handling and phone records remain owned until the operator completes them.
      if (readLifecycle(attrs) === 'ended' || resolveChannelGroup(conv.inbox?.channel_type) === 'phone') continue;
      const next: Record<string, unknown> = { ...attrs, itr_hosted: false };
      delete next.itr_flow_id;
      delete next.acd_request_id;
      delete next.acd_agent_id;
      await prisma.conversations.update({
        where: { id: conv.id },
        data: { assignee_id: null, additional_attributes: next as object },
      });
      markItrHosted(conv.id, false);
      released += 1;
    }
    console.log('[ccs-uiOffline] released conversations of logged-out agent', {
      userId,
      count: released,
      retained: convs.length - released,
    });
  } catch (e) {
    console.warn('[ccs-uiOffline] release conversations on logout failed', e);
  }
}

/** Uses the correlated RPC response; a stale callback cannot confirm a current cleanup. */
export async function logoutWithConfirmation(userId:number,expectedSid?:string):Promise<void>{
  if(expectedSid && getLoginSession(userId)?.sessionId!==expectedSid)throw new AppError(409,'登录会话已变化');
  const old=getSessionByUserId(userId);if(!old?.loggedIn || !old.agentId)return;
  const remote=await (await import('../../modules/extension-binding/ccs-state.js')).remoteVoice(old.vdnId,old.workNO);
  if(remote && remote.agentId!==old.agentId)throw new AppError(409,'CCS 会话身份已变化，请重试');
  if(remote){
    assertVoiceIdle(old);
    let result:Awaited<ReturnType<typeof invokeDoAgent>>;
    try{result=await invokeDoAgent('DoAgentLoggedOff',{AgentID:old.agentId});}catch{throw new AppError(502,'旧 CCS 会话签出超时或连接失败，请重试');}
    // CCS 的 DoAgentLoggedOff 不是幂等的：对「本来就没登入」或「状态冲突」的坐席
    // 会回非 0。实测见过：
    //   7    = ACD_AgentIDErr（CCS 里已没有这个坐席对象）
    //   12   = ACD_AgentIDNotSignIn（坐席组未签入）
    //   15   = ACD_AgentStatusNoChange（状态未变）
    //   -409 = CCS ActionResult 的负值（会话/状态冲突）
    // 这个列表永远列不全，所以判定改成「只要 ack 回来了就算签出成功」：
    // Ack 回来意味着 CCS 确实处理了这次请求，签出目标基本达成；把非 0 当致命
    // 错误会让人永久卡在登录页 —— 遗留一条脏会话 → 每次登录都尝试签出 →
    // 每次都报「旧 CCS 会话签出失败，原会话已保留」。
    // 真正的故障（CCS 无响应 / 连接失败）在上面 catch 里已经拦掉了。
    const logoutCode = Number(result.rsp.err);
    if (logoutCode !== 0 || result.ret !== 0) {
      console.warn(
        `[ccs-logout] LoggedOff ack non-zero code=${logoutCode} ret=${result.ret} user=${userId} agentId=${old.agentId} — treating as signed out`,
      );
    }
  }
  if(expectedSid && getLoginSession(userId)?.sessionId!==expectedSid)throw new AppError(409,'登录会话已变化');
  if(getSessionByUserId(userId)===old)clearSession(userId);
  clearSignedInSynced(userId);setSignedInSkillIds(userId,[]);clearCcsEmitQueue(userId);markLoginVoiceSignedOut(userId,expectedSid);
  await (await import('../../shared/services/omni-runtime-persist.js')).dropCcsRuntime(userId);
}

export async function logoutUser(userId: number): Promise<void> {
  const session = getSessionByUserId(userId);
  if (session?.loggedIn && session.agentId != null) {
    const agentId = session.agentId;
    const vdnId = session.vdnId;
    try {
      await signOutImsOnLogout(agentId, vdnId);
    } catch {
      /* IMS 由 Omni 管，注销时尽量先清；失败仍继续 LoggedOff */
    }
    try {
      await invokeDoAgent('DoAgentLoggedOff', { AgentID: agentId });
    } catch {
      /* best effort */
    }
  }
  answerInFlightUsers.delete(userId);
  clearSession(userId);
  // Online handling and durable participation are separate: release active media
  // routing while retaining the operator's uncompleted work and phone records.
  await releaseConversationsOfAgent(userId);
}

export function attachCcsBridgeToApp(app: FastifyInstance): void {
  app.decorate('ccsBridge', {
    registerUserCredentials,
    handleInvoke,
    logoutUser,
    logoutWithConfirmation,
    getSession: getSessionByUserId,
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    ccsBridge?: {
      registerUserCredentials: typeof registerUserCredentials;
      handleInvoke: typeof handleInvoke;
      logoutUser: typeof logoutUser;
      logoutWithConfirmation: typeof logoutWithConfirmation;
      getSession: typeof getSessionByUserId;
    };
  }
}
