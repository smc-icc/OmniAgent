-- 第二级回复超时（按渠道配置，不写死在代码里）
--
-- 一级：客户发言后 reply_timeout_seconds 内坐席没回 → 发「请继续等待」类安抚提示。
-- 二级：再等到 reply_timeout_level2_seconds 坐席仍未回 → 把提示升级为
--       「引导留言 / 按 9 转留言」（由超时流程用 var.timeoutLevel==2 分流）。
--
-- 注意适用性：二级只对「能主动推送」的渠道形态有效。被动回复（未认证订阅号）
-- 只有客户发言后的一个窗口，无法在 30 秒后主动联系客户 —— 那条路径只能等
-- 客户下次发言时把提示带回。
--
-- 默认 0 = 不启用二级，保证既有渠道行为不变。
ALTER TABLE "channel_wechat_mp"
    ADD COLUMN IF NOT EXISTS "reply_timeout_level2_seconds" INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN "channel_wechat_mp"."reply_timeout_level2_seconds" IS
    '第二级回复超时（秒），0=不启用；仅主动推送形态有效';
