import type { FastifyInstance } from 'fastify';
import {
  listCannedResponses, createCannedResponse, updateCannedResponse, destroyCannedResponse,
  listAutomationRules, createAutomationRule, showAutomationRule, updateAutomationRule,
  destroyAutomationRule, cloneAutomationRule,
  listMacros, createMacro, showMacro, updateMacro, destroyMacro, executeMacro,
  listCustomFilters, createCustomFilter, showCustomFilter, updateCustomFilter, destroyCustomFilter,
  listCsatResponses, createCsatTemplate, showCsatTemplate,
  listSlaPolicies, createSlaPolicy, showSlaPolicy, updateSlaPolicy, destroySlaPolicy,
  listAppliedSlas, appliedSlasMetrics, appliedSlasDownload,
  listAssignmentPolicies, createAssignmentPolicy, showAssignmentPolicy,
  updateAssignmentPolicy, destroyAssignmentPolicy,
} from './efficiency.controller.js';

export async function efficiencyRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };
  const base = '/api/v1/accounts/:account_id';

  // Canned Responses
  fastify.get(`${base}/canned_responses`, auth, listCannedResponses);
  fastify.post(`${base}/canned_responses`, auth, createCannedResponse);
  fastify.put(`${base}/canned_responses/:id`, auth, updateCannedResponse);
  fastify.delete(`${base}/canned_responses/:id`, auth, destroyCannedResponse);

  // Automation Rules
  fastify.get(`${base}/automation_rules`, auth, listAutomationRules);
  fastify.post(`${base}/automation_rules`, auth, createAutomationRule);
  fastify.get(`${base}/automation_rules/:id`, auth, showAutomationRule);
  fastify.put(`${base}/automation_rules/:id`, auth, updateAutomationRule);
  fastify.delete(`${base}/automation_rules/:id`, auth, destroyAutomationRule);
  fastify.get(`${base}/automation_rules/:id/clone`, auth, cloneAutomationRule);

  // Macros
  fastify.get(`${base}/macros`, auth, listMacros);
  fastify.post(`${base}/macros`, auth, createMacro);
  fastify.get(`${base}/macros/:id`, auth, showMacro);
  fastify.put(`${base}/macros/:id`, auth, updateMacro);
  fastify.delete(`${base}/macros/:id`, auth, destroyMacro);
  fastify.post(`${base}/macros/:id/execute`, auth, executeMacro);

  // Custom Filters
  fastify.get(`${base}/custom_filters`, auth, listCustomFilters);
  fastify.post(`${base}/custom_filters`, auth, createCustomFilter);
  fastify.get(`${base}/custom_filters/:id`, auth, showCustomFilter);
  fastify.put(`${base}/custom_filters/:id`, auth, updateCustomFilter);
  fastify.delete(`${base}/custom_filters/:id`, auth, destroyCustomFilter);

  // CSAT
  fastify.get(`${base}/csat_survey_responses`, auth, listCsatResponses);
  fastify.post(`${base}/inboxes/:id/csat_template`, auth, createCsatTemplate);
  fastify.get(`${base}/inboxes/:id/csat_template`, auth, showCsatTemplate);
  fastify.post(`${base}/inboxes/:id/csat_template/analyze`, auth, async (_req, reply) => {
    return reply.status(200).send({ analysis: {} });
  });

  // SLA Policies
  fastify.get(`${base}/sla_policies`, auth, listSlaPolicies);
  fastify.post(`${base}/sla_policies`, auth, createSlaPolicy);
  fastify.get(`${base}/sla_policies/:id`, auth, showSlaPolicy);
  fastify.put(`${base}/sla_policies/:id`, auth, updateSlaPolicy);
  fastify.delete(`${base}/sla_policies/:id`, auth, destroySlaPolicy);

  // Applied SLAs
  fastify.get(`${base}/applied_slas`, auth, listAppliedSlas);
  fastify.get(`${base}/applied_slas/metrics`, auth, appliedSlasMetrics);
  fastify.get(`${base}/applied_slas/download`, auth, appliedSlasDownload);

  // Assignment Policies V2
  fastify.get(`${base}/assignment_policies`, auth, listAssignmentPolicies);
  fastify.post(`${base}/assignment_policies`, auth, createAssignmentPolicy);
  fastify.get(`${base}/assignment_policies/:id`, auth, showAssignmentPolicy);
  fastify.put(`${base}/assignment_policies/:id`, auth, updateAssignmentPolicy);
  fastify.delete(`${base}/assignment_policies/:id`, auth, destroyAssignmentPolicy);
}
