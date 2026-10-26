import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { readFile } from "node:fs/promises";
import {
  MobileCallService,
  type MobileCallServicePorts,
} from "../../modules/mobile-calling/call-service.js";
import { runMobileOutboxOnce } from "../../modules/mobile-calling/worker.js";
import type { MobileExecutionPorts } from "../../modules/mobile-calling/push-dispatcher.js";
import { MysqlMobileRepository } from "../../modules/mobile-calling/repository.js";
import type { MobilePrincipal } from "../../modules/mobile-calling/contracts.js";

let pool: Pool;
let repository: MysqlMobileRepository;
const actor = {
  accountId: 1,
  vdnId: 10,
  userId: 20,
  loginSid: "session-1",
  bindingVersion: 4,
};
const tables = [
  "omni_mobile_push_outbox",
  "omni_mobile_call_events",
  "omni_mobile_call_attempts",
  "omni_mobile_duty_leases",
  "omni_mobile_push_tokens",
  "omni_mobile_devices",
];
async function device(certified = true) {
  const created = await repository.registerDevice({
    principal: actor,
    platform: "android",
    appVersion: "1.0-test",
    provider: "fcm",
    token: "provider-token-" + crypto.randomUUID(),
    appId: "test-app",
    environment: "test",
    nowMs: 1000,
  });
  if (certified)
    await repository.certifyDevice(created.deviceId, "lab-profile", 1000);
  return {
    principal: { ...actor, deviceId: created.deviceId } as MobilePrincipal,
    created,
  };
}
async function duty(principal: MobilePrincipal) {
  const created = await repository.startDuty({
    principal,
    nowMs: 1000,
    expiresAtMs: 100000,
    mode: "background",
  });
  await repository.activateLease(created.leaseId, created.leaseRevision, 1100);
  return created;
}

beforeAll(async () => {
  const raw = process.env.MOBILE_TEST_DATABASE_URL;
  if (!raw)
    throw new Error("Use an explicitly provisioned local mobile test database");
  const url = new URL(raw);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "13306" ||
    url.pathname !== "/omni_mobile_test"
  ) {
    throw new Error("Refusing to mutate a non-lab database");
  }
  pool = mysql.createPool(raw);
  const ddl = await readFile(
    new URL("../../../sql/mobile-calling.sql", import.meta.url),
    "utf8",
  );
  for (const sql of ddl
    .split("-- statement")
    .map((s) => s.trim())
    .filter(Boolean))
    await pool.query(sql);
  // Reapplying the incremental migration must preserve all existing tables.
  for (const sql of ddl
    .split("-- statement")
    .map((s) => s.trim())
    .filter(Boolean))
    await pool.query(sql);
  repository = new MysqlMobileRepository(pool, Buffer.alloc(32, 7));
});
beforeEach(async () => {
  // The endpoint/schema guard above is mandatory before these test-only deletes.
  for (const table of tables) await pool.query("DELETE FROM " + table);
});
afterAll(async () => {
  if (pool) await pool.end();
});

describe("durable mobile identity and outbox", () => {
  it("does not persist plaintext provider tokens", async () => {
    const { principal } = await device();
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT token_ciphertext FROM omni_mobile_push_tokens WHERE device_id=?",
      [principal.deviceId],
    );
    expect(rows[0].token_ciphertext).toMatch(/^omc2[.]/);
    expect(rows[0].token_ciphertext).not.toContain("provider-token-");
  });
  it("refuses background duty without server-side device certification", async () => {
    const { principal } = await device(false);
    await expect(duty(principal)).rejects.toThrow("device_not_certified");
  });
  it("keeps a newly issued duty pending until CCS confirms it", async () => {
    const { principal } = await device();
    const created = await repository.startDuty({
      principal,
      nowMs: 1000,
      expiresAtMs: 100000,
      mode: "background",
    });
    expect((await repository.getLease(created.leaseId))?.state).toBe("pending");
    await repository.activateLease(
      created.leaseId,
      created.leaseRevision,
      1100,
    );
    expect((await repository.getLease(created.leaseId))?.state).toBe("active");
  });
  it("allows only one active primary device under simultaneous duty requests", async () => {
    const a = await device(),
      b = await device();
    const result = await Promise.allSettled([
      duty(a.principal),
      duty(b.principal),
    ]);
    expect(result.some((x) => x.status === "fulfilled")).toBe(true);
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT lease_id FROM omni_mobile_duty_leases WHERE active_slot IS NOT NULL",
    );
    expect(rows).toHaveLength(1);
  });
  it("never lets another VDN start duty with the same installation id", async () => {
    const { principal } = await device();
    await expect(duty({ ...principal, vdnId: 11 })).rejects.toThrow(
      "device_identity_mismatch",
    );
  });
  it("revokes all old leases when the login identity is invalidated", async () => {
    const { principal } = await device();
    const lease = await duty(principal);
    await repository.revokeIdentity(principal, "session_replaced", 2000);
    expect((await repository.getLease(lease.leaseId))?.state).toBe("revoked");
    expect((await repository.getLease(lease.leaseId))?.activeSlot).toBeNull();
  });
  it("deduplicates prepared callbacks and atomically creates one push job", async () => {
    const { principal } = await device();
    const lease = await duty(principal);
    const offerId = crypto.randomUUID();
    const input = {
      offerId,
      leaseId: lease.leaseId,
      createdAtMs: 2000,
      nowMs: 2000,
      expiresAtMs: 32000,
      context: {
        agentId: 20,
        vdnId: 10,
        callId: 100,
        callIdType: 0,
        offeredType: 1,
      },
    };
    const first = await repository.createAttempt(input);
    const second = await repository.createAttempt(input);
    expect(second.attemptId).toBe(first.attemptId);
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT kind FROM omni_mobile_push_outbox",
    );
    expect(rows.map((x) => x.kind)).toEqual(["push"]);
  });
  it("persists the ready effect exactly once across duplicate callbacks", async () => {
    const { principal } = await device();
    const lease = await duty(principal);
    const a = await repository.createAttempt({
      offerId: crypto.randomUUID(),
      leaseId: lease.leaseId,
      createdAtMs: 2000,
      nowMs: 2000,
      expiresAtMs: 32000,
      context: {
        agentId: 20,
        vdnId: 10,
        callId: 100,
        callIdType: 0,
        offeredType: 1,
      },
    });
    const event = {
      eventId: crypto.randomUUID(),
      deviceId: principal.deviceId,
      leaseRevision: lease.leaseRevision,
      kind: "sip_ready" as const,
    };
    await repository.applyEvent(a.attemptId, event, 3000);
    await repository.applyEvent(a.attemptId, event, 3001);
    const restored = new MysqlMobileRepository(pool, Buffer.alloc(32, 7));
    expect((await restored.getAttempt(a.attemptId))?.state.sipReady).toBe(true);
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT kind FROM omni_mobile_push_outbox WHERE kind='prepare_leg'",
    );
    expect(rows).toHaveLength(1);
  });
  it("does not restart the CCS wake budget when Prepared is delivered late", async () => {
    const { principal } = await device();
    const lease = await duty(principal);
    const a = await repository.createAttempt({
      offerId: crypto.randomUUID(),
      leaseId: lease.leaseId,
      createdAtMs: 2000,
      nowMs: 8000,
      expiresAtMs: 32000,
      context: {
        agentId: 20,
        vdnId: 10,
        callId: 100,
        callIdType: 0,
        offeredType: 1,
      },
    });
    expect(a.state.wakeDeadlineMs).toBe(10000);
  });
  it("clears the old certification and duty when the application version changes", async () => {
    const created = await repository.registerDevice({
      principal: actor,
      platform: "android",
      appVersion: "1",
      provider: "fcm",
      token: "persistent-local-provider-token",
      appId: "test-app",
      environment: "test",
      nowMs: 1000,
    });
    await repository.certifyDevice(
      created.deviceId,
      "version-1-certified",
      1000,
    );
    const lease = await duty({ ...actor, deviceId: created.deviceId });
    await repository.registerDevice({
      principal: actor,
      platform: "android",
      appVersion: "2",
      provider: "fcm",
      token: "persistent-local-provider-token",
      appId: "test-app",
      environment: "test",
      nowMs: 2000,
    });
    expect((await repository.getLease(lease.leaseId))?.state).toBe("revoked");
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT certified_profile_id FROM omni_mobile_devices WHERE device_id=?",
      [created.deviceId],
    );
    expect(rows[0].certified_profile_id).toBeNull();
  });
  it("requeues an unconnected offer when its login identity is revoked", async () => {
    const { principal } = await device();
    const lease = await duty(principal);
    await repository.createAttempt({
      offerId: crypto.randomUUID(),
      leaseId: lease.leaseId,
      createdAtMs: 2000,
      nowMs: 2000,
      expiresAtMs: 32000,
      context: {
        agentId: 20,
        vdnId: 10,
        callId: 100,
        callIdType: 0,
        offeredType: 1,
      },
    });
    await repository.revokeIdentity(principal, "session_replaced", 3000);
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT kind FROM omni_mobile_push_outbox WHERE kind='fail_offer'",
    );
    expect(rows).toHaveLength(1);
  });
  it("waits for a competing lease revocation before creating a new offer", async () => {
    const { principal } = await device();
    const lease = await duty(principal);
    const writer = await pool.getConnection();
    await writer.beginTransaction();
    await writer.execute(
      "UPDATE omni_mobile_duty_leases SET state='revoked' WHERE lease_id=?",
      [lease.leaseId],
    );
    const creation = repository
      .createAttempt({
        offerId: crypto.randomUUID(),
        leaseId: lease.leaseId,
        createdAtMs: 2000,
        nowMs: 2000,
        expiresAtMs: 32000,
        context: {
          agentId: 20,
          vdnId: 10,
          callId: 100,
          callIdType: 0,
          offeredType: 1,
        },
      })
      .then(
        (value) => ({ value, error: null }),
        (error) => ({ value: null, error }),
      );
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await writer.commit();
      const outcome = await creation;
      expect(outcome.value).toBeNull();
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.error.message).toBe("mobile_lease_unavailable");
    } finally {
      await writer.rollback();
      writer.release();
    }
  });
  it("delays a retry and refuses settlement by the superseded worker", async () => {
    const { principal } = await device();
    const lease = await duty(principal);
    await repository.createAttempt({
      offerId: crypto.randomUUID(),
      leaseId: lease.leaseId,
      createdAtMs: 2000,
      nowMs: 2000,
      expiresAtMs: 32000,
      context: {
        agentId: 20,
        vdnId: 10,
        callId: 100,
        callIdType: 0,
        offeredType: 1,
      },
    });
    const first = await repository.claimOutbox("worker-a", 2000, 1000);
    expect(
      await repository.settleOutbox(
        first!.jobId,
        first!.claimToken,
        {
          status: "retry",
          nextAttemptAtMs: 2500,
          code: "provider_timeout",
        },
        2100,
      ),
    ).toBe(true);
    expect(await repository.claimOutbox("worker-b", 2400, 1000)).toBeNull();
    const second = await repository.claimOutbox("worker-b", 2500, 1000);
    expect(second?.attempts).toBe(2);
    expect(
      await repository.settleOutbox(
        first!.jobId,
        first!.claimToken,
        { status: "completed" },
        2600,
      ),
    ).toBe(false);
    expect(
      await repository.settleOutbox(
        second!.jobId,
        second!.claimToken,
        { status: "completed" },
        2600,
      ),
    ).toBe(true);
  });
  it("executes durable push, leg preparation and acceptance in separate acknowledged phases", async () => {
    const { principal } = await device();
    const lease = await duty(principal);
    const created = await repository.createAttempt({
      offerId: crypto.randomUUID(),
      leaseId: lease.leaseId,
      createdAtMs: 2000,
      nowMs: 2000,
      expiresAtMs: 32000,
      context: {
        agentId: 20,
        vdnId: 10,
        callId: 100,
        callIdType: 0,
        offeredType: 1,
      },
    });
    const operations: string[] = [];
    const ports: MobileExecutionPorts = {
      ccs: {
        async currentOffer(offerId) {
          return {
            offerId,
            active: true,
            leaseId: lease.leaseId,
            leaseRevision: lease.leaseRevision,
            agentId: 20,
            vdnId: 10,
          };
        },
        async action(input) {
          operations.push(input.action);
          return { status: "ok" };
        },
      },
      providers: {
        fcm: {
          async send() {
            return { status: "provider_accepted" };
          },
        },
      },
      getToken: (id) => repository.getPrimaryToken(id),
      async notifyNative() {},
    };
    await runMobileOutboxOnce(repository, ports, {
      workerId: "lab",
      clock: () => 2100,
    });
    expect(
      (await repository.getAttempt(created.attemptId))?.state.sipReady,
    ).toBe(false);
    await repository.applyEvent(
      created.attemptId,
      {
        eventId: crypto.randomUUID(),
        deviceId: principal.deviceId,
        leaseRevision: lease.leaseRevision,
        kind: "sip_ready",
      },
      2200,
    );
    await runMobileOutboxOnce(repository, ports, {
      workerId: "lab",
      clock: () => 2300,
    });
    expect(
      (await repository.getAttempt(created.attemptId))?.state.legCreated,
    ).toBe(true);
    await repository.applyEvent(
      created.attemptId,
      {
        eventId: crypto.randomUUID(),
        deviceId: principal.deviceId,
        leaseRevision: lease.leaseRevision,
        kind: "accept",
      },
      2400,
    );
    expect(
      (await repository.getAttempt(created.attemptId))?.state.acceptAuthorized,
    ).toBe(false);
    await runMobileOutboxOnce(repository, ports, {
      workerId: "lab",
      clock: () => 2500,
    });
    expect(
      (await repository.getAttempt(created.attemptId))?.state.acceptAuthorized,
    ).toBe(true);
    expect(operations).toEqual(["prepare_leg", "accept"]);
  });
  it("issues only one call capability across bootstrap retries and denies another device", async () => {
    const { principal } = await device();
    const lease = await duty(principal);
    const attempt = await repository.createAttempt({
      offerId: crypto.randomUUID(),
      leaseId: lease.leaseId,
      createdAtMs: 2000,
      nowMs: 2000,
      expiresAtMs: 32000,
      context: {
        agentId: 20,
        vdnId: 10,
        callId: 100,
        callIdType: 0,
        offeredType: 1,
      },
    });
    const first = await repository.bootstrapAttempt(
      attempt.attemptId,
      lease.grant,
      principal,
      3000,
    );
    const second = await repository.bootstrapAttempt(
      attempt.attemptId,
      lease.grant,
      principal,
      3100,
    );
    expect(first.operationToken).toBe(second.operationToken);
    await expect(
      repository.bootstrapAttempt(
        attempt.attemptId,
        lease.grant,
        { ...principal, deviceId: crypto.randomUUID() },
        3200,
      ),
    ).rejects.toThrow("mobile_authorization_denied");
    expect(
      await repository.verifyAttemptToken(
        attempt.attemptId,
        first.operationToken,
        principal,
        3300,
      ),
    ).toBe(true);
    await repository.revokeIdentity(principal, "session_replaced", 3400);
    expect(
      await repository.verifyAttemptToken(
        attempt.attemptId,
        first.operationToken,
        principal,
        3500,
      ),
    ).toBe(false);
  });
  it("invalidates old network proofs without creating a second offer", async () => {
    const { principal } = await device();
    const lease = await duty(principal);
    const attempt = await repository.createAttempt({
      offerId: crypto.randomUUID(),
      leaseId: lease.leaseId,
      createdAtMs: 2000,
      nowMs: 2000,
      expiresAtMs: 32000,
      context: {
        agentId: 20,
        vdnId: 10,
        callId: 100,
        callIdType: 0,
        offeredType: 1,
      },
    });
    const first = await repository.bindNetworkContext(
      attempt.attemptId,
      { runtimeId: "runtime-1", networkEpoch: 1 },
      3000,
    );
    const next = await repository.bindNetworkContext(
      attempt.attemptId,
      { runtimeId: "runtime-1", networkEpoch: 2 },
      3100,
    );
    expect(next.connectionGeneration).toBe(first.connectionGeneration + 1);
    await expect(
      repository.bindNetworkContext(
        attempt.attemptId,
        { runtimeId: "runtime-1", networkEpoch: 1 },
        3200,
      ),
    ).rejects.toThrow("network_epoch_stale");
    expect((await repository.getAttempt(attempt.attemptId))?.offerId).toBe(
      attempt.offerId,
    );
  });
  it("does not issue SIP credentials for an offer already cancelled in CCS", async () => {
    const { principal } = await device();
    const lease = await duty(principal);
    const a = await repository.createAttempt({
      offerId: crypto.randomUUID(),
      leaseId: lease.leaseId,
      createdAtMs: 2000,
      nowMs: 2000,
      expiresAtMs: 32000,
      context: {
        agentId: 20,
        vdnId: 10,
        callId: 100,
        callIdType: 0,
        offeredType: 1,
      },
    });
    let credentialFetches = 0;
    const ports: MobileCallServicePorts = {
      async currentIdentity(p) {
        return p;
      },
      async sipCredentials() {
        credentialFetches++;
        return { username: "test", password: "private" };
      },
      async verifyRegistration() {
        return true;
      },
      ccs: {
        async currentOffer() {
          return null;
        },
        async action() {
          return { status: "stale" };
        },
      },
    };
    const service = new MobileCallService(repository, ports, () => 3000);
    await expect(
      service.bootstrap(a.attemptId, lease.grant, {
        runtimeId: "runtime-1",
        networkEpoch: 0,
      }),
    ).rejects.toThrow("offer_no_longer_current");
    expect(credentialFetches).toBe(0);
  });
  it("requires a matching server generation and verified SIP registration before native ready", async () => {
    const { principal } = await device();
    const lease = await duty(principal);
    const a = await repository.createAttempt({
      offerId: crypto.randomUUID(),
      leaseId: lease.leaseId,
      createdAtMs: 2000,
      nowMs: 2000,
      expiresAtMs: 32000,
      context: {
        agentId: 20,
        vdnId: 10,
        callId: 100,
        callIdType: 0,
        offeredType: 1,
      },
    });
    const ports: MobileCallServicePorts = {
      async currentIdentity(p) {
        return p;
      },
      async sipCredentials() {
        return { username: "test", password: "private" };
      },
      async verifyRegistration() {
        return false;
      },
      ccs: {
        async currentOffer(offerId) {
          return {
            offerId,
            active: true,
            leaseId: lease.leaseId,
            leaseRevision: lease.leaseRevision,
            agentId: 20,
            vdnId: 10,
          };
        },
        async action() {
          return { status: "ok" };
        },
      },
    };
    const service = new MobileCallService(repository, ports, () => 3000);
    const boot = await service.bootstrap(a.attemptId, lease.grant, {
      runtimeId: "runtime-1",
      networkEpoch: 0,
    });
    await expect(
      service.nativeEvent(a.attemptId, boot.operationToken, {
        eventId: crypto.randomUUID(),
        kind: "sip_ready",
        registrationId: "reg-1",
        generation: boot.generation,
      }),
    ).rejects.toThrow("registration_not_verified");
    expect((await repository.getAttempt(a.attemptId))?.state.sipReady).toBe(
      false,
    );
    ports.verifyRegistration = async () => true;
    await service.nativeEvent(a.attemptId, boot.operationToken, {
      eventId: crypto.randomUUID(),
      kind: "sip_ready",
      registrationId: "reg-1",
      generation: boot.generation,
    });
    expect((await repository.getAttempt(a.attemptId))?.state.sipReady).toBe(
      true,
    );
    await expect(
      service.nativeEvent(a.attemptId, boot.operationToken, {
        eventId: crypto.randomUUID(),
        kind: "accept",
        generation: {
          ...boot.generation,
          connectionGeneration: boot.generation.connectionGeneration + 1,
        },
      }),
    ).rejects.toThrow("network_proof_stale");
  });
  it("never accepts a trusted CCS acknowledgement supplied by the device", async () => {
    const { principal } = await device();
    const lease = await duty(principal);
    const a = await repository.createAttempt({
      offerId: crypto.randomUUID(),
      leaseId: lease.leaseId,
      createdAtMs: 2000,
      nowMs: 2000,
      expiresAtMs: 32000,
      context: {
        agentId: 20,
        vdnId: 10,
        callId: 100,
        callIdType: 0,
        offeredType: 1,
      },
    });
    const ports: MobileCallServicePorts = {
      async currentIdentity(p) {
        return p;
      },
      async sipCredentials() {
        return {};
      },
      async verifyRegistration() {
        return true;
      },
      ccs: {
        async currentOffer(offerId) {
          return {
            offerId,
            active: true,
            leaseId: lease.leaseId,
            leaseRevision: lease.leaseRevision,
            agentId: 20,
            vdnId: 10,
          };
        },
        async action() {
          return { status: "ok" };
        },
      },
    };
    const service = new MobileCallService(repository, ports, () => 3000);
    const boot = await service.bootstrap(a.attemptId, lease.grant, {
      runtimeId: "runtime-1",
      networkEpoch: 0,
    });
    await expect(
      service.nativeEvent(a.attemptId, boot.operationToken, {
        eventId: crypto.randomUUID(),
        kind: "accept_authorized",
        generation: boot.generation,
      } as never),
    ).rejects.toThrow("native_event_not_allowed");
    expect(
      (await repository.getAttempt(a.attemptId))?.state.acceptAuthorized,
    ).toBe(false);
  });
  it("lets the owning native client read a cancellation without allowing further actions", async () => {
    const { principal } = await device();
    const lease = await duty(principal);
    const a = await repository.createAttempt({
      offerId: crypto.randomUUID(),
      leaseId: lease.leaseId,
      createdAtMs: 2000,
      nowMs: 2000,
      expiresAtMs: 32000,
      context: {
        agentId: 20,
        vdnId: 10,
        callId: 100,
        callIdType: 0,
        offeredType: 1,
      },
    });
    const ports: MobileCallServicePorts = {
      async currentIdentity(p) {
        return p;
      },
      async sipCredentials() {
        return {};
      },
      async verifyRegistration() {
        return true;
      },
      ccs: {
        async currentOffer(offerId) {
          return {
            offerId,
            active: true,
            leaseId: lease.leaseId,
            leaseRevision: lease.leaseRevision,
            agentId: 20,
            vdnId: 10,
          };
        },
        async action() {
          return { status: "ok" };
        },
      },
    };
    const service = new MobileCallService(repository, ports, () => 3000);
    const boot = await service.bootstrap(a.attemptId, lease.grant, {
      runtimeId: "runtime-1",
      networkEpoch: 0,
    });
    await repository.applyEvent(
      a.attemptId,
      {
        eventId: crypto.randomUUID(),
        deviceId: principal.deviceId,
        leaseRevision: lease.leaseRevision,
        kind: "cancel",
      },
      3100,
    );
    expect(
      (await service.state(a.attemptId, boot.operationToken)).terminal,
    ).toBe("cancelled");
    await expect(
      service.nativeEvent(a.attemptId, boot.operationToken, {
        eventId: crypto.randomUUID(),
        kind: "accept",
        generation: boot.generation,
      }),
    ).rejects.toThrow("mobile_authorization_denied");
  });
  it("persists exactly one failure path when the deadline scanner is repeated after restart", async () => {
    const { principal } = await device();
    const lease = await duty(principal);
    const a = await repository.createAttempt({
      offerId: crypto.randomUUID(),
      leaseId: lease.leaseId,
      createdAtMs: 2000,
      nowMs: 2000,
      expiresAtMs: 32000,
      context: {
        agentId: 20,
        vdnId: 10,
        callId: 100,
        callIdType: 0,
        offeredType: 1,
      },
    });
    await repository.expireDueAttempts(10000);
    await new MysqlMobileRepository(
      pool,
      Buffer.alloc(32, 7),
    ).expireDueAttempts(11000);
    expect((await repository.getAttempt(a.attemptId))?.state.terminal).toBe(
      "wake_timeout",
    );
    const [jobs] = await pool.query<RowDataPacket[]>(
      "SELECT kind FROM omni_mobile_push_outbox WHERE kind='fail_offer'",
    );
    expect(jobs).toHaveLength(1);
  });
  it("does not carry an old pre-answer readiness proof across a network change", async () => {
    const { principal } = await device();
    const lease = await duty(principal);
    const a = await repository.createAttempt({
      offerId: crypto.randomUUID(),
      leaseId: lease.leaseId,
      createdAtMs: 2000,
      nowMs: 2000,
      expiresAtMs: 32000,
      context: {
        agentId: 20,
        vdnId: 10,
        callId: 100,
        callIdType: 0,
        offeredType: 1,
      },
    });
    await repository.bindNetworkContext(
      a.attemptId,
      { runtimeId: "runtime-1", networkEpoch: 0 },
      3000,
    );
    await repository.applyEvent(
      a.attemptId,
      {
        eventId: crypto.randomUUID(),
        deviceId: principal.deviceId,
        leaseRevision: lease.leaseRevision,
        kind: "sip_ready",
      },
      3100,
    );
    await repository.bindNetworkContext(
      a.attemptId,
      { runtimeId: "runtime-1", networkEpoch: 1 },
      3200,
    );
    const saved = await repository.getAttempt(a.attemptId);
    expect(saved?.state.terminal).toBe("wake_timeout");
    expect(saved?.state.acceptAuthorized).toBe(false);
    const [jobs] = await pool.query<RowDataPacket[]>(
      "SELECT kind FROM omni_mobile_push_outbox WHERE kind='fail_offer'",
    );
    expect(jobs).toHaveLength(1);
  });
  it("fences an old outbox worker after its delivery lease is reclaimed", async () => {
    const { principal } = await device();
    const lease = await duty(principal);
    await repository.createAttempt({
      offerId: crypto.randomUUID(),
      leaseId: lease.leaseId,
      createdAtMs: 2000,
      nowMs: 2000,
      expiresAtMs: 32000,
      context: {
        agentId: 20,
        vdnId: 10,
        callId: 100,
        callIdType: 0,
        offeredType: 1,
      },
    });
    const first = await repository.claimOutbox("worker-a", 2000, 1000);
    const second = await repository.claimOutbox("worker-b", 3001, 1000);
    expect(first?.jobId).toBe(second?.jobId);
    expect(
      await repository.completeOutbox(first!.jobId, first!.claimToken, 3002),
    ).toBe(false);
    expect(
      await repository.completeOutbox(second!.jobId, second!.claimToken, 3002),
    ).toBe(true);
  });
});
