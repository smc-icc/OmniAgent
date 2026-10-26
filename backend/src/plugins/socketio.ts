import type { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { redis as redisClient } from './redis.js';
import { env } from '../config/env.js';
import { ioRef } from '../processors/socket-ref.js';
import { socketAccess, secureSocket, secureBroadcasts } from '../modules/access/access.socket.js';
import { getLoginSession, onLoginRevoked, withLoginTransition } from '../shared/services/login-session.js';

/**
 * Socket.io events — mirrors Chatwoot ActionCable channels.
 */
export const SocketEvents = {
  // Conversation
  CONVERSATION_CREATED: 'conversation.created',
  CONVERSATION_STATUS_CHANGED: 'conversation.status_changed',
  CONVERSATION_ASSIGNED: 'conversation.assigned',
  CONVERSATION_UPDATED: 'conversation.updated',
  CONVERSATION_UNREAD_CHANGED: 'conversation.unread_changed',

  // Messages
  MESSAGE_CREATED: 'message.created',
  MESSAGE_UPDATED: 'message.updated',

  // Presence & Typing
  PRESENCE_UPDATE: 'presence.update',
  TYPING_ON: 'typing.on',
  TYPING_OFF: 'typing.off',

  // Contacts
  CONTACT_UPDATED: 'contact.updated',

  // Notifications
  NOTIFICATION_CREATED: 'notification.created',

  VOICEMAIL_CREATED: 'voicemail.created',

  // CCS telephony bridge (agent.tars over Socket.io)
  CCS_AGENT: 'ccs.agent',
  /** CCS TARS 不可达：前端应清会话并回登录页 */
  CCS_DOWN: 'ccs.down',
  /** 全员轻量健康脉冲（generation / up），不按座席探测 CCS */
  CCS_HEALTH: 'ccs.health',
  /** ITR 辅助观察（非业务 RPC） */
  ITR_OBSERVE: 'itr.observe',
} as const;

export type SocketEvent = (typeof SocketEvents)[keyof typeof SocketEvents];

/** 客户端形态；移动端的「断开」语义与桌面浏览器不同，握手时就要区分。 */
export type SocketClientKind = 'web' | 'mobile' | 'desktop';

const CLIENT_KINDS: readonly SocketClientKind[] = ['web', 'mobile', 'desktop'];

export function normalizeClientKind(raw: unknown): SocketClientKind {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (CLIENT_KINDS as readonly string[]).includes(v) ? (v as SocketClientKind) : 'web';
}

export function socketClientKind(socket: Pick<Socket, 'data'>): SocketClientKind {
  return normalizeClientKind(socket.data?.client);
}

declare module 'fastify' {
  interface FastifyInstance {
    io: Server;
    /** Emit an event to all sockets in an account */
    emitToAccount: (accountId: number, event: string, data: unknown) => void;
    /** Emit to a specific user */
    emitToUser: (userId: number, event: string, data: unknown) => void;
    /** Active socket count for a user (this process) */
    userSocketCount: (userId: number) => number;
    /** Drop all sockets for a user (exclusive login kick) */
    disconnectUserSockets: (userId: number) => void;
    /** Broadcast to every connected socket */
    emitToAll: (event: string, data: unknown) => void;
  }
}

// Track which socket belongs to which user/account
const userSockets = new Map<number, Set<string>>();
const accountRooms = new Map<number, Set<string>>();

function normUserId(userId: unknown): number {
  return Number(userId);
}

async function socketioPlugin(fastify: FastifyInstance) {
  // Create Socket.io server attached to Fastify's HTTP server
  const io = new Server(fastify.server, {
    cors: {
      origin: true,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    path: '/cable', // Chatwoot compatibility: ActionCable uses /cable
  });

  // 桥接：Fastify 路由系统会把未匹配的 /cable 请求吃掉（404），Socket.io 挂在
  // fastify.server 上拿不到握手请求 → 前端报 "Socket not connected"。
  // 注册通配路由，把 /cable 请求直接交给 Socket.io 的 engine 处理。
  const bridge = (req: unknown, reply: unknown) => {
    io.engine.handleRequest((req as any).raw, (reply as any).raw);
  };
  fastify.get('/cable*', bridge as any);
  fastify.post('/cable*', bridge as any);

  // Redis adapter for multi-process scalability
  const pubClient = redisClient.duplicate();
  const subClient = redisClient.duplicate();
  await pubClient.connect();
  await subClient.connect();
  io.adapter(createAdapter(pubClient as any, subClient as any));
  secureBroadcasts(io);

  // JWT authentication middleware
  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth.token as string
        || (socket.handshake.query.token as string);

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const payload = fastify.jwt.verify(token) as { id: number; email: string; sid?: string };
      const { isCurrentSession, getLoginSession } = await import('../shared/services/login-session.js');
      if (getLoginSession(payload.id) && !isCurrentSession(payload.id, payload.sid)) {
        return next(new Error('session_replaced'));
      }
      socket.data.userId = Number(payload.id);
      socket.data.email = payload.email;
      socket.data.sid = payload.sid;
      socket.data.client = normalizeClientKind(
        socket.handshake.auth.client ?? socket.handshake.query.client,
      );
      socket.data.deviceId = String(
        socket.handshake.auth.device_id ?? socket.handshake.query.device_id ?? '',
      );
      await socketAccess(Number(payload.id), payload.sid);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  // Connection handler
  io.on('connection', (socket: Socket) => {
    secureSocket(socket);
    const userId = normUserId(socket.data.userId);
    socket.data.userId = userId;
    fastify.log.info(`Socket connected: user=${userId} client=${socketClientKind(socket)} (${socket.id})`);

    // Track user's sockets + room for cross-safe emit (Redis adapter)
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId)!.add(socket.id);
    void socket.join(`user:${userId}`);

    // Join account rooms
    socket.on('subscribe', (data: { account_id: number; conversation_id?: number }) => {
      const room = `account:${data.account_id}`;
      socket.join(room);
      if (!accountRooms.has(data.account_id)) {
        accountRooms.set(data.account_id, new Set());
      }
      accountRooms.get(data.account_id)!.add(socket.id);

      // Also join a conversation room if provided
      if (data.conversation_id) {
        socket.join(`conversation:${data.conversation_id}`);
      }
    });

    // Presence
    socket.on('presence.update', (data: { account_id: number; status: string }) => {
      io.to(`account:${data.account_id}`).emit(SocketEvents.PRESENCE_UPDATE, {
        user_id: userId,
        status: data.status,
      });
    });

    // Typing indicators
    socket.on('typing.on', (data: { conversation_id: number }) => {
      socket.to(`conversation:${data.conversation_id}`).emit(SocketEvents.TYPING_ON, {
        user_id: userId,
        conversation_id: data.conversation_id,
      });
    });

    socket.on('typing.off', (data: { conversation_id: number }) => {
      socket.to(`conversation:${data.conversation_id}`).emit(SocketEvents.TYPING_OFF, {
        user_id: userId,
        conversation_id: data.conversation_id,
      });
    });

    // Disconnect
    socket.on('disconnect', () => {
      fastify.log.info(`🔌 Socket disconnected: user=${userId} (${socket.id})`);
      userSockets.get(userId)?.delete(socket.id);
      if (userSockets.get(userId)?.size === 0) {
        userSockets.delete(userId);
      }
    });
  });

  // Store reference for BullMQ processors to emit events
  const stopRevocationCleanup = onLoginRevoked(session => {
    fastify.emitToUser?.(session.userId, 'auth.kicked', { reason: 'social_revoked', message: '企业授权或身份关联已失效，请重新登录' });
    fastify.disconnectUserSockets?.(session.userId);
    void withLoginTransition(session.userId, async () => {
      if (!getLoginSession(session.userId)) await fastify.ccsBridge?.logoutUser(session.userId);
    }).catch(err => fastify.log.warn({ err, userId: session.userId }, 'social revocation CCS cleanup failed'));
  });
  fastify.addHook('onClose', async () => { stopRevocationCleanup(); });
  ioRef.set(io);

  // Decorate fastify instance
  fastify.decorate('io', io);
  fastify.decorate('emitToAccount', (accountId: number, event: string, data: unknown) => {
    io.to(`account:${accountId}`).emit(event, data);
  });
  fastify.decorate('emitToUser', (userId: number, event: string, data: unknown) => {
    const uid = normUserId(userId);
    let n = 0;
    for (const sock of io.sockets.sockets.values()) {
      if (normUserId(sock.data.userId) === uid) {
        sock.emit(event, data);
        n += 1;
      }
    }
    if (n === 0) {
      io.to(`user:${uid}`).emit(event, data);
    }
  });
  fastify.decorate('userSocketCount', (userId: number) => {
    const uid = normUserId(userId);
    let n = 0;
    for (const sock of io.sockets.sockets.values()) {
      if (!sock.connected) continue;
      if (normUserId(sock.data.userId) === uid) n += 1;
    }
    return n;
  });
  fastify.decorate('emitToAll', (event: string, data: unknown) => {
    io.emit(event, data);
  });
  fastify.decorate('disconnectUserSockets', (userId: number) => {
    const ids = userSockets.get(userId);
    if (!ids) return;
    for (const sid of [...ids]) {
      const sock = io.sockets.sockets.get(sid);
      sock?.disconnect(true);
    }
  });

  // Cleanup on server close
  fastify.addHook('onClose', async () => {
    await io.close();
    await pubClient.quit();
    await subClient.quit();
  });
}

export default fp(socketioPlugin, { name: 'socketio', dependencies: ['redis'] });
