import { resolveChannelGroup } from '../../shared/services/channel-group.js';
import { productModules } from '../product-modules/authority.js';
import { moduleForRequest } from '../product-modules/policy.js';
import { confTenancyEnabled } from '../../shared/services/conf-tenancy.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../../shared/errors/index.js';
import { context, getAccess } from './access.context.js';
import { prisma } from '../../plugins/db.js';
import { routePolicy } from './access.route-policy.js';
import { accessScope, resolveScope, conversationScope, type ScopeContext } from './access.scope.js';
import { validMediaUrl, signMediaPayload, hasUnsignedMedia } from './access.media.js';

const requestScopes = new WeakMap<FastifyRequest, ScopeContext>();

/** 全媒体会话路由的 :id 为 `c<会话号>` 形式，与 omnichannel 的 parseSessionConvId 保持同一约定。 */
function toConversationId(value: unknown): number {
  const matched = String(value).trim().match(/^c?(\d+)$/i);
  return matched ? Number(matched[1]) : Number.NaN;
}
export function installAccessGuard(app: FastifyInstance) {
  app.addHook('onRoute', options => {
    const handler = options.handler;
    options.handler = function(req, reply) {
      const scope = requestScopes.get(req);
      return scope ? accessScope.run(scope, () => handler.call(this, req, reply)) : handler.call(this, req, reply);
    };
  });
  app.addHook('preHandler', async req => {
    const template = req.routeOptions.url ?? req.url.split('?')[0];
    if (template.startsWith('/uploads/')) {
      if (!validMediaUrl(req.url)) throw new AppError(403, '文件链接无效或已过期，请刷新会话');
      return;
    }
    if (hasUnsignedMedia(req.body)) throw new AppError(403, '文件必须通过授权上传或会话获取');
    const module = moduleForRequest(req.method, template) ?? moduleForRequest(req.method, req.url);
    if (module && !(await productModules().snapshot()).modules[module].available) throw new AppError(403, '对应功能模块未安装、未启用或未获授权', 'module_unavailable');
    const policy = routePolicy(req.method, template);
    if (policy?.mode === 'external') return;
    await app.authenticate(req);
    if (!policy) throw new AppError(403, '接口尚未登记访问策略', 'access_policy_missing');
    const access = policy.mode === 'session' ? { ...await context(req), scopes: {} as Record<string, import('./access.catalog.js').DataScope[]>, permissions: [] as string[] } : await getAccess(req);
    if (confTenancyEnabled() && !access.systemSuperuser && (/^\/(platform|enterprise)\/api\//.test(template) || template.startsWith('/api/platform-config/') || template === '/api/v1/accounts' || template === '/auth')) throw new AppError(403, '全局配置仅限系统超级用户');
    if (confTenancyEnabled() && template.startsWith('/api/agent/') && access.systemSuperuser && template !== '/api/agent/ccs-session') throw new AppError(403, '系统超级用户不是业务坐席，请使用 VDN 业务身份进行语音操作');
    if (policy.permission && !access.permissions.includes(policy.permission)) throw new AppError(403, '没有此操作权限', 'access_denied');
    const params = req.params as Record<string, unknown>;
    const query = req.query as Record<string, unknown>;
    const body = req.body as Record<string, unknown> | undefined;
    if (policy.resource === 'conversation' && body?.additional_attributes && typeof body.additional_attributes === 'object') {
      const allowed = new Set(['pinned', 'flagged', 'muted', 'omni_pinned', 'omni_flagged']);
      if (Object.keys(body.additional_attributes).some(key => !allowed.has(key))) throw new AppError(403, '会话系统属性不能由客户端修改');
    }
    const accountId = params?.account_id ?? (/\/accounts\/:id(?:\/|$)/.test(template) ? params?.id : undefined);
    for (const value of [accountId, query?.account_id, body?.account_id, req.headers['x-account-id']]) {
      if (value !== undefined && Number(value) !== access.accountId) throw new AppError(403, '不能访问其他租户');
    }
    if (confTenancyEnabled()) {
      const session = req.server.ccsBridge?.getSession(req.currentUser!.id);
      if (session?.loggedIn && session.vdnId !== access.vdnId && (template.startsWith('/api/agent/') || template.startsWith('/api/omnichannel/workspace/'))) throw new AppError(403, '语音会话与当前 VDN 不一致，请先签出');
    }
    const users = await prisma.users.findMany({ where: { account_users: { some: { account_id: access.accountId } } }, select: { id: true, uid: true, email: true, name: true, custom_attributes: true } });
    const scopes = policy.permission ? access.scopes[policy.permission] ?? [] : ['self'] as const;
    const scope = await resolveScope(access, policy.permission ?? 'session', [...scopes], users);
    const additional = policy.permission === 'conversation.update' && body ? [
      ...(('assignee_id' in body || 'team_id' in body) ? ['conversation.transfer'] : []), ...('status' in body ? ['conversation.close'] : []),
    ] : [];
    for (const code of additional) {
      if (!access.permissions.includes(code)) throw new AppError(403, '没有此操作权限');
      const secondary = await resolveScope(access, code, access.scopes[code] ?? [], users);
      scope.all = scope.all && secondary.all;
      scope.userIds = scope.userIds.filter(id => secondary.userIds.includes(id));
    }
    requestScopes.set(req, scope);
    const conversationId = policy.resource === 'conversation' ? params?.conversationId ?? params?.id : undefined;
    for (const raw of [conversationId, body?.conversation_id, body?.conversationId, query?.conversation_id, query?.conversationId, policy.resource === 'workspace' ? body?.logicNo : undefined]) {
      if (raw == null) continue;
      const id = toConversationId(raw);
      if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(400, '会话编号无效');
      const found = await prisma.conversations.findFirst({ where: { id, ...conversationScope(scope) }, select: { id: true, inbox: { select: { channel_type: true } } } });
      if (!found) throw new AppError(403, '会话不在授权数据范围内');
      if (resolveChannelGroup(found.inbox?.channel_type) === 'phone' && !(await productModules().snapshot()).modules.icc.available) throw new AppError(403, 'ICC 话务模块未启用', 'module_unavailable');
    }
    for (const id of [body?.target_user_id, body?.targetUserId, body?.assignee_id, body?.assigneeId, body?.owner_id]) {
      if (id != null && !scope.userIds.includes(Number(id))) throw new AppError(403, '目标人员不在授权数据范围内');
    }
    if (policy.resource === 'workspace') {
      const { getSessionByAgentId } = await import('../../integrations/ccs/session-manager.js');
      for (const id of [body?.agentId, ...(Array.isArray(body?.agentIds) ? body.agentIds : [])]) {
        if (id != null && !scope.userIds.includes(getSessionByAgentId(Number(id))?.userId ?? 0)) throw new AppError(403, '目标坐席不在授权数据范围内');
      }
    }
    if (!scope.all && ['/api/omnichannel/call-records', '/api/omnichannel/recordings'].includes(template)) throw new AppError(403, '按号码查询全部录音需要当前租户范围；请从获授权的会话访问录音');
    if (policy.permission === 'conversation.update' && body && ('assignee_id' in body || 'team_id' in body) && !access.permissions.includes('conversation.transfer')) throw new AppError(403, '没有转接权限');
    if (policy.permission === 'conversation.update' && body && 'status' in body && !access.permissions.includes('conversation.close')) throw new AppError(403, '没有结束会话权限');
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    if (typeof payload !== 'string' || !String(reply.getHeader('content-type')).includes('application/json')) return payload;
    if (!payload.includes('/uploads/')) return payload;
    return JSON.stringify(signMediaPayload(JSON.parse(payload)));
  });
  app.addHook('onResponse', async (req, reply) => {
    if (reply.statusCode === 403 || (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && requestScopes.has(req))) {
      const scope = requestScopes.get(req);
      req.log.info({ access_audit: true, user_id: req.currentUser?.id, account_id: scope?.accountId, permission: scope?.permission, scopes: scope?.scopes, route: req.routeOptions.url, method: req.method, status: reply.statusCode }, 'access decision');
    }
  });
}
