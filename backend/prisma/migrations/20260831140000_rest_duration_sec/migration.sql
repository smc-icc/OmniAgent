-- 小休申请/审批时长（秒）；申请写入申请值，审批可覆盖
ALTER TABLE "agent_rest_requests" ADD COLUMN IF NOT EXISTS "duration_sec" INTEGER NOT NULL DEFAULT 0;
