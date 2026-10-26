import type { FastifyInstance } from 'fastify';
import {
  createAccount, showAccount, updateAccount, updateActiveAt, cacheKeys,
  listAgents, createAgent, updateAgent, destroyAgent, bulkCreateAgents,
  listTeams, createTeam, showTeam, updateTeam, destroyTeam,
  listTeamMembers, addTeamMembers, updateTeamMembers, removeTeamMembers,
  listAgentBots, createAgentBot, showAgentBot, updateAgentBot,
  destroyAgentBot, deleteAgentBotAvatar, resetAgentBotToken,
  listCustomRoles, createCustomRole, showCustomRole, updateCustomRole, destroyCustomRole,
  listCapacityPolicies, createCapacityPolicy, showCapacityPolicy, updateCapacityPolicy, destroyCapacityPolicy,
  listCapacityPolicyUsers, addCapacityPolicyUser, removeCapacityPolicyUser,
  createInboxLimit, updateInboxLimit, destroyInboxLimit,
} from './accounts.controller.js';

export async function accountsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  // ── Accounts ──
  fastify.post('/api/v1/accounts', auth, createAccount);
  fastify.get('/api/v1/accounts/:id', auth, showAccount);
  fastify.put('/api/v1/accounts/:id', auth, updateAccount);
  fastify.post('/api/v1/accounts/:id/update_active_at', auth, updateActiveAt);
  fastify.get('/api/v1/accounts/:id/cache_keys', auth, cacheKeys);

  // ── Agents ──
  fastify.get('/api/v1/accounts/:account_id/agents', auth, listAgents);
  fastify.post('/api/v1/accounts/:account_id/agents', auth, createAgent);
  fastify.put('/api/v1/accounts/:account_id/agents/:id', auth, updateAgent);
  fastify.delete('/api/v1/accounts/:account_id/agents/:id', auth, destroyAgent);
  fastify.post('/api/v1/accounts/:account_id/agents/bulk_create', auth, bulkCreateAgents);

  // ── Teams ──
  fastify.get('/api/v1/accounts/:account_id/teams', auth, listTeams);
  fastify.post('/api/v1/accounts/:account_id/teams', auth, createTeam);
  fastify.get('/api/v1/accounts/:account_id/teams/:id', auth, showTeam);
  fastify.put('/api/v1/accounts/:account_id/teams/:id', auth, updateTeam);
  fastify.delete('/api/v1/accounts/:account_id/teams/:id', auth, destroyTeam);

  // Team Members
  fastify.get('/api/v1/accounts/:account_id/teams/:team_id/team_members', auth, listTeamMembers);
  fastify.post('/api/v1/accounts/:account_id/teams/:team_id/team_members', auth, addTeamMembers);
  fastify.patch('/api/v1/accounts/:account_id/teams/:team_id/team_members', auth, updateTeamMembers);
  fastify.delete('/api/v1/accounts/:account_id/teams/:team_id/team_members', auth, removeTeamMembers);

  // ── Agent Bots ──
  fastify.get('/api/v1/accounts/:account_id/agent_bots', auth, listAgentBots);
  fastify.post('/api/v1/accounts/:account_id/agent_bots', auth, createAgentBot);
  fastify.get('/api/v1/accounts/:account_id/agent_bots/:id', auth, showAgentBot);
  fastify.put('/api/v1/accounts/:account_id/agent_bots/:id', auth, updateAgentBot);
  fastify.delete('/api/v1/accounts/:account_id/agent_bots/:id', auth, destroyAgentBot);
  fastify.delete('/api/v1/accounts/:account_id/agent_bots/:id/avatar', auth, deleteAgentBotAvatar);
  fastify.post('/api/v1/accounts/:account_id/agent_bots/:id/reset_access_token', auth, resetAgentBotToken);

  // ── Custom Roles ──
  fastify.get('/api/v1/accounts/:account_id/custom_roles', auth, listCustomRoles);
  fastify.post('/api/v1/accounts/:account_id/custom_roles', auth, createCustomRole);
  fastify.get('/api/v1/accounts/:account_id/custom_roles/:id', auth, showCustomRole);
  fastify.put('/api/v1/accounts/:account_id/custom_roles/:id', auth, updateCustomRole);
  fastify.delete('/api/v1/accounts/:account_id/custom_roles/:id', auth, destroyCustomRole);

  // ── Agent Capacity Policies ──
  fastify.get('/api/v1/accounts/:account_id/agent_capacity_policies', auth, listCapacityPolicies);
  fastify.post('/api/v1/accounts/:account_id/agent_capacity_policies', auth, createCapacityPolicy);
  fastify.get('/api/v1/accounts/:account_id/agent_capacity_policies/:id', auth, showCapacityPolicy);
  fastify.put('/api/v1/accounts/:account_id/agent_capacity_policies/:id', auth, updateCapacityPolicy);
  fastify.delete('/api/v1/accounts/:account_id/agent_capacity_policies/:id', auth, destroyCapacityPolicy);

  // Capacity Policy → Users
  fastify.get('/api/v1/accounts/:account_id/agent_capacity_policies/:policy_id/users', auth, listCapacityPolicyUsers);
  fastify.post('/api/v1/accounts/:account_id/agent_capacity_policies/:policy_id/users', auth, addCapacityPolicyUser);
  fastify.delete('/api/v1/accounts/:account_id/agent_capacity_policies/:policy_id/users', auth, removeCapacityPolicyUser);

  // Capacity Policy → Inbox Limits
  fastify.post('/api/v1/accounts/:account_id/agent_capacity_policies/:policy_id/inbox_limits', auth, createInboxLimit);
  fastify.put('/api/v1/accounts/:account_id/agent_capacity_policies/:policy_id/inbox_limits/:id', auth, updateInboxLimit);
  fastify.delete('/api/v1/accounts/:account_id/agent_capacity_policies/:policy_id/inbox_limits/:id', auth, destroyInboxLimit);
}
