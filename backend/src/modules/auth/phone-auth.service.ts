import crypto from 'node:crypto';
import { AppError } from '../../shared/errors/index.js';
import type { AuthenticatedUser } from './auth-session.js';
import { normalizeLoginPhone } from './phone-policy.js';

export interface PhoneTarget { userId: number; accountId: number; vdnId: number; operatorId: number; name?: string }
export interface PhoneChallenge {
  version: 2; id: string; phoneHash: string; deviceHash: string; codeHash: string;
  expiresAt: number; state: 'pending' | 'ready'; attempts: number;
}
export interface PhoneProof { phoneHash: string; deviceHash: string; codeHash: string; now: number }
export interface PhoneSelection { phoneHash: string; deviceHash: string; expiresAt: number; targets: PhoneTarget[] }
export interface PhoneSelectionProof { phoneHash: string; deviceHash: string; vdnId: number; now: number }
export interface PhoneChallengeStore {
  reserve(challenge: PhoneChallenge, ttlSeconds: number, cooldownSeconds: number): Promise<boolean>;
  activate(id: string): Promise<void>;
  discard(id: string): Promise<void>;
  verify(id: string, proof: PhoneProof): Promise<PhoneChallenge | null>;
  saveSelection(hash: string, selection: PhoneSelection, ttlSeconds: number): Promise<void>;
  consumeSelection(hash: string, proof: PhoneSelectionProof): Promise<PhoneSelection | null>;
  limit(key: string, maximum: number, windowSeconds: number): Promise<boolean>;
}
export interface PhoneAuthRepository {
  list(phone: string): Promise<PhoneTarget[]>;
  validate(target: PhoneTarget, phone: string): Promise<AuthenticatedUser>;
}
export interface PhoneReadiness { supported: boolean; ready: boolean; reason: string }
export interface PhoneDelivery {
  readiness(): Promise<PhoneReadiness>;
  send(phone: string, code: string): Promise<void>;
  failure?(challengeId: string): void;
}
export interface PhoneRequest { phone: string; device_id: string }
export interface PhoneSignIn extends PhoneRequest { request_id: string; code: string }
export interface PhoneSelect extends PhoneRequest { selection_ticket: string; vdn_id: number }
export interface PhoneAuthenticated { status: 'authenticated'; user: AuthenticatedUser; target: PhoneTarget }
export interface PhoneVdnSelection { status: 'select_vdn'; selection_ticket: string; expires_in: number; vdns: { vdn_id: number; name: string }[] }
export interface PhoneUnbound { status: 'unbound'; message: string }
const lifetime = 300, cooldown = 60, selectionLifetime = 120;
const invalid = () => new AppError(401, '验证码有误、已失效或已使用，请重新获取', 'phone_code_invalid');
const selectionInvalid = () => new AppError(401, 'VDN 选择已失效，请重新验证手机号', 'phone_selection_invalid');
const inactive = (error: unknown) => error instanceof AppError && [403, 404, 409].includes(error.statusCode);

/** Verify possession first; business identities come only from explicit, live administrator bindings. */
export class PhoneAuthService {
  private deliveries = new Set<Promise<void>>();
  constructor(private store: PhoneChallengeStore, private repository: PhoneAuthRepository,
    private delivery: PhoneDelivery, private key: crypto.BinaryLike, private now = Date.now) {}
  private hash(purpose: string, value: string) { return crypto.createHmac('sha256', this.key).update(purpose + ':' + value).digest('hex'); }
  async capabilities() { return { ...await this.delivery.readiness(), expires_in: lifetime, retry_after: cooldown }; }
  private async requireReady() {
    const state = await this.delivery.readiness();
    if (!state.supported || !state.ready) throw new AppError(503, state.reason || '短信登录服务暂不可用，请使用账号或授权码登录', 'phone_login_unavailable');
  }
  private async limitVerification(ip: string) {
    if (!await this.store.limit('verify-ip:' + this.hash('ip', ip), 120, 60)) throw new AppError(429, '验证尝试过于频繁，请稍后重试');
  }
  async request(input: PhoneRequest, ip: string) {
    await this.requireReady();
    const phone = normalizeLoginPhone(input.phone), phoneHash = this.hash('phone', phone);
    if (!await this.store.limit('request-ip:' + this.hash('ip', ip), 60, 60) ||
      !await this.store.limit('request-phone-hour:' + phoneHash, 5, 3600) ||
      !await this.store.limit('request-phone-day:' + phoneHash, 10, 86400)) {
      throw new AppError(429, '验证码请求过于频繁，请稍后重试', 'phone_rate_limited');
    }
    const id = crypto.randomUUID(), code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
    const record: PhoneChallenge = { version: 2, id, phoneHash, deviceHash: this.hash('device', input.device_id),
      codeHash: this.hash('code', id + ':' + code), expiresAt: this.now() + lifetime * 1000, state: 'pending', attempts: 0 };
    if (!await this.store.reserve(record, lifetime, cooldown)) throw new AppError(429, '请等待 60 秒后重新获取验证码', 'phone_resend_cooldown');
    // Identical delivery for bound/unbound numbers; no tenant lookup or identity disclosure before proof.
    const task = (async () => {
      try { await this.delivery.send(phone, code); await this.store.activate(id); }
      catch { await this.store.discard(id); this.delivery.failure?.(id); }
    })();
    this.deliveries.add(task);
    void task.finally(() => this.deliveries.delete(task)).catch(() => undefined);
    return { request_id: id, expires_in: lifetime, retry_after: cooldown, message: '验证码将发送到手机，请注意查收' };
  }
  async signIn(input: PhoneSignIn, ip: string): Promise<PhoneAuthenticated | PhoneVdnSelection | PhoneUnbound> {
    await this.requireReady(); await this.limitVerification(ip);
    const phone = normalizeLoginPhone(input.phone);
    const record = await this.store.verify(input.request_id, { phoneHash: this.hash('phone', phone),
      deviceHash: this.hash('device', input.device_id), codeHash: this.hash('code', input.request_id + ':' + input.code), now: this.now() });
    if (!record || record.expiresAt <= this.now()) throw invalid();
    const valid: PhoneAuthenticated[] = [];
    for (const target of await this.repository.list(phone)) {
      try {
        const user = await this.repository.validate(target, phone);
        if (user.id === target.userId) valid.push({ status: 'authenticated', user, target });
      } catch (error) { if (!inactive(error)) throw error; }
    }
    if (!valid.length) return { status: 'unbound', message: '未绑定 VDN，请联系 VDN 管理员关联手机号' };
    if (valid.length === 1) return valid[0]!;
    const ticket = crypto.randomBytes(32).toString('base64url');
    await this.store.saveSelection(this.hash('selection', ticket), { phoneHash: record.phoneHash, deviceHash: record.deviceHash,
      expiresAt: this.now() + selectionLifetime * 1000, targets: valid.map(r => r.target) }, selectionLifetime);
    return { status: 'select_vdn', selection_ticket: ticket, expires_in: selectionLifetime,
      vdns: valid.map(r => ({ vdn_id: r.target.vdnId, name: r.target.name || 'VDN ' + r.target.vdnId })) };
  }
  async select(input: PhoneSelect, ip: string): Promise<PhoneAuthenticated> {
    await this.requireReady(); await this.limitVerification(ip);
    const phone = normalizeLoginPhone(input.phone);
    const record = await this.store.consumeSelection(this.hash('selection', input.selection_ticket), {
      phoneHash: this.hash('phone', phone), deviceHash: this.hash('device', input.device_id), vdnId: input.vdn_id, now: this.now() });
    const target = record?.targets.find(t => t.vdnId === input.vdn_id);
    if (!record || record.expiresAt <= this.now() || !target) throw selectionInvalid();
    try {
      const user = await this.repository.validate(target, phone);
      if (user.id !== target.userId) throw selectionInvalid();
      return { status: 'authenticated', user, target };
    } catch (error) {
      if (inactive(error)) throw new AppError(403, 'VDN 关联已变更或停用，请联系管理员后重新验证手机号', 'phone_binding_changed');
      throw error;
    }
  }
  /** Wait only for the bounded SMS gateway calls during graceful shutdown. */
  async drainDeliveries() { await Promise.allSettled([...this.deliveries]); }
}
