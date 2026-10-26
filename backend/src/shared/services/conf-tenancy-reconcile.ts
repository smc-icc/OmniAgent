import { prisma } from '../../plugins/db.js';
import { database, rows } from '../../modules/access/access.db.js';
import { syncVdn, syncManagedUser } from './conf-tenancy-sync.js';
import { confTenancyEnabled } from './conf-tenancy.js';

export interface ReconcileOptions { apply?: boolean; allowCreate?: boolean; vdnsOnly?: boolean; bindings?: Record<number, number> }
export interface ReconcileJob { kind: 'vdn' | 'user'; action: 'upsert' | 'delete'; vdn_id: number; account_id?: number; source_user_id?: number; work_no?: string }
/** Snapshot contains identity references only. Every apply re-reads the live source; no passwords or stale grants are queued. */
export async function reconcileConfTenancy(options: ReconcileOptions = {}) {
  if (options.apply && !confTenancyEnabled() && process.env.CONF_TENANCY_MAINTENANCE !== '1') throw new Error('Apply requires managed mode or explicit offline maintenance');
  for (const [vdn, account] of Object.entries(options.bindings ?? {})) {
    if (!/^[1-9]\d*$/.test(vdn) || !Number.isSafeInteger(Number(vdn)) || !Number.isSafeInteger(account) || account <= 0) throw new Error('Invalid explicit account binding');
  }
  const db = await database();
  const vdns = await rows<{ id: number }>(db, 'SELECT ID AS id FROM t_icc_vdn WHERE ID > 0 ORDER BY ID');
  const users = await rows<{ vdn_id: number; source_user_id: number; work_no: string }>(db,
    'SELECT VDNID AS vdn_id, ID AS source_user_id, WorkNO AS work_no FROM t_user_users WHERE VDNID > 0 ORDER BY VDNID, ID');
  const [maps, bindings] = await Promise.all([prisma.conf_vdn_accounts.findMany(), prisma.conf_user_bindings.findMany()]);
  const liveVdns = new Set(vdns.map(v => Number(v.id)));
  for (const vdn of Object.keys(options.bindings ?? {})) if (!liveVdns.has(Number(vdn))) throw new Error('Explicit binding must refer to a live VDN');
  const liveUsers = new Set(users.map(u => `${u.vdn_id}:${u.source_user_id}`));
  const jobs: ReconcileJob[] = [];
  const blocked: Array<{ vdn_id: number; reason: string }> = [];
  for (const { id } of vdns) {
    const map = maps.find(m => m.vdn_id === Number(id));
    const hint = options.bindings?.[Number(id)];
    if (map && (!map.enabled || (hint && hint !== map.account_id))) {
      blocked.push({ vdn_id: Number(id), reason: 'Tombstoned mapping or forbidden remap; explicit audited migration required' }); continue;
    }
    if (!map && !hint && !options.allowCreate) {
      blocked.push({ vdn_id: Number(id), reason: 'Provide --bind VDN:ACCOUNT or explicitly allow creation of a new empty account' }); continue;
    }
    jobs.push({ kind: 'vdn', action: 'upsert', vdn_id: Number(id), ...(hint ? { account_id: hint } : {}) });
    for (const u of (options.vdnsOnly ? [] : users).filter(u => Number(u.vdn_id) === Number(id))) jobs.push({ kind: 'user', action: 'upsert', ...u });
    for (const b of (options.vdnsOnly ? [] : bindings).filter(b => b.vdn_id === Number(id) && !liveUsers.has(`${b.vdn_id}:${b.source_user_id}`))) {
      jobs.push({ kind: 'user', action: 'delete', vdn_id: b.vdn_id, source_user_id: b.source_user_id, work_no: b.work_no });
    }
  }
  // Tombstone deleted tenants; historical accounts/users/conversations are retained.
  for (const map of maps.filter(m => m.enabled && !liveVdns.has(m.vdn_id))) jobs.push({ kind: 'vdn', action: 'delete', vdn_id: map.vdn_id });
  const results: Array<{ job: ReconcileJob; status: 'applied' | 'pending'; reason?: string }> = [];
  if (options.apply) {
    const failedVdns = new Set<number>();
    for (const job of jobs) {
      try {
        if (job.kind === 'vdn') await syncVdn({ action: job.action, vdn_id: job.vdn_id, ...(job.account_id ? { account_id: job.account_id } : {}) });
        else {
          if (failedVdns.has(job.vdn_id)) throw new Error('Tenant projection pending');
          await syncManagedUser({ action: job.action, vdn_id: job.vdn_id, source_user_id: job.source_user_id!, work_no: job.work_no! });
        }
        results.push({ job, status: 'applied' });
      } catch {
        if (job.kind === 'vdn') failedVdns.add(job.vdn_id);
        // Intentionally do not serialize SQL errors/credentials.
        results.push({ job, status: 'pending', reason: 'Verify source identity, mapping, distinct login email and backend availability; retry reconciliation' });
      }
    }
  }
  return { mode: options.apply ? 'apply' : 'dry-run', jobs, blocked, results, success: !blocked.length && !results.some(r => r.status === 'pending') };
}
