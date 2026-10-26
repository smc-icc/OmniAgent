-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'email',
    "uid" TEXT NOT NULL DEFAULT '',
    "encrypted_password" TEXT NOT NULL DEFAULT '',
    "reset_password_token" TEXT,
    "reset_password_sent_at" TIMESTAMP(3),
    "remember_created_at" TIMESTAMP(3),
    "sign_in_count" INTEGER NOT NULL DEFAULT 0,
    "current_sign_in_at" TIMESTAMP(3),
    "last_sign_in_at" TIMESTAMP(3),
    "current_sign_in_ip" TEXT,
    "last_sign_in_ip" TEXT,
    "confirmation_token" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "confirmation_sent_at" TIMESTAMP(3),
    "unconfirmed_email" TEXT,
    "name" TEXT NOT NULL,
    "display_name" TEXT,
    "email" TEXT,
    "tokens" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "pubsub_token" TEXT,
    "availability" INTEGER NOT NULL DEFAULT 0,
    "ui_settings" JSONB NOT NULL DEFAULT '{}',
    "custom_attributes" JSONB NOT NULL DEFAULT '{}',
    "type" TEXT,
    "message_signature" TEXT,
    "otp_secret" TEXT,
    "consumed_timestep" INTEGER,
    "otp_required_for_login" BOOLEAN NOT NULL DEFAULT false,
    "otp_backup_codes" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "locale" INTEGER NOT NULL DEFAULT 0,
    "domain" VARCHAR(100),
    "support_email" VARCHAR(100),
    "feature_flags" BIGINT NOT NULL DEFAULT 0,
    "auto_resolve_duration" INTEGER,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "custom_attributes" JSONB NOT NULL DEFAULT '{}',
    "status" INTEGER NOT NULL DEFAULT 0,
    "internal_attributes" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_users" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER,
    "user_id" INTEGER,
    "role" INTEGER NOT NULL DEFAULT 0,
    "inviter_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "active_at" TIMESTAMP(3),
    "availability" INTEGER NOT NULL DEFAULT 0,
    "auto_offline" BOOLEAN NOT NULL DEFAULT true,
    "custom_role_id" INTEGER,
    "agent_capacity_policy_id" INTEGER,

    CONSTRAINT "account_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_tokens" (
    "id" SERIAL NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" BIGINT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_saml_settings" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "sso_url" TEXT,
    "certificate" TEXT,
    "sp_entity_id" TEXT,
    "idp_entity_id" TEXT,
    "role_mappings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_saml_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inboxes" (
    "id" SERIAL NOT NULL,
    "channel_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "channel_type" TEXT,
    "enable_auto_assignment" BOOLEAN NOT NULL DEFAULT true,
    "greeting_enabled" BOOLEAN NOT NULL DEFAULT false,
    "greeting_message" TEXT,
    "email_address" TEXT,
    "working_hours_enabled" BOOLEAN NOT NULL DEFAULT false,
    "out_of_office_message" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "enable_email_collect" BOOLEAN NOT NULL DEFAULT true,
    "csat_survey_enabled" BOOLEAN NOT NULL DEFAULT false,
    "allow_messages_after_resolved" BOOLEAN NOT NULL DEFAULT true,
    "auto_assignment_config" JSONB NOT NULL DEFAULT '{}',
    "lock_to_single_conversation" BOOLEAN NOT NULL DEFAULT false,
    "portal_id" INTEGER,
    "sender_name_type" INTEGER NOT NULL DEFAULT 0,
    "business_name" TEXT,
    "csat_config" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "inboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_members" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "inbox_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbox_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_bot_inboxes" (
    "id" SERIAL NOT NULL,
    "inbox_id" INTEGER,
    "agent_bot_id" INTEGER,
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "account_id" INTEGER,

    CONSTRAINT "agent_bot_inboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_bots" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "outgoing_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "account_id" INTEGER,
    "bot_type" INTEGER NOT NULL DEFAULT 0,
    "bot_config" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "agent_bots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_api" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "webhook_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "identifier" TEXT,
    "hmac_token" TEXT,
    "hmac_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "additional_attributes" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "channel_api_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_email" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "forward_to_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "imap_enabled" BOOLEAN NOT NULL DEFAULT false,
    "imap_address" TEXT NOT NULL DEFAULT '',
    "imap_port" INTEGER NOT NULL DEFAULT 0,
    "imap_login" TEXT NOT NULL DEFAULT '',
    "imap_password" TEXT NOT NULL DEFAULT '',
    "imap_enable_ssl" BOOLEAN NOT NULL DEFAULT true,
    "smtp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "smtp_address" TEXT NOT NULL DEFAULT '',
    "smtp_port" INTEGER NOT NULL DEFAULT 0,
    "smtp_login" TEXT NOT NULL DEFAULT '',
    "smtp_password" TEXT NOT NULL DEFAULT '',
    "smtp_domain" TEXT NOT NULL DEFAULT '',
    "smtp_enable_starttls_auto" BOOLEAN NOT NULL DEFAULT true,
    "smtp_authentication" TEXT NOT NULL DEFAULT 'login',
    "smtp_openssl_verify_mode" TEXT NOT NULL DEFAULT 'none',
    "smtp_enable_ssl_tls" BOOLEAN NOT NULL DEFAULT false,
    "provider_config" JSONB NOT NULL DEFAULT '{}',
    "provider" TEXT,
    "verified_for_sending" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "channel_email_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_facebook_pages" (
    "id" SERIAL NOT NULL,
    "page_id" TEXT NOT NULL,
    "user_access_token" TEXT NOT NULL,
    "page_access_token" TEXT NOT NULL,
    "account_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "instagram_id" TEXT,

    CONSTRAINT "channel_facebook_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_twitter_profiles" (
    "id" SERIAL NOT NULL,
    "profile_id" TEXT NOT NULL,
    "twitter_access_token" TEXT NOT NULL,
    "twitter_access_token_secret" TEXT NOT NULL,
    "account_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "tweets_enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "channel_twitter_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_web_widgets" (
    "id" SERIAL NOT NULL,
    "website_url" TEXT,
    "account_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "website_token" TEXT,
    "widget_color" TEXT NOT NULL DEFAULT '#1f93ff',
    "welcome_title" TEXT,
    "welcome_tagline" TEXT,
    "feature_flags" INTEGER NOT NULL DEFAULT 7,
    "reply_time" INTEGER NOT NULL DEFAULT 0,
    "hmac_token" TEXT,
    "pre_chat_form_enabled" BOOLEAN NOT NULL DEFAULT false,
    "pre_chat_form_options" JSONB NOT NULL DEFAULT '{}',
    "hmac_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "continuity_via_email" BOOLEAN NOT NULL DEFAULT true,
    "allowed_domains" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "channel_web_widgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_whatsapp" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "phone_number" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'default',
    "provider_config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "message_templates" JSONB NOT NULL DEFAULT '{}',
    "message_templates_last_updated" TIMESTAMP(3),

    CONSTRAINT "channel_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_sms" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "phone_number" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'default',
    "provider_config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_sms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_twilio_sms" (
    "id" SERIAL NOT NULL,
    "phone_number" TEXT,
    "auth_token" TEXT NOT NULL,
    "account_sid" TEXT NOT NULL,
    "account_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "medium" INTEGER NOT NULL DEFAULT 0,
    "messaging_service_sid" TEXT,
    "api_key_sid" TEXT,
    "content_templates" JSONB NOT NULL DEFAULT '{}',
    "content_templates_last_updated" TIMESTAMP(3),

    CONSTRAINT "channel_twilio_sms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_telegram" (
    "id" SERIAL NOT NULL,
    "bot_name" TEXT,
    "account_id" INTEGER NOT NULL,
    "bot_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_telegram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_line" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "line_channel_id" TEXT NOT NULL,
    "line_channel_secret" TEXT NOT NULL,
    "line_channel_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_instagram" (
    "id" SERIAL NOT NULL,
    "access_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "account_id" INTEGER NOT NULL,
    "instagram_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_instagram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_tiktok" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "business_id" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "refresh_token_expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_tiktok_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_voice" (
    "id" SERIAL NOT NULL,
    "phone_number" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'twilio',
    "provider_config" JSONB NOT NULL,
    "account_id" INTEGER NOT NULL,
    "additional_attributes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_voice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "inbox_id" INTEGER NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "assignee_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "contact_id" INTEGER,
    "display_id" INTEGER NOT NULL,
    "contact_last_seen_at" TIMESTAMP(3),
    "agent_last_seen_at" TIMESTAMP(3),
    "additional_attributes" JSONB NOT NULL DEFAULT '{}',
    "contact_inbox_id" INTEGER,
    "uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    "identifier" TEXT,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "team_id" INTEGER,
    "campaign_id" INTEGER,
    "snoozed_until" TIMESTAMP(3),
    "custom_attributes" JSONB NOT NULL DEFAULT '{}',
    "assignee_last_seen_at" TIMESTAMP(3),
    "first_reply_created_at" TIMESTAMP(3),
    "priority" INTEGER,
    "sla_policy_id" INTEGER,
    "waiting_since" TIMESTAMP(3),
    "cached_label_list" TEXT,
    "assignee_agent_bot_id" INTEGER,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" SERIAL NOT NULL,
    "content" TEXT,
    "account_id" INTEGER NOT NULL,
    "inbox_id" INTEGER NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "message_type" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "private" BOOLEAN NOT NULL DEFAULT false,
    "status" INTEGER NOT NULL DEFAULT 0,
    "source_id" TEXT,
    "content_type" INTEGER NOT NULL DEFAULT 0,
    "content_attributes" JSONB NOT NULL DEFAULT '{}',
    "sender_type" TEXT,
    "sender_id" INTEGER,
    "external_source_ids" JSONB NOT NULL DEFAULT '{}',
    "additional_attributes" JSONB NOT NULL DEFAULT '{}',
    "processed_message_content" TEXT,
    "sentiment" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" SERIAL NOT NULL,
    "file_type" INTEGER NOT NULL DEFAULT 0,
    "external_url" TEXT,
    "coordinates_lat" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "coordinates_long" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "message_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "fallback_title" TEXT,
    "extension" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "email" TEXT,
    "phone_number" TEXT,
    "account_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "additional_attributes" JSONB NOT NULL DEFAULT '{}',
    "identifier" TEXT,
    "custom_attributes" JSONB NOT NULL DEFAULT '{}',
    "last_activity_at" TIMESTAMP(3),
    "contact_type" INTEGER NOT NULL DEFAULT 0,
    "middle_name" TEXT NOT NULL DEFAULT '',
    "last_name" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "country_code" TEXT NOT NULL DEFAULT '',
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "company_id" INTEGER,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "description" TEXT,
    "account_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "contacts_count" INTEGER,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_inboxes" (
    "id" SERIAL NOT NULL,
    "contact_id" INTEGER,
    "inbox_id" INTEGER,
    "source_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "hmac_verified" BOOLEAN NOT NULL DEFAULT false,
    "pubsub_token" TEXT,

    CONSTRAINT "contact_inboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "allow_auto_assign" BOOLEAN NOT NULL DEFAULT true,
    "account_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" SERIAL NOT NULL,
    "team_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labels" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#1f93ff',
    "show_on_sidebar" BOOLEAN,
    "account_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" SERIAL NOT NULL,
    "content" TEXT NOT NULL,
    "account_id" INTEGER NOT NULL,
    "contact_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "event_name" TEXT NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "macros" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" INTEGER,
    "updated_by_id" INTEGER,
    "actions" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "macros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canned_responses" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "short_code" TEXT,
    "content" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canned_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "notification_type" INTEGER NOT NULL,
    "primary_actor_type" TEXT NOT NULL,
    "primary_actor_id" INTEGER NOT NULL,
    "secondary_actor_type" TEXT,
    "secondary_actor_id" INTEGER,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "snoozed_until" TIMESTAMP(3),
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER,
    "user_id" INTEGER,
    "email_flags" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "push_flags" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_subscriptions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "subscription_type" INTEGER NOT NULL,
    "subscription_attributes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "identifier" TEXT,

    CONSTRAINT "notification_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" SERIAL NOT NULL,
    "display_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "message" TEXT NOT NULL,
    "sender_id" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "account_id" INTEGER NOT NULL,
    "inbox_id" INTEGER NOT NULL,
    "trigger_rules" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "campaign_type" INTEGER NOT NULL DEFAULT 0,
    "campaign_status" INTEGER NOT NULL DEFAULT 0,
    "audience" JSONB NOT NULL DEFAULT '[]',
    "scheduled_at" TIMESTAMP(3),
    "trigger_only_during_business_hours" BOOLEAN NOT NULL DEFAULT false,
    "template_params" JSONB,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "csat_survey_responses" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "message_id" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "feedback_message" TEXT,
    "contact_id" INTEGER NOT NULL,
    "assigned_agent_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "csat_review_notes" TEXT,
    "review_notes_updated_at" TIMESTAMP(3),
    "review_notes_updated_by_id" INTEGER,

    CONSTRAINT "csat_survey_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_policies" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "first_response_time_threshold" DOUBLE PRECISION,
    "next_response_time_threshold" DOUBLE PRECISION,
    "only_during_business_hours" BOOLEAN NOT NULL DEFAULT false,
    "account_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "resolution_time_threshold" DOUBLE PRECISION,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applied_slas" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "sla_policy_id" INTEGER NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "sla_status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "applied_slas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_events" (
    "id" SERIAL NOT NULL,
    "applied_sla_id" INTEGER NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "sla_policy_id" INTEGER NOT NULL,
    "inbox_id" INTEGER NOT NULL,
    "event_type" INTEGER,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_attribute_definitions" (
    "id" SERIAL NOT NULL,
    "attribute_display_name" TEXT,
    "attribute_key" TEXT,
    "attribute_display_type" INTEGER NOT NULL DEFAULT 0,
    "default_value" INTEGER,
    "attribute_model" INTEGER NOT NULL DEFAULT 0,
    "account_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "attribute_description" TEXT,
    "attribute_values" JSONB NOT NULL DEFAULT '[]',
    "regex_pattern" TEXT,
    "regex_cue" TEXT,

    CONSTRAINT "custom_attribute_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_filters" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "filter_type" INTEGER NOT NULL DEFAULT 0,
    "query" JSONB NOT NULL DEFAULT '{}',
    "account_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_filters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_roles" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "account_id" INTEGER NOT NULL,
    "permissions" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portals" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "custom_domain" TEXT,
    "color" TEXT,
    "homepage_link" TEXT,
    "page_title" TEXT,
    "header_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{"allowed_locales": ["en"]}',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "channel_web_widget_id" INTEGER,
    "ssl_settings" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "portals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "portal_id" INTEGER NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "position" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "slug" TEXT NOT NULL,
    "parent_category_id" INTEGER,
    "associated_category_id" INTEGER,
    "icon" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "portal_id" INTEGER NOT NULL,
    "category_id" INTEGER,
    "folder_id" INTEGER,
    "title" TEXT,
    "description" TEXT,
    "content" TEXT,
    "status" INTEGER,
    "views" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "author_id" INTEGER,
    "associated_article_id" INTEGER,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "slug" TEXT NOT NULL,
    "position" INTEGER,
    "locale" TEXT NOT NULL DEFAULT 'en',

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "captain_assistants" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "account_id" INTEGER NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "response_guidelines" JSONB NOT NULL DEFAULT '[]',
    "guardrails" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "captain_assistants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "captain_inboxes" (
    "id" SERIAL NOT NULL,
    "captain_assistant_id" INTEGER NOT NULL,
    "inbox_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "captain_inboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "captain_assistant_responses" (
    "id" SERIAL NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "embedding" vector(1536),
    "assistant_id" INTEGER NOT NULL,
    "documentable_id" INTEGER,
    "account_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "documentable_type" TEXT,

    CONSTRAINT "captain_assistant_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "captain_documents" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "external_link" TEXT NOT NULL,
    "content" TEXT,
    "assistant_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "captain_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "captain_scenarios" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "instruction" TEXT,
    "tools" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "assistant_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "captain_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "captain_custom_tools" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "http_method" TEXT NOT NULL DEFAULT 'GET',
    "endpoint_url" TEXT NOT NULL,
    "request_template" TEXT,
    "response_template" TEXT,
    "auth_type" TEXT NOT NULL DEFAULT 'none',
    "auth_config" JSONB NOT NULL DEFAULT '{}',
    "param_schema" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "captain_custom_tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copilot_threads" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "assistant_id" INTEGER,

    CONSTRAINT "copilot_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copilot_messages" (
    "id" SERIAL NOT NULL,
    "copilot_thread_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "message" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "message_type" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "copilot_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_capacity_policies" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "exclusion_rules" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_capacity_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_capacity_limits" (
    "id" SERIAL NOT NULL,
    "agent_capacity_policy_id" INTEGER NOT NULL,
    "inbox_id" INTEGER NOT NULL,
    "conversation_limit" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbox_capacity_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_policies" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "assignment_order" INTEGER NOT NULL DEFAULT 0,
    "conversation_priority" INTEGER NOT NULL DEFAULT 0,
    "fair_distribution_limit" INTEGER NOT NULL DEFAULT 100,
    "fair_distribution_window" INTEGER NOT NULL DEFAULT 3600,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_assignment_policies" (
    "id" SERIAL NOT NULL,
    "inbox_id" INTEGER NOT NULL,
    "assignment_policy_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbox_assignment_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations_hooks" (
    "id" SERIAL NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "inbox_id" INTEGER,
    "account_id" INTEGER,
    "app_id" TEXT,
    "hook_type" INTEGER NOT NULL DEFAULT 0,
    "reference_id" TEXT,
    "access_token" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "integrations_hooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER,
    "inbox_id" INTEGER,
    "url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "webhook_type" INTEGER NOT NULL DEFAULT 0,
    "subscriptions" JSONB NOT NULL DEFAULT '["conversation_status_changed", "conversation_updated", "conversation_created", "contact_created", "contact_updated", "message_created", "message_updated", "webwidget_triggered"]',
    "name" TEXT,
    "secret" TEXT,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "mentioned_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mentions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting_events" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "value" DOUBLE PRECISION,
    "account_id" INTEGER,
    "inbox_id" INTEGER,
    "user_id" INTEGER,
    "conversation_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "value_in_business_hours" DOUBLE PRECISION,
    "event_start_time" TIMESTAMP(3),
    "event_end_time" TIMESTAMP(3),

    CONSTRAINT "reporting_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting_events_rollups" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "dimension_type" TEXT NOT NULL,
    "dimension_id" INTEGER NOT NULL,
    "metric" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "sum_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sum_value_business_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reporting_events_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "working_hours" (
    "id" SERIAL NOT NULL,
    "inbox_id" INTEGER,
    "account_id" INTEGER,
    "day_of_week" INTEGER NOT NULL,
    "closed_all_day" BOOLEAN NOT NULL DEFAULT false,
    "open_hour" INTEGER,
    "open_minutes" INTEGER,
    "close_hour" INTEGER,
    "close_minutes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "open_all_day" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_apps" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL DEFAULT '[]',
    "account_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_imports" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "data_type" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "processing_errors" TEXT,
    "total_records" INTEGER,
    "processed_records" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "account_id" INTEGER,
    "template_type" INTEGER NOT NULL DEFAULT 1,
    "locale" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaves" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "leave_type" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "approved_by_id" INTEGER,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leaves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installation_configs" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "serialized_value" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "installation_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_apps" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_app_permissibles" (
    "id" SERIAL NOT NULL,
    "platform_app_id" INTEGER NOT NULL,
    "permissible_type" TEXT NOT NULL,
    "permissible_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_app_permissibles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audits" (
    "id" SERIAL NOT NULL,
    "auditable_id" INTEGER,
    "auditable_type" TEXT,
    "associated_id" INTEGER,
    "associated_type" TEXT,
    "user_id" INTEGER,
    "user_type" TEXT,
    "username" TEXT,
    "action" TEXT,
    "audited_changes" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "comment" TEXT,
    "remote_address" TEXT,
    "request_uuid" TEXT,
    "created_at" TIMESTAMP(3),

    CONSTRAINT "audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "active_storage_blobs" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT,
    "metadata" TEXT,
    "byte_size" INTEGER NOT NULL,
    "checksum" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "service_name" TEXT NOT NULL,

    CONSTRAINT "active_storage_blobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "active_storage_attachments" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "record_type" TEXT NOT NULL,
    "record_id" INTEGER NOT NULL,
    "blob_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "active_storage_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "active_storage_variant_records" (
    "id" SERIAL NOT NULL,
    "blob_id" INTEGER NOT NULL,
    "variation_digest" TEXT NOT NULL,

    CONSTRAINT "active_storage_variant_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_mailbox_inbound_emails" (
    "id" SERIAL NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "message_id" TEXT NOT NULL,
    "message_checksum" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_mailbox_inbound_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folders" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portals_members" (
    "portal_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "portals_members_pkey" PRIMARY KEY ("portal_id","user_id")
);

-- CreateTable
CREATE TABLE "related_categories" (
    "id" SERIAL NOT NULL,
    "category_id" INTEGER,
    "related_category_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "related_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "taggings_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taggings" (
    "id" SERIAL NOT NULL,
    "tag_id" INTEGER,
    "taggable_type" TEXT,
    "taggable_id" INTEGER,
    "tagger_type" TEXT,
    "tagger_id" INTEGER,
    "context" VARCHAR(128),

    CONSTRAINT "taggings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_embeddings" (
    "id" SERIAL NOT NULL,
    "article_id" INTEGER NOT NULL,
    "term" TEXT NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "article_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "auditable_type" VARCHAR(255) NOT NULL,
    "auditable_id" INTEGER NOT NULL,
    "action" VARCHAR(255) NOT NULL,
    "audited_changes" JSONB NOT NULL DEFAULT '{}',
    "associated_type" VARCHAR(255),
    "associated_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_configs" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "value" TEXT NOT NULL,
    "category" VARCHAR(100) NOT NULL DEFAULT 'general',
    "description" TEXT,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_pubsub_token_key" ON "users"("pubsub_token");

-- CreateIndex
CREATE UNIQUE INDEX "users_otp_secret_key" ON "users"("otp_secret");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "index_users_on_uid_and_provider" ON "users"("uid", "provider");

-- CreateIndex
CREATE INDEX "users_otp_required_for_login_idx" ON "users"("otp_required_for_login");

-- CreateIndex
CREATE INDEX "accounts_status_idx" ON "accounts"("status");

-- CreateIndex
CREATE INDEX "account_users_account_id_idx" ON "account_users"("account_id");

-- CreateIndex
CREATE INDEX "account_users_user_id_idx" ON "account_users"("user_id");

-- CreateIndex
CREATE INDEX "account_users_custom_role_id_idx" ON "account_users"("custom_role_id");

-- CreateIndex
CREATE INDEX "account_users_agent_capacity_policy_id_idx" ON "account_users"("agent_capacity_policy_id");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_user_id_per_account_id" ON "account_users"("account_id", "user_id");

-- CreateIndex
CREATE INDEX "access_tokens_owner_type_owner_id_idx" ON "access_tokens"("owner_type", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "access_tokens_token_key" ON "access_tokens"("token");

-- CreateIndex
CREATE INDEX "account_saml_settings_account_id_idx" ON "account_saml_settings"("account_id");

-- CreateIndex
CREATE INDEX "inboxes_account_id_idx" ON "inboxes"("account_id");

-- CreateIndex
CREATE INDEX "inboxes_channel_id_channel_type_idx" ON "inboxes"("channel_id", "channel_type");

-- CreateIndex
CREATE INDEX "inbox_members_inbox_id_idx" ON "inbox_members"("inbox_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_members_inbox_id_user_id_key" ON "inbox_members"("inbox_id", "user_id");

-- CreateIndex
CREATE INDEX "agent_bots_account_id_idx" ON "agent_bots"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_api_hmac_token_key" ON "channel_api"("hmac_token");

-- CreateIndex
CREATE UNIQUE INDEX "channel_api_identifier_key" ON "channel_api"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "channel_email_email_key" ON "channel_email"("email");

-- CreateIndex
CREATE UNIQUE INDEX "channel_email_forward_to_email_key" ON "channel_email"("forward_to_email");

-- CreateIndex
CREATE INDEX "channel_facebook_pages_page_id_idx" ON "channel_facebook_pages"("page_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_facebook_pages_page_id_account_id_key" ON "channel_facebook_pages"("page_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_twitter_profiles_account_id_profile_id_key" ON "channel_twitter_profiles"("account_id", "profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_web_widgets_hmac_token_key" ON "channel_web_widgets"("hmac_token");

-- CreateIndex
CREATE UNIQUE INDEX "channel_web_widgets_website_token_key" ON "channel_web_widgets"("website_token");

-- CreateIndex
CREATE UNIQUE INDEX "channel_whatsapp_phone_number_key" ON "channel_whatsapp"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "channel_sms_phone_number_key" ON "channel_sms"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "channel_twilio_sms_account_sid_phone_number_key" ON "channel_twilio_sms"("account_sid", "phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "channel_twilio_sms_messaging_service_sid_key" ON "channel_twilio_sms"("messaging_service_sid");

-- CreateIndex
CREATE UNIQUE INDEX "channel_twilio_sms_phone_number_key" ON "channel_twilio_sms"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "channel_telegram_bot_token_key" ON "channel_telegram"("bot_token");

-- CreateIndex
CREATE UNIQUE INDEX "channel_line_line_channel_id_key" ON "channel_line"("line_channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_instagram_instagram_id_key" ON "channel_instagram"("instagram_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_tiktok_business_id_key" ON "channel_tiktok"("business_id");

-- CreateIndex
CREATE INDEX "channel_voice_account_id_idx" ON "channel_voice"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_voice_phone_number_key" ON "channel_voice"("phone_number");

-- CreateIndex
CREATE INDEX "conv_acid_inbid_stat_asgnid_idx" ON "conversations"("account_id", "inbox_id", "status", "assignee_id");

-- CreateIndex
CREATE INDEX "conversations_account_id_idx" ON "conversations"("account_id");

-- CreateIndex
CREATE INDEX "conversations_assignee_id_account_id_idx" ON "conversations"("assignee_id", "account_id");

-- CreateIndex
CREATE INDEX "conversations_campaign_id_idx" ON "conversations"("campaign_id");

-- CreateIndex
CREATE INDEX "conversations_contact_id_idx" ON "conversations"("contact_id");

-- CreateIndex
CREATE INDEX "conversations_contact_inbox_id_idx" ON "conversations"("contact_inbox_id");

-- CreateIndex
CREATE INDEX "conversations_first_reply_created_at_idx" ON "conversations"("first_reply_created_at");

-- CreateIndex
CREATE INDEX "conversations_identifier_account_id_idx" ON "conversations"("identifier", "account_id");

-- CreateIndex
CREATE INDEX "conversations_inbox_id_idx" ON "conversations"("inbox_id");

-- CreateIndex
CREATE INDEX "conversations_priority_idx" ON "conversations"("priority");

-- CreateIndex
CREATE INDEX "conversations_status_account_id_idx" ON "conversations"("status", "account_id");

-- CreateIndex
CREATE INDEX "conversations_status_priority_idx" ON "conversations"("status", "priority");

-- CreateIndex
CREATE INDEX "conversations_team_id_idx" ON "conversations"("team_id");

-- CreateIndex
CREATE INDEX "conversations_waiting_since_idx" ON "conversations"("waiting_since");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_uuid_key" ON "conversations"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_account_id_display_id_key" ON "conversations"("account_id", "display_id");

-- CreateIndex
CREATE INDEX "messages_account_id_idx" ON "messages"("account_id");

-- CreateIndex
CREATE INDEX "messages_account_id_inbox_id_idx" ON "messages"("account_id", "inbox_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_idx" ON "messages"("conversation_id");

-- CreateIndex
CREATE INDEX "messages_inbox_id_idx" ON "messages"("inbox_id");

-- CreateIndex
CREATE INDEX "messages_source_id_idx" ON "messages"("source_id");

-- CreateIndex
CREATE INDEX "messages_created_at_idx" ON "messages"("created_at");

-- CreateIndex
CREATE INDEX "conversation_participants_account_id_idx" ON "conversation_participants"("account_id");

-- CreateIndex
CREATE INDEX "conversation_participants_conversation_id_idx" ON "conversation_participants"("conversation_id");

-- CreateIndex
CREATE INDEX "conversation_participants_user_id_idx" ON "conversation_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_participants_user_id_conversation_id_key" ON "conversation_participants"("user_id", "conversation_id");

-- CreateIndex
CREATE INDEX "attachments_account_id_idx" ON "attachments"("account_id");

-- CreateIndex
CREATE INDEX "attachments_message_id_idx" ON "attachments"("message_id");

-- CreateIndex
CREATE INDEX "contacts_account_id_idx" ON "contacts"("account_id");

-- CreateIndex
CREATE INDEX "contacts_account_id_contact_type_idx" ON "contacts"("account_id", "contact_type");

-- CreateIndex
CREATE INDEX "contacts_account_id_last_activity_at_idx" ON "contacts"("account_id", "last_activity_at" DESC);

-- CreateIndex
CREATE INDEX "contacts_blocked_idx" ON "contacts"("blocked");

-- CreateIndex
CREATE INDEX "contacts_company_id_idx" ON "contacts"("company_id");

-- CreateIndex
CREATE INDEX "contacts_phone_number_account_id_idx" ON "contacts"("phone_number", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_email_per_account_contact" ON "contacts"("email", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_identifier_per_account_contact" ON "contacts"("identifier", "account_id");

-- CreateIndex
CREATE INDEX "companies_account_id_idx" ON "companies"("account_id");

-- CreateIndex
CREATE INDEX "companies_name_account_id_idx" ON "companies"("name", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "index_companies_on_account_and_domain" ON "companies"("account_id", "domain");

-- CreateIndex
CREATE INDEX "contact_inboxes_contact_id_idx" ON "contact_inboxes"("contact_id");

-- CreateIndex
CREATE INDEX "contact_inboxes_inbox_id_idx" ON "contact_inboxes"("inbox_id");

-- CreateIndex
CREATE INDEX "contact_inboxes_pubsub_token_idx" ON "contact_inboxes"("pubsub_token");

-- CreateIndex
CREATE INDEX "contact_inboxes_source_id_idx" ON "contact_inboxes"("source_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_inboxes_inbox_id_source_id_key" ON "contact_inboxes"("inbox_id", "source_id");

-- CreateIndex
CREATE INDEX "teams_account_id_idx" ON "teams"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_name_account_id_key" ON "teams"("name", "account_id");

-- CreateIndex
CREATE INDEX "team_members_team_id_idx" ON "team_members"("team_id");

-- CreateIndex
CREATE INDEX "team_members_user_id_idx" ON "team_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_team_id_user_id_key" ON "team_members"("team_id", "user_id");

-- CreateIndex
CREATE INDEX "labels_account_id_idx" ON "labels"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "labels_title_account_id_key" ON "labels"("title", "account_id");

-- CreateIndex
CREATE INDEX "notes_account_id_idx" ON "notes"("account_id");

-- CreateIndex
CREATE INDEX "notes_contact_id_idx" ON "notes"("contact_id");

-- CreateIndex
CREATE INDEX "notes_user_id_idx" ON "notes"("user_id");

-- CreateIndex
CREATE INDEX "automation_rules_account_id_idx" ON "automation_rules"("account_id");

-- CreateIndex
CREATE INDEX "macros_account_id_idx" ON "macros"("account_id");

-- CreateIndex
CREATE INDEX "notifications_account_id_idx" ON "notifications"("account_id");

-- CreateIndex
CREATE INDEX "idx_notifications_performance" ON "notifications"("user_id", "account_id", "snoozed_until", "read_at");

-- CreateIndex
CREATE INDEX "notifications_last_activity_at_idx" ON "notifications"("last_activity_at");

-- CreateIndex
CREATE UNIQUE INDEX "by_account_user" ON "notification_settings"("account_id", "user_id");

-- CreateIndex
CREATE INDEX "notification_subscriptions_user_id_idx" ON "notification_subscriptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_subscriptions_identifier_key" ON "notification_subscriptions"("identifier");

-- CreateIndex
CREATE INDEX "campaigns_account_id_idx" ON "campaigns"("account_id");

-- CreateIndex
CREATE INDEX "campaigns_campaign_status_idx" ON "campaigns"("campaign_status");

-- CreateIndex
CREATE INDEX "campaigns_campaign_type_idx" ON "campaigns"("campaign_type");

-- CreateIndex
CREATE INDEX "campaigns_inbox_id_idx" ON "campaigns"("inbox_id");

-- CreateIndex
CREATE INDEX "campaigns_scheduled_at_idx" ON "campaigns"("scheduled_at");

-- CreateIndex
CREATE INDEX "csat_survey_responses_account_id_idx" ON "csat_survey_responses"("account_id");

-- CreateIndex
CREATE INDEX "csat_survey_responses_assigned_agent_id_idx" ON "csat_survey_responses"("assigned_agent_id");

-- CreateIndex
CREATE INDEX "csat_survey_responses_contact_id_idx" ON "csat_survey_responses"("contact_id");

-- CreateIndex
CREATE INDEX "csat_survey_responses_conversation_id_idx" ON "csat_survey_responses"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "csat_survey_responses_message_id_key" ON "csat_survey_responses"("message_id");

-- CreateIndex
CREATE INDEX "sla_policies_account_id_idx" ON "sla_policies"("account_id");

-- CreateIndex
CREATE INDEX "applied_slas_account_id_idx" ON "applied_slas"("account_id");

-- CreateIndex
CREATE INDEX "applied_slas_conversation_id_idx" ON "applied_slas"("conversation_id");

-- CreateIndex
CREATE INDEX "applied_slas_sla_policy_id_idx" ON "applied_slas"("sla_policy_id");

-- CreateIndex
CREATE UNIQUE INDEX "index_applied_slas_on_account_sla_policy_conversation" ON "applied_slas"("account_id", "sla_policy_id", "conversation_id");

-- CreateIndex
CREATE INDEX "sla_events_account_id_idx" ON "sla_events"("account_id");

-- CreateIndex
CREATE INDEX "sla_events_applied_sla_id_idx" ON "sla_events"("applied_sla_id");

-- CreateIndex
CREATE INDEX "sla_events_conversation_id_idx" ON "sla_events"("conversation_id");

-- CreateIndex
CREATE INDEX "sla_events_inbox_id_idx" ON "sla_events"("inbox_id");

-- CreateIndex
CREATE INDEX "sla_events_sla_policy_id_idx" ON "sla_events"("sla_policy_id");

-- CreateIndex
CREATE INDEX "custom_attribute_definitions_account_id_idx" ON "custom_attribute_definitions"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_key_model_index" ON "custom_attribute_definitions"("attribute_key", "attribute_model", "account_id");

-- CreateIndex
CREATE INDEX "custom_filters_account_id_idx" ON "custom_filters"("account_id");

-- CreateIndex
CREATE INDEX "custom_filters_user_id_idx" ON "custom_filters"("user_id");

-- CreateIndex
CREATE INDEX "custom_roles_account_id_idx" ON "custom_roles"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "portals_custom_domain_key" ON "portals"("custom_domain");

-- CreateIndex
CREATE UNIQUE INDEX "portals_slug_key" ON "portals"("slug");

-- CreateIndex
CREATE INDEX "categories_locale_idx" ON "categories"("locale");

-- CreateIndex
CREATE INDEX "categories_locale_account_id_idx" ON "categories"("locale", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_locale_portal_id_key" ON "categories"("slug", "locale", "portal_id");

-- CreateIndex
CREATE INDEX "articles_account_id_idx" ON "articles"("account_id");

-- CreateIndex
CREATE INDEX "articles_portal_id_idx" ON "articles"("portal_id");

-- CreateIndex
CREATE INDEX "articles_status_idx" ON "articles"("status");

-- CreateIndex
CREATE INDEX "articles_views_idx" ON "articles"("views");

-- CreateIndex
CREATE UNIQUE INDEX "articles_slug_key" ON "articles"("slug");

-- CreateIndex
CREATE INDEX "captain_assistants_account_id_idx" ON "captain_assistants"("account_id");

-- CreateIndex
CREATE INDEX "captain_inboxes_captain_assistant_id_idx" ON "captain_inboxes"("captain_assistant_id");

-- CreateIndex
CREATE INDEX "captain_inboxes_inbox_id_idx" ON "captain_inboxes"("inbox_id");

-- CreateIndex
CREATE UNIQUE INDEX "captain_inboxes_captain_assistant_id_inbox_id_key" ON "captain_inboxes"("captain_assistant_id", "inbox_id");

-- CreateIndex
CREATE INDEX "captain_assistant_responses_account_id_idx" ON "captain_assistant_responses"("account_id");

-- CreateIndex
CREATE INDEX "captain_assistant_responses_assistant_id_idx" ON "captain_assistant_responses"("assistant_id");

-- CreateIndex
CREATE INDEX "captain_assistant_responses_status_idx" ON "captain_assistant_responses"("status");

-- CreateIndex
CREATE INDEX "captain_documents_account_id_idx" ON "captain_documents"("account_id");

-- CreateIndex
CREATE INDEX "captain_documents_assistant_id_idx" ON "captain_documents"("assistant_id");

-- CreateIndex
CREATE INDEX "captain_documents_status_idx" ON "captain_documents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "captain_documents_assistant_id_external_link_key" ON "captain_documents"("assistant_id", "external_link");

-- CreateIndex
CREATE INDEX "captain_scenarios_account_id_idx" ON "captain_scenarios"("account_id");

-- CreateIndex
CREATE INDEX "captain_scenarios_assistant_id_enabled_idx" ON "captain_scenarios"("assistant_id", "enabled");

-- CreateIndex
CREATE INDEX "captain_scenarios_assistant_id_idx" ON "captain_scenarios"("assistant_id");

-- CreateIndex
CREATE INDEX "captain_scenarios_enabled_idx" ON "captain_scenarios"("enabled");

-- CreateIndex
CREATE INDEX "captain_custom_tools_account_id_idx" ON "captain_custom_tools"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "captain_custom_tools_account_id_slug_key" ON "captain_custom_tools"("account_id", "slug");

-- CreateIndex
CREATE INDEX "copilot_threads_account_id_idx" ON "copilot_threads"("account_id");

-- CreateIndex
CREATE INDEX "copilot_threads_assistant_id_idx" ON "copilot_threads"("assistant_id");

-- CreateIndex
CREATE INDEX "copilot_threads_user_id_idx" ON "copilot_threads"("user_id");

-- CreateIndex
CREATE INDEX "copilot_messages_account_id_idx" ON "copilot_messages"("account_id");

-- CreateIndex
CREATE INDEX "copilot_messages_copilot_thread_id_idx" ON "copilot_messages"("copilot_thread_id");

-- CreateIndex
CREATE INDEX "agent_capacity_policies_account_id_idx" ON "agent_capacity_policies"("account_id");

-- CreateIndex
CREATE INDEX "inbox_capacity_limits_agent_capacity_policy_id_idx" ON "inbox_capacity_limits"("agent_capacity_policy_id");

-- CreateIndex
CREATE INDEX "inbox_capacity_limits_inbox_id_idx" ON "inbox_capacity_limits"("inbox_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_capacity_limits_agent_capacity_policy_id_inbox_id_key" ON "inbox_capacity_limits"("agent_capacity_policy_id", "inbox_id");

-- CreateIndex
CREATE INDEX "assignment_policies_account_id_idx" ON "assignment_policies"("account_id");

-- CreateIndex
CREATE INDEX "assignment_policies_enabled_idx" ON "assignment_policies"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_policies_account_id_name_key" ON "assignment_policies"("account_id", "name");

-- CreateIndex
CREATE INDEX "inbox_assignment_policies_assignment_policy_id_idx" ON "inbox_assignment_policies"("assignment_policy_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_assignment_policies_inbox_id_key" ON "inbox_assignment_policies"("inbox_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhooks_account_id_url_key" ON "webhooks"("account_id", "url");

-- CreateIndex
CREATE INDEX "mentions_account_id_idx" ON "mentions"("account_id");

-- CreateIndex
CREATE INDEX "mentions_conversation_id_idx" ON "mentions"("conversation_id");

-- CreateIndex
CREATE INDEX "mentions_user_id_idx" ON "mentions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mentions_user_id_conversation_id_key" ON "mentions"("user_id", "conversation_id");

-- CreateIndex
CREATE INDEX "reporting_events__account_id__name__created_at" ON "reporting_events"("account_id", "name", "created_at");

-- CreateIndex
CREATE INDEX "reporting_events_account_id_idx" ON "reporting_events"("account_id");

-- CreateIndex
CREATE INDEX "reporting_events_conversation_id_idx" ON "reporting_events"("conversation_id");

-- CreateIndex
CREATE INDEX "reporting_events_created_at_idx" ON "reporting_events"("created_at");

-- CreateIndex
CREATE INDEX "reporting_events_inbox_id_idx" ON "reporting_events"("inbox_id");

-- CreateIndex
CREATE INDEX "reporting_events_name_idx" ON "reporting_events"("name");

-- CreateIndex
CREATE INDEX "reporting_events_user_id_idx" ON "reporting_events"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "index_rollup_unique_key" ON "reporting_events_rollups"("account_id", "date", "dimension_type", "dimension_id", "metric");

-- CreateIndex
CREATE INDEX "working_hours_account_id_idx" ON "working_hours"("account_id");

-- CreateIndex
CREATE INDEX "working_hours_inbox_id_idx" ON "working_hours"("inbox_id");

-- CreateIndex
CREATE INDEX "dashboard_apps_account_id_idx" ON "dashboard_apps"("account_id");

-- CreateIndex
CREATE INDEX "dashboard_apps_user_id_idx" ON "dashboard_apps"("user_id");

-- CreateIndex
CREATE INDEX "data_imports_account_id_idx" ON "data_imports"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_templates_name_account_id_key" ON "email_templates"("name", "account_id");

-- CreateIndex
CREATE INDEX "leaves_account_id_status_idx" ON "leaves"("account_id", "status");

-- CreateIndex
CREATE INDEX "leaves_account_id_idx" ON "leaves"("account_id");

-- CreateIndex
CREATE INDEX "leaves_approved_by_id_idx" ON "leaves"("approved_by_id");

-- CreateIndex
CREATE INDEX "leaves_user_id_idx" ON "leaves"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "installation_configs_name_created_at_key" ON "installation_configs"("name", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "installation_configs_name_key" ON "installation_configs"("name");

-- CreateIndex
CREATE INDEX "index_platform_app_permissibles_on_permissibles" ON "platform_app_permissibles"("permissible_type", "permissible_id");

-- CreateIndex
CREATE INDEX "platform_app_permissibles_platform_app_id_idx" ON "platform_app_permissibles"("platform_app_id");

-- CreateIndex
CREATE UNIQUE INDEX "unique_permissibles_index" ON "platform_app_permissibles"("platform_app_id", "permissible_id", "permissible_type");

-- CreateIndex
CREATE INDEX "associated_index" ON "audits"("associated_type", "associated_id");

-- CreateIndex
CREATE INDEX "auditable_index" ON "audits"("auditable_type", "auditable_id", "version");

-- CreateIndex
CREATE INDEX "audits_created_at_idx" ON "audits"("created_at");

-- CreateIndex
CREATE INDEX "audits_request_uuid_idx" ON "audits"("request_uuid");

-- CreateIndex
CREATE INDEX "user_index" ON "audits"("user_id", "user_type");

-- CreateIndex
CREATE UNIQUE INDEX "active_storage_blobs_key_key" ON "active_storage_blobs"("key");

-- CreateIndex
CREATE INDEX "active_storage_attachments_blob_id_idx" ON "active_storage_attachments"("blob_id");

-- CreateIndex
CREATE UNIQUE INDEX "active_storage_attachments_record_type_record_id_name_blob__key" ON "active_storage_attachments"("record_type", "record_id", "name", "blob_id");

-- CreateIndex
CREATE UNIQUE INDEX "active_storage_variant_records_blob_id_variation_digest_key" ON "active_storage_variant_records"("blob_id", "variation_digest");

-- CreateIndex
CREATE UNIQUE INDEX "action_mailbox_inbound_emails_message_id_message_checksum_key" ON "action_mailbox_inbound_emails"("message_id", "message_checksum");

-- CreateIndex
CREATE INDEX "portals_members_portal_id_idx" ON "portals_members"("portal_id");

-- CreateIndex
CREATE INDEX "portals_members_user_id_idx" ON "portals_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "related_categories_category_id_related_category_id_key" ON "related_categories"("category_id", "related_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "related_categories_related_category_id_category_id_key" ON "related_categories"("related_category_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE INDEX "taggings_context_idx" ON "taggings"("context");

-- CreateIndex
CREATE INDEX "taggings_tag_id_idx" ON "taggings"("tag_id");

-- CreateIndex
CREATE INDEX "taggings_taggable_id_taggable_type_context_idx" ON "taggings"("taggable_id", "taggable_type", "context");

-- CreateIndex
CREATE INDEX "taggings_taggable_id_idx" ON "taggings"("taggable_id");

-- CreateIndex
CREATE INDEX "taggings_taggable_type_idx" ON "taggings"("taggable_type");

-- CreateIndex
CREATE INDEX "taggings_tagger_id_tagger_type_idx" ON "taggings"("tagger_id", "tagger_type");

-- CreateIndex
CREATE INDEX "taggings_tagger_id_idx" ON "taggings"("tagger_id");

-- CreateIndex
CREATE UNIQUE INDEX "taggings_idx" ON "taggings"("tag_id", "taggable_id", "taggable_type", "context", "tagger_id", "tagger_type");

-- CreateIndex
CREATE INDEX "audit_logs_account_id_idx" ON "audit_logs"("account_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_auditable_type_auditable_id_idx" ON "audit_logs"("auditable_type", "auditable_id");

-- CreateIndex
CREATE INDEX "audit_logs_associated_type_associated_id_idx" ON "audit_logs"("associated_type", "associated_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "platform_configs_key_key" ON "platform_configs"("key");

-- CreateIndex
CREATE INDEX "platform_configs_category_idx" ON "platform_configs"("category");

-- AddForeignKey
ALTER TABLE "account_users" ADD CONSTRAINT "account_users_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_users" ADD CONSTRAINT "account_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_users" ADD CONSTRAINT "account_users_custom_role_id_fkey" FOREIGN KEY ("custom_role_id") REFERENCES "custom_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_users" ADD CONSTRAINT "account_users_agent_capacity_policy_id_fkey" FOREIGN KEY ("agent_capacity_policy_id") REFERENCES "agent_capacity_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_saml_settings" ADD CONSTRAINT "account_saml_settings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inboxes" ADD CONSTRAINT "inboxes_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inboxes" ADD CONSTRAINT "inboxes_portal_id_fkey" FOREIGN KEY ("portal_id") REFERENCES "portals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_members" ADD CONSTRAINT "inbox_members_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_members" ADD CONSTRAINT "inbox_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_bot_inboxes" ADD CONSTRAINT "agent_bot_inboxes_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_bot_inboxes" ADD CONSTRAINT "agent_bot_inboxes_agent_bot_id_fkey" FOREIGN KEY ("agent_bot_id") REFERENCES "agent_bots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_bots" ADD CONSTRAINT "agent_bots_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_inbox_id_fkey" FOREIGN KEY ("contact_inbox_id") REFERENCES "contact_inboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_sla_policy_id_fkey" FOREIGN KEY ("sla_policy_id") REFERENCES "sla_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_inboxes" ADD CONSTRAINT "contact_inboxes_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_inboxes" ADD CONSTRAINT "contact_inboxes_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "macros" ADD CONSTRAINT "macros_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "macros" ADD CONSTRAINT "macros_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "macros" ADD CONSTRAINT "macros_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "csat_survey_responses" ADD CONSTRAINT "csat_survey_responses_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "csat_survey_responses" ADD CONSTRAINT "csat_survey_responses_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "csat_survey_responses" ADD CONSTRAINT "csat_survey_responses_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "csat_survey_responses" ADD CONSTRAINT "csat_survey_responses_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "csat_survey_responses" ADD CONSTRAINT "csat_survey_responses_assigned_agent_id_fkey" FOREIGN KEY ("assigned_agent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applied_slas" ADD CONSTRAINT "applied_slas_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applied_slas" ADD CONSTRAINT "applied_slas_sla_policy_id_fkey" FOREIGN KEY ("sla_policy_id") REFERENCES "sla_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applied_slas" ADD CONSTRAINT "applied_slas_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_events" ADD CONSTRAINT "sla_events_applied_sla_id_fkey" FOREIGN KEY ("applied_sla_id") REFERENCES "applied_slas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_events" ADD CONSTRAINT "sla_events_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_events" ADD CONSTRAINT "sla_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_events" ADD CONSTRAINT "sla_events_sla_policy_id_fkey" FOREIGN KEY ("sla_policy_id") REFERENCES "sla_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_events" ADD CONSTRAINT "sla_events_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_attribute_definitions" ADD CONSTRAINT "custom_attribute_definitions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_filters" ADD CONSTRAINT "custom_filters_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_filters" ADD CONSTRAINT "custom_filters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portals" ADD CONSTRAINT "portals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_portal_id_fkey" FOREIGN KEY ("portal_id") REFERENCES "portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_portal_id_fkey" FOREIGN KEY ("portal_id") REFERENCES "portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captain_assistants" ADD CONSTRAINT "captain_assistants_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captain_inboxes" ADD CONSTRAINT "captain_inboxes_captain_assistant_id_fkey" FOREIGN KEY ("captain_assistant_id") REFERENCES "captain_assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captain_inboxes" ADD CONSTRAINT "captain_inboxes_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captain_assistant_responses" ADD CONSTRAINT "captain_assistant_responses_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captain_assistant_responses" ADD CONSTRAINT "captain_assistant_responses_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "captain_assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captain_documents" ADD CONSTRAINT "captain_documents_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captain_documents" ADD CONSTRAINT "captain_documents_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "captain_assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captain_scenarios" ADD CONSTRAINT "captain_scenarios_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captain_scenarios" ADD CONSTRAINT "captain_scenarios_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "captain_assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captain_custom_tools" ADD CONSTRAINT "captain_custom_tools_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_threads" ADD CONSTRAINT "copilot_threads_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_threads" ADD CONSTRAINT "copilot_threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_messages" ADD CONSTRAINT "copilot_messages_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_messages" ADD CONSTRAINT "copilot_messages_copilot_thread_id_fkey" FOREIGN KEY ("copilot_thread_id") REFERENCES "copilot_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_capacity_policies" ADD CONSTRAINT "agent_capacity_policies_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_capacity_limits" ADD CONSTRAINT "inbox_capacity_limits_agent_capacity_policy_id_fkey" FOREIGN KEY ("agent_capacity_policy_id") REFERENCES "agent_capacity_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_capacity_limits" ADD CONSTRAINT "inbox_capacity_limits_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_policies" ADD CONSTRAINT "assignment_policies_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_assignment_policies" ADD CONSTRAINT "inbox_assignment_policies_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_assignment_policies" ADD CONSTRAINT "inbox_assignment_policies_assignment_policy_id_fkey" FOREIGN KEY ("assignment_policy_id") REFERENCES "assignment_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations_hooks" ADD CONSTRAINT "integrations_hooks_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_events" ADD CONSTRAINT "reporting_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_events" ADD CONSTRAINT "reporting_events_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_events" ADD CONSTRAINT "reporting_events_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_events_rollups" ADD CONSTRAINT "reporting_events_rollups_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_apps" ADD CONSTRAINT "dashboard_apps_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_apps" ADD CONSTRAINT "dashboard_apps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_app_permissibles" ADD CONSTRAINT "platform_app_permissibles_platform_app_id_fkey" FOREIGN KEY ("platform_app_id") REFERENCES "platform_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_storage_attachments" ADD CONSTRAINT "active_storage_attachments_blob_id_fkey" FOREIGN KEY ("blob_id") REFERENCES "active_storage_blobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_storage_variant_records" ADD CONSTRAINT "active_storage_variant_records_blob_id_fkey" FOREIGN KEY ("blob_id") REFERENCES "active_storage_blobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taggings" ADD CONSTRAINT "taggings_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE SET NULL ON UPDATE CASCADE;
