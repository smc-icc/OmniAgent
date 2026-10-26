import { confTenancyEnabled } from '../../shared/services/conf-tenancy.js';
import { isSystemSuperuser } from '../../shared/services/system-superuser.js';
import { AppError } from '../../shared/errors/index.js';
import { prisma } from '../../plugins/db.js';

/** 一次登录最多展开的 VDN 数。超出后仍按已取到的结果决定是否沿用默认 VDN。 */
export const LOGIN_VDN_LIMIT = 500;

export interface LoginVdnChoice {
  user_id: number;
  vdn_id: number | null;
  name: string;
}

export interface SeatRow {
  id: number;
  uid: string | null;
  name: string;
  email: string | null;
  provider: string;
  encrypted_password: string;
  pubsub_token: string | null;
  confirmed_at: Date | null;
  created_at: Date;
  current_sign_in_at: Date | null;
  current_sign_in_ip: string | null;
  type?: string | null;
  ui_settings?: unknown;
}

export function seatIdentity(uid: string | null | undefined): { workNo: string; vdnId: number | null } {
  const managed = /^conf-vdn:([1-9]\d*):[1-9]\d*:(.+)$/.exec(uid ?? '');
  if (!managed) return { workNo: String(uid ?? '').trim(), vdnId: null };
  try { return { workNo: decodeURIComponent(managed[2]!), vdnId: Number(managed[1]) }; }
  catch { return { workNo: '', vdnId: null }; }
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...(value as Record<string, unknown>) };
  return {};
}

function snapshot(choice: LoginVdnChoice): LoginVdnChoice {
  return { user_id: choice.user_id, vdn_id: choice.vdn_id, name: choice.name };
}

export function readStoredVdn(settings: unknown, key: 'default_login_vdn' | 'active_login_vdn'): LoginVdnChoice | null {
  const value = asObject(settings)[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const userId = Number(record.user_id);
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!Number.isInteger(userId) || userId <= 0 || !name) return null;
  if (record.vdn_id == null || record.vdn_id === '') return { user_id: userId, vdn_id: null, name };
  const vdnId = Number(record.vdn_id);
  if (!Number.isInteger(vdnId) || vdnId <= 0) return null;
  return { user_id: userId, vdn_id: vdnId, name };
}

/** 记住的 VDN 仍在本次结果里，且编号和名称都没变，才可以不经选择直接进入。 */
export function unchangedChoice(choices: LoginVdnChoice[], stored: LoginVdnChoice | null): LoginVdnChoice | null {
  if (!stored) return null;
  return choices.find(item => item.user_id === stored.user_id && item.vdn_id === stored.vdn_id && item.name === stored.name) ?? null;
}

export function explicitChoice(choices: LoginVdnChoice[], userId?: number, vdnId?: number): LoginVdnChoice | null {
  if (!userId) return null;
  return choices.find(item => item.user_id === userId && (vdnId == null || item.vdn_id === vdnId)) ?? null;
}

async function liveNames(vdnIds: Array<number | null>): Promise<Map<number, string>> {
  const wanted = [...new Set(vdnIds.filter((id): id is number => id != null))];
  if (!wanted.length || !confTenancyEnabled()) return new Map();
  const mod = await import('../../shared/services/conf-tenancy.js') as {
    sourceVdn?: (id: number) => Promise<{ name?: string } | undefined>;
  };
  if (typeof mod.sourceVdn !== 'function') return new Map();
  const names = new Map<number, string>();
  for (const id of wanted) {
    const row = await mod.sourceVdn(id);
    if (row?.name) names.set(id, row.name);
  }
  return names;
}

export async function loadSeatRows(workNo: string): Promise<SeatRow[]> {
  const encoded = encodeURIComponent(workNo);
  const rows = await prisma.users.findMany({
    where: { OR: [{ uid: workNo }, { uid: { endsWith: `:${encoded}` } }] },
    take: LOGIN_VDN_LIMIT,
  });
  return rows.filter(user => !isSystemSuperuser(user) && seatIdentity(user.uid).workNo === workNo);
}

export async function toChoices(users: SeatRow[]): Promise<LoginVdnChoice[]> {
  const identities = users.map(user => ({ user, identity: seatIdentity(user.uid) }));
  const names = await liveNames(identities.map(item => item.identity.vdnId));
  return identities.map(({ user, identity }) => ({
    user_id: user.id,
    vdn_id: identity.vdnId,
    name: (identity.vdnId != null ? names.get(identity.vdnId) : undefined) || (identity.vdnId ? `VDN ${identity.vdnId}` : (user.name || '默认')),
  }));
}

/** 超级管理员不按工号逐条匹配坐席，登录选择列出全部仍有效的 VDN。 */
export async function allVdnChoices(userId: number): Promise<LoginVdnChoice[]> {
  if (confTenancyEnabled()) {
    const maps = await prisma.conf_vdn_accounts.findMany({ where: { enabled: true }, orderBy: { vdn_id: 'asc' } });
    const names = await liveNames(maps.map(item => item.vdn_id));
    return maps.map(item => ({ user_id: userId, vdn_id: item.vdn_id, name: names.get(item.vdn_id) || `VDN ${item.vdn_id}` }));
  }
  const { database, rows } = await import('../access/access.db.js');
  const list = await rows<{ id: number; name: string }>(await database(), 'SELECT ID AS id, Name AS name FROM t_icc_vdn ORDER BY ID');
  return list.map(row => ({ user_id: userId, vdn_id: Number(row.id), name: String(row.name || `VDN ${row.id}`) }));
}

export function decideLoginChoice(
  choices: LoginVdnChoice[],
  users: SeatRow[],
  selection: { user_id?: number; vdn_id?: number },
): LoginVdnChoice | null {
  const explicit = explicitChoice(choices, selection.user_id, selection.vdn_id);
  if (selection.user_id || selection.vdn_id) return explicit;
  if (choices.length <= 1) return choices[0] ?? null;
  for (const user of users) {
    const remembered = unchangedChoice(choices, readStoredVdn(user.ui_settings, 'default_login_vdn'));
    if (remembered) return remembered;
  }
  return null;
}

export async function writeLoginMemory(userIds: number[], choice: LoginVdnChoice, activeUserId: number | null) {
  const ids = [...new Set(userIds.filter(id => Number.isInteger(id) && id > 0))];
  if (!ids.length) return;
  const rows = await prisma.users.findMany({ where: { id: { in: ids } }, select: { id: true, ui_settings: true } });
  const saved = snapshot(choice);
  for (const row of rows) {
    const settings = asObject(row.ui_settings);
    settings.default_login_vdn = saved;
    if (activeUserId != null && row.id === activeUserId) settings.active_login_vdn = saved;
    await prisma.users.update({ where: { id: row.id }, data: { ui_settings: settings as object } });
  }
}

function sameVdn(left: LoginVdnChoice, right: LoginVdnChoice) {
  return left.user_id === right.user_id && left.vdn_id === right.vdn_id;
}

export async function loginVdnView(user: SeatRow) {
  const superuser = isSystemSuperuser(user);
  const options = superuser
    ? await allVdnChoices(user.id)
    : await toChoices(await loadSeatRows(seatIdentity(user.uid).workNo).then(rows => rows.length ? rows : [user]));
  const activeStored = readStoredVdn(user.ui_settings, 'active_login_vdn');
  const current = (activeStored && options.find(item => sameVdn(item, activeStored)))
    ?? options.find(item => item.user_id === user.id)
    ?? null;
  return {
    scope: superuser ? 'all' as const : 'seats' as const,
    current,
    default: readStoredVdn(user.ui_settings, 'default_login_vdn'),
    options,
  };
}

export async function saveDefaultLoginVdn(user: SeatRow, selection: { user_id: number; vdn_id: number | null }) {
  const view = await loginVdnView(user);
  const chosen = view.options.find(item => item.user_id === selection.user_id && item.vdn_id === selection.vdn_id);
  if (!chosen) throw new AppError(422, '不能选择当前账号无权进入的 VDN');
  await writeLoginMemory([...new Set(view.options.map(item => item.user_id))], chosen, null);
  return chosen;
}
