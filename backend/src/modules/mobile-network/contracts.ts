export interface NetworkGeneration {
  runtimeId: string;
  networkEpoch: number;
  connectionGeneration: number;
}
export interface RecoveryContext {
  generation: NetworkGeneration;
  deadlineMonoMs: number;
  mediaHealthy: boolean;
  businessCallConnected: boolean;
}
export interface NativeNetworkProfile {
  version: number;
  sipEndpoints: Array<{
    id: string;
    host: string;
    port: number;
    transport: "tls";
    serviceDomain: string;
    priority: number;
  }>;
  stunServers: Array<{ host: string; port: number }>;
  turnServers: Array<{
    host: string;
    port: number;
    transport: "udp" | "tcp" | "tls";
    username: string;
    credential: string;
    expiresAtMs: number;
  }>;
  cellularAllowed: boolean;
  roamingAllowed: boolean;
  activeRecoveryTimeoutMs: number;
}
export interface NativeNetworkSnapshot {
  runtimeId: string;
  networkEpoch: number;
  bearer: "wifi" | "cellular" | "ethernet" | "vpn" | "none" | "unknown";
  osValidation: "validated" | "unvalidated" | "captive" | "unknown";
  ipFamilies: Array<"v4" | "v6">;
  businessState: "unknown" | "probing" | "ready" | "partial" | "blocked";
  metered: boolean | null;
  constrained: boolean | null;
}
