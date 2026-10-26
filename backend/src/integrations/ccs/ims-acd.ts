/**
 * IMS / 非话务 ACD 签入：由 Omni 直连 ACD，不经 CCS。
 * CCS 只管理 MediaTypeID=1（TAS）技能与含 TAS 技能的组。
 */
import { getIccMysqlPool } from '../../shared/services/icc-groups-dal.js';
import { displayGroupName } from '../../shared/services/agent-skill-groups.js';
import {
  acdSetImsIdle,
  acdSignInGroups,
  acdSignInSkills,
  acdSignOutGroups,
  acdSignOutSkills,
} from './acd-client.js';

const TAS_MEDIA = 1;

export type MediaGroupPartition = {
  tasIds: number[];
  imsOnlyIds: number[];
  imsSkillIds: number[];
};

type GroupMediaRow = { groupId: number; hasTas: boolean; hasIms: boolean; autoCheckIn: number };

async function loadGroupMedia(ccsAgentId: number): Promise<GroupMediaRow[]> {
  const p = await getIccMysqlPool();
  if (!p || !ccsAgentId) return [];
  const [rows] = await p.query(
    `SELECT utg.GroupID AS groupId, utg.AutoCheckIn AS autoCheckIn,
            MAX(CASE WHEN s.MediaTypeID = ? THEN 1 ELSE 0 END) AS hasTas,
            MAX(CASE WHEN s.MediaTypeID IS NOT NULL AND s.MediaTypeID <> ? THEN 1 ELSE 0 END) AS hasIms
       FROM t_user_usertogroup utg
       LEFT JOIN t_group_skill gs ON gs.group_id = utg.GroupID
       LEFT JOIN t_icc_skill s ON s.ID = gs.skill_id
      WHERE utg.UserID = ?
      GROUP BY utg.GroupID, utg.AutoCheckIn`,
    [TAS_MEDIA, TAS_MEDIA, ccsAgentId],
  );
  return (rows as Array<{ groupId: number; autoCheckIn: number; hasTas: number; hasIms: number }>).map((r) => ({
    groupId: Number(r.groupId),
    autoCheckIn: Number(r.autoCheckIn) || 0,
    hasTas: Number(r.hasTas) === 1,
    hasIms: Number(r.hasIms) === 1,
  }));
}

async function loadImsSkills(
  ccsAgentId: number,
  groupIds?: number[],
): Promise<Array<{ skillId: number; autoCheckIn: number }>> {
  const p = await getIccMysqlPool();
  if (!p || !ccsAgentId) return [];
  const params: Array<number | string> = [TAS_MEDIA, ccsAgentId];
  let sql = `SELECT DISTINCT s.ID AS skillId, su.AutoCheckIn AS autoCheckIn
       FROM t_icc_skill_skilltouser su
       INNER JOIN t_icc_skill s ON s.ID = su.SkillID
      WHERE s.MediaTypeID <> ? AND su.UserID = ?`;
  if (groupIds) {
    if (groupIds.length === 0) return [];
    sql += ` AND s.ID IN (SELECT gs.skill_id FROM t_group_skill gs WHERE gs.group_id IN (${groupIds.map(() => '?').join(',')}))`;
    params.push(...groupIds);
  }
  const [rows] = await p.query(sql, params);
  return (rows as Array<{ skillId: number; autoCheckIn: number }>).map((r) => ({
    skillId: Number(r.skillId),
    autoCheckIn: Number(r.autoCheckIn) || 0,
  }));
}

/** MySQL 不可用时全部当 TAS，走 CCS，避免误伤话务签入。 */
export async function partitionAgentGroups(
  ccsAgentId: number,
  groupIds: number[],
): Promise<MediaGroupPartition> {
  const ids = [...new Set(groupIds.filter((n) => Number.isFinite(n) && n > 0))];
  if (ids.length === 0) return { tasIds: [], imsOnlyIds: [], imsSkillIds: [] };
  try {
    const groups = await loadGroupMedia(ccsAgentId);
    if (groups.length === 0) return { tasIds: ids, imsOnlyIds: [], imsSkillIds: [] };
    const byId = new Map(groups.map((g) => [g.groupId, g]));
    const tasIds: number[] = [];
    const imsOnlyIds: number[] = [];
    const imsGroupIds: number[] = [];
    for (const id of ids) {
      const g = byId.get(id);
      if (!g) {
        tasIds.push(id);
        continue;
      }
      if (g.hasTas) tasIds.push(id);
      if (g.hasIms && !g.hasTas) imsOnlyIds.push(id);
      if (g.hasIms) imsGroupIds.push(id);
    }
    const skills = await loadImsSkills(ccsAgentId, imsGroupIds);
    return {
      tasIds,
      imsOnlyIds,
      imsSkillIds: skills.map((s) => s.skillId),
    };
  } catch (e) {
    console.warn('[ims-acd] partitionAgentGroups fallback TAS', e instanceof Error ? e.message : e);
    return { tasIds: ids, imsOnlyIds: [], imsSkillIds: [] };
  }
}

export async function signInImsOnAcd(opts: {
  agentId: number;
  vdnId: number;
  groupIds?: number[];
  skillIds?: number[];
}): Promise<void> {
  const groupIds = [...new Set((opts.groupIds ?? []).filter((n) => n > 0))];
  const skillIds = [...new Set((opts.skillIds ?? []).filter((n) => n > 0))];
  if (groupIds.length === 0 && skillIds.length === 0) return;
  await acdSetImsIdle({ agentId: opts.agentId, vdnId: opts.vdnId });
  // 先签组再签技能：AgentSingleSkillSignInToAgentGroup 只遍历已签入组
  if (groupIds.length > 0) {
    await acdSignInGroups({ agentId: opts.agentId, vdnId: opts.vdnId, groupIds });
  }
  if (skillIds.length > 0) {
    await acdSignInSkills({ agentId: opts.agentId, vdnId: opts.vdnId, skillIds });
  }
}

export async function signOutImsOnAcd(opts: {
  agentId: number;
  vdnId: number;
  groupIds?: number[];
  skillIds?: number[];
}): Promise<void> {
  const groupIds = [...new Set((opts.groupIds ?? []).filter((n) => n > 0))];
  const skillIds = [...new Set((opts.skillIds ?? []).filter((n) => n > 0))];
  if (groupIds.length > 0) {
    await acdSignOutGroups({ agentId: opts.agentId, vdnId: opts.vdnId, groupIds });
  }
  if (skillIds.length > 0) {
    await acdSignOutSkills({ agentId: opts.agentId, vdnId: opts.vdnId, skillIds });
  }
}

/** 接听模式确认后：签入 AutoCheckIn 的 IMS 技能/纯 IMS 组。返回实际签入的组 ID。 */
export async function signInImsAutoCheckIn(agentId: number, vdnId: number): Promise<number[]> {
  try {
    const groups = await loadGroupMedia(agentId);
    const skills = await loadImsSkills(agentId);
    const imsOnly = groups.filter((g) => g.hasIms && !g.hasTas && g.autoCheckIn !== 0).map((g) => g.groupId);
    const autoSkills = skills.filter((s) => s.autoCheckIn !== 0).map((s) => s.skillId);
    const mixedIms = groups.filter((g) => g.hasIms && g.hasTas && g.autoCheckIn !== 0).map((g) => g.groupId);
    const mixedSkills = mixedIms.length ? (await loadImsSkills(agentId, mixedIms)).map((s) => s.skillId) : [];
    await signInImsOnAcd({
      agentId,
      vdnId,
      groupIds: imsOnly,
      skillIds: [...new Set([...autoSkills, ...mixedSkills])],
    });
    return imsOnly;
  } catch (e) {
    console.warn('[ims-acd] auto check-in skipped', e instanceof Error ? e.message : e);
    return [];
  }
}

/** 全库 IMS/非 TAS 技能 ID，供排队列表过滤。 */
export async function loadImsSkillIdSet(): Promise<Set<number>> {
  const p = await getIccMysqlPool();
  if (!p) return new Set();
  const [rows] = await p.query(
    `SELECT ID AS skillId FROM t_icc_skill WHERE MediaTypeID IS NOT NULL AND MediaTypeID <> ?`,
    [TAS_MEDIA],
  );
  return new Set(
    (rows as Array<{ skillId: number }>).map((r) => Number(r.skillId)).filter((n) => n > 0),
  );
}

/** 含 IMS 技能的组，供多媒体工作台分组。 */
export async function loadImsGroupMeta(): Promise<Array<{ id: number; name: string }>> {
  const p = await getIccMysqlPool();
  if (!p) return [];
  const [rows] = await p.query(
    `SELECT DISTINCT g.ID AS id, g.Name AS name
       FROM t_user_group g
       INNER JOIN t_group_skill gs ON gs.group_id = g.ID
       INNER JOIN t_icc_skill s ON s.ID = gs.skill_id
      WHERE s.MediaTypeID IS NOT NULL AND s.MediaTypeID <> ?
      ORDER BY g.ID`,
    [TAS_MEDIA],
  );
  return (rows as Array<{ id: number; name: string }>).map((r) => ({
    id: Number(r.id),
    name: displayGroupName(r.name, Number(r.id)),
  })).filter((g) => g.id > 0);
}

/** CCS LoggedOff 前清 IMS：CCS 不管非话务组。 */
export async function signOutImsOnLogout(agentId: number, vdnId: number): Promise<void> {
  const groups = await loadGroupMedia(agentId);
  const imsOnly = groups.filter((g) => g.hasIms && !g.hasTas).map((g) => g.groupId);
  const skills = (await loadImsSkills(agentId)).map((s) => s.skillId);
  await signOutImsOnAcd({ agentId, vdnId, groupIds: imsOnly, skillIds: skills });
}
