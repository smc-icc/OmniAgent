import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../shared/errors/index.js';

const expired = () => new AppError(410, '授权已取消、过期或已使用，请重新授权', 'social_authorization_expired');

export interface EphemeralStore { put(key: string, value: string, ttlSeconds: number): Promise<boolean>; get(key: string): Promise<string | null>; take(key: string): Promise<string | null> }
export interface AuthorizationContext { provider: string; appId: string; organizationId: string; installationId: string; platform: string; proofChallenge: string; deviceId: string; externalOrganizationId?: string; revision?: number }
export interface AuthorizationTransaction extends AuthorizationContext { state: string; createdAt: number }
export interface AuthorizationReceipt extends AuthorizationTransaction { subjectId: string }
export class AuthorizationLedger {
  constructor(private readonly store: EphemeralStore, private readonly now: () => number = Date.now) {}
  async begin(context: AuthorizationContext): Promise<string> {
    const checked = contextSchema.parse(context);
    const state = randomBytes(32).toString('base64url');
    if (!await this.store.put(key('state', state), JSON.stringify({ ...checked, state, createdAt: this.now() }), 600)) {
      throw new Error('Authorization state could not be created');
    }
    return state;
  }
  async callback(state: string): Promise<AuthorizationTransaction> {
    const raw = await this.store.take(key('state', state));
    if (!raw) throw expired();
    const value = transactionSchema.parse(JSON.parse(raw));
    if (value.state !== state || value.createdAt + 600000 <= this.now()) throw expired();
    return value;
  }
  async receipt(value: AuthorizationReceipt): Promise<string> {
    const checked = receiptSchema.parse({ ...value, issuedAt: this.now() });
    const ticket = randomBytes(32).toString('base64url');
    if (!await this.store.put(key('receipt', ticket), JSON.stringify(checked), 120)) throw new Error('Authorization receipt could not be created');
    return ticket;
  }
  async exchange(ticket: string, state: string, verifier: string): Promise<AuthorizationReceipt> {
    const raw = await this.store.take(key('receipt', ticket));
    if (!raw) throw expired();
    const value = receiptSchema.parse(JSON.parse(raw));
    this.checkProof(value, state, verifier, 120000);
    return value;
  }
  async binding(value: AuthorizationReceipt): Promise<string> {
    const ticket = randomBytes(32).toString('base64url');
    const checked = receiptSchema.parse({ ...value, issuedAt: this.now() });
    if (!await this.store.put(key('binding', ticket), JSON.stringify(checked), 300)) throw new Error('Binding ticket could not be created');
    return ticket;
  }
  async checkBinding(ticket: string, state: string, verifier: string, consume = false): Promise<AuthorizationReceipt> {
    const tokenKey = key('binding', ticket);
    const raw = consume ? await this.store.take(tokenKey) : await this.store.get(tokenKey);
    if (!raw) throw expired();
    const value = receiptSchema.parse(JSON.parse(raw));
    this.checkProof(value, state, verifier, 300000);
    return value;
  }
  private checkProof(value: z.infer<typeof receiptSchema>, state: string, verifier: string, ttl: number): void {
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) throw new AppError(400, '授权证明无效', 'social_proof_invalid');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const a = Buffer.from(value.proofChallenge), b = Buffer.from(challenge);
    if (value.state !== state || value.issuedAt + ttl <= this.now() || a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new AppError(400, '授权证明不匹配或已过期，请重新授权', 'social_proof_invalid');
    }
  }
  async cancel(state: string): Promise<void> { await this.store.take(key('state', state)); }
}
const identifier = z.string().min(1).max(256);
const contextSchema = z.object({ provider: z.enum(['wechat', 'alipay', 'feishu', 'dingtalk', 'wecom']),
  appId: identifier, organizationId: identifier, installationId: identifier,
  platform: z.enum(['android', 'ios', 'harmonyos', 'web']), proofChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  deviceId: z.string().min(1).max(128), externalOrganizationId: identifier.optional(), revision: z.number().int().positive().optional() }).strict();
const transactionSchema = contextSchema.extend({ state: z.string().regex(/^[A-Za-z0-9_-]{43}$/), createdAt: z.number().finite().nonnegative() });
const receiptSchema = transactionSchema.extend({ subjectId: identifier, issuedAt: z.number().finite().nonnegative() });
function key(kind: string, token: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError(400, '授权凭据无效', 'social_proof_invalid');
  return `auth:social:${kind}:${createHash('sha256').update(token).digest('hex')}`;
}
