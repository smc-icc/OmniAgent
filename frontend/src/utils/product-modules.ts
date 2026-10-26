export function moduleForPage(path: string): string | null {
  if (/^\/(?:m\/)?(?:dialer|monitor|voicemail)(?:\/|$)/.test(path))
    return 'icc';
  if (path === '/m/messages') return 'icc';
  if (/^\/(?:outbound)(?:\/|$)/.test(path)) return 'outbound';
  if (/^\/(?:inspection|inspection-manage|qc)(?:\/|$)/.test(path))
    return 'aiqc';
  return null;
}
export const cleanupVoiceMethods = new Set([
  'DoAgentReleaseCall',
  'DoAgentLoggedOff',
  'DoAgentStopPlayFile',
  'DoAgentEndReceiveDTMF',
  'DoHangup',
  'DoHangUp',
  'DoReleaseCall',
  'DoAgentSignOutGroup',
  'DoAgentSignOutSkill',
  'DoAgentLogout',
  'ccs.logout',
  'ccs.signOut',
  'DoStopRecord',
  'DoAgentRelease',
  'DoAgentSignOut',
]);

export function moduleForTile(label:string):string|null{return ['话务管理','专项管理','报表管理','业务监控与调度'].includes(label)?'icc':null;}

export function voiceEventAllowed(method: string, iccAvailable: boolean): boolean {
  return iccAvailable || method !== 'OnAgentOnCallOfferedEvt'
}
