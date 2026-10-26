export const EventTypes = {
  VOICEMAIL_CREATED: 'icc.voicemail.created',
  VOICEMAIL_UPDATED: 'icc.voicemail.updated',
  VOICEMAIL_TRANSCRIBED: 'icc.voicemail.transcribed',
  CALL_STARTED: 'icc.call.started',
  CALL_ENDED: 'icc.call.ended',
  AGENT_LEG_ENDED: 'icc.agent.leg_ended',
  AGENT_STATE_CHANGED: 'icc.agent.state_changed',
  AGENT_LOGIN_CHANGED: 'icc.agent.login_changed',
  RECORDING_READY: 'icc.recording.ready',
  CALL_CDR_WRITTEN: 'icc.call.cdr_written',
  ACD_ROUTE_ENDED: 'icc.acd.route_ended',
  IVR_ROUTE_ENDED: 'icc.ivr.route_ended',
  IVR_TRACE_WRITTEN: 'icc.ivr.trace_written',
} as const;

export type KnownEventType = (typeof EventTypes)[keyof typeof EventTypes];

export interface VoicemailCreatedPayload {
  leavewordId: number | string;
  callerNumber?: string;
  calleeNumber?: string;
  fileName?: string;
  duration?: number;
  vdnId?: number;
}

export interface CallEndedPayload {
  callId?: string;
  /** 雪花 PID，JSON 用字符串避免 JS 精度丢失 */
  pid?: number | string;
  parentPid?: number | string;
  callerNumber?: string;
  calleeNumber?: string;
  callingNo?: string;
  calledNo?: string;
  vdnId?: number;
  vdnName?: string;
  mediaId?: number;
  mediaType?: string;
  logicNo?: number;
  channelGroupId?: number;
  channelGroupName?: string;
  spanId?: number;
  channelNo?: number;
  beginTime?: string | number;
  answerTime?: string | number | null;
  endTime?: string | number | null;
  callDirection?: number;
  callType?: number;
  deviceTypeId?: number;
  releaseCause?: number;
  answerTimeLong?: number;
  talkTimeLong?: number;
  duration?: number;
}

export interface AgentLegEndedPayload {
  pid?: number | string;
  acdRoutePid?: number | string | null;
  baseCallPid?: number | string;
  parentCallPid?: number | string;
  vdnId?: number;
  vdnName?: string;
  mediaId?: number;
  mediaType?: string;
  callingNo?: string;
  calledNo?: string;
  agentGroupId?: number;
  agentGroupName?: string;
  skillId?: number;
  skillName?: string;
  createCallTime?: string | number | null;
  enterIvrTime?: string | number | null;
  enterAcdTime?: string | number | null;
  beginTime?: string | number | null;
  ringTime?: string | number | null;
  answerTime?: string | number | null;
  afterTime?: string | number | null;
  endTime?: string | number | null;
  agentId?: number;
  workNo?: string;
  agentName?: string;
  releaseCause?: number;
  satisficing?: number;
  recordFile?: string;
  callDirection?: number;
  callType?: number;
  ringTimeLong?: number;
  talkTimeLong?: number;
  afterTimeLong?: number;
  label?: number;
  chMediaType?: number;
}

export function matchEventType(pattern: string, eventType: string): boolean {
  if (pattern === eventType || pattern === '*') return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return eventType === prefix || eventType.startsWith(`${prefix}.`);
  }
  if (pattern.includes('*')) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(eventType);
  }
  return false;
}
