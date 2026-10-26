import type { MobilePrincipal } from "./contracts.js";
import type { NetworkGeneration } from "../mobile-network/contracts.js";
import { acceptsNetworkProof } from "../mobile-network/network-policy.js";
import { MysqlMobileRepository, type StoredAttempt } from "./repository.js";
import type { MobileCcsPort } from "./push-dispatcher.js";

export interface MobileCallServicePorts {
  /** Reload the current login, tenant, VDN and extension binding. Never echo unverified client fields. */
  currentIdentity(stored: MobilePrincipal): Promise<MobilePrincipal | null>;
  sipCredentials(
    principal: MobilePrincipal,
    attempt: StoredAttempt,
  ): Promise<unknown>;
  /** Verify the current registry flow, managed extension and registration identity at the trusted server boundary. */
  verifyRegistration(
    attempt: StoredAttempt,
    registrationId: string,
    generation: NetworkGeneration,
  ): Promise<boolean>;
  ccs: MobileCcsPort;
}
export interface NativeCallEvent {
  eventId: string;
  kind: "sip_ready" | "accept" | "decline" | "connected" | "end";
  generation: NetworkGeneration;
  registrationId?: string;
}
const samePrincipal = (a: MobilePrincipal, b: MobilePrincipal) =>
  a.accountId === b.accountId &&
  a.vdnId === b.vdnId &&
  a.userId === b.userId &&
  a.loginSid === b.loginSid &&
  a.bindingVersion === b.bindingVersion &&
  a.deviceId === b.deviceId;

export class MobileCallService {
  constructor(
    private readonly repository: MysqlMobileRepository,
    private readonly ports: MobileCallServicePorts,
    private readonly clock: () => number = Date.now,
  ) {}
  private async context(
    attemptId: string,
  ): Promise<{ attempt: StoredAttempt; principal: MobilePrincipal }> {
    const attempt = await this.repository.getAttempt(attemptId);
    const lease = attempt
      ? await this.repository.getLease(attempt.leaseId)
      : null;
    if (!attempt || !lease) throw new Error("mobile_authorization_denied");
    const principal = await this.ports.currentIdentity(lease.principal);
    if (!principal || !samePrincipal(principal, lease.principal))
      throw new Error("mobile_authorization_denied");
    return { attempt, principal };
  }
  private async verifyOffer(attempt: StoredAttempt): Promise<void> {
    const current = await this.ports.ccs.currentOffer(attempt.offerId);
    if (
      !current ||
      !current.active ||
      current.offerId !== attempt.offerId ||
      current.leaseId !== attempt.leaseId ||
      current.leaseRevision !== attempt.state.leaseRevision ||
      current.agentId !== attempt.context.agentId ||
      current.vdnId !== attempt.context.vdnId
    )
      throw new Error("offer_no_longer_current");
  }
  async bootstrap(
    attemptId: string,
    grantSecret: string,
    network: { runtimeId: string; networkEpoch: number },
  ) {
    const { attempt, principal } = await this.context(attemptId);
    await this.verifyOffer(attempt);
    const capability = await this.repository.bootstrapAttempt(
      attemptId,
      grantSecret,
      principal,
      this.clock(),
    );
    const generation = await this.repository.bindNetworkContext(
      attemptId,
      network,
      this.clock(),
    );
    const credentials = await this.ports.sipCredentials(principal, attempt);
    // A cancellation during credential lookup must not issue credentials for an obsolete offer.
    await this.verifyOffer(attempt);
    if (
      !(await this.repository.verifyAttemptToken(
        attemptId,
        capability.operationToken,
        principal,
        this.clock(),
      ))
    )
      throw new Error("mobile_authorization_denied");
    return {
      attemptId,
      offerId: attempt.offerId,
      operationToken: capability.operationToken,
      operationTokenExpiresAtMs: capability.expiresAtMs,
      expiresAtMs: attempt.state.expiresAtMs,
      wakeDeadlineMs: attempt.state.wakeDeadlineMs,
      generation,
      credentials,
    };
  }
  async nativeEvent(
    attemptId: string,
    operationToken: string,
    event: NativeCallEvent,
  ) {
    if (
      !["sip_ready", "accept", "decline", "connected", "end"].includes(
        event.kind,
      )
    )
      throw new Error("native_event_not_allowed");
    if (!/^[A-Za-z0-9-]{1,64}$/.test(event.eventId))
      throw new Error("invalid_event_id");
    const { attempt, principal } = await this.context(attemptId);
    if (
      !(await this.repository.verifyAttemptToken(
        attemptId,
        operationToken,
        principal,
        this.clock(),
      ))
    )
      throw new Error("mobile_authorization_denied");
    if (
      !attempt.network ||
      !acceptsNetworkProof(attempt.network, event.generation)
    )
      throw new Error("network_proof_stale");
    if (event.kind === "sip_ready") {
      await this.verifyOffer(attempt);
      if (
        !event.registrationId ||
        !(await this.ports.verifyRegistration(
          attempt,
          event.registrationId,
          event.generation,
        ))
      )
        throw new Error("registration_not_verified");
    }
    if (event.kind === "accept") await this.verifyOffer(attempt);
    return this.repository.applyEvent(
      attemptId,
      {
        eventId: event.eventId,
        deviceId: principal.deviceId,
        leaseRevision: attempt.state.leaseRevision,
        kind: event.kind,
      },
      this.clock(),
    );
  }
  async state(attemptId: string, operationToken: string) {
    const { attempt, principal } = await this.context(attemptId);
    if (
      !(await this.repository.verifyAttemptToken(
        attemptId,
        operationToken,
        principal,
        this.clock(),
        true,
      ))
    )
      throw new Error("mobile_authorization_denied");
    return {
      offerId: attempt.offerId,
      attemptId: attemptId,
      terminal: attempt.state.terminal,
      connected: attempt.state.connected,
      acceptAuthorized: attempt.state.acceptAuthorized,
      acceptPermitExpiresAtMs: attempt.state.acceptPermitExpiresAtMs ?? null,
      generation: attempt.network,
      expiresAtMs: attempt.state.expiresAtMs,
    };
  }
}
