import type { Job } from 'bullmq';
import { prisma } from './prisma.js';
import type { ConversationJob } from './types.js';
import { runAiAutoReplyJob } from '../shared/services/ai-auto-reply.js';

/**
 * Conversation queue processor — handles bulk actions and background
 * conversation processing.
 *
 * Job names:
 *   - bulk_action — bulk status/assignee/team/label update
 *   - reopen_snoozed — reopen snoozed conversations (scheduled)
 *   - auto_resolve — auto-resolve idle conversations (scheduled)
 *   - ai_auto_reply — LLM auto-reply for incoming customer messages
 */

export async function conversationProcessor(job: Job): Promise<{ processed: boolean; action: string; count?: number }> {
  const data = job.data as ConversationJob;

  switch (job.name) {
    case 'bulk_action': {
      const { account_id, conversation_ids, fields, labels } = data;
      if (!conversation_ids?.length) return { processed: true, action: 'bulk_action', count: 0 };

      const accountId = Number(account_id);
      const updateData: Record<string, unknown> = {};

      if (fields?.status) updateData.status = fields.status;
      if (fields?.assignee_id) updateData.assignee_id = Number(fields.assignee_id);
      if (fields?.team_id) updateData.team_id = Number(fields.team_id);

      // Handle label updates via cached_label_list
      if (labels?.add?.length || labels?.remove?.length) {
        const conversations = await prisma.conversations.findMany({
          where: { id: { in: conversation_ids.map((id) => Number(id)) } } as any,
          select: { id: true, cached_label_list: true },
        });

        for (const conv of conversations) {
          const currentLabels = (conv.cached_label_list as string)
            ? (conv.cached_label_list as string).split(',').map((l) => l.trim()).filter(Boolean)
            : [];

          let updated = [...currentLabels];
          if (labels.add) {
            for (const label of labels.add) {
              if (!updated.includes(label)) updated.push(label);
            }
          }
          if (labels.remove) {
            updated = updated.filter((l) => !labels.remove!.includes(l));
          }

          await prisma.conversations.update({
            where: { id: conv.id },
            data: { cached_label_list: updated.join(',') },
          });
        }
      }

      // Apply shared field updates
      if (Object.keys(updateData).length > 0) {
        await prisma.conversations.updateMany({
          where: {
            account_id: accountId,
            id: { in: conversation_ids.map((id) => Number(id)) },
          } as any,
          data: updateData as any,
        });
      }

      return { processed: true, action: 'bulk_action', count: conversation_ids.length };
    }

    case 'reopen_snoozed': {
      const now = new Date();
      const result = await prisma.conversations.updateMany({
        where: {
          status: 3, // snoozed
          snoozed_until: { not: null, lte: now },
        } as any,
        data: {
          status: 0, // open
          snoozed_until: null,
        } as any,
      });
      return { processed: true, action: 'reopen_snoozed', count: result.count };
    }

    case 'auto_resolve': {
      const resolveDays = (data.fields?.days as number) ?? 7;
      const cutoff = new Date(Date.now() - resolveDays * 24 * 60 * 60 * 1000);
      const idle = await prisma.conversations.findMany({
        where: {
          status: 0,
          last_activity_at: { lte: cutoff },
        },
        select: { id: true, additional_attributes: true },
        take: 500,
      });
      for (const row of idle) {
        const attrs = {
          ...((row.additional_attributes && typeof row.additional_attributes === 'object'
            ? row.additional_attributes
            : {}) as Record<string, unknown>),
          omni_lifecycle: 'ended',
          auto_resolved: true,
          session_ended_at: new Date().toISOString(),
        };
        await prisma.conversations.update({
          where: { id: row.id },
          data: { status: 1, additional_attributes: attrs as object },
        });
      }
      return { processed: true, action: 'auto_resolve', count: idle.length };
    }

    case 'ai_auto_reply': {
      const result = await runAiAutoReplyJob({
        account_id: Number(data.account_id),
        conversation_id: Number(data.conversation_id),
        message_id: data.message_id ? Number(data.message_id) : undefined,
        assistant_id: data.assistant_id ?? null,
      });
      return { processed: result.ok, action: 'ai_auto_reply' };
    }

    default:
      return { processed: true, action: job.name };
  }
}
