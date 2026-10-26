import { database, rows, execute } from '../access/access.db.js';
import { AppError } from '../../shared/errors/index.js';
import type { VideoEntry } from './video-customer.policy.js';
import { hashVideoToken, issueVisitorIdentity } from './video-customer.policy.js';

export async function createVideoLease(entry: VideoEntry, domain: string, ipKey: string, called: string, mediaType: 0 | 1 = 1) {
  const db = await (await database()).getConnection();
  let locked = false;
  try {
    const [lock] = await rows<{ acquired: number }>(db, "SELECT GET_LOCK('omni.video.visitor.issue', 5) AS acquired");
    if (lock?.acquired !== 1) throw new AppError(429, 'Video service is busy');
    locked = true;
    await db.beginTransaction();
    await execute(db, "UPDATE t_icc_video_session SET password='' WHERE expires_at <= UTC_TIMESTAMP(3) AND password<>''");
    await execute(db, 'DELETE FROM t_icc_video_session WHERE expires_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)');
    // A duplicated code across VDNs is unsafe unless TAS tenant routing is proven.
    const codes = await rows<{ vdn_id: number }>(db, 'SELECT VDNID AS vdn_id FROM t_icc_base_accesscode WHERE Code = ?', [entry.accessCode]);
    if (codes.length !== 1 || Number(codes[0]!.vdn_id) !== entry.vdnId) throw new AppError(503, 'Video access code is missing or ambiguous');
    if (!/^[1-9]\d{2,19}$/.test(called)) throw new AppError(400, 'Invalid called number');
    const [route] = await rows<{ n: number }>(db,
      'SELECT COUNT(*) AS n FROM t_icc_vdn_serviceroute WHERE IsValid=1 AND VDNID=? AND CalledCode=?',
      [entry.vdnId, called]);
    if (Number(route?.n) !== 1) throw new AppError(404, 'Called number has no service route');
    const [budget] = await rows<{ active: number; own_active: number; recent: number }>(db,
      `SELECT COALESCE(SUM(revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(3)),0) AS active,
       COALESCE(SUM(ip_key=? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(3)),0) AS own_active,
       COALESCE(SUM(ip_key=? AND created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE)),0) AS recent
       FROM t_icc_video_session`, [ipKey, ipKey]);
    if (Number(budget!.active) >= 100 || Number(budget!.own_active) >= 2 || Number(budget!.recent) >= 3) throw new AppError(429, 'Video session limit reached');
    const identity = issueVisitorIdentity(mediaType);
    await execute(db, `INSERT INTO t_icc_video_session
      (id,username,password,token_hash,ip_key,entry_id,vdn_id,domain,access_code,created_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE))`,
    [identity.id, identity.username, identity.password, identity.tokenHash, ipKey, entry.id, entry.vdnId, domain, entry.accessCode]);
    const [deadline] = await rows<{ expires_at: string }>(db, "SELECT DATE_FORMAT(expires_at,'%Y-%m-%dT%H:%i:%s.000Z') AS expires_at FROM t_icc_video_session WHERE id=?", [identity.id]);
    await db.commit();
    return { ...identity, expiresAt: deadline!.expires_at, destination: called };
  } catch (err) {
    await db.rollback();
    if ((err as { code?: string }).code === 'ER_NO_SUCH_TABLE') throw new AppError(503, 'Video session migration has not been installed');
    if (err instanceof AppError) throw err;
    // mysql2 errors may embed formatted INSERT SQL containing the SIP password.
    throw new AppError(503, 'Video session database operation failed');
  } finally {
    if (locked) await db.query("SELECT RELEASE_LOCK('omni.video.visitor.issue')").catch(() => undefined);
    db.release();
  }
}
export async function revokeVideoLease(id: string, token: string) {
  if (!/^[a-f0-9]{32}$/.test(id) || !/^[a-f0-9]{64}$/.test(token)) throw new AppError(403, 'Invalid video session capability');
  const result = await execute(await database(), `UPDATE t_icc_video_session SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(3)),password=''
    WHERE id=? AND token_hash=?`, [id, hashVideoToken(token)]);
  if (!result.affectedRows) throw new AppError(403, 'Invalid video session capability');
}
