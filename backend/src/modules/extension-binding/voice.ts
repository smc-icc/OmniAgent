import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../shared/errors/index.js';
import {
  getLoginSession,
  assertCurrentLogin,
  markLoginVoiceSignedIn,
  markLoginVoiceSignedOut,
} from '../../shared/services/login-session.js';
import { context } from '../access/access.context.js';
import { database, execute, rows } from '../access/access.db.js';
import {
  getSessionByUserId,
  clearSession,
  hydrateLoggedInSession,
} from '../../integrations/ccs/session-manager.js';
import { readBinding, bindingConflict, activeOperation } from './repository.js';
export const bindingFlowEnabled = () => process.env.OMNI_EXTENSION_BINDING_ENABLED === '1';
export function requireBindingFlow() {
  if (!bindingFlowEnabled()) throw new AppError(503, '分机绑定流程尚未启用，请联系管理员完成迁移');
}
export interface VoiceRow {
  sid: string;
  version: number;
  state: string;
  error: string;
  agent_id: number | null;
}
export async function voiceRow(user: number): Promise<VoiceRow | undefined> {
  return (
    await rows<VoiceRow>(
      await database(),
      'SELECT LoginSID AS sid,BindingVersion AS version,State AS state,Error AS error,AgentID AS agent_id FROM t_omni_extension_voice WHERE OmniUserID=?',
      [user],
    )
  )[0];
}
export async function startIdentityVoice(request: FastifyRequest, sid: string) {
  const ctx = await context(request);
  const login = getLoginSession(ctx.userId);
  const b =
    ctx.agentId && !ctx.systemSuperuser
      ? await readBinding(await database(), ctx.vdnId, ctx.agentId)
      : null;
  const conflict = b ? await bindingConflict(await database(), ctx.vdnId, b) : null;
  const state = conflict ? 'failed' : b?.extension ? 'signing_in' : 'unbound';
  await execute(
    await database(),
    `INSERT INTO t_omni_extension_voice (OmniUserID,VDNID,UserID,LoginSID,BindingVersion,LoginContext,State,Error) VALUES (?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE VDNID=VALUES(VDNID),UserID=VALUES(UserID),LoginSID=VALUES(LoginSID),BindingVersion=VALUES(BindingVersion),LoginContext=VALUES(LoginContext),State=VALUES(State),AgentID=NULL,Error=VALUES(Error),UpdatedAt=CURRENT_TIMESTAMP(3)`,
    [
      ctx.userId,
      ctx.vdnId,
      ctx.agentId,
      sid,
      b?.version ?? 0,
      JSON.stringify(login),
      state,
      conflict ?? '',
    ],
  );
  return {
    extension_binding: {
      extension: b?.extension ?? '',
      version: b?.version ?? 0,
      status: b?.extension ? 'bound' : 'unbound',
      conflict,
    },
    voice_startup: { state, error: conflict ?? '' },
  };
}
export async function persistVoiceState(
  user: number,
  sid: string,
  version: number,
  state: string,
  error = '',
  agentId: number | null = null,
) {
  const login = getLoginSession(user);
  const saved =
    login?.sessionId === sid
      ? {
          ...login,
          hadVoiceSignIn: login.hadVoiceSignIn || state === 'signed_in',
          voiceSessionExpected: state === 'signed_in',
        }
      : null;
  const result = await execute(
    await database(),
    'UPDATE t_omni_extension_voice SET BindingVersion=?,State=?,Error=?,AgentID=?,LoginContext=COALESCE(?,LoginContext),UpdatedAt=CURRENT_TIMESTAMP(3) WHERE OmniUserID=? AND LoginSID=?',
    [version, state, error.slice(0, 500), agentId, saved ? JSON.stringify(saved) : null, user, sid],
  );
  if (!result.affectedRows)
    throw new AppError(409, '登录会话已变化，请重新登录', 'session_replaced');
}
export async function signInBoundVoice(req: FastifyRequest, expectedVersion: number) {
  requireBindingFlow();
  const ctx = await context(req);
  const sid = (req.user as { sid?: string }).sid;
  if (!sid || !ctx.agentId || ctx.systemSuperuser) throw new AppError(403, '当前身份不是业务坐席');
  assertCurrentLogin(ctx.userId, sid);
  const db = await (await database()).getConnection();
  const lock = 'omni.extension.voice.' + ctx.userId;
  let locked = false,
    started = false;
  try {
    const [r] = await rows<{ acquired: number }>(db, 'SELECT GET_LOCK(?,0) AS acquired', [lock]);
    if (r?.acquired !== 1) throw new AppError(409, '话务正在启动，请稍后重试');
    locked = true;
    const b = await readBinding(db, ctx.vdnId, ctx.agentId);
    const voice = await voiceRow(ctx.userId);
    if (voice?.sid !== sid) throw new AppError(409, '登录会话已变化，请重新登录');
    if (b.version !== expectedVersion)
      throw new AppError(409, '绑定版本已变化，请刷新后重试', 'extension_version_stale');
    if (!b.extension) throw new AppError(409, '未绑定分机，请先申请绑定');
    if (await activeOperation(db, ctx.vdnId, ctx.agentId))
      throw new AppError(409, '分机正在变更，请稍后重试');
    const conflict = await bindingConflict(db, ctx.vdnId, b);
    if (conflict) throw new AppError(409, conflict);
    const bridge = req.server.ccsBridge;
    if (!bridge) throw new AppError(503, 'CCS 服务未配置');
    let existing = getSessionByUserId(ctx.userId);
    const remote = await (await import('./ccs-state.js')).remoteVoice(ctx.vdnId, b.work_no);
    if (!existing?.loggedIn && remote) {
      if (!remote.software)
        throw new AppError(409, '当前工号已由其他话务终端签入，请先在配置中心或原终端签出');
      existing = hydrateLoggedInSession({
        userId: ctx.userId,
        workNO: b.work_no,
        extension: b.extension,
        agentId: remote.agentId,
        vdnId: ctx.vdnId,
      });
    }
    if (existing?.loggedIn) {
      if (
        existing.extension === b.extension &&
        existing.loginSessionId === sid &&
        existing.bindingVersion === b.version
      )
        return { state: 'signed_in', binding_version: b.version, agent_id: existing.agentId };
      if (remote) {
        if (remote.agentId !== existing.agentId)
          throw new AppError(409, 'CCS 会话已变化，请联系管理员确认');
        existing.currentCall = null;
        existing.status = 'idle';
        await bridge.logoutWithConfirmation(ctx.userId, sid);
      } else clearSession(ctx.userId);
    }
    const [creds] = await rows<{ password: string }>(
      db,
      'SELECT PassWord AS password FROM t_user_users WHERE ID=? AND VDNID=? AND IsValid=1',
      [ctx.agentId, ctx.vdnId],
    );
    if (!creds?.password) throw new AppError(409, '操作员 CCS 凭据缺失，请联系管理员');
    await persistVoiceState(ctx.userId, sid, b.version, 'signing_in');
    started = true;
    bridge.registerUserCredentials(
      ctx.userId,
      { workNO: b.work_no, extension: b.extension, password: creds.password, vdnId: ctx.vdnId },
      sid,
    );
    getSessionByUserId(ctx.userId)!.bindingVersion = b.version;
    const ack = await bridge.handleInvoke(
      ctx.userId,
      randomUUID(),
      'DoAgentLoginEx',
      { ComputerName: 'OmniAgent', AgentType: 0, Priority: 1, AgentStatus: 1 },
      sid,
    );
    assertCurrentLogin(ctx.userId, sid);
    const fresh = await readBinding(db, ctx.vdnId, ctx.agentId);
    if (fresh.version !== b.version || fresh.extension !== b.extension)
      throw new AppError(409, '绑定版本已变化，丢弃旧签入结果');
    if (ack?.Result !== 0 || !Number(ack.AgentID))
      throw new AppError(502, 'CCS 签入失败（' + String(ack?.Result ?? -1) + '），请重试');
    await persistVoiceState(ctx.userId, sid, b.version, 'signed_in', '', Number(ack.AgentID));
    markLoginVoiceSignedIn(ctx.userId, sid);
    return { state: 'signed_in', binding_version: b.version, agent_id: Number(ack.AgentID) };
  } catch (err) {
    if (started && locked && getLoginSession(ctx.userId)?.sessionId === sid) {
      await persistVoiceState(
        ctx.userId,
        sid,
        expectedVersion,
        'failed',
        err instanceof AppError ? err.message : 'CCS 签入超时或连接失败，请重试',
      ).catch(() => undefined);
      if (!getSessionByUserId(ctx.userId)?.loggedIn) clearSession(ctx.userId);
    }
    if (err instanceof Error && err.message === 'session_replaced')
      throw new AppError(409, '登录会话已变化，已拒绝旧签入结果', 'session_replaced');
    throw err instanceof AppError ? err : new AppError(502, 'CCS 签入超时或连接失败，请重试');
  } finally {
    if (locked) await db.query('SELECT RELEASE_LOCK(?)', [lock]).catch(() => undefined);
    db.release();
  }
}
export async function signOutBoundVoice(req: FastifyRequest) {
  const ctx = await context(req),
    sid = (req.user as { sid?: string }).sid;
  if (!sid) throw new AppError(401, '登录会话缺失');
  const s = getSessionByUserId(ctx.userId);
  const { assertVoiceIdle } = await import('./policy.js');
  assertVoiceIdle(s);
  if (s?.loggedIn) {
    const ack = await req.server.ccsBridge?.handleInvoke(
      ctx.userId,
      randomUUID(),
      'DoAgentLoggedOff',
      {},
      sid,
    );
    if (ack?.Result !== 0) throw new AppError(502, 'CCS 签出失败，请重试');
  }
  markLoginVoiceSignedOut(ctx.userId, sid);
  clearSession(ctx.userId);
  const b = await readBinding(await database(), ctx.vdnId, ctx.agentId);
  await persistVoiceState(ctx.userId, sid, b.version, 'signed_out');
  return { state: 'signed_out', binding_version: b.version };
}

export async function reportStartupFailure(req: FastifyRequest, version: number) {
  const ctx = await context(req),
    sid = (req.user as { sid?: string }).sid;
  if (!sid || !ctx.agentId || ctx.systemSuperuser) throw new AppError(403, '当前身份不是业务坐席');
  assertCurrentLogin(ctx.userId, sid);
  const b = await readBinding(await database(), ctx.vdnId, ctx.agentId);
  if (b.version !== version) throw new AppError(409, '绑定版本已变化');
  const existing = await voiceRow(ctx.userId);
  if (existing?.sid !== sid) throw new AppError(409, '登录会话已变化');
  if (
    existing.state === 'failed' ||
    (getSessionByUserId(ctx.userId)?.loggedIn &&
      getSessionByUserId(ctx.userId)?.loginSessionId === sid)
  )
    return { state: existing.state };
  const [lock] = await rows<{ free: number }>(await database(), 'SELECT IS_FREE_LOCK(?) AS free', [
    'omni.extension.voice.' + ctx.userId,
  ]);
  if (lock?.free !== 1) return { state: 'signing_in' };
  await persistVoiceState(
    ctx.userId,
    sid,
    b.version,
    b.extension ? 'failed' : 'unbound',
    b.extension ? '话务启动未完成，请检查连接后重试' : '',
  );
  return { state: b.extension ? 'failed' : 'unbound' };
}
