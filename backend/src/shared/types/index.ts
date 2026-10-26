/**
 * Shared type definitions that mirror Chatwoot's API response structures.
 * These are the canonical types for the entire backend.
 */

// ── User / Agent ──
export interface UserPayload {
  id: number;
  email: string;
  name: string;
  avatar_url?: string;
  custom_role_id?: number;
  confirmed: boolean;
}

export interface AgentPayload extends UserPayload {
  role: string;
  availability_status: 'online' | 'offline' | 'busy';
  auto_offline: boolean;
}

// ── Account ──
export interface AccountPayload {
  id: number;
  name: string;
  locale: string;
  domain?: string;
  support_email?: string;
  auto_resolve_duration?: number;
  custom_attributes: Record<string, unknown>;
}

// ── Inbox ──
export interface InboxPayload {
  id: number;
  name: string;
  channel_type: string;
  avatar_url?: string;
  enable_auto_assignment: boolean;
  greeting_enabled: boolean;
  greeting_message?: string;
  working_hours_enabled: boolean;
}

// ── Conversation ──
export interface ConversationPayload {
  id: number;
  account_id: number;
  inbox_id: number;
  status: 'open' | 'resolved' | 'pending' | 'snoozed';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  contact_last_seen_at?: number;
  agent_last_seen_at?: number;
  additional_attributes: Record<string, unknown>;
  created_at: number;
}

// ── Message ──
export interface MessagePayload {
  id: number;
  content: string;
  message_type: 'incoming' | 'outgoing' | 'activity' | 'template';
  content_type: 'text' | 'input_select' | 'cards' | 'form';
  content_attributes: Record<string, unknown>;
  private: boolean;
  sender_type: 'User' | 'Contact' | 'AgentBot';
  sender_id: number;
  created_at: number;
}

// ── Contact ──
export interface ContactPayload {
  id: number;
  name: string;
  email?: string;
  phone_number?: string;
  identifier?: string;
  thumbnail?: string;
  additional_attributes: Record<string, unknown>;
  created_at: number;
}

// ── Team ──
export interface TeamPayload {
  id: number;
  name: string;
  description?: string;
  allow_auto_assign: boolean;
  account_id: number;
}

// ── API Response Envelope (Chatwoot format) ──
export interface ApiResponse<T = unknown> {
  [key: string]: T;
}

export interface ApiListResponse<T = unknown> {
  payload: T[];
  meta?: {
    current_page: number;
    total_count: number;
  };
}

export interface ApiErrorResponse {
  error: string;
  error_code?: string;
  errors?: string[];
  message?: string;
}

// ── Pagination ──
export interface PaginationParams {
  page?: number;
  per_page?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}
