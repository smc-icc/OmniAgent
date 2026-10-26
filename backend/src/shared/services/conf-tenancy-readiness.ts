import crypto from 'node:crypto';
import { prisma } from '../../plugins/db.js';
import { database, rows } from '../../modules/access/access.db.js';
import { managedUid } from './conf-tenancy.js';
import { verifyPassword } from '../utils/password.js';
export async function checkConfTenancyReady(conf: Record<string, string>, stage: 'pre-enable' | 'post-enable' = 'pre-enable') {
  const checks: Array<{ check: string; passed: boolean; detail: string }> = [];
  const add = (check: string, passed: boolean, detail: string) => checks.push({ check, passed, detail });
  add('conf_real_auth_config', conf.TARS_ENABLE_LOGIN === 'true', 'ConfManager must explicitly enable real ticket authentication; this is a configuration check, not a live login');
  const ours = process.env.PLATFORM_SYNC_SECRET || '', theirs = conf.PLATFORM_SYNC_SECRET || '';
  add('shared_sync_secret', !!ours && Buffer.byteLength(ours) === Buffer.byteLength(theirs) && crypto.timingSafeEqual(Buffer.from(ours), Buffer.from(theirs)), 'Both endpoints must have the same nonempty secret; values are never reported');
  add('activation_flags', stage === 'pre-enable' ? process.env.CONF_TENANCY_ENABLED !== '1' && conf.CONF_TENANCY_ENABLED !== '1' : process.env.CONF_TENANCY_ENABLED === '1' && conf.CONF_TENANCY_ENABLED === '1', `Expected ${stage} environment flags on both sides`);
  const db = await database();
  const vdns = await rows<{ id: number }>(db, 'SELECT ID AS id FROM t_icc_vdn WHERE ID > 0 ORDER BY ID');
  const source = await rows<{ id: number; vdn_id: number; work_no: string; email: string | null; enabled: number; password: string }>(db,
    'SELECT ID AS id, VDNID AS vdn_id, WorkNO AS work_no, Email AS email, IsValid AS enabled, PassWord AS password FROM t_user_users WHERE VDNID > 0 ORDER BY VDNID, ID');
  const [maps, bindings, users, members] = await Promise.all([prisma.conf_vdn_accounts.findMany(), prisma.conf_user_bindings.findMany(), prisma.users.findMany(), prisma.account_users.findMany()]);
  const activeMaps = maps.filter(m => m.enabled);
  add('vdn_maps', vdns.length > 0 && vdns.every(v => activeMaps.some(m => m.vdn_id === Number(v.id))) && activeMaps.every(m => vdns.some(v => Number(v.id) === m.vdn_id)), 'Every live VDN has exactly one active persistent mapping; stale active VDN mappings are forbidden');
  const superusers = users.filter(u => u.type === 'SuperAdmin' || u.uid === 'conf-system:admin');
  add('singleton_superuser', superusers.length === 1 && superusers[0]?.uid === 'conf-system:admin' && superusers[0]?.type === 'SuperAdmin', 'Exactly one source-provisioned system superuser is required');
  const conflicts: Array<{ vdn_id: number; source_user_id: number; reason: string }> = [];
  const emails = new Map<string, string>();
  for (const s of source) {
    const vdn = Number(s.vdn_id), id = Number(s.id), enabled = Number(s.enabled) === 1;
    const map = activeMaps.find(m => m.vdn_id === vdn), binding = bindings.find(b => b.vdn_id === vdn && b.source_user_id === id);
    const user = users.find(u => u.id === binding?.user_id);
    const email = s.email?.trim().toLowerCase() || '';
    const reason: string[] = [];
    if (email && (emails.has(email) || users.some(u => u.email?.trim().toLowerCase() === email && u.id !== binding?.user_id))) reason.push('login_email_conflict');
    if (email) emails.set(email, `${vdn}:${id}`);
    if (!map || !binding || binding.work_no !== s.work_no || binding.enabled !== enabled || !user || user.uid !== managedUid(vdn, id, s.work_no) || (user.email?.trim().toLowerCase() || '') !== email) reason.push('identity_projection_mismatch');
    const memberships = members.filter(m => m.user_id === binding?.user_id);
    if (memberships.some(m => m.account_id !== map?.account_id) || (enabled ? !memberships.some(m => m.account_id === map?.account_id && m.role === 1) : memberships.length > 0)) reason.push('membership_projection_mismatch');
    if (enabled && (!s.password || Buffer.byteLength(s.password, 'utf8') > 72 || !user || !await verifyPassword(s.password, user.encrypted_password))) reason.push('source_password_not_synchronized');
    if (reason.length) conflicts.push({ vdn_id: vdn, source_user_id: id, reason: reason.join(',') });
  }
  for (const b of bindings.filter(b => b.enabled)) if (!source.some(s => Number(s.vdn_id) === b.vdn_id && Number(s.id) === b.source_user_id)) conflicts.push({ vdn_id: b.vdn_id, source_user_id: b.source_user_id, reason: 'deleted_source_still_enabled' });
  add('identity_email_membership_passwords', conflicts.length === 0, 'Every projection must match live source identity, status, distinct login email, membership and password');
  const legacyMembers = members.filter(m => m.user_id && !bindings.some(b => b.user_id === m.user_id) && !superusers.some(u => u.id === m.user_id));
  add('legacy_members_reviewed', legacyMembers.length === 0, 'Unbound legacy memberships must be explicitly adopted or archived by a separately reviewed operation');
  return { ready: checks.every(c => c.passed), stage, checks, conflicts, unbound_legacy_memberships: legacyMembers.map(m => ({ user_id: m.user_id, account_id: m.account_id })),
    acceptance_still_required: ['Actual ConfManager and Omni sign-in through the production proxy', 'Live revocation and concurrent synchronization', 'CCS call/SIP/RTP and restore rehearsal'], auto_enabled: false };
}
