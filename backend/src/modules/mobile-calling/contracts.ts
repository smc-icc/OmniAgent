/** V2 contracts. Wire handlers must authenticate/validate before reducing events. */
export type NativeProvider =
  | "fcm"
  | "apns_voip"
  | "harmony_voip"
  | "hms_android"
  | "xiaomi"
  | "oppo"
  | "vivo";
export type Availability =
  | "off_duty"
  | "foreground_ready"
  | "background_reachable"
  | "waking"
  | "in_call"
  | "unavailable";
export type Terminal =
  | "ended"
  | "cancelled"
  | "declined"
  | "wake_timeout"
  | "expired"
  | "superseded";
export interface MobileAttempt {
  attemptId: string;
  offerId: string;
  deviceId: string;
  leaseId: string;
  leaseRevision: number;
  expiresAtMs: number;
  wakeDeadlineMs: number;
  sipReady: boolean;
  acceptRequested: boolean;
  legCreated: boolean;
  acceptAuthorized: boolean;
  acceptAuthorizationRequested?: boolean;
  acceptPermitExpiresAtMs?: number;
  connected: boolean;
  terminal: Terminal | null;
}
export interface CallEvent {
  eventId: string;
  deviceId: string;
  leaseRevision: number;
  kind:
    | "sip_ready"
    | "accept"
    | "leg_created"
    | "cancel"
    | "decline"
    | "timeout"
    | "connected"
    | "end"
    | "accept_authorized";
}
export type CallEffect =
  "prepare_leg" | "authorize_accept" | "end_native" | "fail_offer";
export interface MobilePrincipal {
  accountId: number;
  vdnId: number;
  userId: number;
  loginSid: string;
  bindingVersion: number;
  deviceId: string;
}
export interface PushEnvelope {
  version: 2;
  attemptId: string;
  offerId: string;
  callUuid: string;
  eventId: string;
  expiresAtMs: number;
  displayCaller: string;
}
export interface PushOutcome {
  status:
    | "provider_accepted"
    | "duplicate"
    | "permanent_failure"
    | "retryable_failure";
  providerMessageId?: string;
  code?: string;
}
export interface NativePushProvider {
  send(deviceToken: string, payload: PushEnvelope): Promise<PushOutcome>;
}
