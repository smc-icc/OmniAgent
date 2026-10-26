-- 公众号渠道能力开关
--
-- 背景：未认证公众号（含个人订阅号、未认证企业订阅号）没有「客服消息」权限，
-- 主动推送必然失败；只能走「用户发言后在 5 秒内被动回复一条」这条路。
-- 与其在代码里写死「个人订阅号」，不如把「有没有客服消息权限」抽象成渠道级能力位：
--   supports_active_reply = false  → 不发客服消息，改为被动回复 + 积压队列 + 精简菜单
--   supports_active_reply = true   → 维持原有主动推送 + 完整菜单
-- 认证通过后只改这一项即可切回主动推送，不需要改代码或重新部署。
--
-- 其余渠道（Widget/API/小程序/微博/邮件/短信/企微客服）出站不经微信客服消息 API，
-- 不受此开关影响。
ALTER TABLE "channel_wechat_mp"
    ADD COLUMN IF NOT EXISTS "supports_active_reply" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "passive_reply_enabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "route_ttl_seconds" INTEGER NOT NULL DEFAULT 300,
    ADD COLUMN IF NOT EXISTS "pending_reply_max" INTEGER NOT NULL DEFAULT 20;

COMMENT ON COLUMN "channel_wechat_mp"."supports_active_reply" IS
    '是否具备「客服消息」权限：认证服务号/认证订阅号 true；未认证（含个人订阅号）false';
COMMENT ON COLUMN "channel_wechat_mp"."passive_reply_enabled" IS
    '无客服消息权限时启用被动回复 + 积压队列；supports_active_reply=false 时才有意义';
COMMENT ON COLUMN "channel_wechat_mp"."route_ttl_seconds" IS
    '被动回复菜单路由记录 TTL（秒），默认 300';
COMMENT ON COLUMN "channel_wechat_mp"."pending_reply_max" IS
    '待回复积压队列上限（条），超出丢弃最旧的，默认 20';
