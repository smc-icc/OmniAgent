import { AppError } from '../../shared/errors/index.js';
export type BindingAction = 'bind' | 'unbind' | 'replace';
export type VoiceStartupState = 'unbound' | 'signing_in' | 'signed_in' | 'failed' | 'signed_out';
export function bindingAction(old: string, target: string): BindingAction {
  return !old ? 'bind' : !target ? 'unbind' : 'replace';
}
export function assertVoiceIdle(session?: { status: string; currentCall: unknown } | null): void {
  if (session && (['ringing', 'talking', 'hold'].includes(session.status) || session.currentCall))
    throw new AppError(
      409,
      '振铃、通话、保持或活动呼叫期间不能解绑或换绑',
      'extension_call_active',
    );
}
export function assertBindingChange(input: {
  old: string;
  target: string;
  version: number;
  expectedVersion: number;
  permissions: string[];
  self: boolean;
}): void {
  if (input.version !== input.expectedVersion)
    throw new AppError(409, '绑定版本已变化，请刷新后重新操作', 'extension_version_stale');
  if (input.old === input.target) throw new AppError(409, '分机绑定未变化');
  const required = input.self
    ? [
        ...(input.target ? ['extension.bind_self'] : []),
        ...(input.old ? ['extension.unbind_self'] : []),
      ]
    : ['extension.assign'];
  for (const permission of required)
    if (!input.permissions.includes(permission))
      throw new AppError(
        403,
        permission === 'extension.unbind_self'
          ? '没有直接解绑权限，请提交申请'
          : '没有直接绑定或分配权限，请提交申请',
      );
}
export function voiceState(
  extension: string,
  input: {
    explicitlySignedOut?: boolean;
    failed?: boolean;
    signedIn?: boolean;
    voiceSessionExpected?: boolean;
  },
): VoiceStartupState {
  return !extension
    ? 'unbound'
    : input.explicitlySignedOut
      ? 'signed_out'
      : input.failed
        ? 'failed'
        : input.signedIn
          ? 'signed_in'
          : 'signing_in';
}

export function ownedRevocationNumbers(old:string,target:string,vdn:number,owners:Array<{num:string;vdn:number}>):string[]{
  const foreign=new Set(owners.filter(o=>Number(o.vdn)!==vdn).map(o=>o.num));
  if(target && foreign.has(target))throw new AppError(409,'目标分机不属于当前 VDN');
  return [...new Set([old,target].filter(n=>n && !foreign.has(n)))];
}
