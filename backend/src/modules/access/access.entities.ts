import { z } from 'zod';
import { AppError } from '../../shared/errors/index.js';
import { database, rows, execute, nextId, transaction, type Db } from './access.db.js';
import { assertAcyclicParent } from './access.policy.js';
import { permissionCatalog } from './access.catalog.js';

export const kindSchema = z.enum(['departments', 'roles', 'groups', 'skills']);
export type Kind = z.infer<typeof kindSchema>;
const definitions = {
  departments: { table: 't_user_department', name: 'DepartMentName', vdn: 'VDNID', member: 't_user_usertodepart', owner: 'departid', ownerType: 2 },
  roles: { table: 't_user_role', name: 'Name', vdn: 'VDNID', member: 't_user_usertorole', owner: 'RoleID', ownerType: 1 },
  groups: { table: 't_user_group', name: 'Name', vdn: '', member: 't_user_usertogroup', owner: 'GroupID', ownerType: 0 },
  skills: { table: 't_icc_skill', name: 'Name', vdn: 'VDN', member: 't_icc_skill_skilltouser', owner: 'SkillID', ownerType: 0 },
} as const;
export interface Entity { id: number; name: string; parent_id: number; system: number; media_type_id: number; business_type_id: number; skill_element_id: number }
export async function listEntities(db: Db, vdnId: number, kind: Kind): Promise<Entity[]> {
  const d = definitions[kind];
  const extra = kind === 'departments' ? 'e.parentid AS parent_id' : kind === 'roles' ? 'e.IsSystem AS `system`' : kind === 'skills' ? 'e.MediaTypeID AS media_type_id, e.BusinessTypeID AS business_type_id, e.SkillElementID AS skill_element_id' : 'e.ParentID AS parent_id';
  return rows<Entity>(db, `SELECT e.ID AS id, e.${d.name} AS name, ${extra} FROM ${d.table} e
    ${kind === 'groups' ? 'JOIN t_icc_grouptovdn v ON v.GroupID = e.ID WHERE v.VDNID = ?' : `WHERE e.${d.vdn} = ?`} ORDER BY e.ID`, [vdnId]);
}
export async function requireEntity(db: Db, vdn: number, kind: Kind, id: number) {
  const item = (await listEntities(db, vdn, kind)).find(i => i.id === id);
  if (!item) throw new AppError(404, '记录不存在或不属于当前 VDN');
  return item;
}
const entitySchema = z.object({
  name: z.string().trim().min(1).max(50), parent_id: z.number().int().default(-1),
  media_type_id: z.number().int().positive().default(1), business_type_id: z.number().int().nonnegative().default(0),
  skill_element_id: z.number().int().nonnegative().default(0),
}).strict();
export async function saveEntity(vdn: number, kind: Kind, id: number | null, input: unknown) {
  const body = entitySchema.parse(input);
  if (kind === 'departments' && body.name.length > 20) throw new AppError(422, '部门名称最多 20 个字符');
  return transaction(async db => {
    const d = definitions[kind];
    const all = await listEntities(db, vdn, kind);
    if (id) await requireEntity(db, vdn, kind, id);
    if (all.some(e => e.id !== id && e.name.trim() === body.name)) throw new AppError(409, '名称已存在');
    if (kind === 'groups' && id) {
      const linked = await rows(db, 'SELECT VDNID FROM t_icc_grouptovdn WHERE GroupID = ? AND VDNID <> ?', [id, vdn]);
      if (linked.length) throw new AppError(409, '该坐席组被多个 VDN 共用，请在配置台维护');
    }
    if (kind === 'departments') {
      try { assertAcyclicParent(id ?? 0, body.parent_id, all); } catch (e) { throw new AppError(422, (e as Error).message); }
    }
    if (kind === 'skills') {
      if (!(await rows(db, 'SELECT ID FROM t_icc_base_mediatype WHERE ID = ?', [body.media_type_id])).length) throw new AppError(422, '媒体类型不存在');
      for (const [table, value] of [['t_icc_skill_businesstype', body.business_type_id], ['t_icc_skill_element', body.skill_element_id]] as const) {
        if (value && !(await rows(db, `SELECT ID FROM ${table} WHERE ID = ? AND VDN = ?`, [value, vdn])).length) throw new AppError(422, '技能配置不属于当前 VDN');
      }
    }
    const entityId = id ?? await nextId(db, d.table);
    if (id) {
      let sql = `UPDATE ${d.table} SET ${d.name} = ?`;
      const params: unknown[] = [body.name];
      if (kind === 'departments') { sql += ', parentid = ?'; params.push(body.parent_id); }
      if (kind === 'skills') { sql += ', MediaTypeID = ?, BusinessTypeID = ?, SkillElementID = ?'; params.push(body.media_type_id, body.business_type_id, body.skill_element_id); }
      await execute(db, `${sql} WHERE ID = ?`, [...params, id]);
    } else if (kind === 'departments') {
      await execute(db, 'INSERT INTO t_user_department (ID, DepartMentName, parentid, VDNID) VALUES (?, ?, ?, ?)', [entityId, body.name, body.parent_id, vdn]);
    } else if (kind === 'roles') {
      await execute(db, 'INSERT INTO t_user_role (ID, Name, IsSystem, VDNID) VALUES (?, ?, 0, ?)', [entityId, body.name, vdn]);
    } else if (kind === 'groups') {
      await execute(db, 'INSERT INTO t_user_group (ID, Name) VALUES (?, ?)', [entityId, body.name]);
      await execute(db, 'INSERT INTO t_icc_grouptovdn (ID, GroupID, VDNID) VALUES (?, ?, ?)', [await nextId(db, 't_icc_grouptovdn'), entityId, vdn]);
    } else {
      await execute(db, 'INSERT INTO t_icc_skill (ID, Name, MediaTypeID, BusinessTypeID, SkillElementID, VDN) VALUES (?, ?, ?, ?, ?, ?)',
        [entityId, body.name, body.media_type_id, body.business_type_id, body.skill_element_id, vdn]);
    }
    return { id: entityId };
  });
}
export async function deleteEntity(vdn: number, kind: Kind, id: number) {
  return transaction(async db => {
    const entity = await requireEntity(db, vdn, kind, id);
    if (entity.system) throw new AppError(409, '系统角色不能删除');
    const d = definitions[kind];
    // Keep references intact; users explicitly remove memberships first.
    if ((await rows(db, `SELECT 1 FROM ${d.member} WHERE ${d.owner} = ? LIMIT 1`, [id])).length) throw new AppError(409, '请先移除该项下的人员');
    if (kind === 'departments' && (await listEntities(db, vdn, kind)).some(e => e.parent_id === id)) throw new AppError(409, '请先处理下级部门');
    if (kind === 'groups') {
      if ((await rows(db, 'SELECT 1 FROM t_icc_grouptovdn WHERE GroupID = ? AND VDNID <> ?', [id, vdn])).length) throw new AppError(409, '该坐席组被其他 VDN 共用');
      if ((await rows(db, 'SELECT 1 FROM t_user_users WHERE DefaultGroup = ? LIMIT 1', [id])).length) throw new AppError(409, '该坐席组仍是操作员的默认组');
      if (await hasQueueReference(db, 'groups', id)) throw new AppError(409, '请先在配置台解除坐席组与技能的绑定');
      await execute(db, 'DELETE FROM t_icc_grouptovdn WHERE GroupID = ? AND VDNID = ?', [id, vdn]);
    }
    if (kind === 'skills' && await hasQueueReference(db, 'skills', id)) throw new AppError(409, '请先在配置台解除技能与坐席组的绑定');
    if (d.ownerType) {
      await execute(db, 'DELETE FROM t_omni_access_scope WHERE OwnerType = ? AND OwnerId = ? AND VDNID = ?', [d.ownerType, id, vdn]);
      await execute(db, 'DELETE FROM t_user_grantpower WHERE OwnerType = ? AND OwnerId = ? AND VDNID = ?', [d.ownerType, id, vdn]);
    }
    await execute(db, `DELETE FROM ${d.table} WHERE ID = ?`, [id]);
    return { ok: true };
  });
}
async function hasQueueReference(db: Db, kind: 'groups' | 'skills', id: number) {
  const column = kind === 'groups' ? 'GroupID' : 'SkillID';
  if ((await rows(db, `SELECT 1 FROM t_icc_acd_skillqueue WHERE ${column} = ? LIMIT 1`, [id])).length) return true;
  const tables = await rows(db, "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 't_group_skill'");
  return tables.length > 0 && (await rows(db, `SELECT 1 FROM t_group_skill WHERE ${kind === 'groups' ? 'group_id' : 'skill_id'} = ? LIMIT 1`, [id])).length > 0;
}
export async function memberIds(db: Db, vdn: number, kind: Kind, id: number) {
  await requireEntity(db, vdn, kind, id);
  const d = definitions[kind];
  const result = await rows<{ id: number }>(db, `SELECT DISTINCT u.ID AS id FROM ${d.member} m JOIN t_user_users u ON u.ID = m.UserID
    WHERE m.${d.owner} = ? AND u.VDNID = ? ${kind === 'skills' ? '' : 'AND m.VDNID = ?'}`, kind === 'skills' ? [id, vdn] : [id, vdn, vdn]);
  return result.map(r => Number(r.id));
}
export const memberSchema = z.object({ action: z.enum(['add', 'remove']), user_ids: z.array(z.number().int().positive()).min(1).max(2000) }).strict();
export async function changeMembers(vdn: number, kind: Kind, id: number, input: unknown) {
  const body = memberSchema.parse(input);
  return transaction(async db => {
    await requireEntity(db, vdn, kind, id);
    const d = definitions[kind];
    const ids = [...new Set(body.user_ids)];
    const marks = ids.map(() => '?').join(',');
    const users = await rows(db, `SELECT ID FROM t_user_users WHERE VDNID = ? AND ID IN (${marks})`, [vdn, ...ids]);
    if (users.length !== ids.length) throw new AppError(422, '人员不存在或不属于当前 VDN');
    if (body.action === 'add' && kind === 'skills') {
      const skill = await requireEntity(db, vdn, kind, id);
      const [group] = await rows<{ id: number }>(db, `SELECT g.ID AS id FROM t_user_group g JOIN t_icc_grouptovdn v ON v.GroupID = g.ID WHERE v.VDNID = ? AND TRIM(g.Name) = ?`, [vdn, skill.name.trim()]);
      if (!group) throw new AppError(422, '请先建立同名坐席组并加入人员，再分配技能');
      const members = await memberIds(db, vdn, 'groups', group.id);
      if (ids.some(uid => !members.includes(uid))) throw new AppError(422, '所选人员须先加入同名坐席组');
    }
    const current = new Set(await memberIds(db, vdn, kind, id));
    if (body.action === 'remove' && kind === 'groups') {
      const group = await requireEntity(db, vdn, kind, id);
      const references = await rows(db, `SELECT 1 FROM t_icc_skill_skilltouser su JOIN t_icc_skill s ON s.ID = su.SkillID
        WHERE s.VDN = ? AND TRIM(s.Name) = ? AND su.UserID IN (${marks}) LIMIT 1`, [vdn, group.name.trim(), ...ids]);
      if (references.length) throw new AppError(409, '请先将所选人员从同名技能组中移除');
    }
    for (const uid of ids) {
      if (body.action === 'remove') {
        await execute(db, `DELETE FROM ${d.member} WHERE ${d.owner} = ? AND UserID = ? ${kind === 'skills' ? '' : 'AND VDNID = ?'}`, kind === 'skills' ? [id, uid] : [id, uid, vdn]);
      } else if (!current.has(uid)) {
        if (kind === 'skills') await execute(db, `INSERT INTO ${d.member} (SkillID, UserID, Level, AutoCheckIn) VALUES (?, ?, 1, 1)`, [id, uid]);
        else await execute(db, `INSERT INTO ${d.member} (${d.owner}, UserID, VDNID) VALUES (?, ?, ?)`, [id, uid, vdn]);
      }
    }
    return { ok: true, member_ids: await memberIds(db, vdn, kind, id) };
  });
}

export async function permissionsCatalog() {
  const catalog = await rows<{ id: number; name: string; value: number; subsystem: number; category: string }>(await database(), `SELECT p.ID AS id, p.Name AS name, p.Value AS value,
    p.SubSystemType AS subsystem, COALESCE(s.SUBSYSEMTYPE, CONCAT('子系统 ', p.SubSystemType)) AS category
    FROM t_user_power p LEFT JOIN t_user_subsysemtype s ON s.ID = p.SubSystemType ORDER BY p.SubSystemType, p.Value, p.ID`);
  return catalog.filter(p => p.subsystem !== 90 || p.value === 1 || p.value >= 100).map(p => ({ ...p, ...(p.subsystem === 90 ? permissionCatalog.find(c => c.value === p.value) : {}), id: p.id }));
}
export async function ownScopes(db: Db, vdn: number, kind: Kind | 'users', id: number) {
  const owner = kind === 'users' ? 3 : definitions[kind].ownerType;
  const result = await rows<{ power_id: number; data_scope: string }>(db, 'SELECT PowerId AS power_id, ScopeType AS data_scope FROM t_omni_access_scope WHERE VDNID = ? AND OwnerType = ? AND OwnerId = ?', [vdn, owner, id]);
  return Object.fromEntries(result.map(r => [r.power_id, r.data_scope]));
}
export async function ownPermissionIds(db: Db, vdn: number, kind: Kind | 'users', id: number) {
  const owner = kind === 'users' ? 3 : definitions[kind].ownerType;
  if (!owner) throw new AppError(422, '该类型不支持授权');
  const result = await rows<{ id: number }>(db, 'SELECT DISTINCT PowerId AS id FROM t_user_grantpower WHERE OwnerType = ? AND OwnerId = ? AND IsOwn = 1 AND VDNID = ?', [owner, id, vdn]);
  return result.map(r => r.id);
}
export async function changePermission(vdn: number, kind: Kind | 'users', id: number, input: unknown) {
  const { permission_id, granted, data_scope } = z.object({ permission_id: z.number().int().positive(), granted: z.boolean(), data_scope: z.enum(['self', 'group', 'department', 'account']).optional() }).strict().parse(input);
  return transaction(async db => {
    if (kind === 'users') {
      if (!(await rows(db, 'SELECT ID FROM t_user_users WHERE ID = ? AND VDNID = ?', [id, vdn])).length) throw new AppError(404, '操作员不存在');
    } else await requireEntity(db, vdn, kind, id);
    const owner = kind === 'users' ? 3 : definitions[kind].ownerType;
    if (!owner) throw new AppError(422, '该类型不支持授权');
    const [power] = await rows<{ value: number; subsystem: number }>(db, 'SELECT Value AS value, SubSystemType AS subsystem FROM t_user_power WHERE ID = ?', [permission_id]);
    if (!power) throw new AppError(422, '权限不存在');
    const definition = power.subsystem === 90 ? permissionCatalog.find(p => p.value === power.value) : undefined;
    const scope = data_scope ?? definition?.scopes[0] ?? 'account';
    if (data_scope && (!definition || !definition.scopes.includes(data_scope))) throw new AppError(422, '此权限不支持所选数据范围');
    await execute(db, 'DELETE FROM t_omni_access_scope WHERE VDNID = ? AND OwnerType = ? AND OwnerId = ? AND PowerId = ?', [vdn, owner, id, permission_id]);
    if (granted && definition) await execute(db, 'INSERT INTO t_omni_access_scope (VDNID, OwnerType, OwnerId, PowerId, ScopeType) VALUES (?, ?, ?, ?, ?)', [vdn, owner, id, permission_id, scope]);
    await execute(db, 'DELETE FROM t_user_grantpower WHERE OwnerType = ? AND OwnerId = ? AND PowerId = ? AND VDNID = ?', [owner, id, permission_id, vdn]);
    if (granted) await execute(db, 'INSERT INTO t_user_grantpower (OwnerType, OwnerId, PowerId, IsOwn, VDNID) VALUES (?, ?, ?, 1, ?)', [owner, id, permission_id, vdn]);
    return { ok: true };
  });
}
