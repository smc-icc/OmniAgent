-- ICC 报表仓：签入、CDR、IVR 路由/轨迹镜像表。视图以 sql/icc.schema.sql 为准。

CREATE TABLE IF NOT EXISTS icc.t_icc_ag_login_log (
  pid               bigint PRIMARY KEY,
  vdnname           varchar(50),
  vdnid             integer,
  agentname         varchar(100),
  workno            varchar(50),
  agentid           integer,
  logintime         timestamptz,
  logouttime        timestamptz,
  extension         varchar(30)
);
CREATE INDEX IF NOT EXISTS icc_ag_login_log_login ON icc.t_icc_ag_login_log (logintime);
CREATE INDEX IF NOT EXISTS icc_ag_login_log_workno ON icc.t_icc_ag_login_log (workno);

CREATE TABLE IF NOT EXISTS icc.t_icc_base_cdr (
  id                bigint PRIMARY KEY,
  consn             bigint NOT NULL DEFAULT 0,
  callsn            bigint DEFAULT 0,
  span              integer,
  channel           integer,
  trunkgroup        varchar(255),
  caller            varchar(255),
  called            varchar(255),
  initializetime    timestamptz,
  answertime        timestamptz,
  connecttime       timestamptz,
  releasetime       timestamptz,
  initializetimems  integer,
  answertimems      integer,
  connecttimems     integer,
  releasetimems     integer,
  talkduration      double precision,
  answerduration    double precision,
  cause             integer,
  callflag          varchar(255),
  pid               bigint
);
CREATE INDEX IF NOT EXISTS icc_base_cdr_init ON icc.t_icc_base_cdr (initializetime);
CREATE INDEX IF NOT EXISTS icc_base_cdr_pid ON icc.t_icc_base_cdr (pid);

CREATE TABLE IF NOT EXISTS icc.t_icc_ivr_route_log (
  pid               bigint PRIMARY KEY,
  basecallpid       bigint,
  vdnid             integer,
  vdnname           varchar(255),
  ivrappid          integer,
  flowid            integer,
  flowname          varchar(255),
  begintime         timestamptz,
  answertime        timestamptz,
  endtime           timestamptz,
  callingno         varchar(64),
  calledno          varchar(64),
  logicno           integer,
  answertimelong    integer,
  talktimelong      integer,
  flowtype          integer
);
CREATE INDEX IF NOT EXISTS icc_ivr_route_log_begin ON icc.t_icc_ivr_route_log (begintime);
CREATE INDEX IF NOT EXISTS icc_ivr_route_log_basecall ON icc.t_icc_ivr_route_log (basecallpid);

CREATE TABLE IF NOT EXISTS icc.t_icc_ivr_trace_log (
  pid               bigint PRIMARY KEY,
  ivrroutepid       bigint,
  begintime         timestamptz,
  endtime           timestamptz,
  flowid            integer,
  nodeid            integer,
  nodetype          smallint,
  nodename          varchar(255),
  nodedeep          smallint,
  nodevalue         varchar(255),
  nodetimelong      integer,
  noderesult        integer
);
CREATE INDEX IF NOT EXISTS icc_ivr_trace_log_route ON icc.t_icc_ivr_trace_log (ivrroutepid);
CREATE INDEX IF NOT EXISTS icc_ivr_trace_log_type ON icc.t_icc_ivr_trace_log (nodetype);
