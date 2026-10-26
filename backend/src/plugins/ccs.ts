import { productModules } from '../modules/product-modules/authority.js';
import { voiceOperationAllowed } from '../modules/product-modules/policy.js';
import { activeVdn } from '../modules/access/access.scope.js';
import { confTenancyEnabled } from '../shared/services/conf-tenancy.js';
import fp from 'fastify-plugin';
import { assertCurrentLogin } from '../shared/services/login-session.js';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { SocketEvents, socketClientKind, type SocketClientKind } from './socketio.js';
import { env } from '../config/env.js';
import { socketAccess } from '../modules/access/access.socket.js';
import { ccsPermission, bindCcsIdentity } from '../modules/access/access.ccs.js';
import { resolveScope } from '../modules/access/access.scope.js';
import {
  attachCcsBridgeToApp,
  clearAllSignedInSynced,
  handleInvoke,
  initCcsBridge,
  maybeRetryAutoAnswerOnReconnect,
  onUiOfflineGraceElapsed,
  registerUserCredentials,
  restoreSkillsAndStatus,
  signOutAllSkillsDueToUiOffline,
} from '../integrations/ccs/ccs-bridge.js';
import { clearSession, getOrCreateSession, getSessionByUserId, listActiveSessions } from '../integrations/ccs/session-manager.js';
import {
  clearCcsEmitQueue,
  enqueueCcsEmit,
  flushCcsEmitQueue,
  isBufferedCcsPayload,
  trimCcsEmitQueue,
} from '../integrations/ccs/ccs-event-queue.js';
import { createCcsHealthMonitor, type CcsHealthMonitor } from '../integrations/ccs/ccs-health.js';
import { CCS_DOWN_EVENT, CCS_HEALTH_EVENT, handleCcsDown } from '../integrations/ccs/ccs-down.js';

const CCS_SOCKET_EVENT = SocketEvents.CCS_AGENT;

declare module 'fastify' {
  interface FastifyInstance {
    /** 该坐席是否有前台可见的 UI 连接（移动端切后台不算）。CCS 桥未启用时不存在。 */
    ccsUiForeground?: (userId: number) => boolean;
  }
}

import { pickNonEmptyWorkNo, resolveCcsWorkNo } from '../integrations/ccs/ccs-workno.js';

export { resolveCcsWorkNo } from '../integrations/ccs/ccs-workno.js';

async function ccsPlugin(fastify: FastifyInstance) {
  const productSnapshot=await productModules().snapshot();
  if (!productSnapshot.modules.icc.available) {
    fastify.log.info('ICC module unavailable — telephony initialization skipped');
    return;
  }
  if (!env.CCS_AGENT_OBJ && productSnapshot.connections?.ccsAgentObj) env.CCS_AGENT_OBJ=productSnapshot.connections.ccsAgentObj;
  if (!env.CCS_AGENT_OBJ) {
    fastify.log.warn('CCS_AGENT_OBJ not set — CCS telephony bridge disabled');
    return;
  }

  const { initCcsClient, initCcsSessionProxy, probeCcs, resetCcsWarmup, getCcsSessionProxy, recreateCcsSessionProxy, recreateCcsBusinessProxy } = await import('../integrations/ccs/ccs-client.js');
  const { startAgentServant } = await import('../integrations/ccs/agent-servant.js');
  const { startCcsSessionWatch } = await import('../integrations/ccs/ccs-session.js');
  const { setSignedInChangeHook } = await import('../shared/services/agent-skill-groups.js');
  const {
    persistCcsSession,
    dropAllCcsRuntime,
    restoreCcsRuntimeSessions,
    setRuntimeCcsBootId,
  } = await import('../shared/services/omni-runtime-persist.js');

  await initCcsClient(env.CCS_AGENT_OBJ, env.CCS_INVOKE_TIMEOUT_MS);
  const sessionObj = await initCcsSessionProxy(env.CCS_AGENT_OBJ, 5000);
  fastify.log.info({ sessionObj }, 'CCS session Prx');
  const { deriveAcdObj, initAcdClient, recreateAcdClient } = await import('../integrations/ccs/acd-client.js');
  const acdObj = deriveAcdObj(env.CCS_AGENT_OBJ);
  if (acdObj) {
    initAcdClient(acdObj, Math.min(env.CCS_INVOKE_TIMEOUT_MS, 8000));
    fastify.log.info({ acdObj }, 'ACD Prx');
  } else {
    fastify.log.warn('ACD_OBJ not set and cannot derive from CCS_AGENT_OBJ — queue list disabled');
  }
  attachCcsBridgeToApp(fastify);
  setSignedInChangeHook((userId) => {
    void persistCcsSession(userId);
  });
  try {
    const restored = await restoreCcsRuntimeSessions('');
    if (restored > 0) {
      fastify.log.warn({ restored }, 'CCS sessions hydrated from Redis');
    }
  } catch (err) {
    fastify.log.warn({ err }, 'CCS session hydrate failed');
  }

  let health: CcsHealthMonitor | undefined;
  let sessionWatch: { stop: () => void } | undefined;
  let healthPulse: ReturnType<typeof setInterval> | undefined;

  /** WS 全断后的 LoggedOff grace 定时器（按 userId）；重连取消。 */
  const logoutGraceTimers = new Map<number, ReturnType<typeof setTimeout>>();
  /** 移动端断开后延迟离队的定时器（按 userId）；Web 端是断开即离队，不用它。 */
  const queueHoldTimers = new Map<number, ReturnType<typeof setTimeout>>();
  /** 最近一次「该用户已无活跃 socket」的时间戳。 */
  const disconnectAtByUser = new Map<number, number>();
  /** 已上报进入后台但 socket 仍在的移动端连接 id。 */
  const backgroundedSockets = new Set<string>();

  const countOtherConnectedSockets = (userId: number, exceptSocketId: string): number => {
    let n = 0;
    for (const sock of fastify.io.sockets.sockets.values()) {
      if (sock.id === exceptSocketId) continue;
      if (!sock.connected) continue;
      if (Number(sock.data.userId) === userId) n += 1;
    }
    return n;
  };

  /** 该用户是否处于「仅移动端在线（含刚断开的移动端）」状态。 */
  const isMobileOnly = (userId: number, exceptSocketId: string, disconnectingKind: SocketClientKind): boolean => {
    if (disconnectingKind !== 'mobile') return false;
    for (const sock of fastify.io.sockets.sockets.values()) {
      if (sock.id === exceptSocketId) continue;
      if (!sock.connected) continue;
      if (Number(sock.data.userId) !== userId) continue;
      if (socketClientKind(sock) !== 'mobile') return false;
    }
    return true;
  };

  const cancelDisconnectTimers = (userId: number): void => {
    const grace = logoutGraceTimers.get(userId);
    if (grace) {
      clearTimeout(grace);
      logoutGraceTimers.delete(userId);
    }
    const hold = queueHoldTimers.get(userId);
    if (hold) {
      clearTimeout(hold);
      queueHoldTimers.delete(userId);
    }
    disconnectAtByUser.delete(userId);
  };

  /**
   * 最后一条 UI 连接离开：Web 端立刻退 ACD 队，移动端先保留 queue hold 窗口；
   * LoggedOff 两者都走 grace，只是移动端的 grace 长得多。
   */
  const leaveQueueOnLastUiGone = (userId: number, reason: string, mobile: boolean): void => {
    const alreadyArmed = logoutGraceTimers.has(userId);
    const disconnectAt = alreadyArmed
      ? (disconnectAtByUser.get(userId) ?? Date.now())
      : Date.now();
    disconnectAtByUser.set(userId, disconnectAt);

    const holdMs = mobile ? Math.max(0, env.CCS_WS_QUEUE_HOLD_MOBILE_MS) : 0;
    if (holdMs <= 0) {
      fastify.log.info({ userId, reason, mobile }, 'CCS UI gone — leave ACD queue immediately');
      signOutAllSkillsDueToUiOffline(userId);
    } else if (!queueHoldTimers.has(userId)) {
      fastify.log.info({ userId, reason, holdMs }, 'CCS mobile UI gone — hold ACD queue');
      const holdTimer = setTimeout(() => {
        queueHoldTimers.delete(userId);
        if (countOtherConnectedSockets(userId, '') > 0) return;
        fastify.log.info({ userId, holdMs }, 'CCS mobile queue hold elapsed — leave ACD queue');
        signOutAllSkillsDueToUiOffline(userId);
      }, holdMs);
      queueHoldTimers.set(userId, holdTimer);
    }

    if (alreadyArmed) return;
    const graceMs = mobile ? env.CCS_WS_LOGOUT_GRACE_MOBILE_MS : env.CCS_WS_LOGOUT_GRACE_MS;
    const graceTimer = setTimeout(() => {
      logoutGraceTimers.delete(userId);
      if (countOtherConnectedSockets(userId, '') > 0) {
        disconnectAtByUser.delete(userId);
        return;
      }
      const offlineFor = Date.now() - (disconnectAtByUser.get(userId) ?? Date.now());
      disconnectAtByUser.delete(userId);
      const outcome = onUiOfflineGraceElapsed(userId);
      fastify.log.info({ userId, offlineFor, mobile, outcome }, 'CCS WS grace elapsed');
    }, graceMs);
    logoutGraceTimers.set(userId, graceTimer);
  };

  const emitCcsToUser = (userId: number, event: string, data: unknown): void => {
    const online = (fastify.userSocketCount?.(userId) ?? 0) > 0;
    if (event === CCS_SOCKET_EVENT && isBufferedCcsPayload(data)) {
      if (!online) {
        enqueueCcsEmit(userId, event, data);
        fastify.log.info(
          { userId, method: (data as { method?: string }).method },
          'CCS evt buffered (no active WS)',
        );
        return;
      }
      trimCcsEmitQueue(userId);
    }
    const method = (data as { method?: string })?.method;
    if (method === 'OnAgentOnForceIdleEvt' || method === 'OnAgentOnForceBusyEvt' || method === 'OnAgentOnForceBlockEvt') {
      fastify.log.info({ userId, method, online, sockets: fastify.userSocketCount?.(userId) ?? 0 }, 'CCS force evt → user');
    }
    fastify.emitToUser(userId, event, data);
  };

  initCcsBridge(emitCcsToUser, {
    vdnId: env.OMNI_AGENT_VDN_ID,
    servantObjName: env.OMNI_AGENT_SERVANT_OBJ,
    servantHost: env.OMNI_AGENT_SERVANT_ADVERTISE_HOST,
    servantPort: env.OMNI_AGENT_SERVANT_PORT,
    invokeTimeoutMs: env.CCS_INVOKE_TIMEOUT_MS,
    resolveWorkNoForUser: async (userId) => {
      const user = await fastify.prisma.users.findUnique({ where: { id: userId } });
      if (!user) throw new Error('user not found');
      return resolveCcsWorkNo(user, env.CCS_WORK_NO_FIELD);
    },
    isUserOnline: (userId) => (fastify.userSocketCount?.(userId) ?? 0) > 0,
    isUiForeground: (userId) => fastify.ccsUiForeground?.(userId) ?? false,
    emitToAccount: (accountId, event, data) => fastify.emitToAccount(accountId, event, data),
  });

  await startAgentServant({
    name: 'OmniAgentAgentServer',
    servant: env.OMNI_AGENT_SERVANT_OBJ,
    host: env.OMNI_AGENT_SERVANT_HOST,
    port: env.OMNI_AGENT_SERVANT_PORT,
  });

  fastify.log.info(
    `CCS Agent Servant listening ${env.OMNI_AGENT_SERVANT_OBJ}@tcp -h ${env.OMNI_AGENT_SERVANT_ADVERTISE_HOST} -p ${env.OMNI_AGENT_SERVANT_PORT}`,
  );

  const { startAcdCbServant, buildAcdCallbackObj } = await import('../integrations/ccs/acd-cb-servant.js');
  await startAcdCbServant({
    name: 'OmniAgentAcdCbServer',
    servant: env.OMNI_ACD_CB_OBJ,
    host: env.OMNI_ACD_CB_HOST,
    port: env.OMNI_ACD_CB_PORT,
  });
  const acdCbEndpoint = buildAcdCallbackObj({
    servant: env.OMNI_ACD_CB_OBJ,
    advertiseHost: env.OMNI_ACD_CB_ADVERTISE_HOST,
    port: env.OMNI_ACD_CB_PORT,
  });
  fastify.log.info(`ACD Callback Servant listening ${acdCbEndpoint} (DoRing.CallbackObj)`);

  const healthPayload = (loggedIn?: boolean): { up: boolean; generation: number; bootId?: string; logged_in?: boolean } => {
    const snap = health?.snapshot();
    const payload: { up: boolean; generation: number; bootId?: string; logged_in?: boolean } = {
      up: snap?.up === true,
      generation: snap?.generation ?? 0,
    };
    if (snap?.bootId) payload.bootId = snap.bootId;
    if (loggedIn !== undefined) payload.logged_in = loggedIn;
    return payload;
  };

  const broadcastHealth = (): void => {
    const snap = health?.snapshot();
    if (snap?.bootId) setRuntimeCcsBootId(snap.bootId);
    fastify.emitToAll(CCS_HEALTH_EVENT, healthPayload());
  };

  health = createCcsHealthMonitor({
    ping: probeCcs,
    intervalMs: env.CCS_HEALTH_INTERVAL_MS,
    failThreshold: env.CCS_HEALTH_FAIL_THRESHOLD,
    onDown: () => {
      resetCcsWarmup();
      void dropAllCcsRuntime();
      const { cleared } = handleCcsDown({
        listUserIds: () => listActiveSessions().map((s) => s.userId),
        clearSession,
        clearQueue: clearCcsEmitQueue,
        clearSignedIn: clearAllSignedInSynced,
        emitToAll: (event, data) => fastify.emitToAll(event, data),
      });
      fastify.log.warn({ cleared, event: CCS_DOWN_EVENT }, 'CCS unreachable — kick all Omni agents to login');
      broadcastHealth();
    },
    onUp: () => {
      resetCcsWarmup();
      void (async () => {
        try {
          await recreateCcsBusinessProxy();
          recreateAcdClient();
        } catch (err) {
          fastify.log.warn({ err }, 'CCS/ACD proxy recreate failed');
        }
        const bootId = health?.snapshot().bootId ?? '';
        if (bootId) setRuntimeCcsBootId(bootId);
        try {
          const restored = await restoreCcsRuntimeSessions(bootId);
          if (restored > 0) {
            fastify.log.info({ restored, bootId }, 'CCS sessions restored from Redis');
          }
        } catch (err) {
          fastify.log.warn({ err }, 'CCS session restore failed');
        }
        fastify.log.info('CCS reachable — TARS proxies ready');
        broadcastHealth();
      })();
    },
  });

  const pulseMsRaw = env.CCS_HEALTH_PULSE_MS;
  if (pulseMsRaw > 0) {
    const pulseMs = Math.max(10_000, pulseMsRaw);
    healthPulse = setInterval(() => broadcastHealth(), pulseMs);
    fastify.log.info({ pulseMs, event: CCS_HEALTH_EVENT }, 'CCS health pulse (one emit for all sockets)');
  }

  sessionWatch = startCcsSessionWatch({
    getProxy: getCcsSessionProxy,
    recreateProxy: recreateCcsSessionProxy,
    objName: env.CCS_AGENT_OBJ ?? '',
    nodeId: env.OMNI_AGENT_SERVANT_OBJ,
    onDown: () => health?.notifyDown(),
    onUp: () => health?.markReachable(),
    log: fastify.log,
  });

  fastify.io.on('connection', (socket) => {
    const userId = Number(socket.data.userId);

    // 重连补发本连接快照（可带 logged_in）。全员脉冲故意不带 per-user 字段。
    socket.emit(CCS_HEALTH_EVENT, healthPayload(getSessionByUserId(userId)?.loggedIn === true));

    // 重连：取消 LoggedOff grace；若关页时已退队则恢复技能
    cancelDisconnectTimers(userId);
    restoreSkillsAndStatus(userId);
    const flushed = flushCcsEmitQueue(userId, (event, data) => {
      socket.emit(event, data);
    });
    if (flushed > 0) {
      fastify.log.info({ userId, flushed }, 'CCS evt queue flushed on reconnect');
    }
    maybeRetryAutoAnswerOnReconnect(userId);

    socket.on(CCS_SOCKET_EVENT, async (msg: { op?: string; method?: string; reqId?: string; payload?: Record<string, unknown> }) => {
        if (msg?.op !== 'invoke' || !msg.method || !msg.reqId) return;
        try {
          const access = await socketAccess(userId, socket.data.sid, socket.data.accountId);
          if (confTenancyEnabled() && access.systemSuperuser) throw new Error('系统超级用户不是业务坐席');
          const permission = ccsPermission(msg.method);
          if (!permission?.startsWith('omni.') && !voiceOperationAllowed(msg.method, (await productModules().snapshot()).modules.icc.available)) throw new Error('ICC 话务模块未启用');
          if (!permission || (permission !== 'session' && !access.permissions.includes(permission))) throw new Error('没有此话务操作权限');
          const user = await fastify.prisma.users.findUniqueOrThrow({ where: { id: userId } });
          assertCurrentLogin(userId, socket.data.sid);
          const session = getOrCreateSession(userId);
          const p = msg.payload ?? {};
          bindCcsIdentity(p, { workNO: resolveCcsWorkNo(user, env.CCS_WORK_NO_FIELD), vdnId: access.vdnId, agentId: session.agentId }, ['ccs.registerCredentials', 'DoAgentLoginEx'].includes(msg.method));
          if (permission === 'monitor.read' && !access.scopes[permission]?.includes('account')) throw new Error('CCS 全量状态订阅需要租户范围，请使用已授权的监控接口');
          if (permission !== 'session') {
            const users = await fastify.prisma.users.findMany({ where: { account_users: { some: { account_id: access.accountId } } } });
            const scope = await resolveScope(access, permission, access.scopes[permission] ?? [], users);
            const { getSessionByAgentId } = await import('../integrations/ccs/session-manager.js');
            const targets = [p.DstAgentID, p.DstAgentIDs, p.InvitedAgentID].flat().filter(id => id != null && Number(id) > 0);
            for (const id of targets) if (!scope.userIds.includes(getSessionByAgentId(Number(id))?.userId ?? 0)) throw new Error('目标坐席不在授权数据范围内');
            if (p.WorkNO != null && !users.some(u => scope.userIds.includes(u.id) && resolveCcsWorkNo(u, env.CCS_WORK_NO_FIELD) === String(p.WorkNO))) throw new Error('目标工号不在授权数据范围内');
          }
          if (['ccs.registerCredentials', 'DoAgentLoginEx'].includes(msg.method)) throw new Error('请使用当前绑定的服务端话务签入接口');
          await handleInvoke(userId, msg.reqId, msg.method, p, socket.data.sid);
      } catch (err) {
        fastify.log.error({ err, method: msg.method, userId }, 'CCS invoke failed');
        emitCcsToUser(userId, CCS_SOCKET_EVENT, {
          op: 'ack',
          method: msg.method,
          reqId: msg.reqId,
          payload: { Result: -1, errMsg: err instanceof Error ? err.message : String(err) },
        });
      }
    });

    backgroundedSockets.delete(socket.id);

    socket.on('ccs.ui.leaving', () => {
      if (countOtherConnectedSockets(userId, socket.id) > 0) return;
      leaveQueueOnLastUiGone(userId, 'pagehide', isMobileOnly(userId, socket.id, socketClientKind(socket)));
    });

    // 移动端切后台：保持在队列，只标记前台不可见，来电改走推送唤醒。
    socket.on('ccs.ui.background', () => {
      backgroundedSockets.add(socket.id);
      fastify.log.info({ userId, socketId: socket.id }, 'CCS mobile UI backgrounded — stay in queue');
    });

    socket.on('ccs.ui.foreground', () => {
      backgroundedSockets.delete(socket.id);
      cancelDisconnectTimers(userId);
      restoreSkillsAndStatus(userId);
      fastify.log.info({ userId, socketId: socket.id }, 'CCS mobile UI foregrounded');
    });

    socket.on('disconnect', () => {
      const kind = socketClientKind(socket);
      backgroundedSockets.delete(socket.id);
      // 仍有其它连接：多标签，不动排队
      if (countOtherConnectedSockets(userId, socket.id) > 0) return;
      leaveQueueOnLastUiGone(userId, 'disconnect', isMobileOnly(userId, socket.id, kind));
    });
  });

  // 推送决策用：有无「前台可见」的连接。全部切后台或全部断开时来电要走推送。
  fastify.decorate('ccsUiForeground', (userId: number): boolean => {
    for (const sock of fastify.io.sockets.sockets.values()) {
      if (!sock.connected) continue;
      if (Number(sock.data.userId) !== userId) continue;
      if (!backgroundedSockets.has(sock.id)) return true;
    }
    return false;
  });

  fastify.post('/api/agent/ccs-profile', { preHandler: [fastify.authenticate] }, async (_req, reply) => reply.status(410).send({ error: '请使用分机绑定管理和服务端话务签入接口' }));

  fastify.get('/api/agent/ccs-session', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const session = getOrCreateSession(req.currentUser!.id);
    const snap = health?.snapshot();
    const owned=process.env.OMNI_EXTENSION_BINDING_ENABLED!=='1' || session.loginSessionId===(req.user as {sid?:string}).sid;
    return reply.send({
      logged_in: owned && session.loggedIn,
      agent_id: owned ? session.agentId : null,
      status: session.status,
      agent_status: session.agentStatus,
      current_call: owned ? session.currentCall : null,
      extension: session.extension,
      work_no: session.workNO,
      auto_answer: session.autoAnswer,
      pending_logout_after_call: session.pendingLogoutAfterCall,
      skills_pending_restore: session.skillsToRestore != null,
      ccs_up: snap?.up === true,
      ccs_boot_id: snap?.bootId ?? '',
      ccs_generation: snap?.generation ?? 0,
    });
  });

  fastify.addHook('onClose', async () => {
    if (healthPulse) clearInterval(healthPulse);
    sessionWatch?.stop();
    health?.stop();
    for (const t of logoutGraceTimers.values()) clearTimeout(t);
    logoutGraceTimers.clear();
    for (const t of queueHoldTimers.values()) clearTimeout(t);
    queueHoldTimers.clear();
    disconnectAtByUser.clear();
    backgroundedSockets.clear();
    const { stopAgentServant } = await import('../integrations/ccs/agent-servant.js');
    await stopAgentServant();
  });
}

export default fp(ccsPlugin, { name: 'ccs', dependencies: ['socketio'] });
