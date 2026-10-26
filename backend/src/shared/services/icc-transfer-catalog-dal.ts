/**
 * 转移目标目录：组/技能、组内坐席、IVR 流程（icc 直查，对齐 BS 配置台数据）。
 * 组/技能列表按「当前有签入坐席」过滤，空组不展示。
 */
import { listLoggedInSessions } from '../../integrations/ccs/session-manager.js';
import { getSignedInSkillIds } from './agent-skill-groups.js';
import { getIccMysqlPool } from './icc-groups-dal.js';
import { displayGroupName } from './agent-skill-groups.js';

export type TransferSkill = { id: number; name: string };
export type TransferGroup = { id: number; name: string; skills: TransferSkill[] };
export type TransferAgent = { workNo: string; name: string; groupId: number; status?: string };
export type TransferIvrFlow = { id: number; name: string; flowId: number; nodeId: number };

/** 当前 VDN 下、已 CCS 登录且签入了技能组的在线坐席画像（供目录过滤）。 */
export type OnlineTransferAgent = {
  workNo: string;
  name: string;
  userId: number;
  signedGroupIds: Set<number>;
  skillIds: Set<number>;
  status: string;
};

export async function mapCcsAgentsToOnlineTransferAgents(
  vdnId: number,
  agents: Array<{ workNo: string; name: string; groupIds: number[]; status?: number }>,
  excludeWorkNo?: string,
): Promise<OnlineTransferAgent[]> {
  const rows = agents.filter((a) => a.workNo && a.workNo !== excludeWorkNo)
  const workNos = [...new Set(rows.map((a) => a.workNo).filter(Boolean))]
  const skillByWork = await loadSkillIdsByWorkNos(vdnId, workNos)
  return rows
    .map((a) => ({
      workNo: a.workNo,
      name: a.name || a.workNo,
      userId: 0,
      signedGroupIds: new Set(a.groupIds.filter((id) => Number.isFinite(id) && id > 0)),
      skillIds: skillByWork.get(a.workNo) ?? new Set<number>(),
      status: String(a.status ?? ''),
    }))
    .filter((a) => a.signedGroupIds.size > 0)
}

export async function loadOnlineTransferAgents(vdnId: number): Promise<OnlineTransferAgent[]> {
  const sessions = listLoggedInSessions().filter(
    (s) => s.agentId != null && (s.vdnId === vdnId || vdnId <= 0),
  );
  if (!sessions.length) return [];

  const workNos = [...new Set(sessions.map((s) => s.workNO).filter(Boolean))];
  const skillByWork = await loadSkillIdsByWorkNos(vdnId, workNos);
  const nameByWork = await loadNamesByWorkNos(vdnId, workNos);

  return sessions
    .filter((s) => s.workNO)
    .map((s) => {
      const signed = getSignedInSkillIds(s.userId)
        .map((id) => Number(id))
        .filter((n) => Number.isFinite(n) && n > 0);
      return {
        workNo: s.workNO,
        name: nameByWork.get(s.workNO) || s.workNO,
        userId: s.userId,
        signedGroupIds: new Set(signed),
        skillIds: skillByWork.get(s.workNO) ?? new Set<number>(),
        status: s.status || 'idle',
      };
    })
    .filter((a) => a.signedGroupIds.size > 0);
}

async function loadSkillIdsByWorkNos(
  vdnId: number,
  workNos: string[],
): Promise<Map<string, Set<number>>> {
  const out = new Map<string, Set<number>>();
  if (!workNos.length) return out;
  const p = await getIccMysqlPool();
  if (!p) return out;
  try {
    const [rows] = await p.query(
      `SELECT u.WorkNO AS workNo, su.SkillID AS skillId
         FROM t_user_users u
         INNER JOIN t_icc_skill_skilltouser su ON su.UserID = u.ID
        WHERE u.VDNID = ?
          AND u.WorkNO IN (${workNos.map(() => '?').join(',')})`,
      [vdnId, ...workNos],
    );
    for (const row of rows as Array<{ workNo: string; skillId: number }>) {
      const wn = String(row.workNo ?? '');
      if (!wn) continue;
      let set = out.get(wn);
      if (!set) {
        set = new Set();
        out.set(wn, set);
      }
      const sid = Number(row.skillId);
      if (sid > 0) set.add(sid);
    }
  } catch (e) {
    console.error('[transfer-catalog] loadSkillIdsByWorkNos failed', e);
  }
  return out;
}

async function loadNamesByWorkNos(vdnId: number, workNos: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!workNos.length) return out;
  const p = await getIccMysqlPool();
  if (!p) return out;
  try {
    const [rows] = await p.query(
      `SELECT WorkNO AS workNo, Name AS name
         FROM t_user_users
        WHERE VDNID = ?
          AND WorkNO IN (${workNos.map(() => '?').join(',')})`,
      [vdnId, ...workNos],
    );
    for (const row of rows as Array<{ workNo: string; name: string }>) {
      out.set(String(row.workNo), String(row.name ?? row.workNo));
    }
  } catch (e) {
    console.error('[transfer-catalog] loadNamesByWorkNos failed', e);
  }
  return out;
}

function filterGroupsByOnlinePresence(
  groups: TransferGroup[],
  online: OnlineTransferAgent[],
  mode: 'skill' | 'agent',
): TransferGroup[] {
  if (!online.length) return [];

  const signedGroupIds = new Set<number>();
  for (const a of online) {
    for (const gid of a.signedGroupIds) signedGroupIds.add(gid);
  }

  return groups
    .filter((g) => signedGroupIds.has(g.id))
    .map((g) => {
      if (mode === 'agent') {
        // 坐席转移：组内至少有一名已签入该组的在线坐席即可
        const hasAgent = online.some((a) => a.signedGroupIds.has(g.id));
        return hasAgent ? g : null;
      }
      // 技能转移：只保留「有签入该组且具备该技能」的技能；无技能则整组隐藏
      const skills = g.skills.filter((s) => {
        if (s.id <= 0) {
          // 「整组」占位：有人签入该组即可
          return online.some((a) => a.signedGroupIds.has(g.id));
        }
        return online.some(
          (a) => a.signedGroupIds.has(g.id) && a.skillIds.has(s.id),
        );
      });
      if (!skills.length) return null;
      return { ...g, skills };
    })
    .filter((g): g is TransferGroup => g != null);
}

export async function loadTransferGroupsWithSkills(
  vdnId: number,
  opts?: { mode?: 'skill' | 'agent'; online?: OnlineTransferAgent[] },
): Promise<TransferGroup[]> {
  const p = await getIccMysqlPool();
  if (!p) return [];
  try {
    const [groupRows] = await p.query(
      `SELECT g.ID AS id, g.Name AS name
         FROM t_user_group g
         INNER JOIN t_icc_grouptovdn v ON v.GroupID = g.ID
        WHERE v.VDNID = ?
        ORDER BY g.ID`,
      [vdnId],
    );
    const groups = (groupRows as Array<{ id: number; name: string }>).map((r) => ({
      id: Number(r.id),
      name: displayGroupName(r.name, Number(r.id)),
      skills: [] as TransferSkill[],
    }));
    if (!groups.length) return [];

    const [skillRows] = await p.query(
      `SELECT gs.group_id AS groupId, s.ID AS id, s.Name AS name
         FROM t_group_skill gs
         INNER JOIN t_icc_skill s ON s.ID = gs.skill_id
        WHERE gs.group_id IN (${groups.map(() => '?').join(',')})
          AND (s.VDN = 0 OR s.VDN = ?)
        ORDER BY gs.group_id, s.ID`,
      [...groups.map((g) => g.id), vdnId],
    );
    const byGroup = new Map(groups.map((g) => [g.id, g]));
    for (const row of skillRows as Array<{ groupId: number; id: number; name: string }>) {
      const g = byGroup.get(Number(row.groupId));
      if (!g) continue;
      g.skills.push({ id: Number(row.id), name: displayGroupName(row.name, Number(row.id)) });
    }
    for (const g of groups) {
      if (!g.skills.length) {
        g.skills.push({ id: 0, name: `${g.name}（整组）` });
      }
    }

    const online = opts?.online ?? (await loadOnlineTransferAgents(vdnId));
    const mode = opts?.mode ?? 'skill';
    return filterGroupsByOnlinePresence(groups, online, mode);
  } catch (e) {
    console.error('[transfer-catalog] loadTransferGroupsWithSkills failed', e);
    return [];
  }
}

export async function loadAgentsByGroup(
  vdnId: number,
  groupId: number,
  search = '',
  opts?: { onlineOnly?: boolean; excludeWorkNo?: string; online?: OnlineTransferAgent[] },
): Promise<TransferAgent[]> {
  const p = await getIccMysqlPool();
  if (!p || !groupId) return [];
  const q = String(search || '').trim();
  try {
    const online = opts?.onlineOnly === false
      ? null
      : (opts?.online ?? await loadOnlineTransferAgents(vdnId));
    const onlineInGroup = online
      ? new Map(
          online
            .filter((a) => a.signedGroupIds.has(groupId))
            .filter((a) => !opts?.excludeWorkNo || a.workNo !== opts.excludeWorkNo)
            .map((a) => [a.workNo, a] as const),
        )
      : null;

    // 仅在线签入：不查全量成员表，避免列出未签入/离线空坐席
    if (onlineInGroup) {
      let list = [...onlineInGroup.values()].map((a) => ({
        workNo: a.workNo,
        name: a.name,
        groupId,
        status: a.status,
      }));
      if (q) {
        const needle = q.toLowerCase();
        list = list.filter(
          (a) =>
            a.workNo.toLowerCase().includes(needle)
            || a.name.toLowerCase().includes(needle),
        );
      }
      list.sort((a, b) => a.workNo.localeCompare(b.workNo));
      return list;
    }

    const params: Array<string | number> = [vdnId, groupId];
    let extra = '';
    if (q) {
      extra = ' AND (u.WorkNO LIKE ? OR u.Name LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    const [rows] = await p.query(
      `SELECT u.WorkNO AS workNo, u.Name AS name, ug.GroupID AS groupId
         FROM t_user_users u
         INNER JOIN t_user_usertogroup ug ON ug.UserID = u.ID
        WHERE u.VDNID = ?
          AND ug.GroupID = ?
          AND IFNULL(u.IsSystem, 0) = 0
          AND IFNULL(u.IsValid, 1) = 1
          ${extra}
        ORDER BY u.WorkNO`,
      params,
    );
    return (rows as Array<{ workNo: string; name: string; groupId: number }>).map((r) => ({
      workNo: String(r.workNo ?? ''),
      name: String(r.name ?? ''),
      groupId: Number(r.groupId),
    })).filter((a) => a.workNo);
  } catch (e) {
    console.error('[transfer-catalog] loadAgentsByGroup failed', e);
    return [];
  }
}

export async function loadIvrFlows(vdnId: number): Promise<TransferIvrFlow[]> {
  const p = await getIccMysqlPool();
  if (!p) return [];
  try {
    const [rows] = await p.query(
      `SELECT ID AS id, Name AS name, FlowID AS flowId, NodeID AS nodeId
         FROM t_icc_base_ivr_flow
        WHERE VDNID = ? OR VDNID = 0
        ORDER BY FlowID, NodeID, ID`,
      [vdnId],
    );
    return (rows as Array<{ id: number; name: string; flowId: number; nodeId: number }>).map((r) => ({
      id: Number(r.id),
      name: String(r.name ?? `流程${r.flowId}`),
      flowId: Number(r.flowId),
      nodeId: Number(r.nodeId),
    }));
  } catch (e) {
    console.error('[transfer-catalog] loadIvrFlows failed', e);
    return [];
  }
}
