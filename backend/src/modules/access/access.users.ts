import { assertVideoExtensionAvailable } from '../../shared/services/video-agent-config.js';
import { confTenancyEnabled } from '../../shared/services/conf-tenancy.js';
import { syncManagedUser } from '../../shared/services/conf-tenancy-sync.js';
import { z } from 'zod';
import { prisma } from '../../plugins/db.js';
import { AppError } from '../../shared/errors/index.js';
import { applyConfUserSync, resolveSyncEmail } from '../../shared/services/conf-user-sync.js';
import { database, rows, execute, transaction, nextId, type Db } from './access.db.js';
import { accessScope } from './access.scope.js';
import { requireEntity } from './access.entities.js';
import type { AccessContext } from './access.context.js';

function identityWhere(workNo: string, email?: string | null) {
  const resolved = resolveSyncEmail(workNo, email);
  return resolved ? { OR: [{ uid: workNo }, { email: resolved }] } : { uid: workNo };
}

const phone = z.string().trim().max(50).default('');
export const userSchema = z.object({
  work_no: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9_-]+$/, '工号仅支持字母、数字、下划线和短横线'),
  name: z.string().trim().min(1).max(100), password: z.string().min(6).max(50).optional(),
  email: z.union([z.string().email().max(50), z.literal('')]).default(''),
  extension: phone, called_tel: phone, mobile: phone, enabled: z.boolean().default(true),
  default_group: z.number().int().nonnegative().default(0),
  client_release_mode: z.number().int().min(0).max(2).default(1), agent_release_mode: z.number().int().min(0).max(1).default(0),
  auto_answer: z.number().int().min(0).max(1).default(0), not_play_work_no: z.number().int().min(0).max(1).default(0),
  hook_mode: z.number().int().min(1).max(2).default(2), use_tel_agent: z.boolean().default(false),
  tel_extension: phone, auto_dial: z.boolean().default(false), auto_dial_no: phone,
}).strict();
export interface Operator { id: number; work_no: string; name: string; email: string; extension: string; enabled: number; sync_pending: number }
export async function listUsers(db: Db, vdn: number) {
  const users = await rows<Operator>(db, `SELECT u.ID AS id, u.WorkNO AS work_no, u.Name AS name, COALESCE(u.Email, '') AS email,
    COALESCE(u.ExtensionTel, '') AS extension, COALESCE(u.CalledTel, '') AS called_tel, COALESCE(u.MobileTel, '') AS mobile,
    u.IsValid AS enabled, COALESCE(u.DefaultGroup, 0) AS default_group, COALESCE(s.Pending, -1) AS sync_pending,
    COALESCE(a.ClientReleaseMode, 1) AS client_release_mode, COALESCE(a.AgentReleaseMode, 0) AS agent_release_mode,
    COALESCE(a.AutoAnswerCall, 0) AS auto_answer, COALESCE(a.NotPlayWorkNO, 0) AS not_play_work_no, CASE WHEN a.AgentHookMode = 0 THEN 2 ELSE COALESCE(a.AgentHookMode, 2) END AS hook_mode,
    COALESCE(t.IfUse, 0) AS use_tel_agent, COALESCE(t.ExtNum, '') AS tel_extension,
    COALESCE(t.IsAutoDial, 0) AS auto_dial, COALESCE(t.AutoDialNO, '') AS auto_dial_no
    FROM t_user_users u LEFT JOIN t_user_attributes a ON a.UserID = u.ID
    LEFT JOIN t_icc_telag_staticlogin t ON t.WorkNO = u.WorkNO AND t.VDNID = u.VDNID
    LEFT JOIN t_omni_access_sync s ON s.UserID = u.ID AND s.VDNID = u.VDNID
    WHERE u.VDNID = ? AND COALESCE(u.IsSystem, 0) = 0 ORDER BY u.WorkNO`, [vdn]);
  return users.map(user => ({ ...user, login_email: user.email || '' }));
}
export async function requireUser(db: Db, vdn: number, id: number) {
  const [user] = await rows<{ id: number; work_no: string; name: string; email: string; enabled: number }>(db,
    'SELECT ID AS id, WorkNO AS work_no, Name AS name, Email AS email, IsValid AS enabled FROM t_user_users WHERE ID = ? AND VDNID = ? AND COALESCE(IsSystem, 0) = 0', [id, vdn]);
  if (!user) throw new AppError(404, '操作员不存在');
  return user;
}
export async function saveUser(ctx: AccessContext, id: number | null, input: unknown) {
  const b = userSchema.parse(input);
  if (!id && !b.password) throw new AppError(422, '新建操作员必须设置密码');
  if (!b.enabled && id === ctx.agentId) throw new AppError(409, '不能停用当前登录操作员');
  const saved = await transaction(async db => {
    const previous = id ? await requireUser(db, ctx.vdnId, id) : null;
    if (previous && previous.work_no !== b.work_no) throw new AppError(422, '工号创建后不可修改');
    if (b.default_group) await requireEntity(db, ctx.vdnId, 'groups', b.default_group);
    const boundExtension = previous ? String((await rows<{extension:string}>(db, "SELECT COALESCE(ExtensionTel,'') AS extension FROM t_user_users WHERE ID=? AND VDNID=? FOR UPDATE", [id,ctx.vdnId]))[0]?.extension ?? '') : '';
    if (!Object.prototype.hasOwnProperty.call(input, 'extension')) b.extension = boundExtension;
    if (b.extension !== boundExtension) throw new AppError(409, '软件分机请通过分机绑定管理分配，操作员编辑不能修改绑定');
    if (b.extension && !(await rows(db, 'SELECT Num FROM t_icc_base_extension WHERE VDN = ? AND Num = ?', [ctx.vdnId, b.extension])).length) throw new AppError(422, '分机号不存在');
    if (b.use_tel_agent) {
      await assertVideoExtensionAvailable(db, b.tel_extension);
      if (!b.tel_extension || !(await rows(db, 'SELECT Num FROM t_icc_base_extension WHERE VDN = ? AND Num = ?', [ctx.vdnId, b.tel_extension])).length) throw new AppError(422, '请选择有效的电话坐席分机');
      if ((await rows(db, 'SELECT WorkNO FROM t_icc_telag_staticlogin WHERE VDNID = ? AND ExtNum = ? AND WorkNO <> ?', [ctx.vdnId, b.tel_extension, b.work_no])).length) throw new AppError(409, '电话坐席分机已被占用');
    }
    if ((await rows(db, confTenancyEnabled() ? 'SELECT ID FROM t_user_users WHERE WorkNO = ? AND ID <> ? AND VDNID = ?' : 'SELECT ID FROM t_user_users WHERE WorkNO = ? AND ID <> ?', confTenancyEnabled() ? [b.work_no, id ?? 0, ctx.vdnId] : [b.work_no, id ?? 0])).length) throw new AppError(409, '工号已存在（全媒体账号工号必须唯一）');
    const linkedUsers = confTenancyEnabled() ? [] : await accessScope.exit(() => prisma.users.findMany({ where: identityWhere(b.work_no, b.email), select: { id: true, uid: true, account_users: true } }));
    if (linkedUsers.length > 1 || linkedUsers.some(u => (!id || u.uid !== b.work_no) || u.account_users.some(a => a.account_id !== ctx.accountId))) throw new AppError(409, '工号或邮箱关联了其他账号，不能覆盖');
    if (!b.enabled && linkedUsers.some(u => u.account_users.some(a => a.role === 0))) throw new AppError(409, '不能在此停用全媒体系统管理员');
    const params = [b.name, b.extension, b.called_tel, b.mobile, b.email, b.enabled ? 1 : 0, b.default_group || null];
    let userId = id;
    if (id) {
      await execute(db, `UPDATE t_user_users SET Name = ?, ExtensionTel = ?, CalledTel = ?, MobileTel = ?, Email = ?, IsValid = ?, DefaultGroup = ?${b.password ? ', PassWord = ?' : ''} WHERE ID = ? AND VDNID = ?`, [...params, ...(b.password ? [b.password] : []), id, ctx.vdnId]);
    } else {
      userId = await nextId(db, 't_user_users');
      await execute(db, 'INSERT INTO t_user_users (ID, Name, ExtensionTel, CalledTel, MobileTel, Email, IsValid, DefaultGroup, WorkNO, PassWord, VDNID, IsSystem, AgentActivate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)', [userId, ...params, b.work_no, b.password, ctx.vdnId]);
      await execute(db, `INSERT IGNORE INTO t_icc_ag_personalized (AgentID, TextProcTime, PopMsgTime, MaxPageSize, TransferConnectMode, ShowLoginWindow, AutoBusyAfterTalk, AutoSigin, ShowWhenCalling, RestTime) VALUES (?, 10, 3, 10, 1, 1, 0, 1, 1, 600)`, [userId]);
    }
    if ((await rows(db, 'SELECT UserID FROM t_user_attributes WHERE UserID = ?', [userId])).length) {
      await execute(db, 'UPDATE t_user_attributes SET ClientReleaseMode = ?, AgentReleaseMode = ?, AutoAnswerCall = ?, NotPlayWorkNO = ?, AgentHookMode = ? WHERE UserID = ?', [b.client_release_mode, b.agent_release_mode, b.auto_answer, b.not_play_work_no, b.hook_mode, userId]);
    } else await execute(db, 'INSERT INTO t_user_attributes (UserID, ClientReleaseMode, AgentReleaseMode, AutoAnswerCall, IsCheckEstNum, NotPlayWorkNO, AgentHookMode) VALUES (?, ?, ?, ?, 1, ?, ?)', [userId, b.client_release_mode, b.agent_release_mode, b.auto_answer, b.not_play_work_no, b.hook_mode]);
    if (b.use_tel_agent) {
      const [credentials] = await rows<{ password: string }>(db, 'SELECT PassWord AS password FROM t_user_users WHERE ID = ?', [userId]);
      await execute(db, `INSERT INTO t_icc_telag_staticlogin (WorkNO, VDNID, Passwd, ExtNum, IfUse, IsAutoDial, AutoDialNO)
        VALUES (?, ?, ?, ?, 1, ?, ?) ON DUPLICATE KEY UPDATE Passwd = VALUES(Passwd), ExtNum = VALUES(ExtNum), IfUse = 1, IsAutoDial = VALUES(IsAutoDial), AutoDialNO = VALUES(AutoDialNO)`,
      [b.work_no, ctx.vdnId, credentials!.password, b.tel_extension, b.auto_dial ? 1 : 0, b.auto_dial_no]);
    } else await execute(db, 'UPDATE t_icc_telag_staticlogin SET IfUse = 0 WHERE WorkNO = ? AND VDNID = ?', [b.work_no, ctx.vdnId]);
    await execute(db, `INSERT INTO t_omni_access_sync (UserID, VDNID, AccountID, Pending) VALUES (?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE AccountID = VALUES(AccountID), Pending = 1`, [userId, ctx.vdnId, ctx.accountId]);
    return userId!;
  });
  return { id: saved, ...await syncUser(ctx, saved) };
}

/** Durable pending marker survives a failed PostgreSQL projection; retry never requires retyping a password. */
export async function syncUser(ctx: AccessContext, id: number) {
  if (confTenancyEnabled()) {
    const db = await database(), user = await requireUser(db, ctx.vdnId, id);
    await execute(db, 'INSERT INTO t_omni_access_sync (UserID, VDNID, AccountID, Pending) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE Pending = 1', [id, ctx.vdnId, ctx.accountId]);
    try {
      await accessScope.exit(() => syncManagedUser({ action: 'upsert', vdn_id: ctx.vdnId, source_user_id: id, work_no: user.work_no }));
      await execute(db, 'UPDATE t_omni_access_sync SET Pending = 0 WHERE UserID = ? AND VDNID = ?', [id, ctx.vdnId]);
      return { ok: true, sync_pending: false };
    } catch { return { ok: true, sync_pending: true, message: '源记录已保存，全媒体同步待重试' }; }
  }
  return transaction(async db => {
    const user = await requireUser(db, ctx.vdnId, id);
    const [privateRow] = await rows<{ password: string }>(db, 'SELECT PassWord AS password FROM t_user_users WHERE ID = ?', [id]);
    await execute(db, `INSERT INTO t_omni_access_sync (UserID, VDNID, AccountID, Pending) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE Pending = 1`, [id, ctx.vdnId, ctx.accountId]);
    try {
      // Check mappings across accounts before a trusted provisioning operation creates membership.
      const existing = await accessScope.exit(() => prisma.users.findMany({ where: identityWhere(user.work_no, user.email), include: { account_users: true } }));
      if (existing.length > 1 || existing.some(u => u.uid !== user.work_no || u.account_users.some(a => a.account_id !== ctx.accountId))) throw new Error('账号映射冲突');
      const role = existing[0]?.account_users.find(a => a.account_id === ctx.accountId)?.role === 0 ? 'administrator' : 'agent';
      await accessScope.exit(() => applyConfUserSync({ action: 'upsert', account_id: ctx.accountId, work_no: user.work_no, name: user.name, email: user.email, password: privateRow!.password, role }));
      await execute(db, 'UPDATE t_omni_access_sync SET Pending = 0 WHERE UserID = ? AND VDNID = ?', [id, ctx.vdnId]);
      return { ok: true, sync_pending: false };
    } catch {
      // ICC remains authoritative. Do not return a false rollback or leak credentials in error text.
      return { ok: true, sync_pending: true, message: '操作员已保存，全媒体账号同步未完成，请点击重新同步' };
    }
  });
}
