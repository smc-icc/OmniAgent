import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../plugins/db.js';
import {
  cannedResponseSchema, automationRuleSchema, macroSchema, macroExecuteSchema,
  customFilterSchema, csatTemplateSchema, slaPolicySchema, assignmentPolicySchema,
  type CannedResponseInput, type AutomationRuleInput, type MacroInput,
  type CustomFilterInput, type SlaPolicyInput, type AssignmentPolicyInput,
} from '../../shared/validators/efficiency.js';
import { NotFoundError } from '../../shared/errors/index.js';

const auth = { preHandler: [] as Array<(req: FastifyRequest) => Promise<void>> };

// ═══ Canned Responses ═══

export async function listCannedResponses(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const items = await prisma.canned_responses.findMany({
    where: { account_id: parseInt(account_id, 10) },
  });
  return reply.status(200).send(items);
}

export async function createCannedResponse(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = cannedResponseSchema.parse(request.body) as CannedResponseInput;
  const item = await prisma.canned_responses.create({
    data: { account_id: parseInt(account_id, 10), short_code: body.short_code, content: body.content },
  });
  return reply.status(200).send(item);
}

export async function updateCannedResponse(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = cannedResponseSchema.parse(request.body);
  const item = await prisma.canned_responses.update({
    where: { id: parseInt(id, 10) },
    data: { short_code: body.short_code, content: body.content },
  });
  return reply.status(200).send(item);
}

export async function destroyCannedResponse(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.canned_responses.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

// ═══ Automation Rules ═══

export async function listAutomationRules(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const items = await prisma.automation_rules.findMany({
    where: { account_id: parseInt(account_id, 10) },
  });
  return reply.status(200).send(items);
}

export async function createAutomationRule(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = automationRuleSchema.parse(request.body) as AutomationRuleInput;
  const item = await prisma.automation_rules.create({
    data: {
      account_id: parseInt(account_id, 10), name: body.name, description: body.description,
      event_name: body.event_name, conditions: body.conditions as object,
      actions: body.actions as object, active: body.active,
    },
  });
  return reply.status(200).send(item);
}

export async function showAutomationRule(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const item = await prisma.automation_rules.findUnique({ where: { id: parseInt(id, 10) } });
  if (!item) throw new NotFoundError('AutomationRule');
  return reply.status(200).send(item);
}

export async function updateAutomationRule(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = automationRuleSchema.parse(request.body);
  const item = await prisma.automation_rules.update({
    where: { id: parseInt(id, 10) },
    data: {
      name: body.name, description: body.description, event_name: body.event_name,
      conditions: body.conditions as object, actions: body.actions as object, active: body.active,
    },
  });
  return reply.status(200).send(item);
}

export async function destroyAutomationRule(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.automation_rules.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

export async function cloneAutomationRule(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const original = await prisma.automation_rules.findUnique({ where: { id: parseInt(id, 10) } });
  if (!original) throw new NotFoundError('AutomationRule');

  const clone = await prisma.automation_rules.create({
    data: {
      account_id: original.account_id, name: `${original.name} (copy)`,
      description: original.description, event_name: original.event_name,
      conditions: original.conditions as object, actions: original.actions as object,
      active: false,
    },
  });
  return reply.status(200).send(clone);
}

// ═══ Macros ═══

export async function listMacros(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const items = await prisma.macros.findMany({
    where: { account_id: parseInt(account_id, 10) },
  });
  return reply.status(200).send(items);
}

export async function createMacro(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = macroSchema.parse(request.body) as MacroInput;
  const user = request.currentUser;
  const item = await prisma.macros.create({
    data: {
      account_id: parseInt(account_id, 10), name: body.name,
      visibility: body.visibility, actions: body.actions as object,
      created_by_id: user?.id, updated_by_id: user?.id,
    },
  });
  return reply.status(200).send(item);
}

export async function showMacro(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const item = await prisma.macros.findUnique({ where: { id: parseInt(id, 10) } });
  if (!item) throw new NotFoundError('Macro');
  return reply.status(200).send(item);
}

export async function updateMacro(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = macroSchema.parse(request.body);
  const item = await prisma.macros.update({
    where: { id: parseInt(id, 10) },
    data: { name: body.name, visibility: body.visibility, actions: body.actions as object },
  });
  return reply.status(200).send(item);
}

export async function destroyMacro(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.macros.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

export async function executeMacro(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = macroExecuteSchema.parse(request.body);
  const ids = body.conversation_ids ?? [];
  return reply.status(200).send({ success: true, executed_on: ids.length, conversation_ids: ids });
}

// ═══ Custom Filters ═══

export async function listCustomFilters(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const items = await prisma.custom_filters.findMany({
    where: { account_id: parseInt(account_id, 10) },
  });
  return reply.status(200).send(items);
}

export async function createCustomFilter(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = customFilterSchema.parse(request.body) as CustomFilterInput;
  const user = request.currentUser;
  const item = await prisma.custom_filters.create({
    data: {
      account_id: parseInt(account_id, 10), user_id: user?.id ?? 1,
      name: body.name, filter_type: body.filter_type, query: body.query as object,
    },
  });
  return reply.status(200).send(item);
}

export async function showCustomFilter(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const item = await prisma.custom_filters.findUnique({ where: { id: parseInt(id, 10) } });
  if (!item) throw new NotFoundError('CustomFilter');
  return reply.status(200).send(item);
}

export async function updateCustomFilter(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = customFilterSchema.parse(request.body);
  const item = await prisma.custom_filters.update({
    where: { id: parseInt(id, 10) },
    data: { name: body.name, filter_type: body.filter_type, query: body.query as object },
  });
  return reply.status(200).send(item);
}

export async function destroyCustomFilter(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.custom_filters.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

// ═══ CSAT ═══

/** GET /api/v1/accounts/:account_id/csat_survey_responses */
export async function listCsatResponses(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const responses = await prisma.csat_survey_responses.findMany({
    where: { account_id: parseInt(account_id, 10) },
    include: {
      contact: { select: { id: true, name: true } },
      assigned_agent: { select: { id: true, name: true } },
    },
    orderBy: { created_at: 'desc' },
    take: 100,
  });
  return reply.status(200).send(responses);
}

/** POST /api/v1/accounts/:account_id/inboxes/:id/csat_template */
export async function createCsatTemplate(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = csatTemplateSchema.parse(request.body);
  await prisma.inboxes.update({
    where: { id: parseInt(id, 10) },
    data: { csat_config: { questions: body.questions } as object, csat_survey_enabled: true },
  });
  return reply.status(200).send({ success: true });
}

/** GET /api/v1/accounts/:account_id/inboxes/:id/csat_template */
export async function showCsatTemplate(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const inbox = await prisma.inboxes.findUnique({
    where: { id: parseInt(id, 10) },
    select: { csat_config: true, csat_survey_enabled: true },
  });
  return reply.status(200).send(inbox?.csat_config ?? {});
}

// ═══ SLA Policies ═══

export async function listSlaPolicies(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const items = await prisma.sla_policies.findMany({
    where: { account_id: parseInt(account_id, 10) },
  });
  return reply.status(200).send(items);
}

export async function createSlaPolicy(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = slaPolicySchema.parse(request.body) as SlaPolicyInput;
  const item = await prisma.sla_policies.create({
    data: {
      account_id: parseInt(account_id, 10), name: body.name, description: body.description,
      first_response_time_threshold: body.first_response_time_threshold,
      next_response_time_threshold: body.next_response_time_threshold,
      resolution_time_threshold: body.resolution_time_threshold,
      only_during_business_hours: body.only_during_business_hours,
    },
  });
  return reply.status(200).send(item);
}

export async function showSlaPolicy(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const item = await prisma.sla_policies.findUnique({ where: { id: parseInt(id, 10) } });
  if (!item) throw new NotFoundError('SlaPolicy');
  return reply.status(200).send(item);
}

export async function updateSlaPolicy(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = slaPolicySchema.parse(request.body);
  const item = await prisma.sla_policies.update({
    where: { id: parseInt(id, 10) },
    data: {
      name: body.name, description: body.description,
      first_response_time_threshold: body.first_response_time_threshold,
      next_response_time_threshold: body.next_response_time_threshold,
      resolution_time_threshold: body.resolution_time_threshold,
      only_during_business_hours: body.only_during_business_hours,
    },
  });
  return reply.status(200).send(item);
}

export async function destroySlaPolicy(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.sla_policies.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

/** GET /api/v1/accounts/:account_id/applied_slas */
export async function listAppliedSlas(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const items = await prisma.applied_slas.findMany({
    where: { account_id: parseInt(account_id, 10) },
    include: { conversation: { select: { id: true, display_id: true } } },
    take: 100,
  });
  return reply.status(200).send(items);
}

/** GET /api/v1/accounts/:account_id/applied_slas/metrics */
export async function appliedSlasMetrics(_request: FastifyRequest, reply: FastifyReply) {
  return reply.status(200).send({ metrics: [] });
}

/** GET /api/v1/accounts/:account_id/applied_slas/download */
export async function appliedSlasDownload(_request: FastifyRequest, reply: FastifyReply) {
  return reply.status(200).send({ download_url: '' });
}

// ═══ Assignment Policies V2 ═══

export async function listAssignmentPolicies(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const items = await prisma.assignment_policies.findMany({
    where: { account_id: parseInt(account_id, 10) },
  });
  return reply.status(200).send(items);
}

export async function createAssignmentPolicy(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = assignmentPolicySchema.parse(request.body) as AssignmentPolicyInput;
  const item = await prisma.assignment_policies.create({
    data: {
      account_id: parseInt(account_id, 10), name: body.name, description: body.description,
      assignment_order: body.assignment_order, conversation_priority: body.conversation_priority,
      fair_distribution_limit: body.fair_distribution_limit,
      fair_distribution_window: body.fair_distribution_window, enabled: body.enabled,
    },
  });
  return reply.status(200).send(item);
}

export async function showAssignmentPolicy(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const item = await prisma.assignment_policies.findUnique({ where: { id: parseInt(id, 10) } });
  if (!item) throw new NotFoundError('AssignmentPolicy');
  return reply.status(200).send(item);
}

export async function updateAssignmentPolicy(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = assignmentPolicySchema.parse(request.body);
  const item = await prisma.assignment_policies.update({
    where: { id: parseInt(id, 10) },
    data: {
      name: body.name, description: body.description, assignment_order: body.assignment_order,
      conversation_priority: body.conversation_priority, fair_distribution_limit: body.fair_distribution_limit,
      fair_distribution_window: body.fair_distribution_window, enabled: body.enabled,
    },
  });
  return reply.status(200).send(item);
}

export async function destroyAssignmentPolicy(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.assignment_policies.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}
