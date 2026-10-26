import type { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getIccMysqlPool } from '../../shared/services/icc-groups-dal.js';
import { AppError } from '../../shared/errors/index.js';

export type Db = Pick<PoolConnection, 'query'>;
export async function database() {
  const pool = await getIccMysqlPool();
  if (!pool) throw new AppError(503, 'ICC 配置数据库不可用');
  return pool;
}
export async function rows<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const [result] = await db.query<RowDataPacket[]>(sql, params);
  return result as T[];
}
export async function execute(db: Db, sql: string, params: unknown[] = []) {
  const [result] = await db.query<ResultSetHeader>(sql, params);
  return result;
}
/** ICC legacy IDs are manually allocated. Serialize our writers across processes. */
export async function transaction<T>(fn: (db: PoolConnection) => Promise<T>): Promise<T> {
  const db = await (await database()).getConnection();
  let locked = false;
  try {
    const [lock] = await rows<{ acquired: number }>(db, "SELECT GET_LOCK('omniagent.access.write', 10) AS acquired");
    if (lock?.acquired !== 1) throw new AppError(409, '其他管理员正在保存，请稍后重试');
    locked = true;
    await db.beginTransaction();
    const result = await fn(db);
    await db.commit();
    return result;
  } catch (error) {
    await db.rollback();
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new AppError(409, '工号、名称或分机号已存在，请刷新后重试');
    throw error;
  } finally {
    if (locked) await db.query("SELECT RELEASE_LOCK('omniagent.access.write')").catch(() => undefined);
    db.release();
  }
}

// Only callers with static table names may use this helper.
export async function nextId(db: Db, table: string) {
  const reservations: Record<string, string[]> = {
    t_user_role: ['SELECT MAX(RoleID) AS id FROM t_user_usertorole', 'SELECT MAX(OwnerId) AS id FROM t_user_grantpower WHERE OwnerType=1', 'SELECT MAX(OwnerId) AS id FROM t_omni_access_scope WHERE OwnerType=1'],
    t_user_department: ['SELECT MAX(departid) AS id FROM t_user_usertodepart', 'SELECT MAX(parentid) AS id FROM t_user_department', 'SELECT MAX(OwnerId) AS id FROM t_user_grantpower WHERE OwnerType=2', 'SELECT MAX(OwnerId) AS id FROM t_omni_access_scope WHERE OwnerType=2'],
    t_user_group: ['SELECT MAX(GroupID) AS id FROM t_user_usertogroup', 'SELECT MAX(GroupID) AS id FROM t_icc_grouptovdn', 'SELECT MAX(DefaultGroup) AS id FROM t_user_users'],
    t_icc_skill: ['SELECT MAX(SkillID) AS id FROM t_icc_skill_skilltouser'],
    t_user_users: ['t_user_usertorole', 't_user_usertodepart', 't_user_usertogroup', 't_icc_skill_skilltouser', 't_user_attributes', 't_omni_access_sync'].map(t => `SELECT MAX(UserID) AS id FROM ${t}`).concat(['SELECT MAX(AgentID) AS id FROM t_icc_ag_personalized', 'SELECT MAX(OwnerId) AS id FROM t_user_grantpower WHERE OwnerType=3', 'SELECT MAX(OwnerId) AS id FROM t_omni_access_scope WHERE OwnerType=3']),
  };
  if (reservations[table]) {
    // Imported ICC databases can contain memberships referencing deleted roles.
    // Reusing their IDs would silently grant the new role to those operators.
    const reserved = reservations[table].map(sql => sql.replace(/MAX\((\w+)\)/g, 'MAX(CAST($1 AS SIGNED))'));
    const [r] = await rows<{ id: number }>(db, `SELECT GREATEST(COALESCE(MAX(CAST(id AS SIGNED)),0),0)+1 AS id FROM (SELECT MAX(ID) AS id FROM ${table} UNION ALL ${reserved.join(' UNION ALL ')}) reserved`);
    return Number(r!.id);
  }
  const [r] = await rows<{ id: number }>(db, `SELECT COALESCE(MAX(ID), 0) + 1 AS id FROM ${table}`);
  return Number(r!.id);
}
