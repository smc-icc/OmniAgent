import type { FastifyInstance } from 'fastify';
import {
  listNotifications, updateNotification, destroyNotification,
  readAllNotifications, destroyAllNotifications, unreadNotificationCount,
  snoozeNotification, unreadNotification,
  showNotificationSettings, updateNotificationSettings,
  searchAll,
  reportSummary, reportBotSummary, reportAgents, reportInboxes, reportLabels, reportTeams,
  reportConversations, reportConversationsSummary, reportConversationTraffic,
  reportBotMetrics, reportInboxLabelMatrix, reportFirstResponseTime, reportOutgoingMessages,
  summaryReportAgent, summaryReportTeam, summaryReportInbox, summaryReportLabel, summaryReportChannel,
  liveConversationMetrics, liveGroupedMetrics,
  yearInReview, showAuditLogs,
} from './notifications.controller.js';

export async function notificationsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };
  const base = '/api/v1/accounts/:account_id';
  const v2 = '/api/v2/accounts/:account_id';

  // ── Notifications ──
  fastify.get(`${base}/notifications`, auth, listNotifications);
  fastify.put(`${base}/notifications/:id`, auth, updateNotification);
  fastify.delete(`${base}/notifications/:id`, auth, destroyNotification);
  fastify.post(`${base}/notifications/read_all`, auth, readAllNotifications);
  fastify.post(`${base}/notifications/destroy_all`, auth, destroyAllNotifications);
  fastify.get(`${base}/notifications/unread_count`, auth, unreadNotificationCount);
  fastify.post(`${base}/notifications/:id/snooze`, auth, snoozeNotification);
  fastify.post(`${base}/notifications/:id/unread`, auth, unreadNotification);

  // Notification Settings
  fastify.get(`${base}/notification_settings`, auth, showNotificationSettings);
  fastify.put(`${base}/notification_settings`, auth, updateNotificationSettings);

  // ── Search ──
  fastify.get(`${base}/search`, auth, searchAll);

  // ── Reports V2 ──
  fastify.get(`${v2}/reports/summary`, auth, reportSummary);
  fastify.get(`${v2}/reports/bot_summary`, auth, reportBotSummary);
  fastify.get(`${v2}/reports/agents`, auth, reportAgents);
  fastify.get(`${v2}/reports/inboxes`, auth, reportInboxes);
  fastify.get(`${v2}/reports/labels`, auth, reportLabels);
  fastify.get(`${v2}/reports/teams`, auth, reportTeams);
  fastify.get(`${v2}/reports/conversations`, auth, reportConversations);
  fastify.get(`${v2}/reports/conversations_summary`, auth, reportConversationsSummary);
  fastify.get(`${v2}/reports/conversation_traffic`, auth, reportConversationTraffic);
  fastify.get(`${v2}/reports/bot_metrics`, auth, reportBotMetrics);
  fastify.get(`${v2}/reports/inbox_label_matrix`, auth, reportInboxLabelMatrix);
  fastify.get(`${v2}/reports/first_response_time_distribution`, auth, reportFirstResponseTime);
  fastify.get(`${v2}/reports/outgoing_messages_count`, auth, reportOutgoingMessages);

  // Summary Reports V2
  fastify.get(`${v2}/summary_reports/agent`, auth, summaryReportAgent);
  fastify.get(`${v2}/summary_reports/team`, auth, summaryReportTeam);
  fastify.get(`${v2}/summary_reports/inbox`, auth, summaryReportInbox);
  fastify.get(`${v2}/summary_reports/label`, auth, summaryReportLabel);
  fastify.get(`${v2}/summary_reports/channel`, auth, summaryReportChannel);

  // Live Reports
  fastify.get(`${v2}/live_reports/conversation_metrics`, auth, liveConversationMetrics);
  fastify.get(`${v2}/live_reports/grouped_conversation_metrics`, auth, liveGroupedMetrics);

  // Year in Review
  fastify.get(`${v2}/year_in_review`, auth, yearInReview);

  // Audit Logs
  fastify.get(`${base}/audit_logs`, auth, showAuditLogs);
}
