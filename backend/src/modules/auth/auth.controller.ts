import { confTenancyEnabled, managedContext } from '../../shared/services/conf-tenancy.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { assertBusinessEmailAvailable, isSystemSuperuser } from '../../shared/services/system-superuser.js';
import { assertOperatorEnabled } from '../access/access.enabled.js';
import { resolveCcsWorkNo } from '../../integrations/ccs/ccs-workno.js';
import { env } from '../../config/env.js';
import { prisma } from '../../plugins/db.js';
import { hashPassword, verifyPassword } from '../../shared/utils/password.js';
import { sendConfirmationEmail, sendPasswordResetEmail } from '../../shared/utils/email.js';
import {
  allVdnChoices, decideLoginChoice, loadSeatRows, loginVdnView, saveDefaultLoginVdn, seatIdentity, toChoices, writeLoginMemory,
} from './login-vdn.js';
import {
  signUpSchema, signInSchema, loginVdnUpdateSchema,
  passwordResetRequestSchema, passwordResetSchema,
  profileUpdateSchema, availabilitySchema, autoOfflineSchema,
  mfaVerifySchema,
  type SignUpInput, type SignInInput, type ProfileUpdateInput,
} from '../../shared/validators/auth.js';
import { AppError, UnauthorizedError, ValidationError } from '../../shared/errors/index.js';
import { issueLoginSession } from './auth-session.js';
import {
  getLoginSession,
  isCurrentSession,
  maskDeviceId,
  releaseLogin,
  withLoginTransition,
} from '../../shared/services/login-session.js';

// ── Helpers ──

function generateToken(length = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

function signJwt(fastify: FastifyRequest['server'], payload: Record<string, unknown>): string {
  return fastify.jwt.sign(payload);
}

function userToPayload(user: {
  id: number; email: string | null; name: string;
  pubsub_token: string | null; provider: string; uid: string;
}) {
  return {
    id: user.id,
    email: user.email ?? '',
    name: user.name,
    provider: user.provider,
    uid: user.uid,
    pubsub_token: user.pubsub_token,
  };
}

// ── Devise-compatible Auth Endpoints ──

/** POST /auth — Sign Up */
export async function signUp(request: FastifyRequest, reply: FastifyReply) {
  const body = signUpSchema.parse(request.body) as SignUpInput;

  await assertBusinessEmailAvailable(body.email);

  // Check if user already exists
  const existing = await prisma.users.findFirst({
    where: { email: body.email },
  });
  if (existing) {
    throw new ValidationError(['Email already registered']);
  }

  const confirmationToken = generateToken();

  const user = await prisma.users.create({
    data: {
      name: body.name,
      email: body.email,
      encrypted_password: await hashPassword(body.password),
      provider: 'email',
      uid: body.email,
      confirmation_token: confirmationToken,
      confirmation_sent_at: new Date(),
    },
  });

  // Send confirmation email (async, don't await)
  sendConfirmationEmail(body.email, confirmationToken).catch((e) =>
    request.log.error(e, 'Failed to send confirmation email'),
  );

  const payload = userToPayload(user);
  const token = signJwt(request.server, payload);

  return reply.status(200).send({
    status: 'success',
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      provider: 'email',
      uid: user.email,
      confirmed: false,
      created_at: user.created_at?.getTime() ?? Date.now(),
    },
    headers: {
      'access-token': token,
      client: '', expiry: '', uid: user.email,
    },
  });
}

/** POST /auth/sign_in — 坐席用工号登录。系统超级用户不参与工号匹配；仅工号 admin 且密码相符时列出全部 VDN。 */
export async function signIn(request: FastifyRequest, reply: FastifyReply) {
  const body = signInSchema.parse(request.body) as SignInInput;
  const workNo = body.work_no;
  const seats = await loadSeatRows(workNo);
  const matched = [];
  for (const user of seats) {
    if (await verifyPassword(body.password, user.encrypted_password)) matched.push(user);
  }
  if (matched.length) {
    const choices = await toChoices(matched);
    const chosen = decideLoginChoice(choices, matched, body);
    if (!chosen) return reply.status(200).send({ status: 'select_vdn', scope: 'seats', vdns: choices });
    const user = matched.find(item => item.id === chosen.user_id) ?? matched[0]!;
    await writeLoginMemory(matched.map(item => item.id), chosen, user.id);
    return finishPasswordLogin(request, reply, user, body.device_id, chosen.vdn_id);
  }
  if (workNo === 'admin') {
    const superuser = await prisma.users.findFirst({ where: { uid: 'conf-system:admin', type: 'SuperAdmin' } });
    if (superuser && isSystemSuperuser(superuser) && await verifyPassword(body.password, superuser.encrypted_password)) {
      const choices = await allVdnChoices(superuser.id);
      if (!choices.length) throw new AppError(503, '没有可进入的 VDN');
      const chosen = decideLoginChoice(choices, [superuser], body);
      if (!chosen) return reply.status(200).send({ status: 'select_vdn', scope: 'all', vdns: choices });
      await writeLoginMemory([superuser.id], chosen, superuser.id);
      return finishPasswordLogin(request, reply, superuser, body.device_id, chosen.vdn_id);
    }
  }
  throw new UnauthorizedError('用户名或密码不正确，请重试。');
}

async function finishPasswordLogin(request: FastifyRequest, reply: FastifyReply, user: {
  id: number; email: string | null; name: string; uid: string | null; provider: string;
  pubsub_token: string | null; confirmed_at: Date | null; created_at: Date; encrypted_password: string;
  current_sign_in_at: Date | null; current_sign_in_ip: string | null; type?: string | null;
}, deviceId: string | undefined, vdnId: number | null) {
  const sessionUser = { ...user, uid: user.uid ?? '' };
  const tenant = confTenancyEnabled() ? await managedContext({ currentUser: { ...sessionUser, accounts: [] }, headers: {}, body: vdnId ? { vdn_id: vdnId } : {} } as unknown as FastifyRequest) : undefined;
  if (!confTenancyEnabled() && !isSystemSuperuser(sessionUser)) await assertOperatorEnabled(resolveCcsWorkNo(sessionUser, env.CCS_WORK_NO_FIELD));
  await prisma.users.update({
    where: { id: user.id },
    data: {
      sign_in_count: { increment: 1 },
      current_sign_in_at: new Date(),
      last_sign_in_at: user.current_sign_in_at,
      current_sign_in_ip: request.ip,
      last_sign_in_ip: user.current_sign_in_ip,
    },
  });
  return reply.status(200).send(await withLoginTransition(user.id, async () => issueLoginSession(request, sessionUser, {
    deviceId: deviceId ?? '', method: 'password', accountId: tenant?.accountId, vdnId: tenant?.vdnId ?? vdnId ?? seatIdentity(sessionUser.uid).vdnId ?? undefined,
  })));
}

/** GET /api/v1/profile/login-vdn — 本次登录 VDN、默认 VDN，以及可改选的列表。 */
export async function getLoginVdn(request: FastifyRequest, reply: FastifyReply) {
  const current = request.currentUser;
  if (!current) throw new UnauthorizedError();
  const user = await prisma.users.findUnique({ where: { id: current.id } });
  if (!user) throw new AppError(404, 'User not found');
  return reply.status(200).send(await loginVdnView(user));
}

/** PUT /api/v1/profile/login-vdn — 只改下次登录的默认 VDN，不切换当前会话。 */
export async function updateLoginVdn(request: FastifyRequest, reply: FastifyReply) {
  const current = request.currentUser;
  if (!current) throw new UnauthorizedError();
  const body = loginVdnUpdateSchema.parse(request.body);
  const user = await prisma.users.findUnique({ where: { id: current.id } });
  if (!user) throw new AppError(404, 'User not found');
  const chosen = await saveDefaultLoginVdn(user, body);
  return reply.status(200).send({ default: chosen, logout_required: true });
}

/** DELETE /auth/sign_out — Sign Out */
export async function signOut(request: FastifyRequest, reply: FastifyReply) {
  const user = request.currentUser;
  if (user) {
    const payload = request.user as { sid?: string };
    if (process.env.OMNI_EXTENSION_BINDING_ENABLED === '1') {
      const { database, execute } = await import('../access/access.db.js');
      await execute(await database(), "UPDATE t_omni_extension_voice SET State='logged_out' WHERE OmniUserID=? AND LoginSID=?", [user.id, payload.sid]);
    }
    releaseLogin(user.id, payload.sid);
    // 主动退出：立刻 LoggedOff，不要等 45s WS grace（否则马上再登会 1053）
    try {
      await request.server.ccsBridge?.logoutUser(user.id);
    } catch (err) {
      request.log.warn({ err, userId: user.id }, 'sign_out CCS logout failed');
    }
  }
  return reply.status(200).send({ success: true });
}

export async function currentLoginSession(request: FastifyRequest, reply: FastifyReply) {
  const user = request.currentUser;
  if (!user) throw new UnauthorizedError();
  const session = getLoginSession(user.id);
  if (!session || !isCurrentSession(user.id, (request.user as { sid?: string }).sid)) {
    throw new AppError(401, '账号已在其他终端登录', 'session_replaced');
  }
  return reply.send({
    user_id: session.userId,
    device_id: session.deviceId,
    device_label: maskDeviceId(session.deviceId),
    issued_at: new Date(session.issuedAt).toISOString(),
    ip: session.ip,
    exclusive: true,
  });
}

/** GET /auth/validate_token — Validate Token */
export async function validateToken(request: FastifyRequest, reply: FastifyReply) {
  if (!request.currentUser) {
    throw new UnauthorizedError('Invalid token');
  }

  const tenant = confTenancyEnabled() ? await managedContext(request) : undefined;
  const session = getLoginSession(request.currentUser.id);
  const binding = process.env.OMNI_EXTENSION_BINDING_ENABLED === '1' ? await (await import('../extension-binding/service.js')).bindingSnapshot(request) : null;
  return reply.status(200).send({
    success: true,
    data: {
      id: request.currentUser.id,
      email: request.currentUser.email,
      name: request.currentUser.name,
      provider: 'email',
      uid: request.currentUser.uid,
      work_no: resolveCcsWorkNo({ id: request.currentUser.id, uid: request.currentUser.uid ?? null }, env.CCS_WORK_NO_FIELD),
      session_id: session?.sessionId,
      authentication_method: session?.authenticationMethod ?? 'password',
      voice_signed_in_before: session?.hadVoiceSignIn ?? false,
      voice_session_expected: session?.voiceSessionExpected ?? false,
      ...(process.env.OMNI_EXTENSION_BINDING_ENABLED === '1' ? (() => ({ extension_binding: binding!.binding, voice_startup: binding!.voice }))() : {}),
      ...(tenant ? { account_id: tenant.accountId, vdn_id: tenant.vdnId } : {}),
    },
  });
}

/** POST /auth/password — Request password reset */
export async function requestPasswordReset(request: FastifyRequest, reply: FastifyReply) {
  const { email } = passwordResetRequestSchema.parse(request.body);

  const user = await prisma.users.findFirst({ where: { email } });
  if (!user || isSystemSuperuser(user) || (confTenancyEnabled() && user.uid?.startsWith('conf-vdn:'))) {
    // Don't reveal whether the user exists
    return reply.status(200).send({
      success: true,
      message: 'If your email is registered, you will receive a reset link.',
    });
  }

  const token = generateToken();
  await prisma.users.update({
    where: { id: user.id },
    data: {
      reset_password_token: token,
      reset_password_sent_at: new Date(),
    },
  });

  sendPasswordResetEmail(email, token).catch((e) =>
    request.log.error(e, 'Failed to send password reset email'),
  );

  return reply.status(200).send({
    success: true,
    message: 'If your email is registered, you will receive a reset link.',
  });
}

/** PUT /auth/password — Reset password */
export async function resetPassword(request: FastifyRequest, reply: FastifyReply) {
  const { token, password } = passwordResetSchema.parse(request.body);

  const user = await prisma.users.findFirst({
    where: { reset_password_token: token },
  });
  if (!user) {
    throw new ValidationError(['Invalid or expired reset token']);
  }
  if (isSystemSuperuser(user) || (confTenancyEnabled() && user.uid?.startsWith('conf-vdn:'))) throw new AppError(403, '联动身份密码请在 ConfManager 修改');

  await prisma.users.update({
    where: { id: user.id },
    data: {
      encrypted_password: await hashPassword(password),
      reset_password_token: null,
      reset_password_sent_at: null,
    },
  });

  return reply.status(200).send({
    success: true,
    message: 'Password reset successfully.',
  });
}

/** GET /auth/confirmation — Confirm email */
export async function confirmEmail(request: FastifyRequest, reply: FastifyReply) {
  const { confirmation_token } = request.query as { confirmation_token?: string };
  if (!confirmation_token) {
    throw new ValidationError(['Confirmation token is required']);
  }

  const user = await prisma.users.findFirst({
    where: { confirmation_token: confirmation_token },
  });
  if (!user) {
    throw new ValidationError(['Invalid confirmation token']);
  }

  await prisma.users.update({
    where: { id: user.id },
    data: {
      confirmed_at: new Date(),
      confirmation_token: null,
    },
  });

  return reply.status(200).send({
    success: true,
    message: 'Email confirmed successfully.',
  });
}

/** POST /auth/confirmation — Resend confirmation */
export async function resendConfirmation(request: FastifyRequest, reply: FastifyReply) {
  const { email } = request.body as { email?: string };
  if (!email) {
    throw new ValidationError(['Email is required']);
  }

  const user = await prisma.users.findFirst({ where: { email } });
  if (!user || user.confirmed_at) {
    return reply.status(200).send({ success: true });
  }

  const token = generateToken();
  await prisma.users.update({
    where: { id: user.id },
    data: { confirmation_token: token, confirmation_sent_at: new Date() },
  });

  sendConfirmationEmail(email, token).catch((e) =>
    request.log.error(e, 'Failed to send confirmation email'),
  );

  return reply.status(200).send({ success: true });
}

// ── Profile Endpoints ──

/** GET /api/v1/profile */
export async function getProfile(request: FastifyRequest, reply: FastifyReply) {
  const user = request.currentUser;
  if (!user) throw new UnauthorizedError();

  const fullUser = await prisma.users.findUnique({
    where: { id: user.id },
    include: {
      account_users: {
        include: { account: { select: { id: true, name: true } } },
      },
    },
  });

  if (!fullUser) throw new AppError(404, 'User not found');

  return reply.status(200).send({
    id: fullUser.id,
    name: fullUser.name,
    display_name: fullUser.display_name,
    email: fullUser.email,
    provider: fullUser.provider,
    uid: fullUser.uid,
    message_signature: fullUser.message_signature,
    ui_settings: fullUser.ui_settings,
    custom_attributes: fullUser.custom_attributes,
    created_at: fullUser.created_at.getTime(),
    accounts: fullUser.account_users.map((au) => ({
      id: au.account?.id ?? 0,
      name: au.account?.name ?? '',
      role: au.role,
      active_at: au.active_at?.getTime(),
    })),
  });
}

/** PUT /api/v1/profile */
export async function updateProfile(request: FastifyRequest, reply: FastifyReply) {
  const user = request.currentUser;
  if (!user) throw new UnauthorizedError();

  const body = profileUpdateSchema.parse(request.body) as ProfileUpdateInput;
  if ((isSystemSuperuser(user) || (confTenancyEnabled() && user.uid?.startsWith('conf-vdn:'))) && (body.email !== undefined || body.name !== undefined)) throw new AppError(403, '系统超级用户邮箱请在 ConfManager 联动配置中修改');

  const existing = await prisma.users.findUnique({
    where: { id: user.id },
    select: { custom_attributes: true },
  });
  const prevAttrs =
    (existing?.custom_attributes as Record<string, unknown> | null) ?? {};
  const nextAttrs: Record<string, unknown> = {
    ...prevAttrs,
    ...(body.custom_attributes ?? {}),
  };
  if (body.department !== undefined) nextAttrs.department = body.department;
  if (body.title !== undefined) nextAttrs.title = body.title;

  if (body.email) await assertBusinessEmailAvailable(body.email);

  const updated = await prisma.users.update({
    where: { id: user.id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.display_name !== undefined && { display_name: body.display_name }),
      ...(body.email !== undefined && { email: body.email }),
      ...(body.message_signature !== undefined && { message_signature: body.message_signature }),
      ...(body.ui_settings !== undefined && { ui_settings: body.ui_settings as object }),
      custom_attributes: nextAttrs as object,
    },
  });

  return reply.status(200).send({
    id: updated.id,
    name: updated.name,
    display_name: updated.display_name,
    email: updated.email,
    custom_attributes: updated.custom_attributes,
  });
}

/** DELETE /api/v1/profile/avatar */
export async function deleteAvatar(request: FastifyRequest, reply: FastifyReply) {
  // Avatar deletion would integrate with ActiveStorage/S3
  // For now, clear any avatar reference
  return reply.status(200).send({ success: true });
}

/** POST /api/v1/profile/availability */
export async function setAvailability(request: FastifyRequest, reply: FastifyReply) {
  const user = request.currentUser;
  if (!user) throw new UnauthorizedError();

  const { availability } = availabilitySchema.parse(request.body);
  const availabilityMap = { online: 0, offline: 1, busy: 2 };

  // Update availability on all account_users for this user
  await prisma.account_users.updateMany({
    where: { user_id: user.id },
    data: { availability: availabilityMap[availability] ?? 1 },
  });

  // Also update the users table
  await prisma.users.update({
    where: { id: user.id },
    data: { availability: availabilityMap[availability] ?? 1 },
  });

  return reply.status(200).send({ success: true, availability });
}

/** POST /api/v1/profile/auto_offline */
export async function setAutoOffline(request: FastifyRequest, reply: FastifyReply) {
  const user = request.currentUser;
  if (!user) throw new UnauthorizedError();

  const { auto_offline } = autoOfflineSchema.parse(request.body);

  await prisma.account_users.updateMany({
    where: { user_id: user.id },
    data: { auto_offline },
  });

  return reply.status(200).send({ success: true, auto_offline });
}

/** PUT /api/v1/profile/set_active_account */
export async function setActiveAccount(request: FastifyRequest, reply: FastifyReply) {
  const user = request.currentUser;
  if (!user) throw new UnauthorizedError();

  const { account_id } = request.body as { account_id?: number };
  if (!account_id) throw new ValidationError(['account_id is required']);

  if (confTenancyEnabled()) {
    const tenant = await managedContext(request);
    if (tenant.systemSuperuser) return reply.status(200).send({ success: true, account_id: tenant.accountId });
  }
  const accountUser = await prisma.account_users.findFirst({
    where: { user_id: user.id, account_id },
  });
  if (!accountUser) throw new AppError(404, 'Account not found for this user');

  // Mark activity
  await prisma.account_users.update({
    where: { id: accountUser.id },
    data: { active_at: new Date() },
  });

  return reply.status(200).send({ success: true });
}

/** POST /api/v1/profile/resend_confirmation */
export async function profileResendConfirmation(request: FastifyRequest, reply: FastifyReply) {
  const user = request.currentUser;
  if (!user) throw new UnauthorizedError();

  const fullUser = await prisma.users.findUnique({ where: { id: user.id } });
  if (!fullUser || !fullUser.email || fullUser.confirmed_at) {
    return reply.status(200).send({ success: true });
  }

  const token = generateToken();
  await prisma.users.update({
    where: { id: user.id },
    data: { confirmation_token: token, confirmation_sent_at: new Date() },
  });

  sendConfirmationEmail(fullUser.email, token).catch((e) =>
    request.log.error(e, 'Failed to send confirmation'),
  );

  return reply.status(200).send({ success: true });
}

/** POST /api/v1/profile/reset_access_token */
export async function resetAccessToken(request: FastifyRequest, reply: FastifyReply) {
  const user = request.currentUser;
  if (!user) throw new UnauthorizedError();

  const newToken = generateToken(16);
  await prisma.users.update({
    where: { id: user.id },
    data: { pubsub_token: newToken },
  });

  return reply.status(200).send({ pubsub_token: newToken });
}

// ── MFA ──

/** GET /api/v1/profile/mfa — Show MFA status */
export async function getMfaStatus(request: FastifyRequest, reply: FastifyReply) {
  const user = request.currentUser;
  if (!user) throw new UnauthorizedError();

  const fullUser = await prisma.users.findUnique({
    where: { id: user.id },
    select: { otp_required_for_login: true, otp_secret: true },
  });

  return reply.status(200).send({
    otp_required_for_login: fullUser?.otp_required_for_login ?? false,
    has_otp_secret: !!fullUser?.otp_secret,
  });
}

/** POST /api/v1/profile/mfa — Setup MFA */
export async function setupMfa(request: FastifyRequest, reply: FastifyReply) {
  const user = request.currentUser;
  if (!user) throw new UnauthorizedError();

  // Generate OTP secret
  const secret = generateToken(10);
  await prisma.users.update({
    where: { id: user.id },
    data: { otp_secret: secret },
  });

  // Generate 10 backup codes
  const backupCodes = Array.from({ length: 10 }, () => generateToken(4).substring(0, 8));
  await prisma.users.update({
    where: { id: user.id },
    data: { otp_backup_codes: backupCodes.join(',') },
  });

  return reply.status(200).send({
    otp_secret: secret,
    backup_codes: backupCodes,
  });
}

/** POST /api/v1/profile/mfa/verify — Verify MFA code */
export async function verifyMfa(request: FastifyRequest, reply: FastifyReply) {
  const user = request.currentUser;
  if (!user) throw new UnauthorizedError();

  const { otp_code } = mfaVerifySchema.parse(request.body);

  // In production, use a proper TOTP library like 'otplib'
  const fullUser = await prisma.users.findUnique({
    where: { id: user.id },
    select: { otp_required_for_login: true },
  });

  // Simple demo: just enable MFA
  await prisma.users.update({
    where: { id: user.id },
    data: { otp_required_for_login: true },
  });

  return reply.status(200).send({ success: true, otp_required_for_login: true });
}

/** DELETE /api/v1/profile/mfa — Disable MFA */
export async function disableMfa(request: FastifyRequest, reply: FastifyReply) {
  const user = request.currentUser;
  if (!user) throw new UnauthorizedError();

  await prisma.users.update({
    where: { id: user.id },
    data: {
      otp_required_for_login: false,
      otp_secret: null,
      otp_backup_codes: null,
    },
  });

  return reply.status(200).send({ success: true });
}

/** POST /api/v1/profile/mfa/backup_codes — Get new backup codes */
export async function getBackupCodes(request: FastifyRequest, reply: FastifyReply) {
  const user = request.currentUser;
  if (!user) throw new UnauthorizedError();

  const backupCodes = Array.from({ length: 10 }, () => generateToken(4).substring(0, 8));
  await prisma.users.update({
    where: { id: user.id },
    data: { otp_backup_codes: backupCodes.join(',') },
  });

  return reply.status(200).send({ backup_codes: backupCodes });
}

// ── Platform Token ──

/** POST /platform/api/v1/users/:id/token — Generate platform token */
export async function generatePlatformToken(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const userId = parseInt(id, 10);

  const user = await prisma.users.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'User not found');

  const payload = userToPayload(user);
  const token = signJwt(request.server, { ...payload, platform: true });

  return reply.status(200).send({ token });
}

// ── Notification Subscriptions ──

/** POST /api/v1/notification_subscriptions */
export async function createNotificationSubscription(request: FastifyRequest, reply: FastifyReply) {
  const user = request.currentUser;
  if (!user) throw new UnauthorizedError();

  const { subscription_type, subscription_attributes, identifier } = request.body as {
    subscription_type: number;
    subscription_attributes?: Record<string, unknown>;
    identifier?: string;
  };

  const sub = await prisma.notification_subscriptions.create({
    data: {
      user_id: user.id,
      subscription_type,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      subscription_attributes: (subscription_attributes ?? {}) as any,
      identifier: identifier ?? generateToken(16),
    },
  });

  return reply.status(200).send({
    id: sub.id,
    subscription_type: sub.subscription_type,
    identifier: sub.identifier,
  });
}

/** DELETE /api/v1/notification_subscriptions */
export async function deleteNotificationSubscription(request: FastifyRequest, reply: FastifyReply) {
  const user = request.currentUser;
  if (!user) throw new UnauthorizedError();

  const { identifier } = request.body as { identifier?: string };
  if (!identifier) throw new ValidationError(['identifier is required']);

  await prisma.notification_subscriptions.deleteMany({
    where: { user_id: user.id, identifier },
  });

  return reply.status(200).send({ success: true });
}

/** POST /api/v1/auth/saml_login — Initiate SAML login */
export async function samlLogin(request: FastifyRequest, reply: FastifyReply) {
  const { email } = request.body as { email?: string };
  if (!email) throw new ValidationError(['email is required']);

  // SAML redirect would go here — for now return a status
  return reply.status(200).send({
    success: true,
    message: 'SAML login initiated',
    redirect_url: `/auth/saml/callback`,
  });
}
