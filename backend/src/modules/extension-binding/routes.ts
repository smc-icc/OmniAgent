import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { assertBindingSchemaReady } from './readiness.js';
import { AppError } from '../../shared/errors/index.js';
import { listUsers } from '../access/access.users.js';
import { listExtensions } from '../access/access.extensions.js';
import { getAccess, context } from '../access/access.context.js';
import * as repo from './repository.js';
import {
  bindingSnapshot,
  submitRequest,
  decideRequest,
  reserveChange,
  approveRequest,
  executeChange,
  recoverChanges,
} from './service.js';
import {
  bindingFlowEnabled,
  requireBindingFlow,
  signInBoundVoice,
  signOutBoundVoice,
  reportStartupFailure,
} from './voice.js';
export const changeSchema = z
  .object({
    extension: z
      .string()
      .trim()
      .max(50)
      .regex(/^[0-9+*#]*$/)
      .default(''),
    expected_version: z.number().int().nonnegative().safe(),
    idempotency_key: z.string().trim().min(8).max(128),
  })
  .strict();
const idSchema = z.string().uuid(),
  userId = z.coerce.number().int().positive();
export async function extensionBindingRoutes(app: FastifyInstance) {
  const auth = {
    preHandler: [
      app.authenticate,
      async () => {
        requireBindingFlow();
        await assertBindingSchemaReady();
      },
    ],
  };
  app.addHook('onReady', async () => {
    if (bindingFlowEnabled()) await assertBindingSchemaReady();
  });
  const admin = async (req: FastifyRequest, permission: string) => {
    const access = await getAccess(req);
    if (!access.permissions.includes(permission)) throw new AppError(403, '没有此分机管理权限');
    if (
      access.systemSuperuser &&
      req.headers['x-vdn-id'] &&
      Number(req.headers['x-vdn-id']) !== access.vdnId
    )
      throw new AppError(403, '所选 VDN 与当前管理范围不一致');
    if (access.systemSuperuser && !req.headers['x-vdn-id'] && !req.headers['x-account-id'])
      throw new AppError(422, '请明确选择管理 VDN');
    return access;
  };
  app.get('/api/agent/extension-binding', auth, bindingSnapshot);
  app.get('/api/agent/extension-options', auth, async (req) => {
    const ctx = await context(req);
    if (!ctx.agentId || ctx.systemSuperuser) throw new AppError(403, '当前身份不是有效坐席');
    return { extensions: await repo.extensionOptions(await repo.database(), ctx.vdnId) };
  });
  app.post('/api/agent/extension-requests', auth, async (req) =>
    submitRequest(req, changeSchema.parse(req.body)),
  );
  app.delete('/api/agent/extension-requests/:id', auth, async (req) =>
    decideRequest(req, idSchema.parse((req.params as { id: string }).id), 'cancel'),
  );
  app.put('/api/agent/extension-binding', auth, async (req) =>
    reserveChange(req, (await context(req)).agentId, changeSchema.parse(req.body), true),
  );
  app.delete('/api/agent/extension-binding', auth, async (req) => {
    const b = changeSchema.parse(req.body);
    if (b.extension) throw new AppError(422, '解绑不接受目标分机');
    return reserveChange(req, (await context(req)).agentId, b, true);
  });
  app.post('/api/agent/extension-binding/retry', auth, async (req) => {
    const id = idSchema.parse((req.body as { operation_id?: string })?.operation_id),
      ctx = await context(req);
    const op = await repo.readOperation(await repo.database(), id);
    if (!op || op.vdn_id !== ctx.vdnId || op.user_id !== ctx.agentId)
      throw new AppError(404, '变更不存在');
    return executeChange(app, id);
  });
  app.get('/api/access/extension-management', auth, async (req) => {
    const access = await getAccess(req);
    if (
      !access.permissions.includes('extension.assign') &&
      !access.permissions.includes('extension.approve')
    )
      throw new AppError(403, '没有分机管理权限');
    await admin(
      req,
      access.permissions.includes('extension.assign') ? 'extension.assign' : 'extension.approve',
    );
    const db = await repo.database();
    return {
      vdn_id: access.vdnId,
      users: await listUsers(db, access.vdnId),
      extensions: await listExtensions(db, access.vdnId),
      departments: [],
      roles: [],
      groups: [],
      skills: [],
      permissions: [],
      channel_groups: [],
      media_types: [],
      business_types: [],
      skill_elements: [],
    };
  });
  app.get('/api/access/extension-requests', auth, async (req) => ({
    requests: await repo.requestList(
      await repo.database(),
      (await admin(req, 'extension.approve')).vdnId,
    ),
  }));
  app.post('/api/access/extension-requests/:id/approve', auth, async (req) => {
    await admin(req, 'extension.approve');
    return approveRequest(req, idSchema.parse((req.params as { id: string }).id));
  });
  app.post('/api/access/extension-requests/:id/reject', auth, async (req) => {
    await admin(req, 'extension.approve');
    return decideRequest(
      req,
      idSchema.parse((req.params as { id: string }).id),
      'reject',
      z.object({ reason: z.string().max(500).default('') }).parse(req.body ?? {}).reason,
    );
  });
  app.get('/api/access/users/:id/extension-binding', auth, async (req) => {
    const ctx = await admin(req, 'extension.assign'),
      id = userId.parse((req.params as { id: string }).id),
      db = await repo.database();
    return {
      binding: await repo.readBinding(db, ctx.vdnId, id),
      extensions: await repo.extensionOptions(db, ctx.vdnId),
      operation: ((op) => (op ? { id: op.id, phase: op.phase, error: op.error } : null))(
        await repo.activeOperation(db, ctx.vdnId, id),
      ),
    };
  });
  app.put('/api/access/users/:id/extension-binding', auth, async (req) => {
    await admin(req, 'extension.assign');
    return reserveChange(
      req,
      userId.parse((req.params as { id: string }).id),
      changeSchema.parse(req.body),
      false,
    );
  });
  app.delete('/api/access/users/:id/extension-binding', auth, async (req) => {
    await admin(req, 'extension.assign');
    const b = changeSchema.parse(req.body);
    if (b.extension) throw new AppError(422, '解绑不接受目标分机');
    return reserveChange(req, userId.parse((req.params as { id: string }).id), b, false);
  });
  app.post('/api/agent/voice/sign-in', auth, async (req) =>
    signInBoundVoice(
      req,
      z.object({ binding_version: z.number().int().nonnegative().safe() }).strict().parse(req.body)
        .binding_version,
    ),
  );
  app.post('/api/agent/voice/startup-failure', auth, async (req) =>
    reportStartupFailure(
      req,
      z.object({ binding_version: z.number().int().nonnegative().safe() }).strict().parse(req.body)
        .binding_version,
    ),
  );
  app.post('/api/agent/voice/sign-out', auth, signOutBoundVoice);
  let recovering = false;
  const timer = setInterval(() => {
    if (!bindingFlowEnabled() || recovering) return;
    recovering = true;
    void recoverChanges(app)
      .catch((err) =>
        app.log.warn(
          { message: err instanceof AppError ? err.message : '分机恢复任务失败' },
          'extension operation recovery',
        ),
      )
      .finally(() => {
        recovering = false;
      });
  }, 15000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}
