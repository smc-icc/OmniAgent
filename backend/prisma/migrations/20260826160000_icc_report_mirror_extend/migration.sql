-- ICC 报表仓扩展：ACD 排队轨迹 + 坐席状态轨迹（列名小写镜像）。
-- 视图以 sql/icc.schema.sql 为准，本迁移只建表。

CREATE TABLE IF NOT EXISTS icc.t_icc_acd_route_log (
  pid               bigint PRIMARY KEY,
  basecallpid       bigint,
  vdnid             integer,
  vdnname           varchar(255),
  mediaid           integer,
  mediatype         varchar(20),
  callingno         varchar(64),
  calledno          varchar(64),
  agentgroupid      integer,
  agentgroupname    varchar(255),
  skillid           integer,
  skillname         varchar(255),
  workno            varchar(64),
  queuelenenter     integer,
  queuelenleft      integer,
  ewt               integer,
  begintime         timestamptz,
  endtime           timestamptz,
  leftcauseid       integer,
  leftcausecnname   varchar(255),
  leftcauseenname   varchar(255),
  queuetimelong     integer,
  requestno         integer,
  processstatus     integer DEFAULT 0,
  processcontent    varchar(4000),
  processagentid    integer,
  processworkno     varchar(255),
  processagentname  varchar(255),
  processdate       timestamptz
);
CREATE INDEX IF NOT EXISTS icc_acd_route_log_begintime ON icc.t_icc_acd_route_log (begintime);
CREATE INDEX IF NOT EXISTS icc_acd_route_log_basecall ON icc.t_icc_acd_route_log (basecallpid);

CREATE TABLE IF NOT EXISTS icc.t_icc_ag_state_trk_record (
  id                bigint PRIMARY KEY,
  agentid           integer NOT NULL DEFAULT 0,
  workno            varchar(255) NOT NULL DEFAULT '',
  consn             bigint,
  callsn            bigint,
  accessmediatype   varchar(255),
  status            integer,
  statusname        varchar(255) NOT NULL DEFAULT '',
  begintime         timestamptz,
  endtime           timestamptz,
  statetime         integer NOT NULL DEFAULT 0,
  operatetype       integer,
  operatename       varchar(255) NOT NULL DEFAULT '',
  operateworkno     varchar(255),
  operatefailcause  integer,
  logoutreasoncode  varchar(255),
  auxcode           integer,
  vdnname           varchar(50),
  vdnid             integer,
  agentname         varchar(100),
  logintime         timestamptz,
  logintimelen      integer NOT NULL DEFAULT 0,
  agroutelogpid     bigint,
  basecallpid       bigint,
  parentcallpid     bigint
);
CREATE INDEX IF NOT EXISTS icc_ag_state_trk_status ON icc.t_icc_ag_state_trk_record (status);
CREATE INDEX IF NOT EXISTS icc_ag_state_trk_agroute ON icc.t_icc_ag_state_trk_record (agroutelogpid);
CREATE INDEX IF NOT EXISTS icc_ag_state_trk_begintime ON icc.t_icc_ag_state_trk_record (begintime);
