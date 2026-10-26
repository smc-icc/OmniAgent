-- Omni 全媒体会话单 + 坐席行为流水
CREATE TABLE IF NOT EXISTS "omni_session_records" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL DEFAULT 0,
    "inbox_id" INTEGER NOT NULL DEFAULT 0,
    "contact_id" INTEGER,
    "channel" TEXT NOT NULL DEFAULT 'media',
    "visitor_name" TEXT NOT NULL DEFAULT '',
    "visitor_id" TEXT NOT NULL DEFAULT '',
    "queued_at" TIMESTAMP(3),
    "assigned_at" TIMESTAMP(3),
    "answered_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "wait_sec" INTEGER NOT NULL DEFAULT 0,
    "talk_sec" INTEGER NOT NULL DEFAULT 0,
    "skill_id" INTEGER NOT NULL DEFAULT 0,
    "skill_group_id" INTEGER NOT NULL DEFAULT 0,
    "skill_group_name" TEXT NOT NULL DEFAULT '',
    "vdn_id" INTEGER NOT NULL DEFAULT 0,
    "acd_request_id" INTEGER NOT NULL DEFAULT 0,
    "method" TEXT NOT NULL DEFAULT 'inbound',
    "release_cause" TEXT NOT NULL DEFAULT '',
    "release_reason" TEXT NOT NULL DEFAULT '',
    "assignee_user_id" INTEGER,
    "assignee_work_no" TEXT NOT NULL DEFAULT '',
    "assignee_agent_id" INTEGER NOT NULL DEFAULT 0,
    "assignee_name" TEXT NOT NULL DEFAULT '',
    "extra" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "omni_session_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "omni_session_events" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "session_record_id" INTEGER,
    "account_id" INTEGER NOT NULL DEFAULT 0,
    "event_type" TEXT NOT NULL,
    "actor_user_id" INTEGER,
    "actor_work_no" TEXT NOT NULL DEFAULT '',
    "actor_agent_id" INTEGER NOT NULL DEFAULT 0,
    "actor_name" TEXT NOT NULL DEFAULT '',
    "target_user_id" INTEGER,
    "target_work_no" TEXT NOT NULL DEFAULT '',
    "target_agent_id" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "omni_session_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "omni_session_records_conversation_id_created_at_idx"
  ON "omni_session_records"("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "omni_session_records_contact_id_created_at_idx"
  ON "omni_session_records"("contact_id", "created_at");
CREATE INDEX IF NOT EXISTS "omni_session_records_assignee_user_id_created_at_idx"
  ON "omni_session_records"("assignee_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "omni_session_records_account_id_created_at_idx"
  ON "omni_session_records"("account_id", "created_at");
CREATE INDEX IF NOT EXISTS "omni_session_records_ended_at_idx"
  ON "omni_session_records"("ended_at");

CREATE INDEX IF NOT EXISTS "omni_session_events_conversation_id_created_at_idx"
  ON "omni_session_events"("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "omni_session_events_session_record_id_created_at_idx"
  ON "omni_session_events"("session_record_id", "created_at");
CREATE INDEX IF NOT EXISTS "omni_session_events_event_type_created_at_idx"
  ON "omni_session_events"("event_type", "created_at");
CREATE INDEX IF NOT EXISTS "omni_session_events_actor_user_id_created_at_idx"
  ON "omni_session_events"("actor_user_id", "created_at");

ALTER TABLE "omni_session_records"
  ADD CONSTRAINT "omni_session_records_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "omni_session_events"
  ADD CONSTRAINT "omni_session_events_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "omni_session_events"
  ADD CONSTRAINT "omni_session_events_session_record_id_fkey"
  FOREIGN KEY ("session_record_id") REFERENCES "omni_session_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
