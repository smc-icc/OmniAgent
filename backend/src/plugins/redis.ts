import Redis from 'ioredis';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // required for BullMQ
  enableReadyCheck: false,
  lazyConnect: true,
});

async function redisPlugin(fastify: FastifyInstance) {
  await redis.connect();

  fastify.decorate('redis', redis);

  fastify.addHook('onClose', async () => {
    await redis.quit();
  });
}

export default fp(redisPlugin, { name: 'redis' });
