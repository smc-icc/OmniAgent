-- 被动回复积压的存活时长（按渠道配置）
--
-- 背景：无客服消息权限的渠道上，坐席发出的内容送不出去，会压进积压队列，
-- 等客户下次发言时随被动回复带回。但如果积压放了几小时，客户下次发言就会
-- 莫名其妙收到一条陈旧内容 —— 实测遇到过：客户发「测试」，收到的却是两小时前
-- 的一条「？」。所以给积压加上存活时长：超过它的一律视为陈旧，取回时直接丢弃。
--
-- 默认 300 秒；0 = 不过期（保留旧行为）。
ALTER TABLE "channel_wechat_mp"
    ADD COLUMN IF NOT EXISTS "pending_ttl_seconds" INTEGER NOT NULL DEFAULT 300;

COMMENT ON COLUMN "channel_wechat_mp"."pending_ttl_seconds" IS
    '被动回复积压存活时长（秒），超期视为陈旧丢弃；0=不过期';
