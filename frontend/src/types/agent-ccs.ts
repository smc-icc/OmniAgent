/** CCS agent_struct / agent.tars 核心类型（JSON 字段与 TARS 一致） */

export interface CcsSocketMessage {
  op: 'invoke' | 'ack' | 'evt'
  method: string
  reqId?: string
  payload: Record<string, unknown>
}

export interface StAgentLoginEx {
  VDNID?: number
  workNO?: string
  password?: string
  extension?: string
  ComputerName?: string
  AgentType?: number
  Priority?: number
  AgentPrxEndpoint?: string
  AgentStatus?: number
}

export interface StAgentLoginExAck {
  VDNID?: number
  workNO?: string
  AgentID?: number
  Result?: number
  AutoAnswer?: number
  AgentName?: string
  UUID?: string
  CallerNO?: string
}

export interface StAgentOnCallOfferedEvt {
  /** Original call media, supplied by CCS: 0=audio, 1=video. Missing stays audio. */
  MediaType?: number
  AgentID?: number
  CallID?: number
  CallIDType?: number
  /** EU_AgentCallOfferType：2=坐席呼坐席，5=监听，6=强插，7=呼转，8=抢接，9=拦截，10=外呼外线，12=话机直拨 */
  CallOfferedType?: number
  Caller?: string
  Called?: string
  DNIS?: string
  AreaCode?: string
  CallData?: string
  VDNName?: string
  AgentGroupID?: number
  SkillID?: number
  SkillGroupName?: string
  TotalQueueWaitNum?: number
  BaseCallPID?: number
  AgCallPID?: number
  PrivateInfo?: string
  JsonPrivateInfo?: string
}

/** CCS EU_CCS_AgentStatus / AgentLegacyVoiceStatus 位值（SelfStatusUpdate.AgentStatus[0]） */
export const CCS_AS = {
  Unknown: 1,
  SetBusy: 2,
  AUX: 4,
  Block: 8,
  Available: 16,
  Idle: 32,
  Ring: 64,
  CallOut: 128,
  Talking: 256,
  Hold: 512,
  AfterCallWork: 1024,
  /** 监听与强插共用 CCS_AS_InspectStatus（Focus 无单独监听位） */
  InspectStatus: 2048,
  OffLine: 4096,
  /** 分机暂时不可用 StatsBit(16) */
  ExtTemporarilyUnavailable: 65536,
  /** 分机不存在 StatsBit(17) */
  ExtNotExist: 131072,
  /** 分机未注册 StatsBit(18) */
  ExtUnregistered: 262144,
} as const

export const CCS_OFFER = {
  Inbound: 1,
  Agent: 2,
  Monitor: 5,
  Insert: 6,
  Transfer: 7,
  Snatch: 8,
  Intercept: 9,
  CallOut: 10,
  TelAgent: 12,
} as const

export function isSupervisorOffer(t: number): boolean {
  return t === CCS_OFFER.Monitor || t === CCS_OFFER.Insert || t === CCS_OFFER.Intercept
}

export function supervisorOfferLabel(t: number): string {
  if (t === CCS_OFFER.Monitor) return '监听'
  if (t === CCS_OFFER.Insert) return '强插'
  if (t === CCS_OFFER.Intercept) return '拦截'
  return ''
}

export interface StAgentSelfStatusUpdateEvt {
  AgentID?: number
  AgentStatus?: number | number[] | { value?: number[] }
  AcwTime?: number
}

export interface StAgentReceiveRealTimeSpeechRecognitionTextEvt {
  VDNID?: number
  AgentID?: number
  CallIDType?: number
  RecogPID?: number
  Text?: string
}

export interface StAgentAnswerCall {
  AgentID?: number
  CallID?: number
  CallIDType?: number
}

export interface StAgentReleaseCall {
  AgentID?: number
  CallID?: number
  CallIDType?: number
}

export interface StAgentHoldCall {
  AgentID?: number
  CallID?: number
  CallIDType?: number
  NoMusic?: number
}

export interface StAgentRetrieveHold {
  AgentID?: number
  CallID?: number
  CallIDType?: number
}

export interface StAgentCallOut {
  AgentID?: number
  dwCh?: number
  szPhoneNo?: string
  szCallerNO?: string
  AgentCalltype?: number
  GroupID?: number
  SkillID?: number
  MediaType?: 0 | 1
}

export type CcsCallPhase = 'idle' | 'ringing' | 'talking' | 'held'
