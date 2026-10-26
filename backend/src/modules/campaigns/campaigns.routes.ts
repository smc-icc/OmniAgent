import type { FastifyInstance } from 'fastify';
import {
  listCampaigns, showCampaign, createCampaign, updateCampaign, destroyCampaign,
} from './campaigns.controller.js';

/**
 * Campaigns CRUD — one-off and ongoing marketing campaigns.
 * Chatwoot equivalent: app/controllers/api/v1/accounts/campaigns_controller.rb
 */
export async function campaignsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.get('/api/v1/accounts/:account_id/campaigns', auth, listCampaigns);
  fastify.post('/api/v1/accounts/:account_id/campaigns', auth, createCampaign);
  fastify.get('/api/v1/accounts/:account_id/campaigns/:id', auth, showCampaign);
  fastify.put('/api/v1/accounts/:account_id/campaigns/:id', auth, updateCampaign);
  fastify.delete('/api/v1/accounts/:account_id/campaigns/:id', auth, destroyCampaign);
}
