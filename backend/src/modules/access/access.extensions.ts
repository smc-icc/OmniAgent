import { assertVideoExtensionAvailable } from '../../shared/services/video-agent-config.js';
import { z } from 'zod';
import { AppError } from '../../shared/errors/index.js';
import { rows, execute, transaction, type Db } from './access.db.js';
import { listActiveSessions } from '../../integrations/ccs/session-manager.js';
export const extensionSchema = z.object({
  num: z.string().trim().min(1).max(50).regex(/^[0-9+*#]+$/), device: z.number().int().min(0).max(1),
  channel_group: z.string().trim().max(50).default(''), channel: z.number().int().min(0).default(0),
  description: z.string().max(100).default(''), agent_mode: z.number().int().min(0).max(1).default(0),
}).strict();
export async function listExtensions(db: Db, vdn: number) {
  return rows(db, 'SELECT Num AS num, Device AS device, Ch AS channel, ChGroup AS channel_group, Description AS description, AgentMode AS agent_mode FROM t_icc_base_extension WHERE VDN = ? ORDER BY Num', [vdn]);
}
async function requireExtension(db: Db, vdn: number, num: string) {
  if (!(await rows(db, 'SELECT Num FROM t_icc_base_extension WHERE VDN = ? AND Num = ?', [vdn, num])).length) throw new AppError(404, '分机号不存在');
}
async function assertUnused(db: Db, vdn: number, num: string) {
  await assertVideoExtensionAvailable(db, num);
  if (listActiveSessions().some(s => s.loggedIn && s.vdnId === vdn && s.extension === num)) throw new AppError(409, '分机正在被在线坐席使用，请先签出');
  const users = await rows(db, `SELECT ID FROM t_user_users WHERE VDNID = ? AND ExtensionTel = ?
    UNION ALL SELECT id FROM t_icc_telag_staticlogin WHERE VDNID = ? AND ExtNum = ?`, [vdn, num, vdn, num]);
  if (users.length) throw new AppError(409, '分机已被操作员或电话坐席引用，请先解除绑定');
}
export async function saveExtension(vdn: number, old: string | null, input: unknown) {
  const b = extensionSchema.parse(input);
  return transaction(async db => {
    if (old) await requireExtension(db, vdn, old);
    if (old && old !== b.num) await assertUnused(db, vdn, old);
    if (b.device === 0 && !(await rows(db, 'SELECT ID FROM t_icc_base_channelgroup WHERE VDNID = ? AND Name = ?', [vdn, b.channel_group])).length) throw new AppError(422, '请选择当前 VDN 的通道组');
    if (b.device === 1 && (await rows(db, 'SELECT Num FROM t_icc_base_extension WHERE Device = 1 AND Ch = ? AND NOT (VDN = ? AND Num = ?)', [b.channel, vdn, old ?? ''])).length) throw new AppError(409, '通道号已被使用');
    // The legacy extension table may be MyISAM: one validated SQL mutation, no multi-table rollback assumption.
    if (old) await execute(db, 'UPDATE t_icc_base_extension SET Num = ?, Device = ?, ChGroup = ?, Ch = ?, Description = ?, AgentMode = ? WHERE VDN = ? AND Num = ?', [b.num, b.device, b.channel_group, b.channel, b.description, b.agent_mode, vdn, old]);
    else await execute(db, 'INSERT INTO t_icc_base_extension (Num, Device, ChGroup, Ch, Description, AgentMode, VDN) VALUES (?, ?, ?, ?, ?, ?, ?)', [b.num, b.device, b.channel_group, b.channel, b.description, b.agent_mode, vdn]);
    return { ok: true };
  });
}
export async function deleteExtension(vdn: number, num: string) {
  return transaction(async db => {
    await requireExtension(db, vdn, num);
    await assertUnused(db, vdn, num);
    await execute(db, 'DELETE FROM t_icc_base_extension WHERE VDN = ? AND Num = ?', [vdn, num]);
    return { ok: true };
  });
}
