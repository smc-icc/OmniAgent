import type { FastifyRequest } from 'fastify';
import type { Server, Socket } from 'socket.io';
import { prisma } from '../../plugins/db.js';
import { getAccess } from './access.context.js';
import { accessScope, resolveScope, conversationScope } from './access.scope.js';
import { isCurrentSession } from '../../shared/services/login-session.js';
import { signMediaPayload } from './access.media.js';
import { assertActiveSocialLogin } from '../social-auth/social-session-authority.js';

export async function socketAccess(userId: number, sid?: string, accountId?: number) {
  if (!isCurrentSession(userId, sid)) throw new Error('session_replaced');
  await assertActiveSocialLogin(userId, sid);
  const user = await prisma.users.findUnique({ where: { id: userId } });
  if (!user) throw new Error('user_not_found');
  const access = await getAccess({ currentUser: user, headers: accountId == null ? {} : { 'x-account-id': String(accountId) } } as unknown as FastifyRequest);
  if (!isCurrentSession(userId, sid)) throw new Error('session_replaced');
  return access;
}
export async function socketMayRead(userId: number, sid: string | undefined, permission: string, conversationId?: number, accountId?: number) {
  const access = await socketAccess(userId, sid, accountId);
  if (accountId != null && accountId !== access.accountId) return false;
  if (!access.permissions.includes(permission)) return false;
  if (!conversationId) return access.scopes[permission]?.includes('account') ?? false;
  const users = await prisma.users.findMany({ where: { account_users: { some: { account_id: access.accountId } } } });
  const scope = await resolveScope(access, permission, access.scopes[permission] ?? [], users);
  return !!await prisma.conversations.findFirst({ where: { id: conversationId, ...conversationScope(scope) }, select: { id: true } });
}

/** Checks every incoming packet, including packets on already established sockets. */
export function secureSocket(socket: Socket) {
  socket.use(async ([event, data], next) => {
    try {
      const access = await socketAccess(socket.data.userId, socket.data.sid, event === 'subscribe' && data?.account_id != null ? Number(data.account_id) : socket.data.accountId);
      if (data?.account_id != null && Number(data.account_id) !== access.accountId) throw new Error('account_denied');
      if (event === 'subscribe' && data?.conversation_id && !await socketMayRead(access.userId, socket.data.sid, 'conversation.read', Number(data.conversation_id), access.accountId)) throw new Error('conversation_denied');
      if (event === 'typing.on' || event === 'typing.off') {
        if (!await socketMayRead(access.userId, socket.data.sid, 'conversation.reply', Number(data?.conversation_id), access.accountId)) throw new Error('reply_denied');
      }
      if (event === 'subscribe') {
        // Drop all old tenant and conversation rooms when switching.
        for (const room of socket.rooms) if (room.startsWith('account:') || room.startsWith('conversation:')) await socket.leave(room);
        socket.data.accountId = access.accountId;
      }
      next();
    } catch { socket.emit('access.denied', { event }); next(new Error('access_denied')); }
  });
}

/** Filter at the adapter boundary so HTTP handlers, workers and direct io.to() all obey RBAC. */
export function secureBroadcasts(io: Server) {
  const adapter = io.of('/').adapter;
  const broadcast = adapter.broadcast.bind(adapter);
  adapter.broadcast = (packet, options) => {
    const [event, payload] = packet.data ?? [];
    const business = /^(conversation[._]|message\.|contact\.|typing\.|voicemail\.|itr\.|icc\.|ccs\.agent)/.test(String(event));
    const accountRooms = [...options.rooms].filter(r => r.startsWith('account:'));
    if (!business && !accountRooms.length) { broadcast(packet, options); return; }
    void accessScope.exit(async () => {
      const targets = await io.in([...options.rooms]).except([...(options.except ?? [])]).fetchSockets();
      const allowed: string[] = [];
      for (const socket of targets) {
        try {
          const access = await socketAccess(socket.data.userId, socket.data.sid, socket.data.accountId);
          if (accountRooms.some(r => Number(r.slice(8)) !== access.accountId)) continue;
          const vdn = payload?.vdnId ?? payload?.tenant?.vdnId;
          if (vdn != null && Number(vdn) !== access.vdnId) continue;
          if (event === 'ccs.agent') { allowed.push(socket.id); continue; }
          const id = Number(payload?.conversation_id ?? (String(event).startsWith('conversation.') ? payload?.id : 0)) || undefined;
          const permission = /^(message|conversation|typing)/.test(event) ? 'conversation.read' : String(event).startsWith('contact.') ? 'customer.read' : String(event).startsWith('voicemail.') ? 'voicemail.read' : String(event).startsWith('itr.') ? 'settings.read' : String(event).startsWith('icc.') ? 'integration.read' : 'organization.read';
          if (String(event).startsWith('notification.')) {
            if (Number(payload?.user_id) !== access.userId) continue;
          } else if (!await socketMayRead(access.userId, socket.data.sid, permission, id, access.accountId)) continue;
          allowed.push(socket.id);
        } catch { /* Missing permission, revoked membership or unavailable authority: do not deliver. */ }
      }
      if (allowed.length) broadcast({ ...packet, data: [event, signMediaPayload(payload)] }, { ...options, rooms: new Set(allowed) });
    }).catch(() => { /* Fail closed on authorization/storage errors. */ });
  };
}
