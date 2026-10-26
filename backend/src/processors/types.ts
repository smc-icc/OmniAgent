/** Shared job payload types for BullMQ processors. */

export interface ConversationReplyEmailJob {
  to: string;
  subject: string;
  html: string;
}

export interface WebhookJob {
  url?: string;
  event?: string;
  payload?: unknown;
  headers?: Record<string, string>;
  account_id?: number;
  conversation_id?: number;
  message_id?: number;
}

export interface NotificationJob {
  account_id: number;
  user_ids: number[];
  notification_type: string;
  meta: Record<string, unknown>;
}

export interface ReportJob {
  account_id: number;
  report_type: string;
  params?: Record<string, unknown>;
}

export interface ImportJob {
  account_id: number;
  data_type: string;
  file_path: string;
  user_id?: number;
}

export interface ConversationJob {
  account_id: number;
  conversation_id?: number;
  conversation_ids?: number[];
  message_id?: number;
  assistant_id?: number | null;
  action: string;
  fields?: Record<string, unknown>;
  labels?: { add?: string[]; remove?: string[] };
}
