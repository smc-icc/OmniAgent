import crypto from 'node:crypto';
import { prisma } from '../../plugins/db.js';
import { sourceUser, sourceVdn, managedUid } from './conf-tenancy.js';
import { isReservedSystemIdentity } from './system-superuser.js';
import { database, rows } from '../../modules/access/access.db.js';
import { hashPassword } from '../utils/password.js';

export interface LegacyAdoption {
  vdn_id: number; account_id: number; source_user_id: number; work_no: string;
  legacy_user_id: number; expected_uid: string; expected_email: string | null;
}
type Column = { table_name: string; column_name: string; data_type: string; user_fk: boolean };
type Reader = { $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Promise<T> };
const q = (name: string) => { if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error('Unsupported database identifier'); return `"${name}"`; };
const referenceNames = new Set(['user_id', 'assignee_id', 'assigned_agent_id', 'owner_id', 'sender_id', 'author_id', 'created_by_id', 'updated_by_id', 'approved_by_id', 'leader_user_id', 'applicant_user_id', 'agent_id']);
const relations = { conversation_id: 'conversations', inbox_id: 'inboxes', team_id: 'teams', contact_id: 'contacts', portal_id: 'portals' };

export async function migrationColumns(db: Reader): Promise<Column[]> {
  return db.$queryRawUnsafe<Column[]>(`SELECT c.table_name, c.column_name, c.data_type,
    EXISTS (SELECT 1 FROM pg_catalog.pg_constraint fk
      JOIN pg_catalog.pg_attribute a ON a.attrelid=fk.conrelid AND a.attnum=ANY(fk.conkey)
      JOIN pg_catalog.pg_attribute f ON f.attrelid=fk.confrelid AND f.attnum=fk.confkey[array_position(fk.conkey,a.attnum)]
      WHERE fk.contype='f' AND fk.conrelid=to_regclass(format('%I.%I',c.table_schema,c.table_name))
        AND a.attname=c.column_name AND fk.confrelid='public.users'::regclass AND f.attname='id') AS user_fk
    FROM information_schema.columns c JOIN information_schema.tables b ON b.table_schema=c.table_schema AND b.table_name=c.table_name
    WHERE c.table_schema='public' AND b.table_type='BASE TABLE' ORDER BY c.table_name,c.column_name`);
}
/** Unknown nonempty references are blockers, not assumed to belong to account 1. */
export async function auditLegacyReferences(db: Reader, columns: Column[], userId: number, accountId: number) {
  const byTable = new Map<string, Set<string>>();
  for (const col of columns) { q(col.table_name); q(col.column_name); const set = byTable.get(col.table_name) ?? new Set<string>(); set.add(col.column_name); byTable.set(col.table_name, set); }
  const inventory: Array<{ table: string; column: string; total: number; unowned: number; fingerprint: string }> = [];
  for (const col of columns) {
    if (col.table_name === 'users' || col.table_name === 'conf_user_bindings') continue;
    const numeric = ['integer', 'bigint', 'smallint'].includes(col.data_type);
    if (!col.user_fk && !(numeric && referenceNames.has(col.column_name))) continue;
    const fields = byTable.get(col.table_name)!;
    const owners: string[] = [], proofs: string[] = [], joins: string[] = [];
    if (fields.has('account_id')) { owners.push('r.account_id'); proofs.push('r.account_id = $2'); }
    for (const [key, target] of Object.entries(relations)) {
      if (!fields.has(key) || !byTable.get(target)?.has('account_id')) continue;
      const alias = `own_${key}`;
      joins.push(`LEFT JOIN public.${q(target)} ${alias} ON ${alias}.id = r.${q(key)}`);
      // Nullable unrelated links need not exist; populated links must prove ownership.
      owners.push(`CASE WHEN r.${q(key)} IS NULL THEN $2 ELSE ${alias}.account_id END`);
      proofs.push(`${alias}.account_id = $2`);
    }
    const owned = owners.length ? `(${owners.map(v => `(${v} = $2)`).join(' AND ')}) AND (${proofs.join(' OR ')})` : 'FALSE';
    const [counts] = await db.$queryRawUnsafe<Array<{ total: bigint; unowned: bigint; fingerprint: string }>>(
      `SELECT $2::integer AS reviewed_account_id, COUNT(*) AS total, COUNT(*) FILTER (WHERE NOT COALESCE((${owned}), FALSE)) AS unowned, md5(COALESCE(string_agg(md5(r::text), ',' ORDER BY md5(r::text)), '')) AS fingerprint FROM public.${q(col.table_name)} r ${joins.join(' ')} WHERE r.${q(col.column_name)} = $1`, userId, accountId);
    inventory.push({ table: col.table_name, column: col.column_name, total: Number(counts.total), unowned: Number(counts.unowned), fingerprint: counts.fingerprint });
  }
  if (byTable.get('contacts')?.has('custom_attributes')) {
    const [counts] = await db.$queryRawUnsafe<Array<{ total: bigint; unowned: bigint; fingerprint: string }>>(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE account_id IS DISTINCT FROM $2) AS unowned, md5(COALESCE(string_agg(md5(r::text), ',' ORDER BY md5(r::text)), '')) AS fingerprint FROM public.contacts r WHERE custom_attributes->>'omni_owner_id' = $1`, String(userId), accountId);
    inventory.push({ table: 'contacts', column: 'custom_attributes.omni_owner_id', total: Number(counts.total), unowned: Number(counts.unowned), fingerprint: counts.fingerprint });
  }
  return inventory;
}
function checkInput(input: LegacyAdoption) {
  for (const key of ['vdn_id', 'account_id', 'source_user_id', 'legacy_user_id'] as const) if (!Number.isSafeInteger(input[key]) || input[key] <= 0) throw new Error('Invalid adoption ID');
  if (typeof input.work_no !== 'string' || !input.work_no || typeof input.expected_uid !== 'string' || !(input.expected_email === null || typeof input.expected_email === 'string')) throw new Error('Expected legacy UID/email and source WorkNO are required');
}
export async function planLegacyAdoption(input: LegacyAdoption, db = prisma as any) {
  checkInput(input);
  const [source, vdn, user, map, sourceBinding, userBinding, account] = await Promise.all([
    sourceUser(input.vdn_id, input.source_user_id), sourceVdn(input.vdn_id),
    db.users.findUnique({ where: { id: input.legacy_user_id } }),
    db.conf_vdn_accounts.findUnique({ where: { vdn_id: input.vdn_id } }),
    db.conf_user_bindings.findUnique({ where: { vdn_id_source_user_id: { vdn_id: input.vdn_id, source_user_id: input.source_user_id } } }),
    db.conf_user_bindings.findUnique({ where: { user_id: input.legacy_user_id } }),
    db.accounts.findUnique({ where: { id: input.account_id }, select: { id: true, name: true } }),
  ]);
  const blockers: string[] = [];
  if (!source || !vdn || source.work_no !== input.work_no) blockers.push('Source VDN/user/WorkNO no longer matches');
  if (!user || user.uid !== input.expected_uid || user.email !== input.expected_email) blockers.push('Legacy UID/email snapshot does not match');
  if (user && (isReservedSystemIdentity(user.uid, user) || user.uid.startsWith('conf-vdn:'))) blockers.push('System/managed identity cannot be adopted');
  if (!account || !map?.enabled || map.account_id !== input.account_id) blockers.push('Explicit enabled VDN/account mapping is required before adoption');
  if (sourceBinding || userBinding) blockers.push('Source or legacy identity is already bound; merging is prohibited');
  const email = source?.email?.trim().toLowerCase() || null;
  const uid = managedUid(input.vdn_id, input.source_user_id, input.work_no);
  const conflict = await db.users.findFirst({ where: { id: { not: input.legacy_user_id }, OR: [...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : []), { uid }] }, select: { id: true } });
  if (conflict) blockers.push('Target login email or UID belongs to another identity');
  const columns = await migrationColumns(db);
  const references = await auditLegacyReferences(db, columns, input.legacy_user_id, input.account_id);
  const accountData: Array<{ table: string; rows: number; fingerprint: string }> = [];
  for (const table of [...new Set(columns.filter(c => c.column_name === 'account_id').map(c => c.table_name))].sort()) {
    const [count] = await db.$queryRawUnsafe(`SELECT COUNT(*) AS total, md5(COALESCE(string_agg(md5(r::text), ',' ORDER BY md5(r::text)), '')) AS fingerprint FROM public.${q(table)} r WHERE account_id = $1`, input.account_id);
    accountData.push({ table, rows: Number(count.total), fingerprint: count.fingerprint });
  }
  if (references.some(r => r.unowned > 0)) blockers.push('Historical references have foreign or unproven account ownership; split/repair requires a separate reviewed migration');
  const payload = { version: 1, operation: 'adopt_preserving_user_id', input, account, source: source ?? null, target: { uid, email },
    legacy: user ? { id: user.id, uid: user.uid, email: user.email, type: user.type, updated_at: user.updated_at } : null,
    references, target_account_data: accountData, blockers, limitations: ['No user merging or historical account movement', 'Only FK/named numeric references and contacts.omni_owner_id are inspected; external/custom JSON ownership requires manual audit', 'Maintenance and restore-tested backups are required; no automatic activation'] };
  const digest = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return { ...payload, digest, applicable: blockers.length === 0 };
}
/** Offline, explicit adoption preserves every relational user ID and history row. */
export async function applyLegacyAdoption(input: LegacyAdoption, reviewedDigest: string, backupReceiptDigest: string) {
  if (process.env.CONF_TENANCY_MAINTENANCE !== '1') throw new Error('CONF_TENANCY_MAINTENANCE=1 and stopped writers are required');
  if (!/^[a-f0-9]{64}$/.test(reviewedDigest) || !/^[a-f0-9]{64}$/.test(backupReceiptDigest)) throw new Error('Reviewed plan and verified backup receipts are required');
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(193655, 2)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(193655, 1)`;
    // Block concurrent PG writers to inventoried tables until commit. Source services
    // must be stopped separately; two independent databases are not a distributed tx.
    const columns = await migrationColumns(tx);
    const tables = [...new Set(columns.map(c => c.table_name))].sort();
    if (tables.length) await tx.$executeRawUnsafe(`LOCK TABLE ${tables.map(t => `public.${q(t)}`).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
    const plan = await planLegacyAdoption(input, tx);
    if (!plan.applicable || plan.digest !== reviewedDigest) throw new Error('Plan blocked or changed since review; generate a fresh dry-run');
    const [credential] = await rows<{ password: string }>(await database(), 'SELECT PassWord AS password FROM t_user_users WHERE ID = ? AND VDNID = ?', [input.source_user_id, input.vdn_id]);
    if (!credential?.password || Buffer.byteLength(credential.password, 'utf8') > 72) throw new Error('Source password cannot be represented safely');
    const enabled = Number(plan.source!.enabled) === 1;
    await tx.users.update({ where: { id: input.legacy_user_id }, data: { uid: plan.target.uid, email: plan.target.email, name: plan.source!.name,
      encrypted_password: await hashPassword(credential.password), confirmed_at: new Date(), tokens: {}, reset_password_token: null, unconfirmed_email: null, confirmation_token: null,
      pubsub_token: crypto.randomBytes(16).toString('hex') } });
    await tx.conf_user_bindings.create({ data: { vdn_id: input.vdn_id, source_user_id: input.source_user_id, user_id: input.legacy_user_id, work_no: input.work_no, enabled } });
    if (enabled) await tx.account_users.upsert({ where: { account_id_user_id: { account_id: input.account_id, user_id: input.legacy_user_id } },
      create: { account_id: input.account_id, user_id: input.legacy_user_id, role: 1, availability: 1 }, update: { role: 1 } });
    else await tx.account_users.deleteMany({ where: { account_id: input.account_id, user_id: input.legacy_user_id } });
    return { applied: true, preserved_user_id: input.legacy_user_id, moved_history_rows: 0, vdn_id: input.vdn_id, account_id: input.account_id, reviewed_digest: reviewedDigest, backup_receipt_digest: backupReceiptDigest };
  // READ COMMITTED is deliberate: take the reviewed data snapshot AFTER table
    // locks are acquired, not a stale SERIALIZABLE snapshot from the first query.
  }, { maxWait: 10000, timeout: 60000, isolationLevel: 'ReadCommitted' });
}
