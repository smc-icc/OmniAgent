import { createHash, randomUUID } from "node:crypto";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import type {
  CallEffect,
  CallEvent,
  MobileAttempt,
  MobilePrincipal,
  NativeProvider,
} from "./contracts.js";
import type { NetworkGeneration } from "../mobile-network/contracts.js";
import { applyCallEvent } from "./call-policy.js";
import {
  createDeviceGrant,
  decryptPushToken,
  encryptPushToken,
  verifyDeviceGrant,
  hashDeviceGrant,
  type StoredDeviceGrant,
} from "./device-auth.js";

type Actor = Omit<MobilePrincipal, "deviceId">;
type Sql = Pool | PoolConnection;
type SqlValue = string | number | null;
const json = <T>(v: unknown): T =>
  (typeof v === "string" ? JSON.parse(v) : v) as T;
async function rows<T extends RowDataPacket>(
  db: Sql,
  sql: string,
  args: SqlValue[] = [],
): Promise<T[]> {
  const [result] = await db.execute<T[]>(sql, args);
  return result;
}
function time(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError("Invalid mobile timestamp");
}
const actorMatches = (row: RowDataPacket, p: MobilePrincipal | Actor) =>
  Number(row.account_id) === p.accountId &&
  Number(row.vdn_id) === p.vdnId &&
  Number(row.user_id) === p.userId &&
  row.login_sid === p.loginSid &&
  Number(row.binding_version) === p.bindingVersion;
export interface StoredLease extends StoredDeviceGrant {
  state: "pending" | "active" | "unavailable" | "revoked";
  mode: "foreground" | "background";
  activeSlot: string | null;
}
export interface StoredAttempt {
  attemptId: string;
  offerId: string;
  leaseId: string;
  state: MobileAttempt;
  context: CallContext;
  connectionGeneration: number;
  network?: NetworkGeneration;
}
export interface CallContext {
  agentId: number;
  vdnId: number;
  callId: number;
  callIdType: number;
  offeredType: number;
}
export interface OutboxJob {
  jobId: string;
  attemptId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  claimToken: string;
  attempts: number;
  deadlineMs: number;
}

export class MysqlMobileRepository {
  constructor(
    private readonly pool: Pool,
    private readonly vaultKey: Buffer,
  ) {
    if (vaultKey.length !== 32)
      throw new Error("Mobile encryption key must be 256 bits");
  }
  private async transaction<T>(
    run: (db: PoolConnection) => Promise<T>,
  ): Promise<T> {
    for (let retry = 0; ; retry++) {
      const db = await this.pool.getConnection();
      try {
        await db.beginTransaction();
        const value = await run(db);
        await db.commit();
        return value;
      } catch (error) {
        await db.rollback();
        const code = (error as { code?: string }).code;
        if (
          retry >= 2 ||
          ![
            "ER_LOCK_DEADLOCK",
            "ER_LOCK_WAIT_TIMEOUT",
            "ER_DUP_ENTRY",
          ].includes(code ?? "")
        )
          throw error;
      } finally {
        db.release();
      }
    }
  }
  private async enqueue(
    db: Sql,
    input: {
      key: string;
      attemptId: string | null;
      kind: string;
      payload: Record<string, unknown>;
      nowMs: number;
      deadlineMs: number;
    },
  ): Promise<void> {
    await db.execute(
      `INSERT INTO omni_mobile_push_outbox
      (job_id,effect_key,attempt_id,kind,payload_json,status,next_attempt_at_ms,deadline_ms,created_at_ms,updated_at_ms)
      VALUES(?,?,?,?,?,'pending',?,?,?,?) ON DUPLICATE KEY UPDATE effect_key=VALUES(effect_key)`,
      [
        randomUUID(),
        input.key,
        input.attemptId,
        input.kind,
        JSON.stringify(input.payload),
        input.nowMs,
        input.deadlineMs,
        input.nowMs,
        input.nowMs,
      ],
    );
  }
  async registerDevice(input: {
    principal: Actor;
    platform: string;
    appVersion: string;
    provider: NativeProvider;
    token: string;
    appId: string;
    environment: string;
    nowMs: number;
  }): Promise<{ deviceId: string }> {
    time(input.nowMs);
    if (input.token.length < 16 || input.token.length > 16384)
      throw new Error("invalid_provider_token");
    const digest = createHash("sha256").update(input.token).digest("hex");
    return this.transaction(async (db) => {
      const [prior] = await rows(
        db,
        `SELECT d.* FROM omni_mobile_push_tokens t JOIN omni_mobile_devices d ON d.device_id=t.device_id
        WHERE t.provider=? AND t.app_id=? AND t.environment=? AND t.token_hash=? FOR UPDATE`,
        [input.provider, input.appId, input.environment, digest],
      );
      if (prior) {
        if (
          !actorMatches(prior, input.principal) ||
          prior.revoked_at_ms !== null
        )
          throw new Error("token_already_bound");
        if (
          prior.app_version !== input.appVersion ||
          prior.platform !== input.platform
        ) {
          await this.revokeRows(
            db,
            input.principal,
            "application_changed",
            input.nowMs,
            true,
          );
          await db.execute(
            "UPDATE omni_mobile_devices SET app_version=?,platform=?,certified_profile_id=NULL,updated_at_ms=? WHERE device_id=?",
            [input.appVersion, input.platform, input.nowMs, prior.device_id],
          );
        }
        return { deviceId: String(prior.device_id) };
      }
      const deviceId = randomUUID(),
        p = input.principal;
      await db.execute(
        `INSERT INTO omni_mobile_devices
        (device_id,account_id,vdn_id,user_id,login_sid,binding_version,platform,app_version,created_at_ms,updated_at_ms)
        VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [
          deviceId,
          p.accountId,
          p.vdnId,
          p.userId,
          p.loginSid,
          p.bindingVersion,
          input.platform,
          input.appVersion,
          input.nowMs,
          input.nowMs,
        ],
      );
      const scope = [
        input.provider,
        input.appId,
        input.environment,
        deviceId,
      ].join(":");
      await db.execute(
        `INSERT INTO omni_mobile_push_tokens
        (token_id,device_id,provider,app_id,environment,token_ciphertext,token_hash,updated_at_ms) VALUES(?,?,?,?,?,?,?,?)`,
        [
          randomUUID(),
          deviceId,
          input.provider,
          input.appId,
          input.environment,
          encryptPushToken(input.token, this.vaultKey, scope),
          digest,
          input.nowMs,
        ],
      );
      return { deviceId };
    });
  }
  /** Trusted provisioning only. No public route is allowed to call this from client-supplied capability flags. */
  async certifyDevice(
    deviceId: string,
    profileId: string,
    nowMs: number,
  ): Promise<void> {
    time(nowMs);
    if (!profileId || profileId.length > 128)
      throw new Error("invalid_certification");
    await this.pool.execute(
      "UPDATE omni_mobile_devices SET certified_profile_id=?,updated_at_ms=? WHERE device_id=? AND revoked_at_ms IS NULL",
      [profileId, nowMs, deviceId],
    );
  }
  async startDuty(input: {
    principal: MobilePrincipal;
    nowMs: number;
    expiresAtMs: number;
    mode: "foreground" | "background";
  }) {
    time(input.nowMs);
    time(input.expiresAtMs);
    const expiresAtMs = Math.min(input.expiresAtMs, input.nowMs + 28800000);
    if (expiresAtMs <= input.nowMs) throw new Error("duty_expired");
    const grant = createDeviceGrant(),
      leaseId = randomUUID(),
      p = input.principal;
    return this.transaction(async (db) => {
      const [device] = await rows(
        db,
        "SELECT * FROM omni_mobile_devices WHERE device_id=? FOR UPDATE",
        [p.deviceId],
      );
      if (!device || !actorMatches(device, p) || device.revoked_at_ms !== null)
        throw new Error("device_identity_mismatch");
      if (input.mode === "background" && !device.certified_profile_id)
        throw new Error("device_not_certified");
      const [last] = await rows(
        db,
        `SELECT revision FROM omni_mobile_duty_leases
        WHERE account_id=? AND vdn_id=? AND user_id=? ORDER BY revision DESC LIMIT 1 FOR UPDATE`,
        [p.accountId, p.vdnId, p.userId],
      );
      const leaseRevision = last ? Number(last.revision) + 1 : 1;
      if (!Number.isSafeInteger(leaseRevision))
        throw new Error("lease_revision_exhausted");
      // Replacing a primary device invalidates old grants in the same transaction.
      await this.revokeRows(db, p, "primary_replaced", input.nowMs, false);
      const slot = `${p.accountId}:${p.vdnId}:${p.userId}`;
      await db.execute(
        `INSERT INTO omni_mobile_duty_leases
        (lease_id,device_id,account_id,vdn_id,user_id,login_sid,binding_version,revision,mode,state,active_slot,
         grant_hash,expires_at_ms,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?)`,
        [
          leaseId,
          p.deviceId,
          p.accountId,
          p.vdnId,
          p.userId,
          p.loginSid,
          p.bindingVersion,
          leaseRevision,
          input.mode,
          slot,
          grant.hash,
          expiresAtMs,
          input.nowMs,
          input.nowMs,
        ],
      );
      return { leaseId, leaseRevision, expiresAtMs, grant: grant.secret };
    });
  }
  async activateLease(
    leaseId: string,
    revision: number,
    nowMs: number,
  ): Promise<boolean> {
    time(nowMs);
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE omni_mobile_duty_leases SET state='active',updated_at_ms=?
      WHERE lease_id=? AND revision=? AND state='pending' AND active_slot IS NOT NULL AND revoked_at_ms IS NULL AND expires_at_ms>?`,
      [nowMs, leaseId, revision, nowMs],
    );
    return result.affectedRows === 1;
  }
  async getLease(
    leaseId: string,
    db: Sql = this.pool,
    lock = false,
  ): Promise<StoredLease | null> {
    const [r] = await rows(
      db,
      "SELECT * FROM omni_mobile_duty_leases WHERE lease_id=?" +
        (lock ? " FOR UPDATE" : ""),
      [leaseId],
    );
    if (!r) return null;
    return {
      leaseId: String(r.lease_id),
      leaseRevision: Number(r.revision),
      hash: String(r.grant_hash),
      expiresAtMs: Number(r.expires_at_ms),
      revokedAtMs: r.revoked_at_ms === null ? null : Number(r.revoked_at_ms),
      state: r.state,
      mode: r.mode,
      activeSlot: r.active_slot,
      principal: {
        deviceId: r.device_id,
        accountId: Number(r.account_id),
        vdnId: Number(r.vdn_id),
        userId: Number(r.user_id),
        loginSid: r.login_sid,
        bindingVersion: Number(r.binding_version),
      },
    };
  }
  private async revokeRows(
    db: Sql,
    p: Actor,
    reason: string,
    nowMs: number,
    exactIdentity: boolean,
  ): Promise<void> {
    const identitySql = exactIdentity
      ? " AND login_sid=? AND binding_version=?"
      : "";
    const args: SqlValue[] = [
      p.accountId,
      p.vdnId,
      p.userId,
      ...(exactIdentity ? [p.loginSid, p.bindingVersion] : []),
    ];
    const leases = await rows(
      db,
      `SELECT lease_id,revision FROM omni_mobile_duty_leases WHERE
      account_id=? AND vdn_id=? AND user_id=?${identitySql} AND active_slot IS NOT NULL FOR UPDATE`,
      args,
    );
    await db.execute(
      `UPDATE omni_mobile_duty_leases SET state='revoked',active_slot=NULL,revoked_at_ms=?,failure_reason=?,updated_at_ms=?
      WHERE account_id=? AND vdn_id=? AND user_id=?${identitySql} AND active_slot IS NOT NULL`,
      [nowMs, reason, nowMs, ...args],
    );
    for (const l of leases) {
      const pending = await rows(
        db,
        "SELECT * FROM omni_mobile_call_attempts WHERE lease_id=? FOR UPDATE",
        [l.lease_id],
      );
      for (const a of pending) {
        const state = json<MobileAttempt>(a.state_json);
        if (state.connected || state.terminal) continue;
        state.terminal = "superseded";
        await db.execute(
          "UPDATE omni_mobile_call_attempts SET state_json=?,revision=revision+1,updated_at_ms=? WHERE attempt_id=?",
          [JSON.stringify(state), nowMs, a.attempt_id],
        );
        await this.enqueue(db, {
          key: `${a.attempt_id}:end_native`,
          attemptId: a.attempt_id,
          kind: "end_native",
          payload: { attemptId: a.attempt_id, reason },
          nowMs,
          deadlineMs: nowMs + 60000,
        });
        await this.enqueue(db, {
          key: `${a.attempt_id}:fail_offer`,
          attemptId: a.attempt_id,
          kind: "fail_offer",
          payload: { attemptId: a.attempt_id, reason },
          nowMs,
          deadlineMs: nowMs + 60000,
        });
      }
      await this.enqueue(db, {
        key: `${l.lease_id}:revoke:${l.revision}`,
        attemptId: null,
        kind: "revoke_lease",
        payload: {
          leaseId: l.lease_id,
          leaseRevision: Number(l.revision),
          reason,
        },
        nowMs,
        deadlineMs: nowMs + 90000,
      });
    }
  }
  async revokeIdentity(
    p: MobilePrincipal,
    reason: string,
    nowMs: number,
  ): Promise<void> {
    time(nowMs);
    await this.transaction((db) => this.revokeRows(db, p, reason, nowMs, true));
  }
  async createAttempt(input: {
    offerId: string;
    leaseId: string;
    createdAtMs: number;
    nowMs: number;
    expiresAtMs: number;
    context: CallContext;
  }): Promise<StoredAttempt> {
    time(input.nowMs);
    time(input.expiresAtMs);
    time(input.createdAtMs);
    if (input.createdAtMs > input.nowMs) throw new Error("offer_clock_invalid");
    return this.transaction(async (db) => {
      const lease = await this.getLease(input.leaseId, db, true);
      if (
        !lease ||
        lease.state !== "active" ||
        lease.revokedAtMs !== null ||
        lease.expiresAtMs <= input.nowMs ||
        lease.principal.vdnId !== input.context.vdnId
      )
        throw new Error("mobile_lease_unavailable");
      const [prior] = await rows(
        db,
        "SELECT * FROM omni_mobile_call_attempts WHERE offer_id=? AND device_id=? FOR UPDATE",
        [input.offerId, lease.principal.deviceId],
      );
      if (prior) {
        if (prior.lease_id !== input.leaseId)
          throw new Error("offer_identity_mismatch");
        return this.decodeAttempt(prior);
      }
      const expiresAtMs = Math.min(input.expiresAtMs, lease.expiresAtMs);
      if (expiresAtMs <= input.nowMs) throw new Error("offer_expired");
      const attemptId = randomUUID(),
        wakeDeadlineMs = Math.min(input.createdAtMs + 8000, expiresAtMs);
      if (input.nowMs >= wakeDeadlineMs) throw new Error("offer_wake_expired");
      const state: MobileAttempt = {
        attemptId,
        offerId: input.offerId,
        deviceId: lease.principal.deviceId,
        leaseId: input.leaseId,
        leaseRevision: lease.leaseRevision,
        expiresAtMs,
        wakeDeadlineMs,
        sipReady: false,
        acceptRequested: false,
        legCreated: false,
        acceptAuthorized: false,
        connected: false,
        terminal: null,
      };
      await db.execute(
        `INSERT INTO omni_mobile_call_attempts
        (attempt_id,offer_id,device_id,lease_id,context_json,state_json,expires_at_ms,wake_deadline_ms,created_at_ms,updated_at_ms)
        VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [
          attemptId,
          input.offerId,
          state.deviceId,
          input.leaseId,
          JSON.stringify(input.context),
          JSON.stringify(state),
          expiresAtMs,
          wakeDeadlineMs,
          input.nowMs,
          input.nowMs,
        ],
      );
      await this.enqueue(db, {
        key: `${attemptId}:push`,
        attemptId,
        kind: "push",
        payload: { attemptId },
        nowMs: input.nowMs,
        deadlineMs: wakeDeadlineMs,
      });
      return {
        attemptId,
        offerId: input.offerId,
        leaseId: input.leaseId,
        state,
        context: input.context,
        connectionGeneration: 0,
      };
    });
  }
  private decodeAttempt(r: RowDataPacket): StoredAttempt {
    return {
      attemptId: r.attempt_id,
      offerId: r.offer_id,
      leaseId: r.lease_id,
      state: json<MobileAttempt>(r.state_json),
      context: json<CallContext>(r.context_json),
      connectionGeneration: Number(r.connection_generation),
      ...(r.network_json
        ? { network: json<NetworkGeneration>(r.network_json) }
        : {}),
    };
  }
  async getAttempt(attemptId: string): Promise<StoredAttempt | null> {
    const [r] = await rows(
      this.pool,
      "SELECT * FROM omni_mobile_call_attempts WHERE attempt_id=?",
      [attemptId],
    );
    return r ? this.decodeAttempt(r) : null;
  }
  async applyEvent(
    attemptId: string,
    event: CallEvent,
    nowMs: number,
  ): Promise<{ state: MobileAttempt; effects: CallEffect[] }> {
    time(nowMs);
    return this.transaction(async (db) => {
      const [r] = await rows(
        db,
        "SELECT * FROM omni_mobile_call_attempts WHERE attempt_id=? FOR UPDATE",
        [attemptId],
      );
      if (!r) throw new Error("attempt_not_found");
      const current = json<MobileAttempt>(r.state_json);
      const [seen] = await rows(
        db,
        "SELECT attempt_id FROM omni_mobile_call_events WHERE event_id=?",
        [event.eventId],
      );
      if (seen) {
        if (seen.attempt_id !== attemptId)
          throw new Error("event_identity_mismatch");
        return { state: current, effects: [] };
      }
      const result = applyCallEvent(current, event, nowMs);
      await db.execute(
        "INSERT INTO omni_mobile_call_events (event_id,attempt_id,kind,payload_json,created_at_ms) VALUES(?,?,?,?,?)",
        [event.eventId, attemptId, event.kind, JSON.stringify(event), nowMs],
      );
      await db.execute(
        "UPDATE omni_mobile_call_attempts SET state_json=?,revision=revision+1,updated_at_ms=? WHERE attempt_id=?",
        [JSON.stringify(result.state), nowMs, attemptId],
      );
      for (const effect of result.effects)
        await this.enqueue(db, {
          key: `${attemptId}:${effect}`,
          attemptId,
          kind: effect,
          payload: {
            attemptId,
            offerId: current.offerId,
            eventId: event.eventId,
          },
          nowMs,
          deadlineMs: ["end_native", "fail_offer"].includes(effect)
            ? nowMs + 60000
            : effect === "prepare_leg"
              ? current.wakeDeadlineMs
              : current.expiresAtMs,
        });
      return result;
    });
  }
  async claimOutbox(
    workerId: string,
    nowMs: number,
    leaseMs: number,
  ): Promise<OutboxJob | null> {
    time(nowMs);
    if (!workerId || !Number.isSafeInteger(leaseMs) || leaseMs <= 0)
      throw new Error("invalid_outbox_claim");
    return this.transaction(async (db) => {
      const [r] = await rows(
        db,
        `SELECT * FROM omni_mobile_push_outbox WHERE next_attempt_at_ms<=?
        AND (status='pending' OR (status='in_flight' AND claim_until_ms<=?))
        ORDER BY created_at_ms,job_id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [nowMs, nowMs],
      );
      if (!r) return null;
      const claimToken = randomUUID();
      await db.execute(
        `UPDATE omni_mobile_push_outbox SET status='in_flight',claim_token=?,claimed_by=?,claim_until_ms=?,
        attempts=attempts+1,updated_at_ms=? WHERE job_id=?`,
        [claimToken, workerId, nowMs + leaseMs, nowMs, r.job_id],
      );
      return {
        jobId: r.job_id,
        attemptId: r.attempt_id,
        kind: r.kind,
        payload: json(r.payload_json),
        claimToken,
        attempts: Number(r.attempts) + 1,
        deadlineMs: Number(r.deadline_ms),
      };
    });
  }
  async completeOutbox(
    jobId: string,
    claimToken: string,
    nowMs: number,
  ): Promise<boolean> {
    time(nowMs);
    const [r] = await this.pool.execute<ResultSetHeader>(
      `UPDATE omni_mobile_push_outbox SET status='completed',updated_at_ms=?
      WHERE job_id=? AND status='in_flight' AND claim_token=? AND claim_until_ms>?`,
      [nowMs, jobId, claimToken, nowMs],
    );
    return r.affectedRows === 1;
  }
  async settleOutbox(
    jobId: string,
    claimToken: string,
    result: {
      status: "completed" | "suppressed" | "expired" | "failed" | "retry";
      nextAttemptAtMs?: number;
      code?: string;
      providerMessageId?: string;
    },
    nowMs: number,
  ): Promise<boolean> {
    time(nowMs);
    if (result.code && !/^[A-Za-z0-9_.-]{1,64}$/.test(result.code))
      throw new Error("invalid_outbox_error_code");
    if (result.providerMessageId && result.providerMessageId.length > 256)
      throw new Error("invalid_provider_message_id");
    if (
      result.status === "retry" &&
      (!Number.isSafeInteger(result.nextAttemptAtMs) ||
        result.nextAttemptAtMs! <= nowMs)
    )
      throw new Error("invalid_retry_time");
    const status = result.status === "retry" ? "pending" : result.status;
    const [r] = await this.pool.execute<ResultSetHeader>(
      `UPDATE omni_mobile_push_outbox
      SET status=?,next_attempt_at_ms=?,last_error=?,provider_message_id=?,claim_token=NULL,claimed_by=NULL,claim_until_ms=NULL,updated_at_ms=?
      WHERE job_id=? AND status='in_flight' AND claim_token=? AND claim_until_ms>?`,
      [
        status,
        result.nextAttemptAtMs ?? nowMs,
        result.code ?? null,
        result.providerMessageId ?? null,
        nowMs,
        jobId,
        claimToken,
        nowMs,
      ],
    );
    return r.affectedRows === 1;
  }
  async bootstrapAttempt(
    attemptId: string,
    grantSecret: string,
    current: MobilePrincipal,
    nowMs: number,
  ): Promise<{
    operationToken: string;
    expiresAtMs: number;
    attempt: StoredAttempt;
  }> {
    time(nowMs);
    return this.transaction(async (db) => {
      const [header] = await rows(
        db,
        "SELECT lease_id FROM omni_mobile_call_attempts WHERE attempt_id=?",
        [attemptId],
      );
      if (!header) throw new Error("mobile_authorization_denied");
      const lease = await this.getLease(header.lease_id, db, true);
      if (
        !lease ||
        lease.state !== "active" ||
        !verifyDeviceGrant(lease, grantSecret, current, nowMs)
      )
        throw new Error("mobile_authorization_denied");
      const [r] = await rows(
        db,
        "SELECT * FROM omni_mobile_call_attempts WHERE attempt_id=? FOR UPDATE",
        [attemptId],
      );
      const attempt = this.decodeAttempt(r);
      if (
        attempt.state.deviceId !== current.deviceId ||
        attempt.state.terminal ||
        attempt.state.connected ||
        nowMs >= attempt.state.expiresAtMs ||
        (!attempt.state.legCreated && nowMs >= attempt.state.wakeDeadlineMs)
      )
        throw new Error("mobile_authorization_denied");
      const scope = `call:${attemptId}:${current.deviceId}`;
      if (
        r.call_token_ciphertext &&
        Number(r.call_token_expires_at_ms) > nowMs
      ) {
        return {
          operationToken: decryptPushToken(
            r.call_token_ciphertext,
            this.vaultKey,
            scope,
          ),
          expiresAtMs: Number(r.call_token_expires_at_ms),
          attempt,
        };
      }
      const token = createDeviceGrant(),
        expiresAtMs = nowMs + 120000;
      await db.execute(
        `UPDATE omni_mobile_call_attempts SET call_token_hash=?,call_token_ciphertext=?,call_token_expires_at_ms=?,updated_at_ms=? WHERE attempt_id=?`,
        [
          token.hash,
          encryptPushToken(token.secret, this.vaultKey, scope),
          expiresAtMs,
          nowMs,
          attemptId,
        ],
      );
      return { operationToken: token.secret, expiresAtMs, attempt };
    });
  }
  async verifyAttemptToken(
    attemptId: string,
    secret: string,
    current: MobilePrincipal,
    nowMs: number,
    readTerminal = false,
  ): Promise<boolean> {
    time(nowMs);
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) return false;
    const [r] = await rows(
      this.pool,
      `SELECT a.*,l.account_id,l.vdn_id,l.user_id,l.login_sid,l.binding_version,
      l.state AS lease_state,l.revoked_at_ms,l.expires_at_ms AS lease_expires_at_ms
      FROM omni_mobile_call_attempts a JOIN omni_mobile_duty_leases l ON a.lease_id=l.lease_id WHERE a.attempt_id=?`,
      [attemptId],
    );
    if (
      !r ||
      !actorMatches(r, current) ||
      r.device_id !== current.deviceId ||
      r.revoked_at_ms !== null ||
      r.lease_state !== "active" ||
      Number(r.call_token_expires_at_ms) <= nowMs ||
      r.call_token_hash !== hashDeviceGrant(secret)
    )
      return false;
    const state = json<MobileAttempt>(r.state_json);
    return (
      (readTerminal || !state.terminal) &&
      (state.connected || Number(r.lease_expires_at_ms) > nowMs)
    );
  }
  async bindNetworkContext(
    attemptId: string,
    input: { runtimeId: string; networkEpoch: number },
    nowMs: number,
  ): Promise<NetworkGeneration> {
    time(nowMs);
    if (
      !/^[A-Za-z0-9-]{1,64}$/.test(input.runtimeId) ||
      !Number.isSafeInteger(input.networkEpoch) ||
      input.networkEpoch < 0
    )
      throw new Error("invalid_network_context");
    return this.transaction(async (db) => {
      const [r] = await rows(
        db,
        "SELECT * FROM omni_mobile_call_attempts WHERE attempt_id=? FOR UPDATE",
        [attemptId],
      );
      if (!r) throw new Error("attempt_not_found");
      const state = json<MobileAttempt>(r.state_json);
      if (state.terminal) throw new Error("attempt_ended");
      const previous = r.network_json
        ? json<NetworkGeneration>(r.network_json)
        : null;
      if (previous?.runtimeId === input.runtimeId) {
        if (input.networkEpoch < previous.networkEpoch)
          throw new Error("network_epoch_stale");
        if (input.networkEpoch === previous.networkEpoch) return previous;
      }
      const connectionGeneration = Number(r.connection_generation) + 1;
      if (!Number.isSafeInteger(connectionGeneration))
        throw new Error("connection_generation_exhausted");
      const context = { ...input, connectionGeneration };
      // Until same-dialog ringing-leg recovery is certified, a changed ready path fails closed.
      // This avoids reusing an old permit or creating a second agent leg for one offer.
      if (
        previous &&
        !state.connected &&
        (state.sipReady ||
          state.legCreated ||
          state.acceptAuthorizationRequested)
      ) {
        state.terminal = "wake_timeout";
        state.acceptAuthorized = false;
        delete state.acceptPermitExpiresAtMs;
        for (const kind of ["end_native", "fail_offer"])
          await this.enqueue(db, {
            key: `${attemptId}:${kind}`,
            attemptId,
            kind,
            payload: { attemptId, reason: "network_changed_before_answer" },
            nowMs,
            deadlineMs: nowMs + 60000,
          });
      }
      await db.execute(
        "UPDATE omni_mobile_call_attempts SET network_json=?,connection_generation=?,state_json=?,revision=revision+1,updated_at_ms=? WHERE attempt_id=?",
        [
          JSON.stringify(context),
          connectionGeneration,
          JSON.stringify(state),
          nowMs,
          attemptId,
        ],
      );
      return context;
    });
  }
  async expireDueAttempts(nowMs: number, limit = 100): Promise<number> {
    time(nowMs);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new Error("invalid_deadline_scan_limit");
    const pending = await rows(
      this.pool,
      `SELECT attempt_id,state_json FROM omni_mobile_call_attempts
      WHERE JSON_EXTRACT(state_json,'$.terminal')=CAST('null' AS JSON)
      AND JSON_EXTRACT(state_json,'$.connected')=CAST('false' AS JSON)
      AND (expires_at_ms<=? OR (wake_deadline_ms<=? AND JSON_EXTRACT(state_json,'$.legCreated')=CAST('false' AS JSON)))
      ORDER BY wake_deadline_ms LIMIT ${limit}`,
      [nowMs, nowMs],
    );
    for (const row of pending) {
      const state = json<MobileAttempt>(row.state_json);
      await this.applyEvent(
        row.attempt_id,
        {
          eventId: randomUUID(),
          deviceId: state.deviceId,
          leaseRevision: state.leaseRevision,
          kind: "timeout",
        },
        nowMs,
      );
    }
    return pending.length;
  }
  async getPrimaryToken(
    deviceId: string,
  ): Promise<{ provider: NativeProvider; token: string } | null> {
    const [r] = await rows(
      this.pool,
      `SELECT * FROM omni_mobile_push_tokens WHERE device_id=? AND invalidated_at_ms IS NULL
      ORDER BY updated_at_ms DESC,token_id LIMIT 1`,
      [deviceId],
    );
    if (!r) return null;
    const scope = [r.provider, r.app_id, r.environment, deviceId].join(":");
    return {
      provider: r.provider,
      token: decryptPushToken(r.token_ciphertext, this.vaultKey, scope),
    };
  }
}
