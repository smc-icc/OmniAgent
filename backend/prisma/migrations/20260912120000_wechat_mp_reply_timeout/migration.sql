-- 坐席回复超时（按渠道配置）
--
-- 背景：客户发言后有且仅有一次「被动回复」窗口（微信硬限制 5 秒）。坐席在这个窗口里
-- 没回出内容，就等于「回复超时」——会话被坐席拿住、客户却一直等不到任何东西。
-- 处理方式：把会话收回给 ITR，走这个渠道配置的超时流程（例如回「坐席正忙，请输入你的问题」）。
--
-- 「能主动推送」（认证号）和「只能被动回复」（未认证订阅号）两种渠道形态都存在回复超时，
-- 区别只在超时后挂哪个流程，所以超时流程做成渠道级配置。
--
-- 默认值 0 表示不启用，保证既有渠道行为不变。
ALTER TABLE "channel_wechat_mp"
    ADD COLUMN IF NOT EXISTS "reply_timeout_seconds" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "reply_timeout_flow_id" INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN "channel_wechat_mp"."reply_timeout_seconds" IS
    '坐席回复超时（秒）；0=不启用。客户发言窗口内坐席没回内容即视为超时';
COMMENT ON COLUMN "channel_wechat_mp"."reply_timeout_flow_id" IS
    '回复超时后启动的 ITR 流程 id；0=不处理';
