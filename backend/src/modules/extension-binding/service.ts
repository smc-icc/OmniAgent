import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../plugins/db.js';
import { AppError } from '../../shared/errors/index.js';
import { getAccess, type AccessContext } from '../access/access.context.js';
import { accessScope } from '../access/access.scope.js';
import { confTenancyEnabled } from '../../shared/services/conf-tenancy.js';
import { restoreLoginSession, getLoginSession } from '../../shared/services/login-session.js';
import {
  getSessionByUserId,
  hydrateLoggedInSession,
  clearSession,
} from '../../integrations/ccs/session-manager.js';
import { assertBindingChange, assertVoiceIdle } from './policy.js';
import { runBindingStages } from './execution.js';
import { remoteVoice } from './ccs-state.js';
import { revokeSipCredentials } from './sip-revocation.js';
import { voiceRow, persistVoiceState } from './voice.js';
import * as repo from './repository.js';
export interface ChangeInput {
  extension: string;
  expected_version: number;
  idempotency_key: string;
}
export async function targetOmniUser(vdn: number, userId: number, workNo: string) {
  return accessScope.exit(async () => {
    if (confTenancyEnabled()) {
      const b = await prisma.conf_user_bindings.findUnique({
        where: { vdn_id_source_user_id: { vdn_id: vdn, source_user_id: userId } },
      });
      return b?.user_id;
    }
    const users = await prisma.users.findMany({ where: { uid: workNo }, select: { id: true } });
    return users.length === 1 ? users[0]!.id : undefined;
  });
}
async function liveActor(actorId: number, vdn: number) {
  const user = await accessScope.exit(() => prisma.users.findUnique({ where: { id: actorId } }));
  if (!user) throw new AppError(403, '操作人已失效');
  const access = await getAccess({
    currentUser: user,
    headers: { 'x-vdn-id': String(vdn) },
  } as unknown as FastifyRequest);
  if (access.vdnId !== vdn) throw new AppError(403, '操作人当前 VDN 授权已失效');
  return access;
}
export async function bindingSnapshot(req: FastifyRequest) {
  const access = await getAccess(req);
  if (!access.agentId || access.systemSuperuser)
    return {
      binding: { extension: '', version: 0, status: 'unbound', conflict: null },
      request: null,
      operation: null,
      permissions: [],
      voice: { state: 'unbound', error: '' },
    };
  const db = await repo.database(),
    b = await repo.readBinding(db, access.vdnId, access.agentId);
  const [request, operation, conflict, voice] = await Promise.all([
    repo.pendingRequest(db, access.vdnId, access.agentId),
    repo.activeOperation(db, access.vdnId, access.agentId),
    repo.bindingConflict(db, access.vdnId, b),
    voiceRow(access.userId),
  ]);
  const s = getSessionByUserId(access.userId),
    sid = (req.user as { sid?: string })?.sid;
  const current = voice?.sid === sid ? voice : undefined;
  const state = !b.extension
    ? 'unbound'
    : conflict
      ? 'failed'
      : s?.loggedIn && s.loginSessionId === sid && s.bindingVersion === b.version
        ? 'signed_in'
        : current?.state === 'signed_out'
          ? 'signed_out'
          : current?.state === 'failed'
            ? 'failed'
            : 'signing_in';
  return {
    binding: {
      extension: b.extension,
      version: b.version,
      status: b.extension ? 'bound' : 'unbound',
      conflict,
    },
    request,
    operation: operation
      ? { id: operation.id, phase: operation.phase, error: operation.error }
      : null,
    permissions: access.permissions.filter((p) => p.startsWith('extension.')),
    voice: {
      state,
      error: conflict || current?.error || '',
      call_active: !!s && (!!s.currentCall || ['ringing', 'talking', 'hold'].includes(s.status)),
    },
  };
}
export async function submitRequest(req: FastifyRequest, input: ChangeInput) {
  const access = await getAccess(req);
  if (!access.agentId || access.systemSuperuser) throw new AppError(403, '当前身份不是有效坐席');
  return repo.transaction(async (db) => {
    const [duplicate] = await repo.rows<repo.ExtensionRequest>(
      db,
      'SELECT ID AS id,TargetNum AS target_extension,ExpectedVersion AS expected_version FROM t_omni_extension_request WHERE VDNID=? AND UserID=? AND IdempotencyKey=?',
      [access.vdnId, access.agentId, input.idempotency_key],
    );
    if (duplicate) {
      if (
        duplicate.target_extension !== input.extension ||
        Number(duplicate.expected_version) !== input.expected_version
      )
        throw new AppError(409, '幂等键已用于不同申请');
      return repo.requestById(db, access.vdnId, duplicate.id);
    }
    const b = await repo.readBinding(db, access.vdnId, access.agentId, true);
    if (b.version !== input.expected_version)
      throw new AppError(409, '绑定版本已变化，请刷新后申请');
    if (b.extension === input.extension) throw new AppError(409, '分机绑定未变化');
    await repo.requireAvailable(db, access.vdnId, input.extension, access.agentId);
    return repo.newRequest(
      db,
      access.vdnId,
      access.userId,
      b,
      input.extension,
      input.idempotency_key,
    );
  });
}
export async function decideRequest(
  req: FastifyRequest,
  id: string,
  decision: 'cancel' | 'reject',
  reason = '',
) {
  const access = await getAccess(req);
  if (decision === 'reject' && !access.permissions.includes('extension.approve'))
    throw new AppError(403, '没有分机审批权限');
  return repo.transaction(async (db) => {
    const r = await repo.requestById(db, access.vdnId, id, true);
    if (decision === 'cancel' && r.user_id !== access.agentId)
      throw new AppError(403, '只能撤销本人的申请');
    if (r.status === (decision === 'cancel' ? 'cancelled' : 'rejected')) return r;
    if (r.status !== 'pending') throw new AppError(409, '申请已处理或正在执行');
    await repo.execute(
      db,
      'UPDATE t_omni_extension_request SET Status=?,Reason=?,ReviewerID=?,ReviewedAt=CURRENT_TIMESTAMP(3) WHERE ID=?',
      [decision === 'cancel' ? 'cancelled' : 'rejected', reason, access.userId, id],
    );
    await repo.execute(
      db,
      "UPDATE t_omni_extension_operation SET Phase='cancelled',UpdatedAt=CURRENT_TIMESTAMP(3) WHERE RequestID=? AND Phase='waiting_call'",
      [id],
    );
    await repo.requestAudit(
      db,
      access.vdnId,
      id,
      access.userId,
      decision === 'cancel' ? 'cancelled' : 'rejected',
      reason,
    );
    return repo.requestById(db, access.vdnId, id);
  });
}
export async function reserveChange(
  req: FastifyRequest,
  targetId: number,
  input: ChangeInput,
  self: boolean,
  requestId?: string,
) {
  const access = await getAccess(req);
  if (self && (targetId !== access.agentId || !targetId || access.systemSuperuser))
    throw new AppError(403, '当前身份不能操作此坐席');
  if (!self && !access.permissions.includes(requestId ? 'extension.approve' : 'extension.assign'))
    throw new AppError(403, '没有分机分配或审批权限');
  const b = await repo.readBinding(await repo.database(), access.vdnId, targetId);
  const omniId = await targetOmniUser(access.vdnId, targetId, b.work_no);
  const op = await repo.withVoiceLock(omniId, () =>
    repo.transaction(async (db) => {
      const original = await repo.operationByKey(db, access.vdnId, targetId, input.idempotency_key);
      if (original) {
        if (
          original.target_extension !== input.extension ||
          Number(original.expected_version) !== input.expected_version ||
          (!requestId && original.actor_id !== access.userId)
        )
          throw new AppError(409, '幂等键已用于不同变更');
        if (original.phase === 'cancelled')
          throw new AppError(409, '原操作已取消，请刷新后重新发起');
        if (original.phase === 'waiting_call') {
          const fresh = await repo.readBinding(db, access.vdnId, targetId, true);
          if (
            fresh.version !== input.expected_version ||
            fresh.extension !== original.old_extension
          )
            throw new AppError(409, '绑定版本已变化，请重新申请', 'extension_version_stale');
          const r = requestId ? await repo.requestById(db, access.vdnId, requestId, true) : null;
          if (r?.status !== 'pending') throw new AppError(409, '申请已处理');
          if (omniId) assertVoiceIdle(getSessionByUserId(omniId));
          await repo.requireAvailable(db, access.vdnId, input.extension, targetId);
          await repo.execute(
            db,
            "UPDATE t_omni_extension_operation SET Phase='reserved',Error='',UpdatedAt=CURRENT_TIMESTAMP(3) WHERE ID=?",
            [original.id],
          );
          await repo.execute(
            db,
            "UPDATE t_omni_extension_request SET Status='executing',ReviewerID=? WHERE ID=?",
            [access.userId, requestId],
          );
          original.phase = 'reserved';
        }
        return original;
      }
      const current = await repo.readBinding(db, access.vdnId, targetId, true);
      const r = requestId ? await repo.requestById(db, access.vdnId, requestId, true) : null;
      if (r && r.status !== 'pending') throw new AppError(409, '申请已处理');
      if (
        r &&
        (Number(r.expected_version) !== current.version || r.old_extension !== current.extension)
      ) {
        await repo.execute(
          db,
          "UPDATE t_omni_extension_request SET Status='stale',ReviewerID=?,Reason='绑定版本已变化',ReviewedAt=CURRENT_TIMESTAMP(3) WHERE ID=?",
          [access.userId, r.id],
        );
        await repo.requestAudit(db, access.vdnId, r.id, access.userId, 'stale', '绑定版本已变化');
        return { stale: true } as const;
      }
      assertBindingChange({
        old: current.extension,
        target: input.extension,
        version: current.version,
        expectedVersion: input.expected_version,
        permissions: requestId ? ['extension.assign'] : access.permissions,
        self,
      });
      if (omniId) assertVoiceIdle(getSessionByUserId(omniId));
      if (await repo.activeOperation(db, access.vdnId, targetId))
        throw new AppError(409, '该坐席有变更正在执行，请刷新或重试原操作');
      await repo.requireAvailable(db, access.vdnId, input.extension, targetId);
      const created = await repo.createOperation(db, {
        vdn: access.vdnId,
        actor: access.userId,
        b: current,
        target: input.extension,
        key: input.idempotency_key,
        self,
        omniUserId: omniId,
        sid: omniId ? getLoginSession(omniId)?.sessionId : undefined,
        requestId,
      });
      if (r)
        await repo.execute(
          db,
          "UPDATE t_omni_extension_request SET Status='executing',ReviewerID=? WHERE ID=?",
          [access.userId, r.id],
        );
      return created;
    }),
  );
  if ('stale' in op) return { status: 'stale', message: '申请已失效，请坐席重新申请' };
  if (op.phase !== 'done' && op.omni_user_id)
    req.server.emitToUser?.(op.omni_user_id, 'extension.binding_processing', {
      vdn_id: op.vdn_id,
      operation_id: op.id,
      binding_version: Number(op.expected_version),
    });
  return executeChange(req.server, op.id);
}
export async function approveRequest(req: FastifyRequest, id: string) {
  const access = await getAccess(req);
  if (!access.permissions.includes('extension.approve'))
    throw new AppError(403, '没有分机审批权限');
  const r = await repo.requestById(await repo.database(), access.vdnId, id);
  if (r.status === 'approved') return { status: 'approved', request: r };
  if (!['pending', 'executing'].includes(r.status)) throw new AppError(409, '申请已处理或失效');
  try {
    return await reserveChange(
      req,
      r.user_id,
      {
        extension: r.target_extension,
        expected_version: Number(r.expected_version),
        idempotency_key: 'approve:' + id,
      },
      false,
      id,
    );
  } catch (e) {
    if (e instanceof AppError && e.errorCode === 'extension_call_active')
      return { status: 'pending', message: e.message };
    if (
      r.status === 'pending' &&
      e instanceof AppError &&
      (e.statusCode === 403 ||
        ['extension_invalid', 'extension_occupied', 'extension_sip_missing'].includes(
          e.errorCode ?? '',
        ))
    ) {
      await repo.execute(
        await repo.database(),
        "UPDATE t_omni_extension_request SET Status='stale',Reason=?,ReviewerID=?,ReviewedAt=CURRENT_TIMESTAMP(3) WHERE ID=? AND Status='pending'",
        [e.message, access.userId, r.id],
      );
      return { status: 'stale', message: e.message };
    }
    throw e;
  }
}
export async function executeChange(app: FastifyInstance, id: string) {
  const db = await (await repo.database()).getConnection(),
    lock = 'omni.ext.op.' + id;
  let locked = false,
    voiceLocked = false,
    voiceLock = '';
  try {
    const [r] = await repo.rows<{ acquired: number }>(db, 'SELECT GET_LOCK(?,0) AS acquired', [
      lock,
    ]);
    if (r?.acquired !== 1) return { status: 'processing', operation_id: id };
    locked = true;
    const op = await repo.readOperation(db, id);
    if (!op) throw new AppError(404, '变更不存在');
    const source = await repo.readBinding(db, op.vdn_id, op.user_id);
    const mapped = await targetOmniUser(op.vdn_id, op.user_id, source.work_no);
    if (mapped && mapped !== op.omni_user_id) {
      op.omni_user_id = mapped;
      await repo.execute(db, 'UPDATE t_omni_extension_operation SET OmniUserID=? WHERE ID=?', [
        mapped,
        op.id,
      ]);
    }
    if (op.omni_user_id) {
      const currentSid = getLoginSession(op.omni_user_id)?.sessionId;
      if (currentSid && currentSid !== op.login_sid) {
        op.login_sid = currentSid;
        await repo.execute(db, 'UPDATE t_omni_extension_operation SET LoginSID=? WHERE ID=?', [
          currentSid,
          op.id,
        ]);
      }
    }
    if (op.omni_user_id) {
      voiceLock = 'omni.extension.voice.' + op.omni_user_id;
      const [v] = await repo.rows<{ acquired: number }>(db, 'SELECT GET_LOCK(?,0) AS acquired', [
        voiceLock,
      ]);
      if (v?.acquired !== 1) return { status: 'processing', operation_id: id };
      voiceLocked = true;
    }
    const confirmRemote = async () => {
      if (!op.old_extension) return null;
      const binding = await repo.readBinding(db, op.vdn_id, op.user_id);
      const remote = await remoteVoice(op.vdn_id, binding.work_no);
      if (!remote && op.omni_user_id && getSessionByUserId(op.omni_user_id)?.loggedIn) {
        clearSession(op.omni_user_id);
      }
      if (remote && !op.omni_user_id)
        throw new AppError(409, '旧 CCS 工号存在话务会话，无法确认 Omni 身份，请联系管理员');
      if (remote && op.omni_user_id && !getSessionByUserId(op.omni_user_id)?.loggedIn) {
        const [saved] = await repo.rows<{
          sid: string;
          context: import('../../shared/services/login-session.js').LoginSession | string;
        }>(
          db,
          'SELECT LoginSID AS sid,LoginContext AS context FROM t_omni_extension_voice WHERE OmniUserID=? AND VDNID=? AND UserID=?',
          [op.omni_user_id, op.vdn_id, op.user_id],
        );
        if (saved) {
          restoreLoginSession(
            typeof saved.context === 'string' ? JSON.parse(saved.context) : saved.context,
          );
        }
        const currentSid = getLoginSession(op.omni_user_id)?.sessionId;
        if (currentSid && currentSid !== op.login_sid) {
          op.login_sid = currentSid;
          await repo.execute(db, 'UPDATE t_omni_extension_operation SET LoginSID=? WHERE ID=?', [
            currentSid,
            op.id,
          ]);
        }
        hydrateLoggedInSession({
          userId: op.omni_user_id,
          workNO: binding.work_no,
          extension: op.old_extension,
          agentId: remote.agentId,
          vdnId: op.vdn_id,
          loginSessionId: currentSid,
          bindingVersion: Number(op.expected_version),
          agentStatus: remote.status,
        });
      }
      return remote;
    };
    if (op.phase === 'waiting_call')
      return { status: 'pending', operation_id: op.id, message: '通话结束后请重新审批' };
    if (op.phase === 'cancelled')
      return { status: 'cancelled', operation_id: op.id, message: op.error };
    const currentVoice = () => (op.omni_user_id ? getSessionByUserId(op.omni_user_id) : undefined);
    const authorize = async () => {
      const actor = await liveActor(op.actor_id, op.vdn_id);
      const b = await repo.readBinding(db, op.vdn_id, op.user_id);
      if (op.request_id) {
        if (!actor.permissions.includes('extension.approve'))
          throw new AppError(403, '审批权限已撤销');
      } else
        assertBindingChange({
          old: op.old_extension,
          target: op.target_extension,
          version: b.version,
          expectedVersion: Number(op.expected_version),
          permissions: actor.permissions,
          self: Number(op.self_operation) === 1,
        });
      if (b.version !== Number(op.expected_version) || b.extension !== op.old_extension)
        throw new AppError(409, '绑定版本已变化，停止执行');
      await repo.requireAvailable(db, op.vdn_id, op.target_extension, op.user_id, op.id);
    };
    const notify = async () => {
      if (op.omni_user_id) {
        const b = await repo.readBinding(db, op.vdn_id, op.user_id),
          session = currentVoice();
        if (b.version !== Number(op.expected_version) + 1) {
          await repo.execute(
            db,
            "UPDATE t_omni_extension_operation SET NotifiedAt=CURRENT_TIMESTAMP(3),Error='' WHERE ID=?",
            [op.id],
          );
          op.notified_at = new Date().toISOString();
          return;
        }
        if (session?.bindingVersion !== b.version) clearSession(op.omni_user_id);
        const login = getLoginSession(op.omni_user_id),
          voice = await voiceRow(op.omni_user_id);
        if (login && (!voice || Number(voice.version) !== b.version))
          await persistVoiceState(
            op.omni_user_id,
            login.sessionId,
            b.version,
            b.extension ? 'signing_in' : 'unbound',
          );
        app.emitToUser?.(op.omni_user_id, 'extension.binding_changed', {
          vdn_id: op.vdn_id,
          binding_version: b.version,
          extension: b.extension,
        });
      }
      await repo.execute(
        db,
        "UPDATE t_omni_extension_operation SET NotifiedAt=CURRENT_TIMESTAMP(3),Error='' WHERE ID=?",
        [op.id],
      );
      op.notified_at = new Date().toISOString();
    };
    try {
      await runBindingStages(op, {
        authorize,
        drain: async () => {
          const remote = await confirmRemote();
          const s = currentVoice();
          assertVoiceIdle(s);
          if (s?.loggedIn && remote) {
            const { invokeDoAgent } = await import('../../integrations/ccs/ccs-client.js');
            const result = await invokeDoAgent('DoAgentSetBusy', { AgentID: s.agentId });
            if (result.ret !== 0 || Number(result.rsp.err) !== 0)
              throw new AppError(502, '停止电话派单失败，请重试');
            await confirmRemote();
            assertVoiceIdle(s);
          }
        },
        signOut: async () => {
          const remote = await confirmRemote();
          const s = currentVoice();
          assertVoiceIdle(s);
          if (s?.loggedIn && remote) {
            if (!app.ccsBridge) throw new AppError(503, 'CCS 服务不可用');
            await app.ccsBridge.logoutWithConfirmation(
              s.userId,
              getLoginSession(s.userId)?.sessionId,
            );
          }
        },
        revoke: async () => {
          assertVoiceIdle(currentVoice());
          await revokeSipCredentials(op);
        },
        commit: () => repo.commitOperation(op),
        save: (p) => repo.phase(op.id, p),
        notify,
      });
      if (!op.notified_at) await notify();
      return {
        status: 'completed',
        operation_id: op.id,
        binding: await repo.readBinding(db, op.vdn_id, op.user_id),
      };
    } catch (e) {
      const message = e instanceof AppError ? e.message : '话务变更失败，请稍后重试';
      if (
        e instanceof AppError &&
        e.errorCode === 'extension_call_active' &&
        ['reserved', 'draining'].includes(op.phase)
      ) {
        await repo.phase(op.id, op.request_id ? 'waiting_call' : 'cancelled', message);
        if (op.request_id)
          await repo.execute(
            db,
            "UPDATE t_omni_extension_request SET Status='pending',Reason=?,ReviewerID=NULL WHERE ID=?",
            [message, op.request_id],
          );
        if (op.omni_user_id)
          app.emitToUser?.(op.omni_user_id, 'extension.binding_processing_finished', {
            vdn_id: op.vdn_id,
          });
        return { status: op.request_id ? 'pending' : 'cancelled', operation_id: op.id, message };
      }
      if (e instanceof AppError && e.statusCode === 403 && op.phase === 'reserved') {
        await repo.phase(op.id, 'cancelled', message);
        if (op.request_id)
          await repo.execute(
            db,
            "UPDATE t_omni_extension_request SET Status='stale',Reason=? WHERE ID=?",
            [message, op.request_id],
          );
        if (op.omni_user_id)
          app.emitToUser?.(op.omni_user_id, 'extension.binding_processing_finished', {
            vdn_id: op.vdn_id,
          });
        return { status: 'cancelled', operation_id: op.id, message };
      }
      await repo.phase(op.id, op.phase, message);
      return { status: 'retryable', operation_id: op.id, message };
    }
  } finally {
    if (voiceLocked) await db.query('SELECT RELEASE_LOCK(?)', [voiceLock]).catch(() => undefined);
    if (locked) await db.query('SELECT RELEASE_LOCK(?)', [lock]).catch(() => undefined);
    db.release();
  }
}
export async function recoverChanges(app: FastifyInstance) {
  const pending = await repo.rows<{ id: string }>(
    await repo.database(),
    "SELECT ID AS id FROM t_omni_extension_operation WHERE Phase NOT IN ('done','cancelled','waiting_call') OR (Phase='done' AND NotifiedAt IS NULL) ORDER BY UpdatedAt LIMIT 20",
  );
  for (const op of pending) await executeChange(app, op.id);
}
