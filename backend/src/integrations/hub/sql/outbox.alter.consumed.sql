-- 已有 outbox 表补 ConsumedAt（幂等：先查 information_schema 再执行，见 cutover-check）
-- 未投递成功的行禁止按年龄删除。

ALTER TABLE t_icc_outbox_event
  ADD COLUMN ConsumedAt DATETIME(3) DEFAULT NULL COMMENT '投递完成（含 DLQ）时间；归档前保留' AFTER ClaimedAt;

ALTER TABLE t_icc_outbox_event
  ADD KEY idx_consumed (ConsumedAt);
