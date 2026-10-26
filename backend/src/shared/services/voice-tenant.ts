import { AppError } from '../errors/index.js';
import { assertLiveBinding, confTenancyEnabled } from './conf-tenancy.js';
import type { ScopeContext } from '../../modules/access/access.scope.js';

export interface VoiceActorInput { userId?: number; vdnId?: number; workNo?: string; agentId?: number | null }
export interface VoiceActor { userId: number; accountId: number; vdnId: number; workNo: string; sourceUserId: number }

/** Request selectors and callback sessions must agree with the live Conf identity. */
export async function resolveVoiceActor(input: VoiceActorInput): Promise<VoiceActor> {
  if (!confTenancyEnabled()) {
    return { userId: input.userId ?? 0, accountId: 1, vdnId: input.vdnId ?? 0,
      workNo: input.workNo ?? '', sourceUserId: input.agentId ?? 0 };
  }
  if (!Number.isSafeInteger(input.userId) || (input.userId ?? 0) <= 0
    || !Number.isSafeInteger(input.vdnId) || (input.vdnId ?? 0) <= 0) {
    throw new AppError(403, '话务身份或 VDN 缺失');
  }
  const { binding, map, user } = await assertLiveBinding(input.userId!);
  if (binding.vdn_id !== input.vdnId || map.vdn_id !== input.vdnId
    || (input.workNo != null && input.workNo !== binding.work_no)) {
    throw new AppError(403, '话务身份与当前租户不一致');
  }
  return { userId: input.userId!, accountId: map.account_id, vdnId: binding.vdn_id,
    workNo: binding.work_no, sourceUserId: Number(user.id) };
}

/** Background CDR work gets only the authenticated operator's same-VDN legs. */
export function voiceReadScope(actor: VoiceActor): ScopeContext {
  return { ...actor, agentId: actor.sourceUserId, administrator: false, systemSuperuser: false,
    permission: 'voice.callback', scopes: ['self'], all: false,
    userIds: [actor.userId], agentIds: [actor.sourceUserId], workNos: [actor.workNo] };
}

export function ownedCcsPayload(
  session: { loggedIn: boolean; agentId: number | null; vdnId: number; workNO: string },
  method: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const id = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value : typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : NaN;
  if (payload.VDNID != null && id(payload.VDNID) !== session.vdnId) {
    throw new AppError(403, 'ICC 控制不能切换到其他 VDN');
  }
  if (method === 'DoAgentLoginEx') {
    if (payload.workNO != null && String(payload.workNO).trim() && String(payload.workNO).trim() !== session.workNO) {
      throw new AppError(403, 'ICC 签入工号不属于当前身份');
    }
    return { ...payload, VDNID: session.vdnId, workNO: session.workNO };
  }
  if (payload.AgentID != null && id(payload.AgentID) !== session.agentId) {
    throw new AppError(403, 'ICC 控制不能借用其他坐席');
  }
  if (/^DoAgent(?:AnswerCall|ReleaseCall|HoldCall|RetrieveHold|ConnectHold|CallOut|ConfCall|ConsultCall|TransferCall)$/.test(method)
    && (!session.loggedIn || !session.agentId)) {
    throw new AppError(403, '坐席尚未话务签入');
  }
  return session.agentId ? { ...payload, AgentID: session.agentId } : { ...payload };
}

export function loginCallbackSession<T extends { workNO: string; vdnId: number; pending: Map<string, { method: string }> }>(
  sessions: T[], payload: Record<string, unknown>,
): T | undefined {
  const matches = sessions.filter(s => s.workNO === payload.workNO
    && (payload.VDNID == null || Number(payload.VDNID) === s.vdnId)
    && [...s.pending.values()].some(p => p.method === 'DoAgentLoginEx'));
  return matches.length === 1 ? matches[0] : undefined;
}
