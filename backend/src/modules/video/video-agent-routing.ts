import type { VideoEntry } from './video-customer.policy.js';
export interface VideoRoutingRow { vdn_id: number; access_code: string; group_id: number; skill_id: number }
/** Rows must already be restricted to this operator's valid group/skill memberships. */
export function selectVideoRouting(entries: VideoEntry[], vdnId: number, rows: VideoRoutingRow[]) {
 const codes = new Set(entries.filter(e => e.vdnId === vdnId).map(e => e.accessCode));
 const eligible = rows.filter(r => Number(r.vdn_id) === vdnId && codes.has(r.access_code)
   && Number.isSafeInteger(Number(r.group_id)) && Number(r.group_id) > 0
   && Number.isSafeInteger(Number(r.skill_id)) && Number(r.skill_id) > 0);
 return { group_ids: [...new Set(eligible.map(r => Number(r.group_id)))],
   skill_ids: [...new Set(eligible.map(r => Number(r.skill_id)))] };
}
