import { createDecipheriv, timingSafeEqual } from "node:crypto";
import type {
  ManagedPushAccount,
  ManagedPushProvider,
  ManagedPushMessage,
  PushSendResult,
} from "./push-providers.js";
export type { ManagedPushProvider } from "./push-providers.js";
export interface EncryptedPushAccount {
  id: string;
  provider: ManagedPushProvider;
  name: string;
  bundle_id: string;
  enabled: boolean;
  credentials: string;
  updated_at: string;
}
export interface PushAccountSnapshot {
  revision: number;
  accounts: EncryptedPushAccount[];
}
export interface PushAccountTransaction {
  read(): Promise<PushAccountSnapshot | null>;
  write(snapshot: PushAccountSnapshot): Promise<void>;
}
export interface PushAccountRepository {
  read(): Promise<PushAccountSnapshot | null>;
  transaction<T>(run: (tx: PushAccountTransaction) => Promise<T>): Promise<T>;
}
export class PushAccountError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message);
  }
}
const providers = [
  "harmony",
  "fcm",
  "apns",
  "mipush",
  "hms",
  "oppo",
  "vivo",
  "honor",
];
const publicFields: Record<string, string[]> = {
  harmony: ["project_id", "app_id"],
  fcm: ["project_id"],
  apns: ["bundle_id", "key_id", "team_id", "production"],
  mipush: ["app_id"],
  hms: ["app_id", "client_id"],
  oppo: ["channel_id"],
  vivo: ["app_id"],
  honor: ["app_id", "client_id"],
};
export function sameSecret(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function shape(snapshot: PushAccountSnapshot): PushAccountSnapshot {
  if (
    !snapshot ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 0 ||
    !Array.isArray(snapshot.accounts) ||
    snapshot.accounts.length > 100
  )
    throw new PushAccountError("Invalid push snapshot");
  const ids = new Set<string>(),
    scopes = new Set<string>();
  const accounts = snapshot.accounts.map((row) => {
    if (
      !row ||
      typeof row.id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(row.id) ||
      ids.has(row.id) ||
      !providers.includes(row.provider) ||
      typeof row.name !== "string" ||
      !row.name.trim() ||
      row.name.length > 100 ||
      typeof row.bundle_id !== "string" ||
      !/^\w[\w.-]{1,254}$/.test(row.bundle_id) ||
      typeof row.enabled !== "boolean" ||
      typeof row.credentials !== "string" ||
      row.credentials.length > 180000 ||
      typeof row.updated_at !== "string" ||
      !Number.isFinite(Date.parse(row.updated_at))
    )
      throw new PushAccountError("Invalid push account");
    ids.add(row.id);
    const scope = `${row.provider}:${row.bundle_id}`;
    if (row.enabled && scopes.has(scope))
      throw new PushAccountError("Duplicate enabled push scope", 409);
    if (row.enabled) scopes.add(scope);
    return {
      id: row.id,
      provider: row.provider,
      name: row.name,
      bundle_id: row.bundle_id,
      enabled: row.enabled,
      credentials: row.credentials,
      updated_at: row.updated_at,
    };
  });
  return {
    revision: snapshot.revision,
    accounts: accounts.sort((a, b) => a.id.localeCompare(b.id)),
  };
}
function decrypt(
  row: EncryptedPushAccount,
  encoded: string,
): ManagedPushAccount {
  try {
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32 || key.toString("base64") !== encoded) throw Error();
    const p = row.credentials.split(":");
    if (p.length !== 4 || p[0] !== "v1") throw Error();
    const iv = Buffer.from(p[1]!, "base64url"),
      tag = Buffer.from(p[2]!, "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw Error();
    const d = createDecipheriv("aes-256-gcm", key, iv);
    d.setAAD(Buffer.from(`push:v1:${row.id}:${row.provider}:${row.bundle_id}`));
    d.setAuthTag(tag);
    const fields: unknown = JSON.parse(
      Buffer.concat([
        d.update(Buffer.from(p[3]!, "base64url")),
        d.final(),
      ]).toString("utf8"),
    );
    if (
      !fields ||
      typeof fields !== "object" ||
      Array.isArray(fields) ||
      Object.entries(fields).some(
        ([k, v]) =>
          k.length > 100 ||
          typeof v !== "string" ||
          Buffer.byteLength(v) > 65536,
      )
    )
      throw Error();
    return {
      id: row.id,
      provider: row.provider,
      name: row.name,
      bundle_id: row.bundle_id,
      enabled: row.enabled,
      fields: fields as Record<string, string>,
    };
  } catch {
    throw new PushAccountError("Push credential decryption unavailable", 503);
  }
}
export function createPushAccountRuntime(options: {
  key: () => string;
  repository: PushAccountRepository;
  validate: (
    provider: ManagedPushProvider,
    fields: Record<string, string>,
  ) => void;
  send: (
    account: ManagedPushAccount,
    token: string,
    message: ManagedPushMessage,
  ) => Promise<PushSendResult>;
}) {
  let active = false;
  function decode(snapshot: PushAccountSnapshot) {
    return snapshot.accounts.map((row) => {
      const account = decrypt(row, options.key());
      if (account.enabled) {
        try {
          options.validate(account.provider, account.fields);
        } catch {
          throw new PushAccountError("Push credential validation failed");
        }
      }
      return account;
    });
  }
  async function load() {
    try {
      const s = await options.repository.read();
      const snapshot = shape(s || { revision: 0, accounts: [] });
      const accounts = decode(snapshot);
      active = accounts.some((a) => a.enabled);
      return { snapshot, accounts };
    } catch (error) {
      active = false;
      throw error;
    }
  }
  return {
    configured: () => active,
    refresh: async () => {
      await load();
    },
    synchronize: async (input: PushAccountSnapshot) => {
      const next = shape(input);
      decode(next);
      const result = await options.repository.transaction(async (tx) => {
        const value = await tx.read();
        if (value) {
          const current = shape(value);
          if (next.revision < current.revision)
            throw new PushAccountError("Stale push configuration", 409);
          if (next.revision === current.revision) {
            if (JSON.stringify(next) !== JSON.stringify(current))
              throw new PushAccountError("Conflicting push configuration", 409);
            return { success: true, revision: next.revision, changed: false };
          }
        }
        await tx.write(next);
        return { success: true, revision: next.revision, changed: true };
      });
      await load();
      return result;
    },
    list: async () => {
      const { snapshot, accounts } = await load();
      return {
        revision: snapshot.revision,
        accounts: accounts.map((a) => ({
          id: a.id,
          provider: a.provider,
          name: a.name,
          bundle_id: a.bundle_id,
          enabled: a.enabled,
          fields: Object.fromEntries(
            Object.entries(a.fields).filter(([k]) =>
              publicFields[a.provider]?.includes(k),
            ),
          ),
          configured_fields: Object.keys(a.fields).filter((k) => a.fields[k]),
        })),
      };
    },
    dispatch: async (
      provider: ManagedPushProvider,
      token: string,
      bundle_id: string,
      message: ManagedPushMessage,
    ): Promise<PushSendResult | null> => {
      const { accounts } = await load();
      const matching = accounts.filter(
        (a) => a.provider === provider && a.bundle_id === bundle_id,
      );
      if (!matching.length) return null;
      const account = matching.find((a) => a.enabled);
      if (!account) return { accepted: false, reason: "account_disabled" };
      return options.send(account, token, message);
    },
    test: async (input: {
      id: string;
      token: string;
      title?: string;
      body?: string;
    }) => {
      const { accounts } = await load();
      const account = accounts.find((a) => a.id === input.id);
      if (!account || !account.enabled)
        throw new PushAccountError("Push account not enabled", 409);
      if (
        !input.token ||
        input.token.length < 16 ||
        input.token.length > 4096 ||
        /[\r\n]/.test(input.token)
      )
        throw new PushAccountError("Invalid device token");
      const result = await options.send(account, input.token, {
        kind: "notification",
        title: input.title || "Omni push test",
        body: input.body || "Push connectivity test",
      });
      return { ...result, device_confirmed: false };
    },
  };
}
export type PushAccountRuntime = ReturnType<typeof createPushAccountRuntime>;
