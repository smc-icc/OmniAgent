import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from '../../shared/errors/index.js';
import { accessScope, modelScope, combineWhere, type ScopeContext } from './access.scope.js';

const models = new Map(Prisma.dmmf.datamodel.models.map(m => [m.name, m]));
const fieldsFor = (name: string) => new Set(models.get(name)?.fields.map(f => f.name) ?? []);
const predicate = (name: string, ctx: ScopeContext) => modelScope(name, ctx, fieldsFor(name));
const deny = () => { throw new AppError(403, '记录或关联对象不在授权数据范围内'); };

function scopeIncludes(model: string, args: any, ctx: ScopeContext) {
  for (const branch of ['include', 'select']) {
    if (!args[branch]) continue;
    args[branch] = { ...args[branch] };
    for (const [key, value] of Object.entries(args[branch])) {
      if (!value) continue;
      if (key === '_count') {
        const selected: any = value === true ? Object.fromEntries((models.get(model)?.fields ?? []).filter(f => f.kind === 'object' && f.isList).map(f => [f.name, true])) : { ...(value as any).select };
        for (const [name, selection] of Object.entries(selected)) {
          const relation = models.get(model)?.fields.find(f => f.name === name && f.kind === 'object');
          if (!relation || !selection) continue;
          selected[name] = { ...(selection === true ? {} : selection as object), where: combineWhere((selection as any)?.where, predicate(relation.type, ctx)) };
        }
        args[branch][key] = { select: selected };
        continue;
      }
      const field = models.get(model)?.fields.find(f => f.name === key && f.kind === 'object');
      if (!field) continue;
      const child: any = value === true ? {} : { ...value as object };
      const condition = predicate(field.type, ctx);
      if (field.isList && Object.keys(condition).length) child.where = combineWhere(child.where, condition);
      scopeIncludes(field.type, child, ctx);
      args[branch][key] = child;
    }
  }
}

export function withAccessScope(client: PrismaClient): PrismaClient {
  return client.$extends({ query: { $allOperations: async ({ model, operation, args, query }: any) => {
    const current = accessScope.getStore();
    if (!current) return query(args);
    const ctx: ScopeContext = current;
    if (!model) {
      // Raw SQL cannot receive a reliable automatic row predicate. Limited scopes must use model queries.
      if (!ctx.all) throw new AppError(403, '此聚合操作需要当前租户数据范围');
      return query(args);
    }
    const scope = predicate(model, ctx);
    const a: any = { ...(args ?? {}) };
    if (/^(find|count|aggregate|groupBy|update|delete|upsert)/.test(operation) && Object.keys(scope).length) a.where = combineWhere(a.where, scope);
    scopeIncludes(model, a, ctx);
    async function validateData(data: any, creating: boolean) {
      if (!data || typeof data !== 'object') return;
      const fields = fieldsFor(model);
      if (fields.has('account_id')) {
        if (data.account_id !== undefined && data.account_id !== ctx.accountId) deny();
        if (creating && !data.account) data.account_id = ctx.accountId;
      }
      if (model === 'contacts') {
        if (creating) data.custom_attributes = { ...data.custom_attributes, omni_owner_id: ctx.userId };
        else if (data.custom_attributes && a.where) {
          const existing = await (client as any).contacts.findFirst({ where: a.where, select: { custom_attributes: true } });
          const owner = existing?.custom_attributes?.omni_owner_id;
          if (data.custom_attributes.omni_owner_id !== undefined && data.custom_attributes.omni_owner_id !== owner) deny();
          if (owner !== undefined) data.custom_attributes = { ...data.custom_attributes, omni_owner_id: owner };
        }
      }
      if (model === 'conversations' && creating && !ctx.all && data.assignee_id == null) data.assignee_id = ctx.userId;
      if (model === 'opportunities' && creating && !ctx.all && data.owner_id == null) data.owner_id = ctx.userId;
      for (const field of models.get(model)?.fields ?? []) {
        if (field.kind !== 'object') continue;
        const relation = data[field.name];
        // Prevent nested writes from bypassing the top-level query extension.
        if (relation && Object.keys(relation).some(k => !['connect', 'disconnect'].includes(k))) deny();
        if (relation?.connect) {
          const values = Array.isArray(relation.connect) ? relation.connect : [relation.connect];
          for (const where of values) if (!await (client as any)[field.type].findFirst({ where: combineWhere(where, predicate(field.type, ctx)), select: { id: true } })) deny();
        }
        if (field.relationFromFields?.length === 1 && field.relationToFields?.length === 1) {
          const key = field.relationFromFields[0], value = data[key];
          if (value == null) continue;
          if (typeof value === 'object') deny();
          const targetScope = field.type === 'users' ? { id: { in: ctx.userIds } } : predicate(field.type, ctx);
          if (!await (client as any)[field.type].findFirst({ where: combineWhere({ [field.relationToFields[0]]: value }, targetScope) })) deny();
        }
      }
    }
    if (/^(create|update|upsert)/.test(operation)) {
      for (const key of operation === 'upsert' ? ['create', 'update'] : ['data']) {
        const creating = key === 'create' || operation.startsWith('create');
        for (const data of Array.isArray(a[key]) ? a[key] : [a[key]]) await validateData(data, creating);
      }
    }
    return query(a);
  } } }) as unknown as PrismaClient;
}
