/** Only agent-facing RPCs may enter through a browser socket. CCS still checks its native powers. */
export const ccsPermissions: Record<string, string> = {};
const methods = ccsPermissions;
function allow(permission: string, names: string) { for (const name of names.split(' ')) methods[name] = permission; }
allow('session', 'ccs.registerCredentials DoGetAgentInterfaceVersion DoAgentLoginEx DoAgentLoggedOff DoAgentSignInGroup DoAgentSignOutGroup DoAgentSignInSkill DoAgentSignOutSkill DoAgentGetAllGroupInfo DoAgentGetGroupReq DoAgentGetSkillReq DoAgentGetAcdSkillListByGroupID DoAgentSetBusy DoAgentSetIdle DoAgentRequestRest');
allow('conversation.reply', 'DoAgentAnswerCall DoAgentHoldCall DoAgentRetrieveHold DoAgentConnectHold DoAgentBeginMute DoAgentEndMute DoAgentPlayFile DoAgentStopPlayFile DoAgentReceiveDTMF DoAgentEndReceiveDTMF DoAgentSetCallData DoAgentRequestTextProc DoAgentSendMsg');
allow('conversation.read', 'DoAgentQueryCallData');
allow('conversation.create', 'DoAgentCallOut DoAgentCallAgent');
allow('conversation.close', 'DoAgentReleaseCall');
allow('conversation.transfer', 'DoAgentTransferIVR DoAgentTransferOut DoAgentTransferAgentGroup DoAgentTransferAgent DoAgentSetTransferIVR');
allow('conversation.conference', 'DoAgentConfCall DoAgentInviteToConf DoAgentKickOut DoAgentChangeConfMode DoAgentJoinToConfCall');
allow('conversation.snatch', 'DoAgentSnatchCall');
allow('monitor.intervene', 'DoAgentForceInsert DoAgentForceRelease DoAgentMonitor DoAgentIntercept');
allow('monitor.force', 'DoAgentForceLogOut DoAgentForceIdle DoAgentForceBusy DoAgentForceBlock');
allow('monitor.read', 'DoAgentMonitorLogin DoAgentRequestAgentStatus DoAgentGetUserListByGroupID DoAgentGetUserListBySkillID DoRequestAgentStatus DoRequestAllAgentStatus DoGetTotalAgentInfo DoRequestAgentGroupStatus DoRequestCCSOutlineView');
allow('schedule.approve', 'DoAgentApproveRest');
export function ccsPermission(method: string) { return methods[method]; }
export function bindCcsIdentity(payload: Record<string, unknown>, identity: { workNO: string; vdnId: number; agentId?: number | null }, login: boolean) {
  for (const key of ['VDNID', 'vdnId']) if (payload[key] != null && Number(payload[key]) !== identity.vdnId) throw new Error('不能切换话务 VDN');
  if (login && payload.workNO != null && String(payload.workNO).trim() !== identity.workNO) throw new Error('话务工号必须匹配当前账号');
  if (!login && payload.AgentID != null && Number(payload.AgentID) !== identity.agentId) throw new Error('不能冒用其他坐席身份');
  if (login) { payload.workNO = identity.workNO; payload.VDNID = identity.vdnId; payload.vdnId = identity.vdnId; delete payload.AgentPrxEndpoint; }
  else if (identity.agentId != null) payload.AgentID = identity.agentId;
}
