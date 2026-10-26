-- 话务小休申请记录
CREATE TABLE IF NOT EXISTS "agent_rest_requests" (
  "id" SERIAL PRIMARY KEY,
  "applicant_user_id" INTEGER NOT NULL,
  "applicant_agent_id" INTEGER NOT NULL,
  "applicant_work_no" TEXT NOT NULL DEFAULT '',
  "applicant_name" TEXT NOT NULL DEFAULT '',
  "leader_user_id" INTEGER,
  "leader_agent_id" INTEGER,
  "leader_work_no" TEXT NOT NULL DEFAULT '',
  "leader_name" TEXT NOT NULL DEFAULT '',
  "content" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_at" TIMESTAMP(3),
  "approve_opinion" TEXT NOT NULL DEFAULT '',
  "aux_code" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_rest_requests_applicant_user_id_fkey"
    FOREIGN KEY ("applicant_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "agent_rest_requests_leader_user_id_fkey"
    FOREIGN KEY ("leader_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "agent_rest_requests_applicant_user_id_requested_at_idx"
  ON "agent_rest_requests"("applicant_user_id", "requested_at");
CREATE INDEX IF NOT EXISTS "agent_rest_requests_applicant_agent_id_requested_at_idx"
  ON "agent_rest_requests"("applicant_agent_id", "requested_at");
CREATE INDEX IF NOT EXISTS "agent_rest_requests_leader_user_id_approved_at_idx"
  ON "agent_rest_requests"("leader_user_id", "approved_at");
CREATE INDEX IF NOT EXISTS "agent_rest_requests_leader_agent_id_approved_at_idx"
  ON "agent_rest_requests"("leader_agent_id", "approved_at");
CREATE INDEX IF NOT EXISTS "agent_rest_requests_status_requested_at_idx"
  ON "agent_rest_requests"("status", "requested_at");
