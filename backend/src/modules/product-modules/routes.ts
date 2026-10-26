import type { FastifyInstance } from 'fastify';
import { productModules } from './authority.js';
export async function productModuleRoutes(app: FastifyInstance) {
  app.get(
    '/api/product-modules',
    { preHandler: [app.authenticate] },
    async (_req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { connections: _connections, ...snapshot } =
        await productModules().snapshot();
      return { data: snapshot };
    },
  );
}
