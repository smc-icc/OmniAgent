import { getIccMysqlPool } from '../../shared/services/icc-groups-dal.js';
import { env } from '../../config/env.js';
import { rows } from './access.db.js';
import { AppError } from '../../shared/errors/index.js';

export async function assertOperatorEnabled(workNo: string) {
  if (!workNo) return;
  const db = await getIccMysqlPool();
  if (!db) return; // Explicit ICC_MYSQL_DISABLED mode has no ICC identities.
  const [user] = await rows<{ enabled: number }>(db, 'SELECT IsValid AS enabled FROM t_user_users WHERE WorkNO = ? AND VDNID = ?', [workNo, env.OMNI_AGENT_VDN_ID]);
  if (user && !user.enabled) throw new AppError(403, '操作员已停用，请联系管理员');
}
