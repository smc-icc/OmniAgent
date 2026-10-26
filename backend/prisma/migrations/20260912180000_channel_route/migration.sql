-- 「路由」实体：统一承接进线 / ITR 决策 / ACD 结果 / 坐席超时 / 会话结束的分发规则
--
-- 背景：路由信息此前散在三处 —— 渠道字段（reply_timeout_flow_id）、会话属性
-- （itr_flow_id）、ITR 流程内部的 staff_service 节点参数。想新增一种目标
--（坐席 / 机器人坐席 / ACD 分组）就必须改代码。这里把它抽成一张表：
-- 某渠道 + 某触发点 → 按 priority 升序依次尝试的候选目标（失败降级）。
CREATE TABLE IF NOT EXISTS "channel_route" (
    "id"              SERIAL PRIMARY KEY,
    "channel_id"      INTEGER NOT NULL,
    "trigger"         TEXT NOT NULL,
    "priority"        INTEGER NOT NULL DEFAULT 0,
    "app_type"        TEXT NOT NULL,
    "flow_id"         INTEGER NOT NULL DEFAULT 0,
    "agent_id"        INTEGER NOT NULL DEFAULT 0,
    "robot_id"        INTEGER NOT NULL DEFAULT 0,
    "agent_group_id"  INTEGER NOT NULL DEFAULT 0,
    "skill_id"        INTEGER NOT NULL DEFAULT 0,
    "media_type"      INTEGER NOT NULL DEFAULT 0,
    "line_priority"   INTEGER NOT NULL DEFAULT 0,
    "timeout_seconds" INTEGER NOT NULL DEFAULT 0,
    "enabled"         BOOLEAN NOT NULL DEFAULT true,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "channel_route_channel_id_trigger_priority_idx"
    ON "channel_route" ("channel_id", "trigger", "priority");

-- 数据迁移：把现有渠道上的「坐席回复超时流程」搬成 on_agent_no_reply 的一条候选。
-- 行为不变 —— 旧字段保留，读取时以本表优先、无记录再回退旧字段，便于回滚。
INSERT INTO "channel_route" ("channel_id", "trigger", "priority", "app_type", "flow_id", "enabled")
SELECT c."id", 'on_agent_no_reply', 0, 'itr', c."reply_timeout_flow_id", true
FROM "channel_wechat_mp" c
WHERE c."reply_timeout_flow_id" > 0
  AND NOT EXISTS (
      SELECT 1 FROM "channel_route" r
      WHERE r."channel_id" = c."id" AND r."trigger" = 'on_agent_no_reply'
  );
