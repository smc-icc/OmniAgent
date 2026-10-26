import crypto from 'node:crypto';
import { AppError } from '../../shared/errors/index.js';
import type { AuthenticatedUser } from './auth-session.js';

export interface LoginCodeManager { userId: number; accountId: number; vdnId: number }
export interface LoginCodeTarget { userId: number; accountId: number; vdnId: number; operatorId: number }
export interface LoginCodeRecord extends LoginCodeTarget {
  id: string; issuerId: number; tokenHash: string; issuedAt: number; expiresAt: number;
}
export interface LoginCodeStore {
  put(record: LoginCodeRecord, ttlSeconds: number): Promise<boolean>;
  take(hash: string): Promise<LoginCodeRecord | null>;
  get(id: string): Promise<LoginCodeRecord | null>;
  list(target: Omit<LoginCodeTarget, 'userId'>): Promise<LoginCodeRecord[]>;
  revoke(record: LoginCodeRecord): Promise<boolean>;
  limit(key: string, maximum: number, windowSeconds: number): Promise<boolean>;
}
export interface LoginCodeRepository {
  assertOperator(manager: LoginCodeManager, operatorId: number): Promise<void>;
  target(manager: LoginCodeManager, operatorId: number): Promise<LoginCodeTarget>;
  validate(record: LoginCodeRecord): Promise<AuthenticatedUser>;
}
const lifetimeSeconds = 15 * 60;
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const invalid = () => new AppError(401, '授权码无效、已使用或已过期，请联系本 VDN 管理员重新获取', 'login_code_invalid');
function normalize(value: string) { return value.trim().toUpperCase().replace(/[\s-]/g, ''); }
function metadata(record: LoginCodeRecord) {
  return { id: record.id, issuerId: record.issuerId, issuedAt: record.issuedAt, expiresAt: record.expiresAt };
}

/** A code authenticates one existing seat. It never provisions accounts or grants permissions. */
export class LoginCodeService {
  constructor(private store: LoginCodeStore, private repository: LoginCodeRepository, private now = Date.now) {}
  async issue(manager: LoginCodeManager, operatorId: number) {
    const target = await this.repository.target(manager, operatorId);
    if (target.accountId !== manager.accountId || target.vdnId !== manager.vdnId || target.operatorId !== operatorId) {
      throw new AppError(403, '不能为其他租户或 VDN 签发授权码');
    }
    if (!await this.store.limit('issuer:' + manager.userId, 30, 60)) throw new AppError(429, '签发过于频繁，请稍后重试');
    const raw = crypto.randomBytes(16).toString('hex').toUpperCase();
    const code = 'XY-' + raw.match(/.{8}/g)!.join('-');
    const issuedAt = this.now();
    const record: LoginCodeRecord = { ...target, id: crypto.randomUUID(), issuerId: manager.userId,
      tokenHash: digest(normalize(code)), issuedAt, expiresAt: issuedAt + lifetimeSeconds * 1000 };
    if (!await this.store.put(record, lifetimeSeconds)) throw new AppError(409, '此坐席已有 5 个有效授权码，请先撤销旧码');
    return { ...metadata(record), code };
  }
  async redeem(code: string, ip: string) {
    if (!await this.store.limit('login:' + digest(ip), 30, 60)) throw new AppError(429, '尝试过于频繁，请稍后重试', 'login_code_rate_limited');
    const normalized = normalize(code);
    if (!/^XY[A-F0-9]{32}$/.test(normalized)) throw invalid();
    // Redis consumes before session creation: concurrent callers cannot issue two sessions.
    const receipt = await this.store.take(digest(normalized));
    if (!receipt || receipt.expiresAt <= this.now()) throw invalid();
    let user: AuthenticatedUser;
    try { user = await this.repository.validate(receipt); }
    catch (error) {
      if (error instanceof AppError && [403, 404, 409].includes(error.statusCode)) throw invalid();
      throw error;
    }
    if (user.id !== receipt.userId) throw invalid();
    return { receipt, user };
  }
  async list(manager: LoginCodeManager, operatorId: number) {
    await this.repository.assertOperator(manager, operatorId);
    return (await this.store.list({ ...manager, operatorId })).filter(record => record.expiresAt > this.now()).map(metadata);
  }
  async revoke(manager: LoginCodeManager, operatorId: number, id: string) {
    await this.repository.assertOperator(manager, operatorId);
    const record = await this.store.get(id);
    if (!record || record.accountId !== manager.accountId || record.vdnId !== manager.vdnId || record.operatorId !== operatorId) {
      throw new AppError(404, '授权码不存在或已失效');
    }
    if (!await this.store.revoke(record)) throw new AppError(404, '授权码不存在或已失效');
    return { success: true };
  }
}
