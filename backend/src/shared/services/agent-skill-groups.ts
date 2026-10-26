export type SkillNodeType = 'skill' | 'queue';

export interface SkillTreeNode {
  id: string;
  label: string;
  type: SkillNodeType;
  children?: SkillTreeNode[];
  /** tas=电话技能组，ims=在线/全媒体技能组；可同时具备 */
  mediaKinds?: Array<'tas' | 'ims'>;
}

export interface CcsGroupInfo {
  id: number;
  name: string;
}

/** 界面展示「组名(ID)」，与 Focus 一致，例如「热线组(2)」。已带尾部编号的不再重复拼接。 */
export function displayGroupName(name: string | undefined | null, id?: number): string {
  let s = String(name ?? '').trim();
  s = s.replace(/\s*[(（]\d+[)）]\s*$/u, '').trim();
  if (!s) s = id != null && Number.isFinite(id) && id > 0 ? `技能组${id}` : '技能组';
  if (id != null && Number.isFinite(id) && id > 0) return `${s}(${id})`;
  return s;
}

/** 由 CCSServer DoAgentGetAllGroupInfo 返回的组列表构建树（skill 节点；CCS 组无队列子节点）。 */
export function buildTreeFromGroups(groups: CcsGroupInfo[]): SkillTreeNode[] {
  return groups.map((g) => ({
    id: String(g.id),
    label: displayGroupName(g.name, g.id),
    type: 'skill' as const,
  }));
}

/**
 * 技能组树缓存：userId → { tree, nameById }。
 * 树由 CCS 拉取后写入（见 omnichannel.routes.ts），未拉取时为 null（前端显示加载中/空）。
 */
const treeCache = new Map<number, { tree: SkillTreeNode[]; nameById: Map<string, string> }>();

export function setGroupTree(userId: number, groups: CcsGroupInfo[]): SkillTreeNode[] {
  const tree = buildTreeFromGroups(groups);
  const nameById = new Map(tree.map((n) => [n.id, n.label] as const));
  treeCache.set(userId, { tree, nameById });
  return tree;
}

export function getGroupTree(userId: number): SkillTreeNode[] | null {
  return treeCache.get(userId)?.tree ?? null;
}

export function applyMediaKindsToTree(userId: number, byGroupId: Map<string, Array<'tas' | 'ims'>>): void {
  const cache = treeCache.get(userId);
  if (!cache) return;
  cache.tree = cache.tree.map((n) => ({
    ...n,
    mediaKinds: byGroupId.get(n.id) ?? n.mediaKinds ?? [],
  }));
}

/** 仅当已有非空树时视为已缓存；空数组视为未就绪，允许重新向 CCS 拉取。 */
export function hasCachedGroupTree(userId: number): boolean {
  const tree = getGroupTree(userId);
  return Array.isArray(tree) && tree.length > 0;
}

export function clearGroupTree(userId?: number): void {
  if (userId == null) treeCache.clear();
  else treeCache.delete(userId);
}

/** 树为空时返回空数组（避免 undefined 传播）。 */
export function treeForUi(userId: number): Array<SkillTreeNode & { disabled?: boolean }> {
  const tree = getGroupTree(userId);
  if (!tree) return [];
  return tree.map((skill) => ({
    ...skill,
    children: skill.children?.map((q) => ({ ...q, disabled: true })),
  }));
}

const signedInByUser = new Map<number, Set<string>>();

function allSkillIds(userId: number): string[] {
  return (getGroupTree(userId) ?? []).filter((n) => n.type === 'skill').map((n) => n.id);
}

export function normalizeSkillIds(userId: number, ids: string[]): string[] {
  const valid = new Set(allSkillIds(userId));
  return ids.filter((id) => valid.has(id));
}

export function getSignedInSkillIds(userId: number): string[] {
  if (!signedInByUser.has(userId)) {
    signedInByUser.set(userId, new Set());
  }
  return [...signedInByUser.get(userId)!];
}

export function setSignedInSkillIds(userId: number, ids: string[]): string[] {
  const tree = getGroupTree(userId);
  const next = tree && tree.length > 0 ? normalizeSkillIds(userId, ids) : [...new Set(ids.map(String).filter(Boolean))];
  signedInByUser.set(userId, new Set(next));
  onSignedInChange?.(userId, next);
  return next;
}

let onSignedInChange: ((userId: number, ids: string[]) => void) | undefined;

export function setSignedInChangeHook(fn: ((userId: number, ids: string[]) => void) | undefined): void {
  onSignedInChange = fn;
}

export function mergeSignedInSkillIds(userId: number, ids: Array<string | number>): string[] {
  const cur = getSignedInSkillIds(userId);
  return setSignedInSkillIds(userId, [...cur, ...ids.map(String)]);
}

export function removeSignedInSkillIds(userId: number, ids: Array<string | number>): string[] {
  const drop = new Set(ids.map(String));
  return setSignedInSkillIds(userId, getSignedInSkillIds(userId).filter((id) => !drop.has(id)));
}

export function signInAllSkillGroups(userId: number): string[] {
  return setSignedInSkillIds(userId, allSkillIds(userId));
}

export function signOutAllSkillGroups(userId: number): string[] {
  return setSignedInSkillIds(userId, []);
}

export function buildDisplayLabel(signedIn: string[], userId?: number): string {
  if (!signedIn.length) return '未签入技能组';
  const cache = userId != null ? treeCache.get(userId) : undefined;
  const nameById = cache?.nameById;
  const name = (id: string) => nameById?.get(id) ?? displayGroupName('', Number(id));
  if (signedIn.length === 1) {
    return name(signedIn[0]);
  }
  return `${name(signedIn[0])} 等${signedIn.length}个`;
}
