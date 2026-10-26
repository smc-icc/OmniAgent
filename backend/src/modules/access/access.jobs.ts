import type { Job } from 'bullmq';
import type { FastifyRequest } from 'fastify';
import { prisma } from '../../plugins/db.js';
import { getAccess } from './access.context.js';
import { accessScope, resolveScope } from './access.scope.js';

/** The queue payload carries identity, never a reusable authorization snapshot. */
export function authorizedJob<T>(processor: (job: Job) => Promise<T>) {
  return async (job: Job): Promise<T> => {
    const actor = job.data?.__omniAccess;
    if (!actor) return processor(job); // Internal scheduled jobs retain their system identity.
    const user = await prisma.users.findUnique({ where: { id: actor.userId } });
    if (!user) throw new Error('access_denied');
    const access = await getAccess({ currentUser: user, headers: { 'x-account-id': String(actor.accountId) } } as unknown as FastifyRequest);
    if (access.accountId !== actor.accountId || !access.permissions.includes(actor.permission)) throw new Error('access_revoked');
    const users = await prisma.users.findMany({ where: { account_users: { some: { account_id: access.accountId } } } });
    const scope = await resolveScope(access, actor.permission, access.scopes[actor.permission] ?? [], users);
    return accessScope.run(scope, () => processor(job));
  };
}
