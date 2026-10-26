import 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    redis: Redis;
    jwt: {
      sign: (payload: Record<string, unknown>, options?: { expiresIn?: string }) => string;
      verify: (token: string) => Record<string, unknown>;
    };
    authenticate: (request: import('fastify').FastifyRequest) => Promise<void>;
    loadAccount: (request: import('fastify').FastifyRequest) => Promise<void>;
  }

  interface FastifyRequest {
    /** Current authenticated user (set by auth plugin) */
    currentUser: {
      id: number;
      email: string;
      name: string;
      pubsubToken?: string;
      accounts: Array<{ id: number; role: string }>;
    } | null;

    /** Current account context (set by loadAccount) */
    currentAccount: {
      id: number;
      name: string;
    } | null;
  }
}
