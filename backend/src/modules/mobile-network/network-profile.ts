import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import type { NativeNetworkProfile } from "./contracts.js";

export interface AuthorizedRelayScope {
  attemptId: string;
  deviceId: string;
  authorizationValidUntilMs: number;
}
export interface CertifiedNetworkCapabilities {
  turnUdp: boolean;
  turnTcp: boolean;
  turnTlsVerified: boolean;
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_network_profile");
  return value as Record<string, unknown>;
};
function text(value: unknown, max = 128): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > max ||
    /[\s\x00-\x1f]/.test(value)
  )
    throw new Error("invalid_network_profile_text");
  return value;
}
function host(value: unknown): string {
  const raw = text(value, 253);
  if (isIP(raw)) return raw;
  // IDNA conversion may discard URL delimiters; reject them before normalization.
  if (!/^[\p{L}\p{N}\p{M}.-]+$/u.test(raw))
    throw new Error("invalid_network_host");
  const ascii = domainToASCII(raw).replace(/[.]$/, "").toLowerCase();
  if (
    !ascii ||
    !ascii
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw new Error("invalid_network_host");
  return ascii;
}
function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error("invalid_network_profile_number");
  return value;
}
function list(value: unknown, max = 8): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error("invalid_network_profile_list");
  return value;
}

/** coturn REST HMAC-SHA1 wire protocol. A scope must already be authorized by the call service. */
export function createTurnCredentials(
  scope: AuthorizedRelayScope,
  sharedSecret: string,
  nowMs: number,
  lifetimeSeconds = 600,
): { username: string; credential: string; expiresAtMs: number } {
  integer(nowMs, 0, Number.MAX_SAFE_INTEGER);
  integer(lifetimeSeconds, 1, 3600);
  if (
    !Number.isFinite(scope.authorizationValidUntilMs) ||
    nowMs >= scope.authorizationValidUntilMs ||
    sharedSecret.length < 32 ||
    !/^[A-Za-z0-9-]{1,64}$/.test(scope.attemptId) ||
    !/^[A-Za-z0-9-]{1,64}$/.test(scope.deviceId)
  )
    throw new Error("relay_scope_not_authorized");
  const expires = Math.floor(nowMs / 1000) + lifetimeSeconds;
  const username = `${expires}:${scope.attemptId}:${scope.deviceId}`;
  return {
    username,
    credential: createHmac("sha1", sharedSecret)
      .update(username)
      .digest("base64"),
    expiresAtMs: expires * 1000,
  };
}

export function buildNetworkProfile(
  input: unknown,
  options: {
    nowMs: number;
    capabilities: CertifiedNetworkCapabilities;
    turnSecret?: string;
    scope?: AuthorizedRelayScope;
  },
): NativeNetworkProfile {
  const raw = record(input);
  const sipEndpoints = list(raw.sipEndpoints).map((value) => {
    const endpoint = record(value);
    if (endpoint.transport !== "tls")
      throw new Error("mobile_sip_requires_tls");
    return {
      id: text(endpoint.id, 64),
      host: host(endpoint.host),
      port: integer(endpoint.port, 1, 65535),
      transport: "tls" as const,
      serviceDomain: host(endpoint.serviceDomain),
      priority: integer(endpoint.priority, 0, 1000),
    };
  });
  if (!sipEndpoints.length) throw new Error("sip_endpoint_missing");
  const stunServers = list(raw.stunServers ?? []).map((value) => {
    const server = record(value);
    return { host: host(server.host), port: integer(server.port, 1, 65535) };
  });
  const relayEndpoints = list(raw.turnServers ?? [])
    .map((value) => {
      const server = record(value);
      if (!["udp", "tcp", "tls"].includes(String(server.transport)))
        throw new Error("invalid_turn_transport");
      return {
        host: host(server.host),
        port: integer(server.port, 1, 65535),
        transport: server.transport as "udp" | "tcp" | "tls",
      };
    })
    .filter((s) =>
      s.transport === "udp"
        ? options.capabilities.turnUdp
        : s.transport === "tcp"
          ? options.capabilities.turnTcp
          : options.capabilities.turnTlsVerified,
    );
  let turnServers: NativeNetworkProfile["turnServers"] = [];
  if (options.scope && relayEndpoints.length) {
    if (!options.turnSecret) throw new Error("turn_secret_not_configured");
    const credentials = createTurnCredentials(
      options.scope,
      options.turnSecret,
      options.nowMs,
    );
    turnServers = relayEndpoints.map((server) => ({
      ...server,
      ...credentials,
    }));
  }
  if (
    typeof raw.cellularAllowed !== "boolean" ||
    typeof raw.roamingAllowed !== "boolean"
  )
    throw new Error("invalid_network_user_policy");
  return {
    version: integer(raw.version, 1, 2147483647),
    sipEndpoints: sipEndpoints.sort((a, b) => a.priority - b.priority),
    stunServers,
    turnServers,
    cellularAllowed: raw.cellularAllowed,
    roamingAllowed: raw.roamingAllowed,
    activeRecoveryTimeoutMs: integer(
      raw.activeRecoveryTimeoutMs ?? 15000,
      1000,
      30000,
    ),
  };
}
