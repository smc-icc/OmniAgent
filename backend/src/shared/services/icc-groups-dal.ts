/**
 * 与 CCS-Fucus 对齐的坐席组数据源。
 * Fucus: MYSQL_TABLE_AGENTGROUP =
 *   SELECT t_user_group.ID, t_user_group.Name, t_icip_grouptovdn.VDNID
 *   FROM t_user_group, t_icip_grouptovdn
 *   WHERE t_icip_grouptovdn.GroupID = t_user_group.ID
 * icc 表名为 t_icc_grouptovdn（等价）。
 */
import { displayGroupName, type CcsGroupInfo } from './agent-skill-groups.js';
import { mediaKind, uniqueMediaKinds, type MediaKind } from './media-kind.js';

type MysqlRow = { id: number; name: string };

let pool: import('mysql2/promise').Pool | null = null;

function iccMysqlEnabled(): boolean {
  return process.env.ICC_MYSQL_DISABLED !== '1';
}

export async function getIccMysqlPool(): Promise<import('mysql2/promise').Pool | null> {
  return getPool();
}

async function getPool(): Promise<import('mysql2/promise').Pool | null> {
  if (!iccMysqlEnabled()) return null;
  if (pool) return pool;
  try {
    const mysql = await import('mysql2/promise');
    pool = mysql.createPool({
      host: process.env.ICC_MYSQL_HOST || '172.22.0.3',
      port: Number(process.env.ICC_MYSQL_PORT || 3306),
      user: process.env.ICC_MYSQL_USER || 'root',
      password: process.env.ICC_MYSQL_PASSWORD || 'ChangeMe123!',
      database: process.env.ICC_MYSQL_DB || 'icc',
      charset: 'utf8mb4',
      connectionLimit: 4,
    });
    return pool;
  } catch (e) {
    console.error('[icc-groups] mysql2 unavailable', e);
    return null;
  }
}

/** 按 VDN 拉组列表（Fucus GetAgentGroup / GetAllGroupInfo 同源）。 */
export async function loadGroupsByVdnFromIccDb(vdnId: number): Promise<CcsGroupInfo[]> {
  const p = await getPool();
  if (!p) return [];
  const sql = `
    SELECT g.ID AS id, g.Name AS name
    FROM t_user_group g
    INNER JOIN t_icc_grouptovdn v ON v.GroupID = g.ID
    WHERE v.VDNID = ?
    ORDER BY g.ID`;
  try {
    const [rows] = await p.query<MysqlRow[] & import('mysql2').RowDataPacket[]>(sql, [vdnId]);
    return (rows as MysqlRow[]).map((r) => ({
      id: Number(r.id),
      name: displayGroupName(r.name, Number(r.id)),
    }));
  } catch (e) {
    console.error('[icc-groups] loadGroupsByVdn failed', e);
    return [];
  }
}

/**
 * 按坐席工号拉其隶属组（Fucus 登录后 m_GroupIDInDB / AutoCheckIn 同源）。
 * 来自 t_user_usertogroup + t_user_group + t_user_users。
 */
export async function loadAgentMembershipGroups(workNo: string, vdnId: number): Promise<CcsGroupInfo[]> {
  const p = await getPool();
  if (!p || !workNo) return [];
  const sql = `
    SELECT g.ID AS id, g.Name AS name
    FROM t_user_users u
    INNER JOIN t_user_usertogroup ug ON ug.UserID = u.ID
    INNER JOIN t_user_group g ON g.ID = ug.GroupID
    INNER JOIN t_icc_grouptovdn v ON v.GroupID = g.ID AND v.VDNID = ?
    WHERE u.WorkNO = ?
    ORDER BY g.ID`;
  try {
    const [rows] = await p.query<MysqlRow[] & import('mysql2').RowDataPacket[]>(sql, [vdnId, workNo]);
    return (rows as MysqlRow[]).map((r) => ({
      id: Number(r.id),
      name: displayGroupName(r.name, Number(r.id)),
    }));
  } catch (e) {
    console.error('[icc-groups] loadAgentMembershipGroups failed', e);
    return [];
  }
}

/** ICC 角色「班长」固定 ID（t_user_role.Name=班长）。 */
export const ICC_LEADER_ROLE_ID = 7;

/**
 * 当前 VDN 下挂了班长角色的坐席 UserID（= CCS AgentID）列表。
 * 申请小休审批人只能从这里选，禁止随便抓在线席。
 */
export async function loadLeaderAgentIdsFromIccDb(vdnId: number): Promise<Set<number>> {
  const p = await getPool();
  if (!p) return new Set();
  const vdn = vdnId > 0 ? vdnId : 1;
  const sql = `
    SELECT DISTINCT ur.UserID AS id
    FROM t_user_usertorole ur
    INNER JOIN t_user_users u ON u.ID = ur.UserID AND u.IsValid = 1
    WHERE ur.RoleID = ?
      AND (ur.VDNID = ? OR ur.VDNID <= 0)
      AND (u.VDNID = ? OR u.VDNID <= 0 OR u.VDNID = -1)
    ORDER BY ur.UserID`;
  try {
    const [rows] = await p.query<{ id: number }[] & import('mysql2').RowDataPacket[]>(sql, [
      ICC_LEADER_ROLE_ID,
      vdn,
      vdn,
    ]);
    return new Set((rows as { id: number }[]).map((r) => Number(r.id)).filter((id) => id > 0));
  } catch (e) {
    console.error('[icc-groups] loadLeaderAgentIds failed', e);
    return new Set();
  }
}

/** VDN 全媒体默认 ITR 流程；列不存在或值为 0 时返回 0（由调用方回落到环境变量）。 */
export async function loadVdnDefaultItrFlowId(vdnId: number): Promise<number> {
  const p = await getPool();
  if (!p || !(vdnId > 0)) return 0;
  try {
    const [rows] = await p.query<{ flowId?: number }[] & import('mysql2').RowDataPacket[]>(
      `SELECT ItrDefaultFlowId AS flowId FROM t_icc_vdn WHERE ID = ? LIMIT 1`,
      [vdnId],
    );
    const n = Number((rows as { flowId?: number }[])?.[0]?.flowId || 0);
    return n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** VDN 配置的 ASR 引擎；未知值按平台默认回落到 FunASR。 */
export async function loadVdnAsrEngine(
  vdnId: number,
): Promise<'funasr' | 'whisper'> {
  const p = await getPool();
  if (!p || !(vdnId > 0)) return 'funasr';
  try {
    const [rows] = await p.query<
      { engine?: string }[] & import('mysql2').RowDataPacket[]
    >(
      `SELECT AsrEngine AS engine FROM t_icc_vdn WHERE ID = ? LIMIT 1`,
      [vdnId],
    );
    return String((rows as { engine?: string }[])?.[0]?.engine ?? '')
      .trim()
      .toLowerCase() === 'whisper'
      ? 'whisper'
      : 'funasr';
  } catch (e) {
    console.warn('[icc-groups] loadVdnAsrEngine fallback=funasr', e);
    return 'funasr';
  }
}

export type GroupSkillRow = {
  groupId: number;
  groupName: string;
  skillId: number;
  skillName: string;
  mediaTypeId: number;
};

export type GroupSkillMatrixItem = {
  id: number;
  name: string;
  mediaKinds: MediaKind[];
  skills: Array<{ id: number; name: string; mediaTypeId: number; kind: MediaKind | null }>;
};

/** 业务组 × 技能（含 MediaType）。组未挂技能时 skills 为空。 */
export async function loadGroupSkillMatrix(vdnId: number): Promise<GroupSkillMatrixItem[]> {
  const p = await getPool();
  if (!p || !(vdnId > 0)) return [];
  const sql = `
    SELECT g.ID AS groupId, g.Name AS groupName,
           s.ID AS skillId, s.Name AS skillName, s.MediaTypeID AS mediaTypeId
      FROM t_user_group g
      INNER JOIN t_icc_grouptovdn v ON v.GroupID = g.ID AND v.VDNID = ?
      LEFT JOIN t_group_skill gs ON gs.group_id = g.ID
      LEFT JOIN t_icc_skill s ON s.ID = gs.skill_id
     ORDER BY g.ID, s.ID`;
  try {
    const [rows] = await p.query<GroupSkillRow[] & import('mysql2').RowDataPacket[]>(sql, [vdnId]);
    const byId = new Map<number, GroupSkillMatrixItem>();
    for (const r of rows as GroupSkillRow[]) {
      const gid = Number(r.groupId);
      if (!byId.has(gid)) {
        byId.set(gid, {
          id: gid,
          name: displayGroupName(r.groupName, gid),
          mediaKinds: [],
          skills: [],
        });
      }
      const item = byId.get(gid)!;
      const sid = Number(r.skillId || 0);
      if (sid > 0) {
        const mediaTypeId = Number(r.mediaTypeId || 0);
        item.skills.push({
          id: sid,
          name: String(r.skillName || `技能${sid}`),
          mediaTypeId,
          kind: mediaKind(mediaTypeId),
        });
      }
    }
    for (const item of byId.values()) {
      item.mediaKinds = uniqueMediaKinds(item.skills.map((s) => s.mediaTypeId));
    }
    return [...byId.values()];
  } catch (e) {
    console.error('[icc-groups] loadGroupSkillMatrix failed', e);
    return [];
  }
}

export async function loadGroupMediaKindsMap(vdnId: number): Promise<Map<string, MediaKind[]>> {
  const items = await loadGroupSkillMatrix(vdnId);
  return new Map(items.map((g) => [String(g.id), g.mediaKinds]));
}
