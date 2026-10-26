import type { Job } from 'bullmq';
import { prisma } from './prisma.js';
import type { ReportJob } from './types.js';

/**
 * Report queue processor — generates aggregated reports.
 *
 * Job names:
 *   - agent_summary — per-agent conversation/metrics summary
 *   - team_summary — per-team aggregated metrics
 *   - inbox_summary — per-inbox channel metrics
 *   - label_summary — per-label conversation counts
 *   - channel_summary — per-channel type metrics
 */

export async function reportProcessor(job: Job): Promise<{ generated: boolean; report_type: string; data?: unknown }> {
  const { account_id, report_type, params } = job.data as ReportJob;
  const accountId = Number(account_id);

  switch (report_type) {
    case 'agent_summary': {
      const agents = await prisma.conversations.groupBy({
        by: ['assignee_id'],
        where: { account_id: accountId } as any,
        _count: { id: true },
      });
      return { generated: true, report_type, data: { agents } };
    }

    case 'team_summary': {
      const teams = await prisma.conversations.groupBy({
        by: ['team_id'],
        where: { account_id: accountId } as any,
        _count: { id: true },
      });
      return { generated: true, report_type, data: { teams } };
    }

    case 'inbox_summary': {
      const inboxes = await prisma.conversations.groupBy({
        by: ['inbox_id', 'status'],
        where: { account_id: accountId } as any,
        _count: { id: true },
      });
      return { generated: true, report_type, data: { inboxes } };
    }

    case 'label_summary': {
      const conversations = await prisma.conversations.findMany({
        where: {
          account_id: accountId,
          cached_label_list: { not: '' as never },
        } as any,
        select: { cached_label_list: true },
        take: 10000,
      });

      const labelCounts: Record<string, number> = {};
      for (const c of conversations) {
        if (c.cached_label_list) {
          for (const label of (c.cached_label_list as string).split(',')) {
            const trimmed = label.trim();
            if (trimmed) {
              labelCounts[trimmed] = (labelCounts[trimmed] ?? 0) + 1;
            }
          }
        }
      }
      return { generated: true, report_type, data: { labels: labelCounts } };
    }

    case 'channel_summary': {
      const results = await prisma.$queryRawUnsafe<
        Array<{ channel_type: string; count: bigint }>
      >(
        `SELECT i.channel_type, COUNT(*) as count
         FROM conversations c
         JOIN inboxes i ON i.id = c.inbox_id
         WHERE c.account_id = $1
         GROUP BY i.channel_type`,
        accountId,
      );
      return { generated: true, report_type, data: { channels: results } };
    }

    default:
      return { generated: true, report_type, data: { message: `Unknown report type: ${report_type}` } };
  }
}
