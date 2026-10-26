-- 会话闲置回收时长（按渠道配置）
--
-- 背景：机器人会把会话停在菜单节点上等输入，客户不发 1/4 就永远出不来
--（被动形态尤其明显，一次一问）。有了这个时长，客户最后发言后超过它
-- 仍无新消息，就把会话「回收」：清掉坐席归属与 ITR 流程状态，
-- 下一条消息重新走 on_inbound 的路由（菜单/机器人/排队）。
--
-- 默认 300 秒（5 分钟）；0 = 不回收。
ALTER TABLE "channel_wechat_mp"
    ADD COLUMN IF NOT EXISTS "idle_recycle_seconds" INTEGER NOT NULL DEFAULT 300;

COMMENT ON COLUMN "channel_wechat_mp"."idle_recycle_seconds" IS
    '会话闲置回收时长（秒）：客户最后发言后超过它无新消息则回收会话；0=不回收';
