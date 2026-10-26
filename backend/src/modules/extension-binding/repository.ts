import { assertVideoExtensionAvailable, reservedVideoExtensions } from '../../shared/services/video-agent-config.js';
import { env } from '../../config/env.js';
import { randomUUID } from 'node:crypto';
import { database, execute, rows, transaction, type Db } from '../access/access.db.js';
import { AppError } from '../../shared/errors/index.js';
import { bindingAction } from './policy.js';
export { database, execute, rows, transaction };
export interface Binding {
  user_id: number;
  work_no: string;
  extension: string;
  version: number;
  enabled: number;
}
export interface ExtensionRequest {
  id: string;
  user_id: number;
  actor_id: number;
  vdn_id: number;
  action: string;
  old_extension: string;
  target_extension: string;
  expected_version: number;
  status: string;
  reason: string;
}
export interface Operation {
  id: string;
  vdn_id: number;
  user_id: number;
  actor_id: number;
  self_operation: number;
  omni_user_id: number | null;
  login_sid: string | null;
  request_id: string | null;
  old_extension: string;
  target_extension: string;
  expected_version: number;
  phase: string;
  error: string;
  notified_at: string | null;
}
const requestColumns =
  'ID AS id, UserID AS user_id, ActorID AS actor_id, VDNID AS vdn_id, Action AS action, OldNum AS old_extension, TargetNum AS target_extension, ExpectedVersion AS expected_version, Status AS status, Reason AS reason';
const operationColumns =
  'ID AS id, VDNID AS vdn_id, UserID AS user_id, ActorID AS actor_id, SelfOperation AS self_operation, OmniUserID AS omni_user_id, LoginSID AS login_sid, RequestID AS request_id, OldNum AS old_extension, TargetNum AS target_extension, ExpectedVersion AS expected_version, Phase AS phase, Error AS error, NotifiedAt AS notified_at';
export async function readBinding(
  db: Db,
  vdn: number,
  userId: number,
  lock = false,
): Promise<Binding> {
  if (lock)
    await execute(db, 'INSERT IGNORE INTO t_omni_extension_binding (VDNID,UserID) VALUES (?,?)', [
      vdn,
      userId,
    ]);
  const users = await rows<Binding>(
    db,
    `SELECT u.ID AS user_id, u.WorkNO AS work_no, COALESCE(u.ExtensionTel,'') AS extension, COALESCE(b.Version,0) AS version, u.IsValid AS enabled FROM t_user_users u LEFT JOIN t_omni_extension_binding b ON b.UserID=u.ID AND b.VDNID=u.VDNID WHERE u.ID=? AND u.VDNID=? AND COALESCE(u.IsSystem,0)=0${lock ? ' FOR UPDATE' : ''}`,
    [userId, vdn],
  );
  const user = users.length === 1 ? users[0] : undefined;
  if (!user || Number(user.enabled) !== 1)
    throw new AppError(403, '坐席不存在、已停用或不属于当前 VDN');
  return {
    ...user,
    user_id: Number(user.user_id),
    version: Number(user.version),
    extension: user.extension.trim(),
  };
}
export async function requireAvailable(
  db: Db,
  vdn: number,
  num: string,
  userId: number,
  ownOperation?: string,
): Promise<void> {
  if (!num) return;
  await assertVideoExtensionAvailable(db, num);
  const ext = await rows<{ vdn: number; enabled: number; device: number }>(
    db,
    'SELECT VDN AS vdn, IsValid AS enabled, Device AS device FROM t_icc_base_extension WHERE Num=? FOR UPDATE',
    [num],
  );
  if (ext.length !== 1 || Number(ext[0]!.vdn) !== vdn || Number(ext[0]!.enabled) !== 1)
    throw new AppError(409, '软件分机不存在、停用或不属于当前 VDN', 'extension_invalid');
  const realm = env.SIP_REALM || env.SIP_SBC_HOST;
  const sip = await rows(
    db,
    `SELECT username FROM t_icc_sip_directory WHERE username=? AND vdn_id=? AND enabled=1 AND password<>''${realm ? ' AND domain=?' : ''} LIMIT 1`,
    realm ? [num, vdn, realm] : [num, vdn],
  );
  if (!sip.length) throw new AppError(409, '分机尚未配置有效 SIP 凭据', 'extension_sip_missing');
  const owners = await rows(
    db,
    'SELECT ID FROM t_user_users WHERE ExtensionTel=? AND NOT (ID=? AND VDNID=?) UNION ALL SELECT id FROM t_icc_telag_staticlogin WHERE ExtNum=? AND IfUse=1',
    [num, userId, vdn, num],
  );
  if (owners.length)
    throw new AppError(409, '分机已分配或由电话坐席自动签入占用', 'extension_occupied');
  const reserved = await rows(
    db,
    'SELECT ID FROM t_omni_extension_operation WHERE ActiveTargetNum=? AND ID<>?',
    [num, ownOperation ?? ''],
  );
  if (reserved.length) throw new AppError(409, '分机正在分配，请稍后重试', 'extension_reserved');
}
export async function bindingConflict(
  db: Db,
  vdn: number,
  binding: Binding,
): Promise<string | null> {
  if (!binding.extension) return null;
  try {
    await requireAvailable(db, vdn, binding.extension, binding.user_id);
    return null;
  } catch (e) {
    if (e instanceof AppError && e.statusCode === 409) return e.message;
    throw e;
  }
}
export async function extensionOptions(db: Db, vdn: number) {
  const realm = env.SIP_REALM || env.SIP_SBC_HOST;
  const options = await rows<{ num: string; description: string }>(
    db,
    `SELECT e.Num AS num, e.Description AS description FROM t_icc_base_extension e WHERE e.VDN=? AND e.IsValid=1
    AND EXISTS(SELECT 1 FROM t_icc_sip_directory d WHERE d.username=e.Num AND d.vdn_id=e.VDN AND d.enabled=1 AND d.password<>''${realm ? ' AND d.domain=?' : ''})
    AND NOT EXISTS(SELECT 1 FROM t_user_users u WHERE u.ExtensionTel=e.Num)
    AND NOT EXISTS(SELECT 1 FROM t_icc_telag_staticlogin t WHERE t.ExtNum=e.Num AND t.IfUse=1)
    AND NOT EXISTS(SELECT 1 FROM t_omni_extension_operation o WHERE o.ActiveTargetNum=e.Num) AND NOT EXISTS(SELECT 1 FROM t_icc_base_extension other WHERE other.Num=e.Num AND other.VDN<>e.VDN) ORDER BY e.Num`,
    realm ? [vdn, realm] : [vdn],
  );
  const reserved = await reservedVideoExtensions(db);
  return options.filter(option => !reserved.has(option.num));
}
export async function requestById(db: Db, vdn: number, id: string, lock = false) {
  const [r] = await rows<ExtensionRequest>(
    db,
    `SELECT ${requestColumns} FROM t_omni_extension_request WHERE ID=? AND VDNID=?${lock ? ' FOR UPDATE' : ''}`,
    [id, vdn],
  );
  if (!r) throw new AppError(404, '申请不存在');
  return r;
}
export const pendingRequest = async (db: Db, vdn: number, user: number) =>
  (
    await rows<ExtensionRequest>(
      db,
      `SELECT ${requestColumns} FROM t_omni_extension_request WHERE VDNID=? AND PendingUserID=?`,
      [vdn, user],
    )
  )[0] ?? null;
export const requestList = async (db: Db, vdn: number) =>
  rows<ExtensionRequest>(
    db,
    `SELECT ${requestColumns} FROM t_omni_extension_request WHERE VDNID=? ORDER BY CreatedAt DESC LIMIT 200`,
    [vdn],
  );
export const readOperation = async (db: Db, id: string) =>
  (
    await rows<Operation>(
      db,
      `SELECT ${operationColumns} FROM t_omni_extension_operation WHERE ID=?`,
      [id],
    )
  )[0];
export const activeOperation = async (db: Db, vdn: number, user: number) =>
  (
    await rows<Operation>(
      db,
      `SELECT ${operationColumns} FROM t_omni_extension_operation WHERE VDNID=? AND ActiveUserID=?`,
      [vdn, user],
    )
  )[0] ?? null;
export const operationByKey = async (db: Db, vdn: number, user: number, key: string) =>
  (
    await rows<Operation>(
      db,
      `SELECT ${operationColumns} FROM t_omni_extension_operation WHERE VDNID=? AND UserID=? AND IdempotencyKey=?`,
      [vdn, user, key],
    )
  )[0];
export async function newRequest(
  db: Db,
  vdn: number,
  actor: number,
  b: Binding,
  target: string,
  key: string,
) {
  const [existing] = await rows<ExtensionRequest>(
    db,
    `SELECT ${requestColumns} FROM t_omni_extension_request WHERE VDNID=? AND UserID=? AND IdempotencyKey=?`,
    [vdn, b.user_id, key],
  );
  if (existing) {
    if (existing.target_extension !== target || Number(existing.expected_version) !== b.version)
      throw new AppError(409, '幂等键已用于不同的申请');
    return existing;
  }
  if ((await pendingRequest(db, vdn, b.user_id)) || (await activeOperation(db, vdn, b.user_id)))
    throw new AppError(409, '已有待处理申请或变更，请撤销申请或等待变更完成');
  const id = randomUUID();
  await execute(
    db,
    'INSERT INTO t_omni_extension_request (ID,VDNID,UserID,ActorID,Action,OldNum,TargetNum,ExpectedVersion,IdempotencyKey) VALUES (?,?,?,?,?,?,?,?,?)',
    [
      id,
      vdn,
      b.user_id,
      actor,
      bindingAction(b.extension, target),
      b.extension,
      target,
      b.version,
      key,
    ],
  );
  await requestAudit(db, vdn, id, actor, 'submitted');
  return requestById(db, vdn, id);
}
export async function createOperation(
  db: Db,
  input: {
    vdn: number;
    actor: number;
    b: Binding;
    target: string;
    key: string;
    self?: boolean;
    omniUserId?: number;
    sid?: string;
    requestId?: string;
  },
): Promise<Operation> {
  const id = randomUUID();
  const { vdn, actor, b, target, key } = input;
  await execute(
    db,
    'INSERT INTO t_omni_extension_operation (ID,VDNID,UserID,ActorID,SelfOperation,OmniUserID,LoginSID,RequestID,OldNum,TargetNum,ExpectedVersion,IdempotencyKey) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [
      id,
      vdn,
      b.user_id,
      actor,
      input.self ? 1 : 0,
      input.omniUserId ?? null,
      input.sid ?? null,
      input.requestId ?? null,
      b.extension,
      target,
      b.version,
      key,
    ],
  );
  await execute(
    db,
    "INSERT INTO t_omni_extension_audit (VDNID,UserID,ActorID,OperationID,RequestID,Action,OldNum,TargetNum,BindingVersion,Result) VALUES (?,?,?,?,?,'reserved',?,?,?,'success')",
    [vdn, b.user_id, actor, id, input.requestId ?? null, b.extension, target, b.version],
  );
  return (await readOperation(db, id))!;
}
export async function phase(id: string, next: string, error = '') {
  await transaction(async (db) => {
    await execute(
      db,
      'UPDATE t_omni_extension_operation SET Phase=?,Error=?,UpdatedAt=CURRENT_TIMESTAMP(3) WHERE ID=?',
      [next, error.slice(0, 500), id],
    );
    await execute(
      db,
      `INSERT INTO t_omni_extension_audit (VDNID,UserID,ActorID,OperationID,RequestID,Action,OldNum,TargetNum,BindingVersion,Result,Reason)
      SELECT o.VDNID,o.UserID,COALESCE(r.ReviewerID,o.ActorID),o.ID,o.RequestID,?,o.OldNum,o.TargetNum,o.ExpectedVersion,?,? FROM t_omni_extension_operation o LEFT JOIN t_omni_extension_request r ON r.ID=o.RequestID WHERE o.ID=?`,
      [next, error ? 'retryable' : 'success', error.slice(0, 500), id],
    );
  });
}
export async function requestAudit(
  db: Db,
  vdn: number,
  id: string,
  actor: number,
  result: string,
  reason = '',
) {
  await execute(
    db,
    `INSERT INTO t_omni_extension_audit (VDNID,UserID,ActorID,RequestID,Action,OldNum,TargetNum,BindingVersion,Result,Reason) SELECT VDNID,UserID,?,ID,Action,OldNum,TargetNum,ExpectedVersion,?,? FROM t_omni_extension_request WHERE ID=? AND VDNID=?`,
    [actor, result, reason.slice(0, 500), id, vdn],
  );
}
export async function commitOperation(op: Operation) {
  return transaction(async (db) => {
    const current = await readBinding(db, op.vdn_id, op.user_id, true);
    if (current.version !== Number(op.expected_version) || current.extension !== op.old_extension)
      throw new AppError(409, '执行期间绑定版本已变化，需管理员修复');
    await requireAvailable(db, op.vdn_id, op.target_extension, op.user_id, op.id);
    await execute(db, 'SET @omni_extension_operation_id=?', [op.id]);
    try {
      await execute(db, 'UPDATE t_user_users SET ExtensionTel=? WHERE ID=? AND VDNID=?', [
        op.target_extension,
        op.user_id,
        op.vdn_id,
      ]);
    } finally {
      await execute(db, 'SET @omni_extension_operation_id=NULL');
    }
    await execute(
      db,
      'UPDATE t_omni_extension_binding SET Version=Version+1, ModifiedAt=CURRENT_TIMESTAMP(3) WHERE VDNID=? AND UserID=?',
      [op.vdn_id, op.user_id],
    );
    await execute(
      db,
      "UPDATE t_omni_extension_operation SET Phase='committed',Error='',UpdatedAt=CURRENT_TIMESTAMP(3) WHERE ID=?",
      [op.id],
    );
    if (op.request_id) {
      await execute(
        db,
        "UPDATE t_omni_extension_request SET Status='approved',ReviewedAt=CURRENT_TIMESTAMP(3) WHERE ID=?",
        [op.request_id],
      );
      await requestAudit(db, op.vdn_id, op.request_id, op.actor_id, 'approved');
    }
    await execute(
      db,
      "INSERT INTO t_omni_extension_audit (VDNID,UserID,ActorID,OperationID,RequestID,Action,OldNum,TargetNum,BindingVersion,Result) VALUES (?,?,?,?,?,'committed',?,?,?,'success')",
      [
        op.vdn_id,
        op.user_id,
        op.actor_id,
        op.id,
        op.request_id,
        op.old_extension,
        op.target_extension,
        current.version + 1,
      ],
    );
    return { ...current, extension: op.target_extension, version: current.version + 1 };
  });
}

export async function withVoiceLock<T>(
  user: number | undefined,
  action: () => Promise<T>,
): Promise<T> {
  if (!user) return action();
  const db = await (await database()).getConnection(),
    name = 'omni.extension.voice.' + user;
  let locked = false;
  try {
    const [r] = await rows<{ acquired: number }>(db, 'SELECT GET_LOCK(?,0) AS acquired', [name]);
    if (r?.acquired !== 1) throw new AppError(409, '话务或分机正在处理，请稍后重试');
    locked = true;
    return await action();
  } finally {
    if (locked) await db.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => undefined);
    db.release();
  }
}
