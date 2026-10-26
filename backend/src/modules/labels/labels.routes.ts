import type { FastifyInstance } from 'fastify';
import {
  listLabels, showLabel, createLabel, updateLabel, destroyLabel,
} from './labels.controller.js';

/**
 * Labels CRUD — standalone label management.
 * Chatwoot equivalent: app/controllers/api/v1/accounts/labels_controller.rb
 */
export async function labelsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.get('/api/v1/accounts/:account_id/labels', auth, listLabels);
  fastify.post('/api/v1/accounts/:account_id/labels', auth, createLabel);
  fastify.get('/api/v1/accounts/:account_id/labels/:id', auth, showLabel);
  fastify.put('/api/v1/accounts/:account_id/labels/:id', auth, updateLabel);
  fastify.delete('/api/v1/accounts/:account_id/labels/:id', auth, destroyLabel);
}
