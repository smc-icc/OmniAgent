/**
 * Shared Prisma client instance for BullMQ processors.
 * Reuses the same Prisma singleton from the db plugin to avoid
 * creating multiple connection pools.
 */
export { prisma } from '../plugins/db.js';
