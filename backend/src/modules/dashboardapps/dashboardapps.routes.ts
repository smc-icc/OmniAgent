import type { FastifyInstance } from 'fastify';
import {
  listDashboardApps, showDashboardApp, createDashboardApp,
  updateDashboardApp, destroyDashboardApp,
} from './dashboardapps.controller.js';

/**
 * Dashboard Apps CRUD — customizable iframe apps in the agent dashboard.
 * Chatwoot equivalent: app/controllers/api/v1/accounts/dashboard_apps_controller.rb
 */
export async function dashboardAppsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.get('/api/v1/accounts/:account_id/dashboard_apps', auth, listDashboardApps);
  fastify.post('/api/v1/accounts/:account_id/dashboard_apps', auth, createDashboardApp);
  fastify.get('/api/v1/accounts/:account_id/dashboard_apps/:id', auth, showDashboardApp);
  fastify.put('/api/v1/accounts/:account_id/dashboard_apps/:id', auth, updateDashboardApp);
  fastify.delete('/api/v1/accounts/:account_id/dashboard_apps/:id', auth, destroyDashboardApp);
}
