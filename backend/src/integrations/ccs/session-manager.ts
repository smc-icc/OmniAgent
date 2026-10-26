import { accessScope } from '../../modules/access/access.scope.js';
import { assertCurrentLogin, getLoginSession, isCurrentSession, isLoginTransitioning } from '../../shared/services/login-session.js';
export type AgentCallState = 'idle' | 'ringing' | 'talking' | 'hold' | 'offline';

export interface PendingInvoke {
  reqId: string;
  method: string;
  ackMethod: string;
  resolve: (payload: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  readonly loginSessionId?: string;
}

export interface CcsUserSession {
  userId: number;
  workNO: string;
  extension: string;
  password: string;
  loginSessionId?: string;
  bindingVersion?: number;
  agentId: number | null;
  vdnId: number;
  status: AgentCallState;
  /** 示闲/示忙/小休/文书：仅登录与手动（或 CCS 工作态）切换，不含通话相位 */
  workMode: 'ready' | 'busy' | 'break' | 'acw' | 'blocked';
  agentStatus: number;
  currentCall: Record<string, unknown> | null;
  pending: Map<string, PendingInvoke>;
  loggedIn: boolean;
  /**
   * CCS 会话存活时「自动摘机 vs 手动摘机」（AutoAnswer）。
   * 与 WS 是否在线无关：仅看 loggedIn && autoAnswer && agentId。
   */
  autoAnswer: boolean;
  /**
   * WS 离线已签出技能：待重连恢复的技能组 ID 列表。
   * null = 未因 UI 离线签出；[] = 当时无已签入技能。
   */
  skillsToRestore: string[] | null;
  /** WS 离线签出技能时的 agentStatus（0 示闲 / 1 示忙），重连后恢复。 */
  agentStatusToRestore: number | null;
  /** 重连 SignIn 进行中：未完成前保留 skillsToRestore，避免二次断线把恢复列表写成空。 */
  skillsRestoreInFlight: boolean;
  /** grace 到期时仍在通话中：挂机后再 DoAgentLoggedOff。 */
  pendingLogoutAfterCall: boolean;
  /** WS logout grace 已到期（仍无活跃 socket）。 */
  uiOfflineGraceElapsed: boolean;
  /** 最近一次强制示闲时间戳，用于丢掉迟到的 SetBusyAck */
  forceIdleAt?: number;
  /** 坐席覆盖的全媒体排队模式 EU_AG_MQM */
  mediaQueuingMode: number;
  /** IMS 接入路数 */
  callerCount: number;
  /** 已在 UI 选择接听模式并下发给 ACD */
  acdQueuingConfirmed: boolean;
}

const sessionsByUser = new Map<number, CcsUserSession>();
const userByAgentId = new Map<number, number>();

export function getOrCreateSession(userId: number): CcsUserSession {
  let s = sessionsByUser.get(userId);
  if (!s) {
    s = {
      userId,
      workNO: '',
      extension: '',
      password: '',
      agentId: null,
      vdnId: 1,
      status: 'offline',
      workMode: 'ready',
      agentStatus: 0,
      currentCall: null,
      pending: new Map(),
      loggedIn: false,
      autoAnswer: false,
      skillsToRestore: null,
      agentStatusToRestore: null,
      skillsRestoreInFlight: false,
      pendingLogoutAfterCall: false,
      uiOfflineGraceElapsed: false,
      mediaQueuingMode: 0,
      callerCount: 10,
      acdQueuingConfirmed: false,
    };
    sessionsByUser.set(userId, s);
  }
  return s;
}

export function getSessionByUserId(userId: number): CcsUserSession | undefined {
  return sessionsByUser.get(userId);
}

export function getSessionByAgentId(agentId: number): CcsUserSession | undefined {
  const userId = userByAgentId.get(agentId);
  if (userId == null) return undefined;
  return sessionsByUser.get(userId);
}

export function getSessionByWorkNo(workNo: string): CcsUserSession | undefined {
  const wn = String(workNo || '').trim();
  if (!wn) return undefined;
  for (const s of sessionsByUser.values()) {
    if (s.workNO === wn) return s;
  }
  return undefined;
}

export function hydrateLoggedInSession(row: {
  userId: number;
  workNO: string;
  extension: string;
  loginSessionId?: string;
  bindingVersion?: number;
  agentId: number;
  vdnId: number;
  workMode?: CcsUserSession['workMode'];
  agentStatus?: number;
  autoAnswer?: boolean;
  mediaQueuingMode?: number;
  callerCount?: number;
  acdQueuingConfirmed?: boolean;
}): CcsUserSession {
  const s = getOrCreateSession(row.userId);
  s.loginSessionId=row.loginSessionId;
  s.bindingVersion=row.bindingVersion;
  s.workNO = row.workNO;
  s.extension = row.extension;
  s.vdnId = row.vdnId || s.vdnId;
  s.workMode = row.workMode || 'ready';
  s.agentStatus = row.agentStatus ?? 0;
  s.autoAnswer = row.autoAnswer ?? false;
  s.mediaQueuingMode = row.mediaQueuingMode ?? s.mediaQueuingMode;
  s.callerCount = row.callerCount ?? s.callerCount;
  s.acdQueuingConfirmed = row.acdQueuingConfirmed ?? false;
  s.status = 'idle';
  s.loggedIn = true;
  s.skillsToRestore = null;
  s.skillsRestoreInFlight = false;
  if (row.agentId > 0) bindAgentId(row.userId, row.agentId);
  return s;
}

export function bindAgentId(userId: number, agentId: number): void {
  const s = getOrCreateSession(userId);
  if (s.agentId != null && s.agentId !== agentId) {
    userByAgentId.delete(s.agentId);
  }
  s.agentId = agentId;
  userByAgentId.set(agentId, userId);
}

/** 解除 agentId ↔ userId 映射（强制下线 / LoggedOff 后调用）。 */
export function unbindAgentId(userId: number): void {
  const s = sessionsByUser.get(userId);
  if (!s || s.agentId == null) return;
  userByAgentId.delete(s.agentId);
  s.agentId = null;
}

export function clearSession(userId: number): void {
  const s = sessionsByUser.get(userId);
  if (!s) return;
  if (s.agentId != null) userByAgentId.delete(s.agentId);
  for (const p of s.pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error('session cleared'));
  }
  sessionsByUser.delete(userId);
}

export function setCredentials(
  userId: number,
  data: { workNO: string; extension: string; password: string; vdnId?: number },
  expectedSid?: string,
): CcsUserSession {
  assertCurrentLogin(userId, expectedSid);
  const s = getOrCreateSession(userId);
  const nextSid = expectedSid ?? getLoginSession(userId)?.sessionId;
  if (s.loginSessionId !== nextSid) {
    for (const [id, pending] of s.pending) {
      if (pending.loginSessionId === nextSid) continue;
      clearTimeout(pending.timer);
      s.pending.delete(id);
      pending.reject(new Error('session_replaced'));
    }
  }
  s.loginSessionId = nextSid;
  s.workNO = data.workNO;
  s.extension = data.extension;
  s.password = data.password;
  if (data.vdnId != null) s.vdnId = data.vdnId;
  return s;
}

export function isVoiceSessionCurrent(session: CcsUserSession): boolean {
  if (getSessionByUserId(session.userId) !== session || isLoginTransitioning(session.userId)) return false;
  if (session.loginSessionId) return isCurrentSession(session.userId, session.loginSessionId);
  return getLoginSession(session.userId)?.authenticationMethod !== 'social';
}

export function listActiveSessions(): CcsUserSession[] {
  return [...sessionsByUser.values()];
}

/** 已登录坐席（含 CCS loggedIn），供 Omni 多媒体工作台遍历，不读 DoQuerySysStatus。 */
export function listLoggedInSessions(): CcsUserSession[] {
  const scope = accessScope.getStore();
  return [...sessionsByUser.values()].filter((s) => s.loggedIn && (!scope || scope.userIds.includes(s.userId)));
}

/** CCS 进程断开：清掉全部坐席内存会话（回调表会随 CCS 一起失效）。 */
export function clearAllSessions(): number {
  const ids = [...sessionsByUser.keys()];
  for (const userId of ids) clearSession(userId);
  return ids.length;
}

/** Map DoAgent* -> expected OnAgent*Ack for invoke/ack correlation. */
const DO_TO_ACK: Record<string, string> = {
  DoAgentLoginEx: 'OnAgentLoginExAck',
  DoAgentLoggedOff: 'OnAgentLoggedOffAck',
  DoAgentSignInGroup: 'OnAgentSignInGroupAck',
  DoAgentSignOutGroup: 'OnAgentSignOutGroupAck',
  DoAgentSignInSkill: 'OnAgentSignInSkillAck',
  DoAgentSignOutSkill: 'OnAgentSignOutSkillAck',
  DoAgentAnswerCall: 'OnAgentAnswerCallAck',
  DoAgentReleaseCall: 'OnAgentReleaseCallAck',
  DoAgentHoldCall: 'OnAgentHoldCallAck',
  DoAgentRetrieveHold: 'OnAgentRetrieveHoldAck',
  DoAgentConnectHold: 'OnAgentConnectHoldAck',
  DoAgentCallOut: 'OnAgentCallOutAck',
  DoAgentConfCall: 'OnAgentConfCallAck',
  DoAgentTransferIVR: 'OnAgentTransferIVRAck',
  DoAgentTransferOut: 'OnAgentTransferOutAck',
  DoAgentTransferAgentGroup: 'OnAgentTransferAgentGroupAck',
  DoAgentTransferAgent: 'OnAgentTransferAgentAck',
  DoAgentCallAgent: 'OnAgentCallAgentAck',
  DoAgentSnatchCall: 'OnAgentSnatchCallAck',
  DoAgentInviteToConf: 'OnAgentInviteToConfAck',
  DoAgentKickOut: 'OnAgentKickOutAck',
  DoAgentChangeConfMode: 'OnAgentChangeConfModeAck',
  DoAgentPlayFile: 'OnAgentPlayFileAck',
  DoAgentStopPlayFile: 'OnAgentStopPlayFileAck',
  DoAgentReceiveDTMF: 'OnAgentReceiveDTMFAck',
  DoAgentEndReceiveDTMF: 'OnAgentEndReceiveDTMFAck',
  DoAgentForceInsert: 'OnAgentForceInsertAck',
  DoAgentForceRelease: 'OnAgentForceReleaseAck',
  DoAgentMonitor: 'OnAgentMonitorAck',
  DoAgentForceLogOut: 'OnAgentForceLogOutAck',
  DoAgentForceIdle: 'OnAgentForceIdleAck',
  DoAgentForceBusy: 'OnAgentForceBusyAck',
  DoAgentForceBlock: 'OnAgentForceBlockAck',
  DoAgentSetBusy: 'OnAgentSetBusyAck',
  DoAgentSetIdle: 'OnAgentSetIdleAck',
  DoAgentRequestRest: 'OnAgentRequestRestAck',
  DoAgentApproveRest: 'OnAgentApproveRestAck',
  DoAgentBeginMute: 'OnAgentBeginMuteAck',
  DoAgentEndMute: 'OnAgentEndMuteAck',
  DoAgentJoinToConfCall: 'OnAgentJoinToConfCallAck',
  DoAgentIntercept: 'OnAgentInterceptAck',
  DoAgentGetGroupReq: 'OnAgentGetGroupReqAck',
  DoAgentGetSkillReq: 'OnAgentGetSkillReqAck',
  DoAgentGetAllGroupInfo: 'OnAgentGetAllGroupInfoAck',
  DoAgentGetUserListByGroupID: 'OnAgentGetUserListByGroupIDAck',
  DoAgentGetUserListBySkillID: 'OnAgentGetUserListBySkillIDAck',
  DoAgentGetAcdSkillListByGroupID: 'OnAgentGetAcdSkillListByGroupIDAck',
  DoAgentSetCallData: 'OnAgentSetCallDataAck',
  DoAgentQueryCallData: 'OnAgentQueryCallDataAck',
  DoAgentRequestTextProc: 'OnAgentRequestTextProcAck',
  DoAgentMonitorLogin: 'OnAgentMonitorLoginAck',
  DoMonitorAgentDesktop: 'OnMonitorAgentDesktopAck',
};

export function expectedAckForDo(method: string): string | undefined {
  return DO_TO_ACK[method];
}
