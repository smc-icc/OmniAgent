import type { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { assertBusinessEmailAvailable, assertBusinessManagedUser, isReservedSystemIdentity } from '../../shared/services/system-superuser.js';
import { prisma } from '../../plugins/db.js';
import { hashPassword } from '../../shared/utils/password.js';
import {
  createAccountSchema, updateAccountSchema,
  createAgentSchema, updateAgentSchema, bulkCreateAgentSchema,
  createTeamSchema, updateTeamSchema, teamMemberSchema, updateTeamMemberSchema,
  createAgentBotSchema, updateAgentBotSchema,
  createCustomRoleSchema, updateCustomRoleSchema,
  createCapacityPolicySchema, updateCapacityPolicySchema,
  createInboxLimitSchema, updateInboxLimitSchema,
  type CreateAccountInput, type UpdateAccountInput,
  type CreateTeamInput, type UpdateTeamInput,
  type CreateAgentBotInput,
} from '../../shared/validators/accounts.js';
import { AppError, NotFoundError, UnauthorizedError, ValidationError } from '../../shared/errors/index.js';

const auth = { preHandler: [] as Array<(req: FastifyRequest) => Promise<void>> };

// ── Accounts ──

/** POST /api/v1/accounts — Create account */
export async function createAccount(request: FastifyRequest, reply: FastifyReply) {
  const body = createAccountSchema.parse(request.body) as CreateAccountInput;

  const account = await prisma.accounts.create({
    data: {
      name: body.name,
      locale: body.locale ?? 0,
      domain: body.domain,
      support_email: body.support_email,
    },
  });

  return reply.status(200).send({
    id: account.id,
    name: account.name,
    locale: account.locale,
    domain: account.domain,
    support_email: account.support_email,
    status: account.status,
    created_at: account.created_at.getTime(),
  });
}

/** GET /api/v1/accounts/:id — Show account */
export async function showAccount(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const account = await prisma.accounts.findUnique({ where: { id: parseInt(id, 10) } });
  if (!account) throw new NotFoundError('Account');

  return reply.status(200).send({
    id: account.id,
    name: account.name,
    locale: account.locale,
    domain: account.domain,
    support_email: account.support_email,
    auto_resolve_duration: account.auto_resolve_duration,
    custom_attributes: account.custom_attributes,
    status: account.status,
    settings: account.settings,
    created_at: account.created_at.getTime(),
  });
}

/** PUT /api/v1/accounts/:id — Update account */
export async function updateAccount(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = updateAccountSchema.parse(request.body) as UpdateAccountInput;

  const account = await prisma.accounts.update({
    where: { id: parseInt(id, 10) },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.locale !== undefined && { locale: body.locale }),
      ...(body.domain !== undefined && { domain: body.domain }),
      ...(body.support_email !== undefined && { support_email: body.support_email }),
      ...(body.auto_resolve_duration !== undefined && { auto_resolve_duration: body.auto_resolve_duration }),
      ...(body.custom_attributes !== undefined && { custom_attributes: body.custom_attributes as object }),
      ...(body.settings !== undefined && { settings: body.settings as object }),
    },
  });

  return reply.status(200).send({
    id: account.id,
    name: account.name,
    locale: account.locale,
    domain: account.domain,
    support_email: account.support_email,
    auto_resolve_duration: account.auto_resolve_duration,
    custom_attributes: account.custom_attributes,
    settings: account.settings,
  });
}

/** POST /api/v1/accounts/:id/update_active_at */
export async function updateActiveAt(request: FastifyRequest, reply: FastifyReply) {
  const user = request.currentUser;
  const { id } = request.params as { id: string };

  if (!user) throw new UnauthorizedError();

  await prisma.account_users.updateMany({
    where: { account_id: parseInt(id, 10), user_id: user.id },
    data: { active_at: new Date() },
  });

  return reply.status(200).send({ success: true });
}

/** GET /api/v1/accounts/:id/cache_keys */
export async function cacheKeys(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const account = await prisma.accounts.findUnique({
    where: { id: parseInt(id, 10) },
    select: { updated_at: true },
  });

  return reply.status(200).send({
    cache_keys: {
      account: account?.updated_at?.toISOString() ?? new Date().toISOString(),
    },
  });
}

// ── Agents ──

/** GET /api/v1/accounts/:account_id/agents — List agents */
export async function listAgents(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);

  const accountUsers = await prisma.account_users.findMany({
    where: { account_id: accId },
    include: {
      user: {
        select: { id: true, name: true, email: true, pubsub_token: true, availability: true, confirmed_at: true },
      },
    },
  });

  return reply.status(200).send(
    accountUsers.map((au) => ({
      id: au.user?.id ?? 0,
      name: au.user?.name ?? '',
      email: au.user?.email ?? '',
      role: au.role === 0 ? 'administrator' : 'agent',
      availability_status: ['online', 'offline', 'busy'][au.availability] || 'offline',
      auto_offline: au.auto_offline,
      confirmed: !!(au.user?.confirmed_at),
      account_id: accId,
    })),
  );
}

/** POST /api/v1/accounts/:account_id/agents — Create agent */
export async function createAgent(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const body = createAgentSchema.parse(request.body);

  // Find or create user
  await assertBusinessEmailAvailable(body.email);
  let user = await prisma.users.findFirst({ where: { email: body.email } });
  if (isReservedSystemIdentity('', user)) throw new AppError(403, '系统超级用户不能通过业务坐席管理维护');
  if (!user) {
    const tempPassword = crypto.randomBytes(16).toString('hex');
    user = await prisma.users.create({
      data: {
        name: body.name,
        email: body.email,
        encrypted_password: await hashPassword(tempPassword),
        provider: 'email',
        uid: body.email,
      },
    });
  }

  const roleMap = { administrator: 0, agent: 1 };
  const availabilityMap = { online: 0, offline: 1, busy: 2 };

  // Create account_user link
  const accountUser = await prisma.account_users.create({
    data: {
      account_id: accId,
      user_id: user.id,
      role: roleMap[body.role] ?? 1,
      availability: body.availability ? availabilityMap[body.availability] : 1,
      auto_offline: body.auto_offline ?? true,
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });

  return reply.status(200).send({
    id: accountUser.user?.id ?? 0,
    name: accountUser.user?.name ?? '',
    email: accountUser.user?.email ?? '',
    role: body.role,
    account_id: accId,
  });
}

/** PUT /api/v1/accounts/:account_id/agents/:id — Update agent */
export async function updateAgent(request: FastifyRequest, reply: FastifyReply) {
  const { account_id, id } = request.params as { account_id: string; id: string };
  const body = updateAgentSchema.parse(request.body);
  await assertBusinessEmailAvailable(body.email);

  const accId = parseInt(account_id, 10);
  const userId = parseInt(id, 10);
  await assertBusinessManagedUser(userId);

  const accountUser = await prisma.account_users.findFirst({
    where: { account_id: accId, user_id: userId },
  });
  if (!accountUser) throw new NotFoundError('Agent');

  if (body.name || body.email) {
    await prisma.users.update({
      where: { id: userId },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.email && { email: body.email }),
      },
    });
  }

  const roleMap: Record<string, number> = { administrator: 0, agent: 1 };
  const updateData: Record<string, unknown> = {};
  if (body.role) updateData.role = roleMap[body.role] ?? accountUser.role;
  if (body.availability !== undefined) updateData.availability = body.availability;
  if (body.auto_offline !== undefined) updateData.auto_offline = body.auto_offline;

  if (Object.keys(updateData).length > 0) {
    await prisma.account_users.update({
      where: { id: accountUser.id },
      data: updateData as object,
    });
  }

  return reply.status(200).send({ success: true });
}

/** DELETE /api/v1/accounts/:account_id/agents/:id — Remove agent */
export async function destroyAgent(request: FastifyRequest, reply: FastifyReply) {
  const { account_id, id } = request.params as { account_id: string; id: string };
  const accId = parseInt(account_id, 10);
  const userId = parseInt(id, 10);
  await assertBusinessManagedUser(userId);

  await prisma.account_users.deleteMany({
    where: { account_id: accId, user_id: userId },
  });

  return reply.status(200).send({ success: true });
}

/** POST /api/v1/accounts/:account_id/agents/bulk_create */
export async function bulkCreateAgents(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const { agents } = bulkCreateAgentSchema.parse(request.body);

  const results = [];
  for (const agent of agents) {
    await assertBusinessEmailAvailable(agent.email);
    let user = await prisma.users.findFirst({ where: { email: agent.email } });
    if (!user) {
      const tempPassword = crypto.randomBytes(8).toString('hex');
      user = await prisma.users.create({
        data: {
          name: agent.name,
          email: agent.email,
          encrypted_password: await hashPassword(tempPassword),
          provider: 'email',
          uid: agent.email,
        },
      });
    }

    const existing = await prisma.account_users.findFirst({
      where: { account_id: accId, user_id: user.id },
    });
    if (!existing) {
      await prisma.account_users.create({
        data: {
          account_id: accId,
          user_id: user.id,
          role: agent.role === 'administrator' ? 0 : 1,
        },
      });
    }

    results.push({ id: user.id, name: user.name, email: user.email });
  }

  return reply.status(200).send(results);
}

// ── Teams ──

/** GET /api/v1/accounts/:account_id/teams — List teams */
export async function listTeams(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const teams = await prisma.teams.findMany({
    where: { account_id: parseInt(account_id, 10) },
    include: {
      team_members: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });

  return reply.status(200).send(
    teams.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      allow_auto_assign: t.allow_auto_assign,
      account_id: t.account_id,
      members: t.team_members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
      })),
    })),
  );
}

/** POST /api/v1/accounts/:account_id/teams — Create team */
export async function createTeam(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = createTeamSchema.parse(request.body) as CreateTeamInput;

  const team = await prisma.teams.create({
    data: {
      name: body.name,
      description: body.description,
      allow_auto_assign: body.allow_auto_assign,
      account_id: parseInt(account_id, 10),
    },
  });

  return reply.status(200).send({
    id: team.id,
    name: team.name,
    description: team.description,
    allow_auto_assign: team.allow_auto_assign,
    account_id: team.account_id,
  });
}

/** GET /api/v1/accounts/:account_id/teams/:id — Show team */
export async function showTeam(request: FastifyRequest, reply: FastifyReply) {
  const { account_id, id } = request.params as { account_id: string; id: string };
  const team = await prisma.teams.findUnique({
    where: { id: parseInt(id, 10) },
    include: {
      team_members: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });
  if (!team) throw new NotFoundError('Team');

  return reply.status(200).send({
    id: team.id,
    name: team.name,
    description: team.description,
    allow_auto_assign: team.allow_auto_assign,
    account_id: team.account_id,
    members: team.team_members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
    })),
  });
}

/** PUT /api/v1/accounts/:account_id/teams/:id — Update team */
export async function updateTeam(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = updateTeamSchema.parse(request.body) as UpdateTeamInput;

  const team = await prisma.teams.update({
    where: { id: parseInt(id, 10) },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.allow_auto_assign !== undefined && { allow_auto_assign: body.allow_auto_assign }),
    },
  });

  return reply.status(200).send({ id: team.id, name: team.name });
}

/** DELETE /api/v1/accounts/:account_id/teams/:id — Destroy team */
export async function destroyTeam(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.teams.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

// ── Team Members ──

/** GET /api/v1/accounts/:account_id/teams/:team_id/team_members */
export async function listTeamMembers(request: FastifyRequest, reply: FastifyReply) {
  const { team_id } = request.params as { team_id: string };
  const members = await prisma.team_members.findMany({
    where: { team_id: parseInt(team_id, 10) },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  return reply.status(200).send(members.map((m) => ({
    id: m.user.id,
    name: m.user.name,
    email: m.user.email,
  })));
}

/** POST /api/v1/accounts/:account_id/teams/:team_id/team_members */
export async function addTeamMembers(request: FastifyRequest, reply: FastifyReply) {
  const { team_id } = request.params as { team_id: string };
  const { user_ids } = teamMemberSchema.parse(request.body);

  const tid = parseInt(team_id, 10);
  for (const uid of user_ids) {
    const exists = await prisma.team_members.findFirst({
      where: { team_id: tid, user_id: uid },
    });
    if (!exists) {
      await prisma.team_members.create({ data: { team_id: tid, user_id: uid } });
    }
  }

  return reply.status(200).send({ success: true });
}

/** PATCH /api/v1/accounts/:account_id/teams/:team_id/team_members — Replace members */
export async function updateTeamMembers(request: FastifyRequest, reply: FastifyReply) {
  const { team_id } = request.params as { team_id: string };
  const { user_ids } = updateTeamMemberSchema.parse(request.body);

  const tid = parseInt(team_id, 10);

  // Remove existing members
  await prisma.team_members.deleteMany({ where: { team_id: tid } });

  // Add new members
  for (const uid of user_ids) {
    await prisma.team_members.create({ data: { team_id: tid, user_id: uid } });
  }

  return reply.status(200).send({ success: true });
}

/** DELETE /api/v1/accounts/:account_id/teams/:team_id/team_members */
export async function removeTeamMembers(request: FastifyRequest, reply: FastifyReply) {
  const { team_id } = request.params as { team_id: string };
  const { user_ids } = request.body as { user_ids?: number[] };

  const tid = parseInt(team_id, 10);
  if (user_ids && user_ids.length > 0) {
    await prisma.team_members.deleteMany({
      where: { team_id: tid, user_id: { in: user_ids } },
    });
  }

  return reply.status(200).send({ success: true });
}

// ── Agent Bots ──

/** GET /api/v1/accounts/:account_id/agent_bots */
export async function listAgentBots(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const bots = await prisma.agent_bots.findMany({
    where: { account_id: parseInt(account_id, 10) },
  });

  return reply.status(200).send(bots.map((b) => ({
    id: b.id, name: b.name, description: b.description,
    outgoing_url: b.outgoing_url, bot_type: b.bot_type, bot_config: b.bot_config,
    account_id: b.account_id,
  })));
}

/** POST /api/v1/accounts/:account_id/agent_bots */
export async function createAgentBot(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = createAgentBotSchema.parse(request.body) as CreateAgentBotInput;

  const bot = await prisma.agent_bots.create({
    data: {
      name: body.name,
      description: body.description,
      outgoing_url: body.outgoing_url,
      bot_type: body.bot_type,
      bot_config: body.bot_config as object,
      account_id: parseInt(account_id, 10),
    },
  });

  return reply.status(200).send({
    id: bot.id, name: bot.name, description: bot.description,
    outgoing_url: bot.outgoing_url, bot_type: bot.bot_type,
  });
}

/** GET /api/v1/accounts/:account_id/agent_bots/:id */
export async function showAgentBot(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const bot = await prisma.agent_bots.findUnique({ where: { id: parseInt(id, 10) } });
  if (!bot) throw new NotFoundError('AgentBot');

  return reply.status(200).send({
    id: bot.id, name: bot.name, description: bot.description,
    outgoing_url: bot.outgoing_url, bot_type: bot.bot_type, bot_config: bot.bot_config,
  });
}

/** PUT /api/v1/accounts/:account_id/agent_bots/:id */
export async function updateAgentBot(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = updateAgentBotSchema.parse(request.body);

  const bot = await prisma.agent_bots.update({
    where: { id: parseInt(id, 10) },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.outgoing_url !== undefined && { outgoing_url: body.outgoing_url }),
      ...(body.bot_type !== undefined && { bot_type: body.bot_type }),
      ...(body.bot_config !== undefined && { bot_config: body.bot_config as object }),
    },
  });

  return reply.status(200).send({ id: bot.id, name: bot.name });
}

/** DELETE /api/v1/accounts/:account_id/agent_bots/:id */
export async function destroyAgentBot(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.agent_bots.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

/** DELETE /api/v1/accounts/:account_id/agent_bots/:id/avatar */
export async function deleteAgentBotAvatar(_request: FastifyRequest, reply: FastifyReply) {
  return reply.status(200).send({ success: true });
}

/** POST /api/v1/accounts/:account_id/agent_bots/:id/reset_access_token */
export async function resetAgentBotToken(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const token = crypto.randomBytes(16).toString('hex');
  // Agent bots use outgoing_url, no token field — just acknowledge
  return reply.status(200).send({ token });
}

// ── Custom Roles ──

/** GET /api/v1/accounts/:account_id/custom_roles */
export async function listCustomRoles(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const roles = await prisma.custom_roles.findMany({
    where: { account_id: parseInt(account_id, 10) },
  });
  return reply.status(200).send(roles);
}

/** POST /api/v1/accounts/:account_id/custom_roles */
export async function createCustomRole(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = createCustomRoleSchema.parse(request.body);

  const role = await prisma.custom_roles.create({
    data: {
      name: body.name,
      description: body.description,
      permissions: body.permissions,
      account_id: parseInt(account_id, 10),
    },
  });

  return reply.status(200).send(role);
}

/** GET /api/v1/accounts/:account_id/custom_roles/:id */
export async function showCustomRole(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const role = await prisma.custom_roles.findUnique({ where: { id: parseInt(id, 10) } });
  if (!role) throw new NotFoundError('CustomRole');
  return reply.status(200).send(role);
}

/** PUT /api/v1/accounts/:account_id/custom_roles/:id */
export async function updateCustomRole(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = updateCustomRoleSchema.parse(request.body);

  const role = await prisma.custom_roles.update({
    where: { id: parseInt(id, 10) },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.permissions !== undefined && { permissions: body.permissions }),
    },
  });

  return reply.status(200).send(role);
}

/** DELETE /api/v1/accounts/:account_id/custom_roles/:id */
export async function destroyCustomRole(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.custom_roles.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

// ── Agent Capacity Policies ──

/** GET /api/v1/accounts/:account_id/agent_capacity_policies */
export async function listCapacityPolicies(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const policies = await prisma.agent_capacity_policies.findMany({
    where: { account_id: parseInt(account_id, 10) },
  });
  return reply.status(200).send(policies);
}

/** POST /api/v1/accounts/:account_id/agent_capacity_policies */
export async function createCapacityPolicy(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = createCapacityPolicySchema.parse(request.body);

  const policy = await prisma.agent_capacity_policies.create({
    data: {
      name: body.name,
      description: body.description,
      exclusion_rules: body.exclusion_rules as object,
      account_id: parseInt(account_id, 10),
    },
  });

  return reply.status(200).send(policy);
}

/** GET /api/v1/accounts/:account_id/agent_capacity_policies/:id */
export async function showCapacityPolicy(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const policy = await prisma.agent_capacity_policies.findUnique({ where: { id: parseInt(id, 10) } });
  if (!policy) throw new NotFoundError('CapacityPolicy');
  return reply.status(200).send(policy);
}

/** PUT /api/v1/accounts/:account_id/agent_capacity_policies/:id */
export async function updateCapacityPolicy(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = updateCapacityPolicySchema.parse(request.body);

  const policy = await prisma.agent_capacity_policies.update({
    where: { id: parseInt(id, 10) },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.exclusion_rules !== undefined && { exclusion_rules: body.exclusion_rules as object }),
    },
  });

  return reply.status(200).send(policy);
}

/** DELETE /api/v1/accounts/:account_id/agent_capacity_policies/:id */
export async function destroyCapacityPolicy(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.agent_capacity_policies.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

// ── Capacity Policy Users ──

/** GET /api/v1/accounts/:account_id/agent_capacity_policies/:policy_id/users */
export async function listCapacityPolicyUsers(request: FastifyRequest, reply: FastifyReply) {
  const { policy_id } = request.params as { policy_id: string };
  const users = await prisma.account_users.findMany({
    where: { agent_capacity_policy_id: parseInt(policy_id, 10) },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  return reply.status(200).send(users.map((au) => ({ id: au.user?.id ?? 0, name: au.user?.name ?? '', email: au.user?.email ?? '' })));
}

/** POST /api/v1/accounts/:account_id/agent_capacity_policies/:policy_id/users */
export async function addCapacityPolicyUser(request: FastifyRequest, reply: FastifyReply) {
  const { policy_id } = request.params as { policy_id: string };
  const { user_id } = request.body as { user_id: number };

  await prisma.account_users.updateMany({
    where: { user_id },
    data: { agent_capacity_policy_id: parseInt(policy_id, 10) },
  });

  return reply.status(200).send({ success: true });
}

/** DELETE /api/v1/accounts/:account_id/agent_capacity_policies/:policy_id/users */
export async function removeCapacityPolicyUser(request: FastifyRequest, reply: FastifyReply) {
  const { policy_id } = request.params as { policy_id: string };
  const { user_id } = request.body as { user_id: number };

  await prisma.account_users.updateMany({
    where: { user_id, agent_capacity_policy_id: parseInt(policy_id, 10) },
    data: { agent_capacity_policy_id: null },
  });

  return reply.status(200).send({ success: true });
}

// ── Capacity Policy Inbox Limits ──

/** POST /api/v1/accounts/:account_id/agent_capacity_policies/:policy_id/inbox_limits */
export async function createInboxLimit(request: FastifyRequest, reply: FastifyReply) {
  const { policy_id } = request.params as { policy_id: string };
  const body = createInboxLimitSchema.parse(request.body);

  const limit = await prisma.inbox_capacity_limits.create({
    data: {
      agent_capacity_policy_id: parseInt(policy_id, 10),
      inbox_id: body.inbox_id,
      conversation_limit: body.conversation_limit,
    },
  });

  return reply.status(200).send(limit);
}

/** PUT /api/v1/accounts/:account_id/agent_capacity_policies/:policy_id/inbox_limits/:id */
export async function updateInboxLimit(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = updateInboxLimitSchema.parse(request.body);

  const limit = await prisma.inbox_capacity_limits.update({
    where: { id: parseInt(id, 10) },
    data: { conversation_limit: body.conversation_limit },
  });

  return reply.status(200).send(limit);
}

/** DELETE /api/v1/accounts/:account_id/agent_capacity_policies/:policy_id/inbox_limits/:id */
export async function destroyInboxLimit(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.inbox_capacity_limits.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}
