import { listManagedTenants } from '../../shared/services/conf-tenancy.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { database, rows } from './access.db.js';
import { context, getAccess, requirePermission, effectivePermissions } from './access.context.js';
import { kindSchema, listEntities, requireEntity, saveEntity, deleteEntity, memberIds, changeMembers, permissionsCatalog, ownPermissionIds, changePermission } from './access.entities.js';
import { listUsers, requireUser, saveUser, syncUser } from './access.users.js';
import { listExtensions, saveExtension, deleteExtension } from './access.extensions.js';
import { ownScopes } from './access.entities.js';

const idSchema = z.coerce.number().int().positive();
export async function accessRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };
  const manage = { preHandler: [app.authenticate, async (req: import('fastify').FastifyRequest) => { await requirePermission(req, 'access.manage'); }] };
  app.get('/api/access/me', auth, getAccess);
  app.get('/api/access/tenants', auth, listManagedTenants);
  app.get('/api/access/bootstrap', manage, async req => {
    const ctx = await context(req);
    const db = await database();
    const [users, departments, roles, groups, skills, permissions, extensions, channel_groups, media_types, business_types, skill_elements] = await Promise.all([
      listUsers(db, ctx.vdnId), listEntities(db, ctx.vdnId, 'departments'), listEntities(db, ctx.vdnId, 'roles'),
      listEntities(db, ctx.vdnId, 'groups'), listEntities(db, ctx.vdnId, 'skills'), permissionsCatalog(), listExtensions(db, ctx.vdnId),
      rows(db, 'SELECT ID AS id, Name AS name FROM t_icc_base_channelgroup WHERE VDNID = ?', [ctx.vdnId]),
      rows(db, 'SELECT ID AS id, Name AS name FROM t_icc_base_mediatype'),
      rows(db, 'SELECT ID AS id, Name AS name FROM t_icc_skill_businesstype WHERE VDN = ?', [ctx.vdnId]),
      rows(db, 'SELECT ID AS id, Name AS name FROM t_icc_skill_element WHERE VDN = ?', [ctx.vdnId]),
    ]);
    return { vdn_id: ctx.vdnId, users, departments, roles, groups, skills, permissions, extensions, channel_groups, media_types, business_types, skill_elements };
  });
  app.post('/api/access/users', manage, async req => saveUser(await context(req), null, req.body));
  app.put('/api/access/users/:id', manage, async req => saveUser(await context(req), idSchema.parse((req.params as { id: string }).id), req.body));
  app.post('/api/access/users/:id/sync', manage, async req => syncUser(await context(req), idSchema.parse((req.params as { id: string }).id)));
  app.get('/api/access/users/:id/permissions', manage, async req => {
    const ctx = await context(req), id = idSchema.parse((req.params as { id: string }).id), db = await database();
    await requireUser(db, ctx.vdnId, id);
    return { own_ids: await ownPermissionIds(db, ctx.vdnId, 'users', id), scopes: await ownScopes(db, ctx.vdnId, 'users', id), effective: await effectivePermissions(db, ctx.vdnId, id) };
  });
  app.patch('/api/access/users/:id/permissions', manage, async req => {
    const ctx = await context(req);
    return changePermission(ctx.vdnId, 'users', idSchema.parse((req.params as { id: string }).id), req.body);
  });
  app.post('/api/access/entities/:kind', manage, async req => saveEntity((await context(req)).vdnId, kindSchema.parse((req.params as { kind: string }).kind), null, req.body));
  app.put('/api/access/entities/:kind/:id', manage, async req => {
    const { kind, id } = req.params as { kind: string; id: string };
    return saveEntity((await context(req)).vdnId, kindSchema.parse(kind), idSchema.parse(id), req.body);
  });
  app.delete('/api/access/entities/:kind/:id', manage, async req => {
    const { kind, id } = req.params as { kind: string; id: string };
    return deleteEntity((await context(req)).vdnId, kindSchema.parse(kind), idSchema.parse(id));
  });
  app.get('/api/access/entities/:kind/:id/assignments', manage, async req => {
    const params = req.params as { kind: string; id: string }, kind = kindSchema.parse(params.kind), id = idSchema.parse(params.id);
    const ctx = await context(req), db = await database();
    await requireEntity(db, ctx.vdnId, kind, id);
    return { member_ids: await memberIds(db, ctx.vdnId, kind, id), scopes: await ownScopes(db, ctx.vdnId, kind, id), permission_ids: ['departments', 'roles'].includes(kind) ? await ownPermissionIds(db, ctx.vdnId, kind, id) : [] };
  });
  app.patch('/api/access/entities/:kind/:id/members', manage, async req => {
    const p = req.params as { kind: string; id: string };
    return changeMembers((await context(req)).vdnId, kindSchema.parse(p.kind), idSchema.parse(p.id), req.body);
  });
  app.patch('/api/access/entities/:kind/:id/permissions', manage, async req => {
    const p = req.params as { kind: string; id: string };
    return changePermission((await context(req)).vdnId, kindSchema.parse(p.kind), idSchema.parse(p.id), req.body);
  });
  app.post('/api/access/extensions', manage, async req => saveExtension((await context(req)).vdnId, null, req.body));
  app.put('/api/access/extensions/:num', manage, async req => saveExtension((await context(req)).vdnId, (req.params as { num: string }).num, req.body));
  app.delete('/api/access/extensions/:num', manage, async req => deleteExtension((await context(req)).vdnId, (req.params as { num: string }).num));
  app.addHook('onResponse', async (req, reply) => {
    if (req.method !== 'GET') req.log.info({ actor: req.currentUser?.id, route: req.routeOptions.url, target: req.params, status: reply.statusCode }, 'access management audit');
  });
}
