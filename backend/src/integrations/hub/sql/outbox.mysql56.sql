-- MySQL 5.6：无 JSON 类型时用 MEDIUMTEXT
-- 未投递成功的行禁止按年龄删除；仅投递成功后归档。

CREATE TABLE IF NOT EXISTS t_icc_outbox_event (
  ID              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  EventId         CHAR(36)        NOT NULL,
  EventType       VARCHAR(64)     NOT NULL,
  EventVersion    SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  AggregateType   VARCHAR(32)     NOT NULL,
  AggregateId     VARCHAR(64)     NOT NULL,
  PartitionKey    VARCHAR(64)     NOT NULL,
  VdnId           INT             NOT NULL DEFAULT 0,
  SourceComponent VARCHAR(16)     NOT NULL,
  SourceNodeId    VARCHAR(32)     DEFAULT NULL,
  Payload         MEDIUMTEXT      NOT NULL,
  OccurredAt      DATETIME(3)     NOT NULL,
  CreateTime      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ClaimedAt       DATETIME(3)     DEFAULT NULL,
  ConsumedAt      DATETIME(3)     DEFAULT NULL,
  PRIMARY KEY (ID),
  UNIQUE KEY uk_event_id (EventId),
  KEY idx_type_id (EventType, ID),
  KEY idx_create (CreateTime),
  KEY idx_claimed (ClaimedAt),
  KEY idx_consumed (ConsumedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS t_icc_outbox_event_archive (
  ID              BIGINT UNSIGNED NOT NULL,
  EventId         CHAR(36)        NOT NULL,
  EventType       VARCHAR(64)     NOT NULL,
  EventVersion    SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  AggregateType   VARCHAR(32)     NOT NULL,
  AggregateId     VARCHAR(64)     NOT NULL,
  PartitionKey    VARCHAR(64)     NOT NULL,
  VdnId           INT             NOT NULL DEFAULT 0,
  SourceComponent VARCHAR(16)     NOT NULL,
  SourceNodeId    VARCHAR(32)     DEFAULT NULL,
  Payload         MEDIUMTEXT      NOT NULL,
  OccurredAt      DATETIME(3)     NOT NULL,
  CreateTime      DATETIME(3)     NOT NULL,
  ArchivedAt      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (ID),
  UNIQUE KEY uk_arch_event_id (EventId),
  KEY idx_arch_create (ArchivedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
