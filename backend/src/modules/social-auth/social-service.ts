import { z } from 'zod';
import { AppError, UnauthorizedError } from '../../shared/errors/index.js';
import { AuthorizationLedger, type AuthorizationReceipt, type AuthorizationTransaction } from './authorization-ledger.js';

export const socialProviderSchema = z.enum(['wechat', 'alipay', 'feishu', 'dingtalk', 'wecom']);
export const socialPlatformSchema = z.enum(['android', 'ios', 'harmonyos']);
export type SocialProviderId = z.infer<typeof socialProviderSchema>;
export type SocialPlatform = z.infer<typeof socialPlatformSchema>;
export interface SocialInstallation {
  id: string;
  externalOrganizationId: string;
  status: string;
  revision: number;
  expiresAt: Date | null;
  organization: { id: string; code: string; accountId: number; vdnId: number; enabled: boolean };
  app: { id: string; provider: SocialProviderId; clientId: string; enabled: boolean; approvedPlatforms: string[] };
}
export interface SocialAdapter {
  platforms: readonly SocialPlatform[];
  mode: 'native' | 'browser';
  authorize(installation: SocialInstallation, state: string): Promise<{ authorizationUrl?: string; nativePayload?: string }>;
  complete(installation: SocialInstallation, code: string, transaction: AuthorizationTransaction): Promise<{ subjectId: string; externalOrganizationId: string }>;
  assertMember(installation: SocialInstallation, subjectId: string): Promise<void>;
}
export type SocialAdapters = Partial<Record<SocialProviderId, SocialAdapter>>;
export interface SocialRepository {
  list(organizationCode: string): Promise<SocialInstallation[]>;
  installation(id: string): Promise<SocialInstallation | null>;
  identity(receipt: AuthorizationReceipt): Promise<{ userId: number; organizationId: string; enabled: boolean } | null>;
  verifyAccount(email: string, password: string): Promise<number | null>;
  assertAccount(userId: number, installation: SocialInstallation): Promise<void>;
  bind(receipt: AuthorizationReceipt, userId: number): Promise<void>;
}
export interface SocialSessionResult {
  status: 'authenticated';
  userId: number;
  deviceId: string;
  subjectId: string;
  installation: SocialInstallation;
}
const labels: Record<SocialProviderId, string> = { wechat: '微信', alipay: '支付宝', feishu: '飞书', dingtalk: '钉钉', wecom: '企业微信' };
const unavailable = () => new AppError(503, '当前企业或平台的第三方授权尚未就绪', 'social_unavailable');

export class SocialAuthService {
  constructor(private readonly ledger: AuthorizationLedger, private readonly repository: SocialRepository,
    private readonly adapters: SocialAdapters, private readonly now: () => number = Date.now) {}

  async providers(code: string, platform: string) {
    const parsed = socialPlatformSchema.safeParse(platform);
    if (!code || !parsed.success) return [];
    const installations = await this.repository.list(code);
    // Ambiguous application mappings fail closed rather than choose another customer/application.
    return Object.entries(labels).flatMap(([id, label]) => {
      const matches = installations.filter(value => value.app.provider === id && this.ready(value, parsed.data));
      return matches.length === 1 ? [{ id, label, ready: true, mode: this.adapters[id as SocialProviderId]!.mode, requiresOrganization: true }] : [];
    });
  }

  async authorize(input: { provider: string; platform: string; organizationCode: string; proofChallenge: string; deviceId: string }) {
    const provider = socialProviderSchema.parse(input.provider);
    const platform = socialPlatformSchema.parse(input.platform);
    const matches = (await this.repository.list(input.organizationCode)).filter(value => value.app.provider === provider && this.ready(value, platform));
    if (matches.length !== 1) throw unavailable();
    const installation = matches[0]!;
    const state = await this.ledger.begin({ provider, platform, appId: installation.app.id, organizationId: installation.organization.id,
      installationId: installation.id, externalOrganizationId: installation.externalOrganizationId, revision: installation.revision,
      proofChallenge: input.proofChallenge, deviceId: input.deviceId });
    try {
      const adapter = this.adapters[provider]!;
      return { transactionId: state, provider, mode: adapter.mode, ...await adapter.authorize(installation, state) };
    } catch (error) {
      await this.ledger.cancel(state);
      throw error;
    }
  }

  async callback(provider: string, state: string, code: string): Promise<{ ticket: string; state: string }> {
    const transaction = await this.ledger.callback(state);
    if (transaction.provider !== provider) throw new AppError(400, '授权供应商不一致', 'social_scope_mismatch');
    const installation = await this.pinnedInstallation(transaction);
    const adapter = this.adapters[installation.app.provider]!;
    const identity = await adapter.complete(installation, code, transaction);
    if (!identity.subjectId || identity.externalOrganizationId !== installation.externalOrganizationId) {
      throw new AppError(403, '第三方账号不属于当前企业', 'social_organization_mismatch');
    }
    await adapter.assertMember(installation, identity.subjectId);
    const ticket = await this.ledger.receipt({ ...transaction, subjectId: identity.subjectId });
    return { ticket, state };
  }

  async exchange(ticket: string, state: string, verifier: string): Promise<SocialSessionResult | { status: 'binding_required'; bindingTicket: string }> {
    const receipt = await this.ledger.exchange(ticket, state, verifier);
    const installation = await this.pinnedInstallation(receipt);
    await this.adapters[installation.app.provider]!.assertMember(installation, receipt.subjectId);
    const identity = await this.repository.identity(receipt);
    if (!identity) return { status: 'binding_required', bindingTicket: await this.ledger.binding(receipt) };
    if (!identity.enabled || identity.organizationId !== installation.organization.id) {
      throw new AppError(403, '第三方身份关联已停用或企业不匹配', 'social_identity_disabled');
    }
    await this.repository.assertAccount(identity.userId, installation);
    return { status: 'authenticated', userId: identity.userId, deviceId: receipt.deviceId, subjectId: receipt.subjectId, installation };
  }

  async bind(ticket: string, state: string, verifier: string, email: string, password: string): Promise<SocialSessionResult> {
    const pending = await this.ledger.checkBinding(ticket, state, verifier);
    const installation = await this.pinnedInstallation(pending);
    const userId = await this.repository.verifyAccount(email, password);
    if (!userId) throw new UnauthorizedError('用户名或密码不正确，请重试。');
    await this.repository.assertAccount(userId, installation);
    await this.adapters[installation.app.provider]!.assertMember(installation, pending.subjectId);
    const receipt = await this.ledger.checkBinding(ticket, state, verifier, true);
    await this.repository.bind(receipt, userId);
    await this.pinnedInstallation(receipt);
    return { status: 'authenticated', userId, deviceId: receipt.deviceId, subjectId: receipt.subjectId, installation };
  }

  cancel(state: string): Promise<void> { return this.ledger.cancel(state); }

  private ready(value: SocialInstallation, platform: SocialPlatform): boolean {
    return value.app.enabled && value.organization.enabled && value.status === 'active' &&
      (value.expiresAt == null || value.expiresAt.getTime() > this.now()) && value.app.approvedPlatforms.includes(platform) &&
      this.adapters[value.app.provider]?.platforms.includes(platform) === true;
  }

  private async pinnedInstallation(value: AuthorizationTransaction): Promise<SocialInstallation> {
    const installation = await this.repository.installation(value.installationId);
    const platform = socialPlatformSchema.parse(value.platform);
    if (!installation || !this.ready(installation, platform) || installation.app.provider !== value.provider ||
      installation.app.id !== value.appId || installation.organization.id !== value.organizationId ||
      installation.externalOrganizationId !== value.externalOrganizationId || installation.revision !== value.revision) throw unavailable();
    return installation;
  }
}
