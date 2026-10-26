import { Queue, Worker } from 'bullmq';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { emailProcessor } from '../processors/email.processor.js';
import { webhookProcessor } from '../processors/webhook.processor.js';
import { notificationProcessor } from '../processors/notification.processor.js';
import { reportProcessor } from '../processors/report.processor.js';
import { importProcessor } from '../processors/import.processor.js';
import { conversationProcessor } from '../processors/conversation.processor.js';
import { authorizedJob } from '../modules/access/access.jobs.js';
import { accessScope } from '../modules/access/access.scope.js';

/**
 * BullMQ queues — mirrors Chatwoot Sidekiq jobs.
 *
 * Uses raw connection options (not the Redis instance directly) to avoid
 * ioredis version mismatch between bullmq's transitive dep and ours.
 */
export const Queues = {
  EMAIL: 'email',
  WEBHOOK: 'webhook',
  REPORT: 'report',
  IMPORT: 'import',
  NOTIFICATION: 'notification',
  CONVERSATION: 'conversation',
} as const;

const REDIS_HOST = process.env.REDIS_URL
  ? new URL(process.env.REDIS_URL).hostname
  : '127.0.0.1';
const REDIS_PORT = process.env.REDIS_URL
  ? parseInt(new URL(process.env.REDIS_URL).port, 10) || 6379
  : 6379;

const connection = {
  connection: {
    host: REDIS_HOST,
    port: REDIS_PORT,
    maxRetriesPerRequest: null,
  },
};

declare module 'fastify' {
  interface FastifyInstance {
    queues: Record<string, Queue>;
    enqueue: (queueName: string, jobName: string, data: unknown, opts?: { delay?: number }) => Promise<void>;
  }
}

async function bullmqPlugin(fastify: FastifyInstance) {
  const conn = connection;

  // Create all queues
  const queues: Record<string, Queue> = {
    [Queues.EMAIL]: new Queue(Queues.EMAIL, conn),
    [Queues.WEBHOOK]: new Queue(Queues.WEBHOOK, conn),
    [Queues.REPORT]: new Queue(Queues.REPORT, conn),
    [Queues.IMPORT]: new Queue(Queues.IMPORT, conn),
    [Queues.NOTIFICATION]: new Queue(Queues.NOTIFICATION, conn),
    [Queues.CONVERSATION]: new Queue(Queues.CONVERSATION, conn),
  };

  // Create workers with real processors — each worker processes one job at a time
  // with concurrency 5 for webhooks (I/O bound) and 2 for others
  const workers = [
    new Worker(Queues.EMAIL, authorizedJob(emailProcessor), { ...conn, concurrency: 2 }),
    new Worker(Queues.WEBHOOK, authorizedJob(webhookProcessor), { ...conn, concurrency: 5 }),
    new Worker(Queues.REPORT, authorizedJob(reportProcessor), { ...conn, concurrency: 1 }),
    new Worker(Queues.IMPORT, authorizedJob(importProcessor), { ...conn, concurrency: 1 }),
    new Worker(Queues.NOTIFICATION, authorizedJob(notificationProcessor), { ...conn, concurrency: 2 }),
    new Worker(Queues.CONVERSATION, authorizedJob(conversationProcessor), { ...conn, concurrency: 1 }),
  ];

  // Log worker events
  workers.forEach((worker) => {
    worker.on('completed', (job) => {
      fastify.log.info(`[OK] Job ${job.id} completed: ${job.queueName}/${job.name}`);
    });
    worker.on('failed', (job, err) => {
      fastify.log.error(`[FAIL] Job ${job?.id} failed (${job?.queueName}/${job?.name}): ${err.message}`);
    });
  });

  // Decorate fastify
  fastify.decorate('queues', queues);
  fastify.decorate('enqueue', async (queueName: string, jobName: string, data: unknown, opts?: { delay?: number }) => {
    if (!queues[queueName]) {
      throw new Error(`Queue "${queueName}" not found`);
    }
    const actor = accessScope.getStore();
    const payload = { ...data as object, __omniAccess: actor && actor.permission !== 'session' ? { userId: actor.userId, accountId: actor.accountId, permission: actor.permission } : undefined };
    await queues[queueName].add(jobName, payload, opts);
    fastify.log.info(`Enqueued: ${queueName}/${jobName}`);
  });

  fastify.addHook('onReady', async () => {
    try {
      await queues[Queues.CONVERSATION].add(
        'auto_resolve',
        { fields: { days: 7 } },
        {
          repeat: { pattern: '0 3 * * *' },
          jobId: 'auto_resolve_daily',
        },
      );
      fastify.log.info('Scheduled daily auto_resolve (03:00)');
    } catch (err) {
      fastify.log.warn({ err }, 'schedule auto_resolve failed');
    }
  });

  // Cleanup on close
  fastify.addHook('onClose', async () => {
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all(Object.values(queues).map((q) => q.close()));
  });
}

export default fp(bullmqPlugin, { name: 'bullmq', dependencies: ['redis'] });
