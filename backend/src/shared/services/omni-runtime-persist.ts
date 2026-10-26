/**
 * Omni 进程内状态落 Redis：CCS 登录映射、技能签入、留言列表。
 * 重启 Omni 且 CCS 仍在线（bootId 一致）时，可恢复坐席映射而不必整页重登。
 * 不写密码。
 */
import { redis } from '../../plugins/redis.js';
import { hydrateLoggedInSession, getSessionByUserId, clearSession } from '../../integrations/ccs/session-manager.js';
import { getSignedInSkillIds, setSignedInSkillIds } from './agent-skill-groups.js';

const SESS_KEY = (id: number) => `omni:runtime:ccs:${id}`;
const SESS_INDEX = 'omni:runtime:ccs:index';
const LEAVE_KEY = 'omni:runtime:leave_messages';
const TTL_SEC = 86400 * 7;

export type PersistedLeaveMsg = {
  id: string;
  conversationId: number;
  content: string;
  createdAt: string;
  status: 'open' | 'claimed' | 'closed';
  assigneeId?: number;
  /** 留言原因（ITR 上报），用于坐席判断为什么进了留言 */
  reason?: string;
};

export type RuntimeCcsSession = {
  userId: number;
  workNO: string;
  extension: string;
  loginSessionId?: string;
  bindingVersion?: number;
  agentId: number;
  vdnId: number;
  workMode: 'ready' | 'busy' | 'break' | 'acw' | 'blocked';
  agentStatus: number;
  autoAnswer: boolean;
  mediaQueuingMode: number;
  callerCount: number;
  acdQueuingConfirmed: boolean;
  signedSkillIds: string[];
  bootId?: string;
};

let runtimeBootId = '';

export function setRuntimeCcsBootId(bootId: string): void {
  if (bootId) runtimeBootId = bootId;
}

export function getRuntimeCcsBootId(): string {
  return runtimeBootId;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function saveCcsRuntime(row: RuntimeCcsSession): Promise<void> {
  if (!row.userId || !row.agentId) return;
  await safe(async () => {
    await redis.set(SESS_KEY(row.userId), JSON.stringify(row), 'EX', TTL_SEC);
    await redis.sadd(SESS_INDEX, String(row.userId));
  }, undefined);
}

export async function persistCcsSession(userId: number): Promise<void> {
  const s = getSessionByUserId(userId);
  if (!s?.loggedIn || !s.agentId) {
    await dropCcsRuntime(userId);
    return;
  }
  await saveCcsRuntime({
    userId: s.userId,
    workNO: s.workNO,
    extension: s.extension,
    loginSessionId: s.loginSessionId,
    bindingVersion: s.bindingVersion,
    agentId: s.agentId,
    vdnId: s.vdnId,
    workMode: s.workMode,
    agentStatus: s.agentStatus,
    autoAnswer: s.autoAnswer,
    mediaQueuingMode: s.mediaQueuingMode,
    callerCount: s.callerCount,
    acdQueuingConfirmed: s.acdQueuingConfirmed,
    signedSkillIds: getSignedInSkillIds(userId),
    bootId: runtimeBootId || undefined,
  });
}

export async function dropCcsRuntime(userId: number): Promise<void> {
  await safe(async () => {
    await redis.del(SESS_KEY(userId));
    await redis.srem(SESS_INDEX, String(userId));
  }, undefined);
}

export async function dropAllCcsRuntime(): Promise<void> {
  await safe(async () => {
    const ids = await redis.smembers(SESS_INDEX);
    const keys = ids.map((id) => SESS_KEY(Number(id)));
    if (keys.length) await redis.del(...keys);
    await redis.del(SESS_INDEX);
  }, undefined);
}

export async function loadAllCcsRuntime(): Promise<RuntimeCcsSession[]> {
  return safe(async () => {
    const ids = await redis.smembers(SESS_INDEX);
    const out: RuntimeCcsSession[] = [];
    for (const id of ids) {
      const raw = await redis.get(SESS_KEY(Number(id)));
      if (!raw) continue;
      try {
        const row = JSON.parse(raw) as RuntimeCcsSession;
        if (row?.userId && row.agentId) out.push(row);
      } catch {
        /* skip */
      }
    }
    return out;
  }, []);
}

/** CCS 进程未换（bootId 一致）才灌回内存；进程已换则丢掉脏映射。 */
export async function restoreCcsRuntimeSessions(bootId: string): Promise<number> {
  if (bootId) runtimeBootId = bootId;
  const rows = await loadAllCcsRuntime();
  if (!rows.length) return 0;
  const matching = bootId
    ? rows.filter((r) => r.bootId === bootId)
    : rows;
  const stale = bootId ? rows.filter((r) => r.bootId !== bootId) : [];
  for (const r of stale) {
    clearSession(r.userId);
    await dropCcsRuntime(r.userId);
  }
  let n = 0;
  for (const row of matching) {
    if (process.env.OMNI_EXTENSION_BINDING_ENABLED === '1') {
      const {database,rows:queryRows}=await import('../../modules/access/access.db.js');
      const [saved]=await queryRows<{sid:string;version:number;extension:string;state:string;context:import('./login-session.js').LoginSession|string}>(await database(), `SELECT v.LoginSID AS sid,v.BindingVersion AS version,v.State AS state,v.LoginContext AS context,u.ExtensionTel AS extension FROM t_omni_extension_voice v JOIN t_user_users u ON u.ID=v.UserID AND u.VDNID=v.VDNID WHERE v.OmniUserID=? AND u.IsValid=1`,[row.userId]);
      if(!saved || saved.sid!==row.loginSessionId || Number(saved.version)!==row.bindingVersion || saved.extension!==row.extension || ['signed_out','logged_out','unbound'].includes(saved.state)){await dropCcsRuntime(row.userId);continue;}
      (await import('./login-session.js')).restoreLoginSession(typeof saved.context==='string'?JSON.parse(saved.context):saved.context);
    }
    hydrateLoggedInSession(row);
    if (row.signedSkillIds?.length) setSignedInSkillIds(row.userId, row.signedSkillIds);
    n += 1;
  }
  return n;
}

export async function saveLeaveMessages(items: PersistedLeaveMsg[]): Promise<void> {
  await safe(async () => {
    await redis.set(LEAVE_KEY, JSON.stringify(items.slice(0, 200)), 'EX', TTL_SEC);
  }, undefined);
}

export async function loadLeaveMessages(): Promise<PersistedLeaveMsg[]> {
  return safe(async () => {
    const raw = await redis.get(LEAVE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedLeaveMsg[];
    return Array.isArray(parsed) ? parsed : [];
  }, []);
}
