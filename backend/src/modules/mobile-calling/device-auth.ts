import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { MobilePrincipal } from "./contracts.js";

export interface StoredDeviceGrant {
  hash: string;
  principal: MobilePrincipal;
  leaseId: string;
  leaseRevision: number;
  expiresAtMs: number;
  revokedAtMs: number | null;
}
const principalValid = (p: MobilePrincipal) =>
  [p.accountId, p.vdnId, p.userId].every(
    (n) => Number.isSafeInteger(n) && n > 0,
  ) &&
  Number.isSafeInteger(p.bindingVersion) &&
  p.bindingVersion >= 0 &&
  typeof p.loginSid === "string" &&
  p.loginSid.length > 0 &&
  typeof p.deviceId === "string" &&
  p.deviceId.length > 0;

export function hashDeviceGrant(secret: string): string {
  return createHash("sha256")
    .update("omni-mobile-grant-v2\0")
    .update(secret)
    .digest("hex");
}
export function createDeviceGrant(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString("base64url");
  return { secret, hash: hashDeviceGrant(secret) };
}
export function isGrantUsable(
  stored: StoredDeviceGrant,
  presentedHash: string,
  current: MobilePrincipal,
  nowMs: number,
): boolean {
  if (
    !principalValid(current) ||
    !principalValid(stored.principal) ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(stored.expiresAtMs) ||
    nowMs >= stored.expiresAtMs ||
    stored.revokedAtMs !== null ||
    !stored.leaseId ||
    !Number.isSafeInteger(stored.leaseRevision) ||
    stored.leaseRevision < 1 ||
    !/^[a-f0-9]{64}$/.test(stored.hash) ||
    !/^[a-f0-9]{64}$/.test(presentedHash)
  )
    return false;
  const expected = stored.principal;
  if (
    expected.accountId !== current.accountId ||
    expected.vdnId !== current.vdnId ||
    expected.userId !== current.userId ||
    expected.loginSid !== current.loginSid ||
    expected.bindingVersion !== current.bindingVersion ||
    expected.deviceId !== current.deviceId
  )
    return false;
  return timingSafeEqual(
    Buffer.from(stored.hash, "hex"),
    Buffer.from(presentedHash, "hex"),
  );
}
export function verifyDeviceGrant(
  stored: StoredDeviceGrant,
  secret: string,
  current: MobilePrincipal,
  nowMs: number,
): boolean {
  return (
    typeof secret === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(secret) &&
    isGrantUsable(stored, hashDeviceGrant(secret), current, nowMs)
  );
}

function validateVault(key: Buffer, scope: string): void {
  if (key.length !== 32)
    throw new Error("Mobile token encryption requires a 256-bit key");
  if (!scope || scope.length > 512)
    throw new Error("Invalid mobile token scope");
}
export function encryptPushToken(
  value: string,
  key: Buffer,
  scope: string,
): string {
  validateVault(key, scope);
  if (!value || Buffer.byteLength(value) > 16384)
    throw new Error("Invalid provider token");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("omni-mobile-push-v2\0" + scope));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "omc2",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}
export function decryptPushToken(
  value: string,
  key: Buffer,
  scope: string,
): string {
  validateVault(key, scope);
  const [version, encodedIv, encodedTag, encodedBody, extra] = value.split(".");
  if (
    version !== "omc2" ||
    !encodedIv ||
    !encodedTag ||
    !encodedBody ||
    extra !== undefined
  )
    throw new Error("Invalid encrypted token");
  const iv = Buffer.from(encodedIv, "base64url"),
    tag = Buffer.from(encodedTag, "base64url");
  if (iv.length !== 12 || tag.length !== 16)
    throw new Error("Invalid encrypted token");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from("omni-mobile-push-v2\0" + scope));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(encodedBody, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
