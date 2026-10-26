import type { FastifyInstance } from 'fastify';
import {
  getWorkingHours, updateWorkingHours,
} from './workinghours.controller.js';

/**
 * Working Hours API — configure per-inbox operating hours.
 * Chatwoot equivalent: app/controllers/api/v1/accounts/working_hours_controller.rb
 *
 * Note: Chatwoot only has update (singular). We add GET for convenience.
 */
export async function workingHoursRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.get('/api/v1/accounts/:account_id/inboxes/:inbox_id/working_hours', auth, getWorkingHours);
  fastify.put('/api/v1/accounts/:account_id/inboxes/:inbox_id/working_hours', auth, updateWorkingHours);
}
