-- 路由加「渠道类型」维度
--
-- 背景：channel_route 原先只有 channel_id，注释里写的也是「关联 channel_wechat_mp.id」。
-- 但 Omni 里每种渠道一张表，主键各自从 1 开始 —— channel_wechat_mp 有 id=1（海米云微信企业号测试），
-- channel_wecom_kf 也有 id=1（海米云微信客服）。只靠 channel_id 查路由必然串味：
-- 给微信客服配的「进线流程」会命中公众号的会话。
--
-- 加上 channel_type 后，路由按 (channel_type, channel_id) 定位到唯一的渠道实例。
-- 存量数据都是公众号的，所以默认值取 wechat_mp，无需回填。
ALTER TABLE "channel_route"
    ADD COLUMN IF NOT EXISTS "channel_type" TEXT NOT NULL DEFAULT 'wechat_mp';

COMMENT ON COLUMN "channel_route"."channel_type" IS
    '渠道类型：wechat_mp | wecom_kf | wecom_contact（与 channel_id 一起定位渠道实例）';

-- 查路由的主路径是 (channel_type, channel_id, trigger, enabled) 按 priority 排序。
-- 原先只有 (channel_id, trigger, priority) 的索引，补上类型维度。
DROP INDEX IF EXISTS "channel_route_channel_id_trigger_priority_idx";
CREATE INDEX IF NOT EXISTS "channel_route_type_channel_trigger_priority_idx"
    ON "channel_route" ("channel_type", "channel_id", "trigger", "priority");
