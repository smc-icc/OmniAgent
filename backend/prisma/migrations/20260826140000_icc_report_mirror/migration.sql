-- ICC 报表仓：镜像运营表（非星型数仓）。
-- 列名 = MySQL t_icc_* 的小写形式，口径对照 docs/报表存储过程。
-- Hub 写入；Metabase 只读角色 icc_rpt_readonly。不要让 CCS 直写本 schema。

CREATE SCHEMA IF NOT EXISTS icc;

CREATE TABLE IF NOT EXISTS icc.t_icc_base_call_log (
  pid               bigint PRIMARY KEY,
  parentpid         bigint DEFAULT -1,
  vdnid             integer DEFAULT -1,
  vdnname           varchar(255),
  mediaid           integer,
  mediatype         varchar(20),
  logicno           integer,
  channelgroupid    integer,
  channelgroupname  varchar(255),
  spanid            integer,
  channelno         integer,
  callingno         varchar(64),
  calledno          varchar(64),
  begintime         timestamptz,
  answertime        timestamptz,
  endtime           timestamptz,
  calldirection     smallint,
  calltype          smallint,
  devicetypeid      integer DEFAULT -1,
  releasecause      integer,
  answertimelong    integer,
  talktimelong      integer
);
CREATE INDEX IF NOT EXISTS icc_base_call_log_begintime ON icc.t_icc_base_call_log (begintime);
CREATE INDEX IF NOT EXISTS icc_base_call_log_vdn ON icc.t_icc_base_call_log (vdnid, calldirection, calltype);

CREATE TABLE IF NOT EXISTS icc.t_icc_ag_route_log (
  pid               bigint PRIMARY KEY,
  acdroutepid       bigint,
  basecallpid       bigint,
  parentcallpid     bigint,
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
  createcalltime    timestamptz,
  enterivrtime      timestamptz,
  enteracdtime      timestamptz,
  begintime         timestamptz,
  ringtime          timestamptz,
  answertime        timestamptz,
  aftertime         timestamptz,
  endtime           timestamptz,
  agentid           integer,
  workno            varchar(64),
  agentname         varchar(100),
  releasecause      integer,
  satisficing       integer DEFAULT 0,
  recordfile        varchar(255),
  calldirection     smallint,
  calltype          smallint,
  ringtimelong      integer,
  talktimelong      integer,
  aftertimelong     integer,
  label             integer,
  chmediatype       integer DEFAULT 0
);
CREATE INDEX IF NOT EXISTS icc_ag_route_log_createcall ON icc.t_icc_ag_route_log (createcalltime);
CREATE INDEX IF NOT EXISTS icc_ag_route_log_vdn ON icc.t_icc_ag_route_log (vdnid, calldirection);
CREATE INDEX IF NOT EXISTS icc_ag_route_log_workno ON icc.t_icc_ag_route_log (workno);
CREATE INDEX IF NOT EXISTS icc_ag_route_log_basecall ON icc.t_icc_ag_route_log (basecallpid);

-- 坐席呼入明细（S_ICIP_RPT_A_IncomingDetails）
CREATE OR REPLACE VIEW icc.v_rpt_agent_inbound_detail AS
SELECT
  pid,
  basecallpid,
  vdnid,
  vdnname,
  workno,
  agentname,
  agentgroupname,
  skillname,
  callingno,
  calledno,
  createcalltime,
  begintime,
  ringtime,
  answertime,
  endtime,
  ringtimelong,
  talktimelong,
  aftertimelong,
  calldirection,
  calltype,
  satisficing,
  releasecause,
  acdroutepid,
  recordfile
FROM icc.t_icc_ag_route_log
WHERE calldirection = 1;

-- 坐席呼入 KPI（S_ICIP_RPT_A_IncomTrafficKPT 字段 f_F..f_M）
-- 旧过程把秒换成「天」小数（/86400）；此处保留秒，Metabase 再格式化。
CREATE OR REPLACE VIEW icc.v_rpt_agent_inbound_kpi AS
SELECT
  date_trunc('day', COALESCE(createcalltime, begintime)) AS datestr,
  vdnid,
  COALESCE(agentgroupname, '全部') AS agentgroupname,
  COALESCE(agentname, '全部') AS agentname,
  COALESCE(workno, '全部') AS workno,
  COUNT(*)::bigint AS f_f,
  COUNT(*) FILTER (WHERE acdroutepid IS NOT NULL)::bigint AS f_g,
  COUNT(*) FILTER (WHERE talktimelong > 0 AND acdroutepid IS NOT NULL)::bigint AS f_h,
  (COUNT(*) FILTER (WHERE acdroutepid IS NOT NULL)
    - COUNT(*) FILTER (WHERE talktimelong > 0 AND acdroutepid IS NOT NULL))::bigint AS f_i,
  COUNT(*) FILTER (WHERE talktimelong > 0 AND talktimelong < 10 AND acdroutepid IS NOT NULL)::bigint AS f_j,
  CASE WHEN COUNT(*) FILTER (WHERE talktimelong > 0 AND acdroutepid IS NOT NULL) = 0 THEN NULL
       ELSE COUNT(*) FILTER (WHERE talktimelong > 0 AND talktimelong < 10 AND acdroutepid IS NOT NULL)::numeric
            / COUNT(*) FILTER (WHERE talktimelong > 0 AND acdroutepid IS NOT NULL)
  END AS f_k,
  CASE WHEN COUNT(*) = 0 THEN NULL
       ELSE COUNT(*) FILTER (WHERE talktimelong > 0 AND acdroutepid IS NOT NULL)::numeric / COUNT(*)
  END AS f_l,
  CASE WHEN COUNT(*) FILTER (WHERE acdroutepid IS NOT NULL) = 0 THEN NULL
       ELSE (COUNT(*) FILTER (WHERE acdroutepid IS NOT NULL)
             - COUNT(*) FILTER (WHERE talktimelong > 0 AND acdroutepid IS NOT NULL))::numeric
            / COUNT(*) FILTER (WHERE acdroutepid IS NOT NULL)
  END AS f_m,
  COALESCE(SUM(ringtimelong) FILTER (WHERE acdroutepid IS NOT NULL), 0) AS f_n_sec,
  COALESCE(SUM(talktimelong) FILTER (WHERE talktimelong > 0 AND acdroutepid IS NOT NULL), 0) AS f_q_sec,
  COALESCE(SUM(aftertimelong) FILTER (WHERE aftertimelong > 0 AND acdroutepid IS NOT NULL), 0) AS f_t_sec
FROM icc.t_icc_ag_route_log
WHERE calldirection = 1
GROUP BY 1, 2, 3, 4, 5;

-- 平台呼入 KPI（S_ICIP_RPT_P_IncomingKPI：外线呼入主话单）
CREATE OR REPLACE VIEW icc.v_rpt_platform_inbound_kpi AS
SELECT
  date_trunc('day', t.begintime) AS datestr,
  t.vdnid,
  t.vdnname,
  COUNT(*)::bigint AS offered,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM icc.t_icc_ag_route_log ag
      WHERE ag.basecallpid = t.pid AND ag.calldirection <> 3 AND COALESCE(ag.talktimelong, 0) > 0
    )
  )::bigint AS answered,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM icc.t_icc_ag_route_log ag
      WHERE ag.basecallpid = t.pid AND ag.calldirection <> 3
        AND COALESCE(ag.talktimelong, 0) > 0 AND ag.talktimelong < 10
    )
  )::bigint AS answered_lt_10s,
  CASE WHEN COUNT(*) = 0 THEN NULL
       ELSE COUNT(*) FILTER (
         WHERE EXISTS (
           SELECT 1 FROM icc.t_icc_ag_route_log ag
           WHERE ag.basecallpid = t.pid AND ag.calldirection <> 3 AND COALESCE(ag.talktimelong, 0) > 0
         )
       )::numeric / COUNT(*)
  END AS answer_rate
FROM icc.t_icc_base_call_log t
WHERE t.mediaid = 1
  AND t.parentpid = -1
  AND t.calldirection = 1
  AND t.calltype = 1
GROUP BY 1, 2, 3;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'icc_rpt_readonly') THEN
    CREATE ROLE icc_rpt_readonly NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA icc TO icc_rpt_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA icc TO icc_rpt_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA icc GRANT SELECT ON TABLES TO icc_rpt_readonly;
