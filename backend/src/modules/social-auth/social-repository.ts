import type { Prisma } from '@prisma/client';
import { prisma } from '../../plugins/db.js';
import { AppError } from '../../shared/errors/index.js';
import { assertLiveBinding, confTenancyEnabled } from '../../shared/services/conf-tenancy.js';
import { verifyPassword } from '../../shared/utils/password.js';
import type { AuthorizationReceipt } from './authorization-ledger.js';
import { socialProviderSchema, type SocialInstallation, type SocialRepository } from './social-service.js';

type InstallationRow = Prisma.social_enterprise_installationsGetPayload<{ include: { app: true; organization: true } }>;
export function installationFromRow(value: InstallationRow): SocialInstallation {
  if (value.provider !== value.app.provider) throw new AppError(403, '企业安装与平台注册应用不匹配');
  return { id: value.id, externalOrganizationId: value.external_organization_id, status: value.status,
    revision: value.authorization_revision, expiresAt: value.expires_at,
    organization: { id: value.organization.id, code: value.organization.code, accountId: value.organization.account_id,
      vdnId: value.organization.vdn_id, enabled: value.organization.enabled },
    app: { id: value.app.id, provider: socialProviderSchema.parse(value.app.provider), clientId: value.app.client_id,
      enabled: value.app.enabled, approvedPlatforms: Array.isArray(value.app.approved_platforms) ? value.app.approved_platforms.filter((p): p is string => typeof p === 'string') : [] } };
}
const identityKey = (value: AuthorizationReceipt) => ({ app_id: value.appId, external_organization_id: value.externalOrganizationId!, subject_id: value.subjectId });
export const socialRepository: SocialRepository = {
  list: async code => !confTenancyEnabled() ? [] : (await prisma.social_enterprise_installations.findMany({
    where: { organization: { code, enabled: true }, app: { enabled: true } }, include: { app: true, organization: true },
  })).map(installationFromRow),
  installation: async id => {
    const value = await prisma.social_enterprise_installations.findUnique({ where: { id }, include: { app: true, organization: true } });
    return value ? installationFromRow(value) : null;
  },
  identity: async receipt => {
    const value = await prisma.social_user_identities.findUnique({ where: { app_id_external_organization_id_subject_id: identityKey(receipt) } });
    return value ? { userId: value.user_id, organizationId: value.organization_id, enabled: value.enabled } : null;
  },
  verifyAccount: async (email, password) => {
    const users = await prisma.users.findMany({ where: { email: { equals: email.trim(), mode: 'insensitive' } }, take: 2 });
    return users.length === 1 && await verifyPassword(password, users[0]!.encrypted_password) ? users[0]!.id : null;
  },
  assertAccount: async (userId, installation) => {
    if (!confTenancyEnabled()) throw new AppError(503, '第三方登录需要已核验的企业租户联动', 'social_tenancy_unavailable');
    // Social access requires an explicit, live tenant/VDN mapping even in legacy password-login mode.
    const live = await assertLiveBinding(userId);
    if (live.map.account_id !== installation.organization.accountId || live.binding.vdn_id !== installation.organization.vdnId) {
      throw new AppError(403, '账号不属于当前企业或 VDN', 'social_account_mismatch');
    }
  },
  bind: async (receipt, userId) => {
    try {
      await prisma.social_user_identities.create({ data: { ...identityKey(receipt), organization_id: receipt.organizationId, user_id: userId } });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const existing = await prisma.social_user_identities.findUnique({ where: { app_id_external_organization_id_subject_id: identityKey(receipt) } });
      if (!existing?.enabled || existing.user_id !== userId || existing.organization_id !== receipt.organizationId) {
        throw new AppError(409, '第三方身份已关联其他账号或企业', 'social_binding_conflict');
      }
    }
  },
};

export async function assertSocialSession(userId: number, payload: Record<string, unknown>): Promise<void> {
  if (payload.authentication_method !== 'social') return;
  if (process.env.SOCIAL_AUTH_ENABLED !== '1') throw new AppError(403, '第三方登录已停用', 'social_disabled');
  const id = typeof payload.social_installation_id === 'string' ? payload.social_installation_id : '';
  const row = await prisma.social_enterprise_installations.findUnique({ where: { id }, include: { app: true, organization: true } });
  if (!row || !row.app.enabled || !row.organization.enabled || row.status !== 'active' ||
    row.organization_id !== payload.social_organization_id || row.authorization_revision !== payload.social_revision ||
    (row.expires_at != null && row.expires_at.getTime() <= Date.now()) || typeof payload.social_subject_id !== 'string') {
    throw new AppError(403, '企业授权已撤销、过期或更新，请重新登录', 'social_installation_expired');
  }
  const identity = await prisma.social_user_identities.findUnique({ where: { app_id_external_organization_id_subject_id: {
    app_id: row.app_id, external_organization_id: row.external_organization_id, subject_id: payload.social_subject_id,
  } } });
  if (!identity?.enabled || identity.user_id !== userId || identity.organization_id !== row.organization_id) throw new AppError(403, '第三方身份关联已失效');
  await socialRepository.assertAccount(userId, installationFromRow(row));
}
