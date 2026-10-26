export type ProductModule =
  'omni' | 'icc' | 'ivr' | 'itr' | 'outbound' | 'aiqc' | 'flow-designer';
const cleanup = new Set([
  'DoAgentReleaseCall',
  'DoAgentLoggedOff',
  'DoAgentStopPlayFile',
  'DoAgentEndReceiveDTMF',
  'DoHangup',
  'DoReleaseCall',
  'DoAgentSignOutGroup',
  'DoAgentSignOutSkill',
  'DoAgentLogout',
  'ccs.logout',
  'ccs.signOut',
  'DoStopRecord',
  'DoAgentRelease',
  'DoAgentSignOut',
  'DoHangUp',
]);
export function voiceOperationAllowed(method: string, iccAvailable: boolean) {
  return iccAvailable || cleanup.has(method);
}
export function moduleForRequest(
  method: string,
  url: string,
): ProductModule | null {
  const p = url.split('?')[0];
  if (p.startsWith('/api/product-modules')) return null;
  if (/^\/api\/omnichannel\/contacts(?:\/export\.csv)?$/.test(p) &&
      new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '').get('channel_group') === 'phone') return 'icc';
  if (p === '/api/internal/aiqc/task-updated') return null;
  if (p.startsWith('/api/bi/')) return 'icc';
  if (
    /^\/api\/agent\/(?:internal-chats|rest-requests|change-password|push-devices)(?:\/|$)/.test(
      p,
    )
  )
    return null;
  if (
    method === 'POST' &&
    /^\/api\/agent\/voice\/(?:sign-out|startup-failure)$/.test(p)
  )
    return null;
  if (
    method === 'DELETE' &&
    /^\/api\/agent\/extension-(?:binding|requests)(?:\/|$)/.test(p)
  )
    return null;
  if (/^\/api\/access\/(?:extension-|users\/[^/]+\/extension-binding)/.test(p))
    return 'icc';
  if (method === 'POST' && /\/agent\/skill-groups\/sign-out-all$/.test(p))
    return null;
  if (p.startsWith('/api/agent/')) return 'icc';
  if (/\/(?:outbound)(?:\/|$)/.test(p)) return 'outbound';
  if (/\/(?:aiqc|qc|inspection|inspection-manage)(?:\/|$)/.test(p))
    return 'aiqc';
  if (/^\/api\/(?:internal\/)?itr(?:\/|$)/.test(p)) return 'itr';
  if (
    /\/(?:voicemails|monitor|call-center|call-records|recordings|ccs-session)(?:\/|$)/.test(
      p,
    )
  )
    return 'icc';
  if (p.startsWith('/api/platform-config/itr/')) return 'itr';
  return null;
}
