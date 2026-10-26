import type { Job } from 'bullmq';
import { prisma } from './prisma.js';
import { ioRef } from './socket-ref.js';
import { SocketEvents } from '../plugins/socketio.js';

/**
 * Notification queue processor — creates notification records in DB
 * and emits real-time events via Socket.io.
 *
 * Job names:
 *   - message_created — notify assigned user about new message
 *   - conversation_assigned — notify agent they were assigned
 *   - conversation_mentioned — notify user they were @mentioned
 */

interface NotificationJobData {
  account_id: number;
  user_ids: number[];
  notification_type: string;
  meta: Record<string, unknown>;
}

export async function notificationProcessor(job: Job): Promise<{ sent: boolean; users: number }> {
  const { account_id, user_ids, notification_type, meta } = job.data as NotificationJobData;

  if (!user_ids?.length) {
    return { sent: false, users: 0 };
  }

  const io = ioRef.get();
  const now = new Date();
  let createdCount = 0;

  // Map notification_type string to integer (mirrors Chatwoot enum)
  const typeMap: Record<string, number> = {
    message_created: 0,
    conversation_assigned: 1,
    conversation_mentioned: 2,
    conversation_activity: 3,
  };
  const notifType = typeMap[notification_type] ?? 0;

  // Create notification records for each user
  try {
    const notifications = user_ids.map((userId) => ({
      account_id,
      user_id: userId,
      notification_type: notifType,
      primary_actor_type: (meta.primary_actor_type as string) ?? '',
      primary_actor_id: Number(meta.primary_actor_id ?? 0),
      secondary_actor_type: (meta.secondary_actor_type as string) ?? null,
      secondary_actor_id: meta.secondary_actor_id ? Number(meta.secondary_actor_id) : null,
      read_at: null,
      created_at: now,
      updated_at: now,
      meta: meta as any,
    }));

    await (prisma.notifications as any).createMany({ data: notifications });
    createdCount = user_ids.length;
  } catch (err) {
    console.error('[NotificationProcessor] Failed to create notification records:', err);
  }

  // Emit real-time notification to each user via Socket.io
  if (io) {
    for (const userId of user_ids) {
      io.to(`user:${userId}`).emit(SocketEvents.NOTIFICATION_CREATED, {
        notification_type,
        account_id,
        meta,
        created_at: now.toISOString(),
      });

      io.to(`account:${account_id}`).emit('notification.unread_count_updated', {
        account_id,
      });
    }
  }

  return { sent: true, users: createdCount };
}
