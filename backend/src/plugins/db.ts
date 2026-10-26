import { PrismaClient } from '@prisma/client';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { withAccessScope } from '../modules/access/access.prisma.js';

export const prisma = withAccessScope(new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
}));

async function dbPlugin(fastify: FastifyInstance) {
  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
}

export default fp(dbPlugin, { name: 'db' });
