import { permissionCatalog } from './access.catalog.js';
import { routePolicy } from './access.route-policy.js';
export const permissionForRoute = (method: string, url: string): string | null => routePolicy(method, url)?.permission ?? null;
/** Stable Omni permission values in ICC subsystem 90. Never reuse a value. */
export const OMNI_SUBSYSTEM = 90;
export const legacyPermissions = [
  { value: 1, code: 'access.manage', name: '用户角色权限管理' },
  { value: 2, code: 'omni.service', name: '全媒体会话处理' },
  { value: 3, code: 'omni.snatch', name: '全媒体抢接' },
  { value: 4, code: 'omni.queue', name: '全媒体排队取回' },
  { value: 5, code: 'omni.conference', name: '全媒体会议' },
  { value: 6, code: 'omni.monitor', name: '全媒体监控' },
  { value: 7, code: 'omni.force', name: '全媒体强制签入签出' },
  { value: 8, code: 'customers.manage', name: '客户管理' },
  { value: 9, code: 'outbound.manage', name: '智能外呼' },
  { value: 10, code: 'inspection.manage', name: '智能质检' },
] as const;
export const omniPermissions = [...legacyPermissions, ...permissionCatalog];
export type PermissionCode = string;

export function legacyPermissionForRoute(method: string, url: string): PermissionCode | null {
  const path = url.split('?')[0]!;
  const workspace: Record<string, PermissionCode> = {
    snatch: 'omni.snatch', 'snatch-targets': 'omni.snatch',
    'queue-take': 'omni.queue', 'queue-sessions': 'omni.queue',
    conference: 'omni.conference', monitor: 'omni.monitor', 'ims-force': 'omni.force',
  };
  if (path.startsWith('/api/omnichannel/workspace/')) {
    return workspace[path.split('/').pop()!] ?? 'omni.service';
  }
  if (/^\/api\/v1\/accounts\/\d+\/(agents|custom_roles|teams)(\/|$)/.test(path) && method !== 'GET') return 'access.manage';
  if (/^\/api\/v1\/accounts\/\d+\/conversations(\/|$)/.test(path)) return 'omni.service';
  if (/^\/api\/omnichannel\/sessions\//.test(path)) return 'omni.service';
  if (/^\/api\/v1\/outbound(\/|$)/.test(path)) return 'outbound.manage';
  if (/^\/api\/v1\/qc(\/|$)/.test(path)) return 'inspection.manage';
  if (/^\/api\/(customers|companies|opportunities)(\/|$)/.test(path)) return 'customers.manage';
  return null;
}

export function assertAcyclicParent(id: number, parent: number, departments: { id: number; parent_id: number }[]) {
  const seen = new Set<number>([id]);
  const parents = new Map(departments.map(d => [d.id, d.parent_id]));
  while (parent > 0) {
    if (seen.has(parent)) throw new Error('上级部门不能是自身或下级部门');
    if (!parents.has(parent)) throw new Error('上级部门不存在');
    seen.add(parent);
    parent = parents.get(parent)!;
  }
}
