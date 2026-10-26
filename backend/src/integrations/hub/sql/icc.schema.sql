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

-- Hub 写入厚 payload 的 icc.agent.state_changed（含 id）；薄 payload 会因缺 id 进 DLQ，不会覆盖历史行。
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
  flowtype          integer,
  -- 离开 IVR 原因：1=转ACD排队 2=直接转坐席 3=线路释放 4=流程切换 5=投递IVR失败
  -- NULL 表示该段仍在 IVR。源库定义见 db/alter_ivr_route_log_left_cause.sql
  leftcauseid       integer,
  leftcausecnname   varchar(255),
  leftcauseenname   varchar(255)
);
CREATE INDEX IF NOT EXISTS icc_ivr_route_log_begin ON icc.t_icc_ivr_route_log (begintime);
CREATE INDEX IF NOT EXISTS icc_ivr_route_log_basecall ON icc.t_icc_ivr_route_log (basecallpid);
CREATE INDEX IF NOT EXISTS icc_ivr_route_log_leftcause ON icc.t_icc_ivr_route_log (leftcauseid);

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

CREATE TABLE IF NOT EXISTS icc.t_icc_base_channelgroup (
  id                integer PRIMARY KEY,
  name              varchar(50),
  beginspanid       integer,
  beginchannelid    integer,
  endspanid         integer,
  endchannelid      integer,
  seektype          integer,
  vdnid             integer DEFAULT -1,
  callercapacity    integer DEFAULT 1
);

CREATE TABLE IF NOT EXISTS icc.t_icc_faxs_recv (
  id                integer PRIMARY KEY,
  vdnid             integer,
  workno            varchar(255),
  filename          varchar(255),
  time              timestamptz,
  readflag          integer DEFAULT 0,
  pagenum           integer,
  callingno         varchar(20),
  checked           integer DEFAULT 0,
  calledno          varchar(20),
  faxresult         integer,
  ifread            integer,
  processdate       timestamptz,
  agentname         varchar(20),
  recid             varchar(50),
  processresult     varchar(255)
);
CREATE INDEX IF NOT EXISTS icc_faxs_recv_time ON icc.t_icc_faxs_recv (time);

CREATE TABLE IF NOT EXISTS icc.t_icc_faxs_sndfax1001d (
  id                integer PRIMARY KEY,
  faxspec           varchar(100),
  faxno             varchar(20),
  startdate1        timestamptz,
  enddate1          timestamptz,
  startdate2        timestamptz,
  enddate2          timestamptz,
  priority          integer,
  uploadfaxfile     varchar(500),
  uploadfaxfilealias varchar(500),
  uploadfaxfileconv varchar(500),
  sndstate          integer,
  ifconv            integer,
  convdate          timestamptz,
  snddate           timestamptz,
  sndresult         varchar(200),
  maxsndcnt         integer,
  sndedcnt          integer,
  sndinterval       integer,
  agentid           varchar(50),
  workno            varchar(50),
  agentname         varchar(50),
  insertdate        timestamptz,
  ftpokafterconv    integer,
  sessionid         bigint,
  sndok             integer DEFAULT 0,
  checked           integer DEFAULT 0,
  vdnid             integer DEFAULT -1
);
CREATE INDEX IF NOT EXISTS icc_faxs_snd_snddate ON icc.t_icc_faxs_sndfax1001d (snddate);

DROP VIEW IF EXISTS icc.v_rpt_agent_inbound_detail CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_agent_outbound_detail CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_agent_inbound_kpi CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_platform_inbound_kpi CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_agent_outbound_kpi CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_agent_intercall_detail CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_agent_satisfaction CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_line_incoming CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_agent_incoming_workload CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_agent_call_loss CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_agent_outgoing_workload CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_agent_workload CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_agent_status_tracking CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_agent_work_efficiency CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_agent_login_detail CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_line_outgoing CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_platform_outbound_kpi CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_phone_call CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_phone_call_loss CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_acd_queue_call_loss CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_ivr_access CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_ivr_business_category CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_time_resolution CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_base_cdr CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_full_media_access CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_relay_utilization CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_customer_by_region CASCADE;
DROP VIEW IF EXISTS icc.v_rpt_pa_efficiency CASCADE;

-- 坐席呼入明细（S_ICIP_RPT_A_IncomingDetails）
CREATE OR REPLACE VIEW icc.v_rpt_agent_inbound_detail AS
SELECT
  ag.basecallpid AS basepid,
  ag.pid AS agpid,
  COALESCE(b.callingno, ag.callingno) AS callingno,
  COALESCE(b.calledno, ag.calledno) AS calledno,
  ag.begintime,
  CASE WHEN ag.aftertime IS NOT NULL AND ag.begintime IS NOT NULL AND ag.aftertime >= ag.begintime
       THEN ag.aftertime ELSE ag.endtime END AS aftertime,
  CASE WHEN COALESCE(ag.parentcallpid, -1) = -1 THEN '首次呼入-转出' ELSE '坐席转接-转入' END AS typename,
  COALESCE(ag.agentgroupname, '-') AS agentgroupname,
  COALESCE(ag.agentname, '-') AS agentname,
  COALESCE(ag.workno, '-') AS workno,
  ag.ringtimelong,
  ag.talktimelong,
  ag.aftertimelong,
  CASE ag.releasecause
    WHEN 1 THEN '等待本坐席应答超时'
    WHEN 2 THEN '呼叫被另一坐席抢接'
    WHEN 3 THEN '通话被另一坐席栏截(质检)'
    WHEN 4 THEN '通话时被另一坐席注销(质检)'
    WHEN 5 THEN '通话时本坐席注销'
    WHEN 6 THEN '通话时本坐席挂断'
    WHEN 7 THEN '通话时对方挂断'
    WHEN 8 THEN '呼叫被转移'
    WHEN 9 THEN '等待对方应答超时'
    ELSE '其它'
  END AS releasecause,
  ag.vdnid,
  ag.vdnname,
  ag.skillname,
  ag.createcalltime,
  ag.acdroutepid,
  ag.recordfile,
  ag.calltype,
  ag.satisficing
FROM icc.t_icc_ag_route_log ag
INNER JOIN icc.t_icc_base_call_log b ON b.pid = ag.basecallpid
WHERE ag.calldirection = 1
  AND (b.calldirection = 1 OR (b.calldirection = 3 AND COALESCE(b.parentpid, -1) <> -1))
  AND ag.endtime >= ag.begintime;

-- 坐席呼出明细（S_ICIP_RPT_A_OutgoingDetails）
CREATE OR REPLACE VIEW icc.v_rpt_agent_outbound_detail AS
SELECT
  ag.basecallpid AS basepid,
  ag.pid AS agpid,
  ag.begintime,
  CASE WHEN ag.aftertime IS NOT NULL AND ag.begintime IS NOT NULL AND ag.aftertime >= ag.begintime
       THEN ag.aftertime ELSE ag.endtime END AS aftertime,
  CASE WHEN COALESCE(ag.parentcallpid, -1) = -1 THEN '首次呼出' ELSE '坐席转接-呼出' END AS typename,
  COALESCE(ag.agentgroupname, '-') AS agentgroupname,
  COALESCE(ag.agentname, '-') AS agentname,
  COALESCE(ag.workno, '-') AS workno,
  COALESCE(b.callingno, ag.callingno) AS callingno,
  COALESCE(b.calledno, ag.calledno) AS calledno,
  ag.ringtimelong,
  ag.talktimelong,
  ag.aftertimelong,
  ag.vdnid,
  ag.vdnname,
  ag.createcalltime,
  ag.calltype
FROM icc.t_icc_ag_route_log ag
LEFT JOIN icc.t_icc_base_call_log b ON b.pid = ag.basecallpid
WHERE ag.calldirection = 2;

-- 坐席呼入 KPI（S_ICIP_RPT_A_IncomTrafficKPT 字段 f_F..f_AC）
-- 旧过程把秒换成「天」小数（/86400）；此处保留秒。f_W 来自 status=512 保持段。
CREATE OR REPLACE VIEW icc.v_rpt_agent_inbound_kpi AS
SELECT
  date_trunc('day', COALESCE(t.createcalltime, t.begintime)) AS datestr,
  t.vdnid,
  COALESCE(t.agentgroupname, '全部') AS agentgroupname,
  COALESCE(t.agentname, '全部') AS agentname,
  COALESCE(t.workno, '全部') AS workno,
  COUNT(*)::bigint AS f_f,
  COUNT(*) FILTER (WHERE t.acdroutepid IS NOT NULL)::bigint AS f_g,
  COUNT(*) FILTER (WHERE t.talktimelong > 0 AND t.acdroutepid IS NOT NULL)::bigint AS f_h,
  (COUNT(*) FILTER (WHERE t.acdroutepid IS NOT NULL)
    - COUNT(*) FILTER (WHERE t.talktimelong > 0 AND t.acdroutepid IS NOT NULL))::bigint AS f_i,
  COUNT(*) FILTER (WHERE t.talktimelong > 0 AND t.talktimelong < 10 AND t.acdroutepid IS NOT NULL)::bigint AS f_j,
  CASE WHEN COUNT(*) FILTER (WHERE t.talktimelong > 0 AND t.acdroutepid IS NOT NULL) = 0 THEN NULL
       ELSE COUNT(*) FILTER (WHERE t.talktimelong > 0 AND t.talktimelong < 10 AND t.acdroutepid IS NOT NULL)::numeric
            / COUNT(*) FILTER (WHERE t.talktimelong > 0 AND t.acdroutepid IS NOT NULL)
  END AS f_k,
  CASE WHEN COUNT(*) = 0 THEN NULL
       ELSE COUNT(*) FILTER (WHERE t.talktimelong > 0 AND t.acdroutepid IS NOT NULL)::numeric / COUNT(*)
  END AS f_l,
  CASE WHEN COUNT(*) FILTER (WHERE t.acdroutepid IS NOT NULL) = 0 THEN NULL
       ELSE (COUNT(*) FILTER (WHERE t.acdroutepid IS NOT NULL)
             - COUNT(*) FILTER (WHERE t.talktimelong > 0 AND t.acdroutepid IS NOT NULL))::numeric
            / COUNT(*) FILTER (WHERE t.acdroutepid IS NOT NULL)
  END AS f_m,
  COALESCE(SUM(t.ringtimelong) FILTER (WHERE t.acdroutepid IS NOT NULL), 0) AS f_n_sec,
  CASE WHEN COUNT(*) FILTER (WHERE t.acdroutepid IS NOT NULL) = 0 THEN NULL
       ELSE SUM(t.ringtimelong) FILTER (WHERE t.acdroutepid IS NOT NULL)::numeric
            / COUNT(*) FILTER (WHERE t.acdroutepid IS NOT NULL)
  END AS f_o_sec,
  MAX(t.ringtimelong) FILTER (WHERE t.acdroutepid IS NOT NULL) AS f_p_sec,
  GREATEST(
    COALESCE(SUM(t.talktimelong) FILTER (WHERE t.talktimelong > 0 AND t.acdroutepid IS NOT NULL), 0)
    - COALESCE(SUM(t.hold_sec) FILTER (WHERE t.acdroutepid IS NOT NULL), 0),
    0
  ) AS f_q_sec,
  CASE WHEN COUNT(*) FILTER (WHERE t.talktimelong > 0 AND t.acdroutepid IS NOT NULL) = 0 THEN NULL
       ELSE SUM(t.talktimelong) FILTER (WHERE t.talktimelong > 0 AND t.acdroutepid IS NOT NULL)::numeric
            / COUNT(*) FILTER (WHERE t.talktimelong > 0 AND t.acdroutepid IS NOT NULL)
  END AS f_r_sec,
  MAX(t.talktimelong) FILTER (WHERE t.talktimelong > 0 AND t.acdroutepid IS NOT NULL) AS f_s_sec,
  COALESCE(SUM(t.aftertimelong) FILTER (WHERE t.aftertimelong > 0 AND t.acdroutepid IS NOT NULL), 0) AS f_t_sec,
  COUNT(*) FILTER (WHERE t.aftertimelong > 0 AND t.acdroutepid IS NOT NULL)::bigint AS f_u,
  CASE WHEN COUNT(*) FILTER (WHERE t.aftertimelong > 0 AND t.acdroutepid IS NOT NULL) = 0 THEN NULL
       ELSE SUM(t.aftertimelong) FILTER (WHERE t.aftertimelong > 0 AND t.acdroutepid IS NOT NULL)::numeric
            / COUNT(*) FILTER (WHERE t.aftertimelong > 0 AND t.acdroutepid IS NOT NULL)
  END AS f_v_sec,
  COALESCE(SUM(t.hold_sec) FILTER (WHERE t.acdroutepid IS NOT NULL), 0) AS f_w_sec,
  COALESCE(SUM(t.hold_n) FILTER (WHERE t.acdroutepid IS NOT NULL), 0)::bigint AS f_x,
  CASE WHEN COALESCE(SUM(t.hold_n) FILTER (WHERE t.acdroutepid IS NOT NULL), 0) = 0 THEN NULL
       ELSE SUM(t.hold_sec) FILTER (WHERE t.acdroutepid IS NOT NULL)::numeric
            / SUM(t.hold_n) FILTER (WHERE t.acdroutepid IS NOT NULL)
  END AS f_y_sec,
  (COALESCE(SUM(t.talktimelong) FILTER (WHERE t.talktimelong > 0 AND t.acdroutepid IS NOT NULL), 0)
    + COALESCE(SUM(t.aftertimelong) FILTER (WHERE t.aftertimelong > 0 AND t.acdroutepid IS NOT NULL), 0)) AS f_z_sec,
  CASE WHEN COUNT(*) FILTER (WHERE t.talktimelong > 0 AND t.acdroutepid IS NOT NULL) = 0 THEN NULL
       ELSE (COALESCE(SUM(t.talktimelong) FILTER (WHERE t.talktimelong > 0 AND t.acdroutepid IS NOT NULL), 0)
             + COALESCE(SUM(t.aftertimelong) FILTER (WHERE t.aftertimelong > 0 AND t.acdroutepid IS NOT NULL), 0))::numeric
            / COUNT(*) FILTER (WHERE t.talktimelong > 0 AND t.acdroutepid IS NOT NULL)
  END AS f_aa_sec,
  CASE WHEN COUNT(*) FILTER (WHERE t.talktimelong > 0 AND t.acdroutepid IS NOT NULL) = 0 THEN NULL
       ELSE AVG(EXTRACT(EPOCH FROM (t.answertime - t.enteracdtime)))
              FILTER (WHERE t.talktimelong > 0 AND t.acdroutepid IS NOT NULL AND t.answertime IS NOT NULL AND t.enteracdtime IS NOT NULL)
  END AS f_ab_sec,
  CASE WHEN COUNT(*) = 0 THEN NULL
       ELSE COUNT(*) FILTER (
         WHERE t.talktimelong > 0 AND t.acdroutepid IS NOT NULL
           AND t.answertime IS NOT NULL AND t.enteracdtime IS NOT NULL
           AND EXTRACT(EPOCH FROM (t.answertime - t.enteracdtime)) > 0
           AND EXTRACT(EPOCH FROM (t.answertime - t.enteracdtime)) < 20
       )::numeric / COUNT(*)
  END AS f_ac
FROM (
  SELECT t.*,
    COALESCE(h.hold_sec, 0) AS hold_sec,
    COALESCE(h.hold_n, 0)::bigint AS hold_n
  FROM icc.t_icc_ag_route_log t
  LEFT JOIN (
    SELECT agroutelogpid,
           SUM(statetime)::numeric AS hold_sec,
           COUNT(*)::bigint AS hold_n
    FROM icc.t_icc_ag_state_trk_record
    WHERE status = 512
    GROUP BY agroutelogpid
  ) h ON h.agroutelogpid = t.pid
  WHERE t.calldirection = 1
) t
GROUP BY 1, 2, 3, 4, 5;

-- 平台呼入 KPI（S_ICIP_RPT_P_IncomingKPI：外线呼入主话单）
-- f_E / f_K 依赖 acd_route（现网可能为 0）；f_I 依赖 ivr_trace，未镜像则为 NULL。
CREATE OR REPLACE VIEW icc.v_rpt_platform_inbound_kpi AS
SELECT
  date_trunc('day', t.begintime) AS datestr,
  t.vdnid,
  t.vdnname,
  COALESCE(t.calledno, '0') AS calledno,
  COUNT(*)::bigint AS f_d,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM icc.t_icc_acd_route_log acd WHERE acd.basecallpid = t.pid
    )
  )::bigint AS f_e,
  CASE WHEN COUNT(*) = 0 THEN NULL
       ELSE COUNT(*) FILTER (
         WHERE EXISTS (
           SELECT 1 FROM icc.t_icc_acd_route_log acd WHERE acd.basecallpid = t.pid
         )
       )::numeric / COUNT(*)
  END AS f_f,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM icc.t_icc_ag_route_log ag
      WHERE ag.basecallpid = t.pid AND ag.calldirection <> 3 AND COALESCE(ag.talktimelong, 0) > 0
    )
  )::bigint AS f_g,
  CASE WHEN COUNT(*) FILTER (
         WHERE EXISTS (SELECT 1 FROM icc.t_icc_acd_route_log acd WHERE acd.basecallpid = t.pid)
       ) = 0 THEN NULL
       ELSE COUNT(*) FILTER (
         WHERE EXISTS (
           SELECT 1 FROM icc.t_icc_ag_route_log ag
           WHERE ag.basecallpid = t.pid AND ag.calldirection <> 3 AND COALESCE(ag.talktimelong, 0) > 0
         )
       )::numeric / COUNT(*) FILTER (
         WHERE EXISTS (SELECT 1 FROM icc.t_icc_acd_route_log acd WHERE acd.basecallpid = t.pid)
       )
  END AS f_h,
  COUNT(*) FILTER (
    WHERE COALESCE(t.talktimelong, 0) = 0
      AND NOT EXISTS (SELECT 1 FROM icc.t_icc_acd_route_log acd WHERE acd.basecallpid = t.pid)
      AND NOT EXISTS (
        SELECT 1
        FROM icc.t_icc_ivr_trace_log it
        JOIN icc.t_icc_ivr_route_log ir ON ir.pid = it.ivrroutepid
        WHERE ir.basecallpid = t.pid
          AND (
            ((it.nodetype IN (17, 18, 30) AND COALESCE(it.nodevalue, '0') <> '0')
             OR it.nodetype = 24)
          )
      )
  )::bigint AS f_i,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM icc.t_icc_acd_route_log acd
      WHERE acd.basecallpid = t.pid
        AND NOT EXISTS (
          SELECT 1 FROM icc.t_icc_ag_route_log ag WHERE ag.acdroutepid = acd.pid
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM icc.t_icc_ag_route_log ag WHERE ag.basecallpid = t.pid
    )
  )::bigint AS f_k,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM icc.t_icc_ag_route_log ag
      WHERE ag.basecallpid = t.pid AND ag.calldirection <> 3
        AND COALESCE(ag.talktimelong, 0) = 0
    )
    AND NOT EXISTS (
      SELECT 1 FROM icc.t_icc_ag_route_log ag
      WHERE ag.basecallpid = t.pid AND COALESCE(ag.talktimelong, 0) > 0
    )
  )::bigint AS f_m,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM icc.t_icc_ag_route_log ag
      WHERE ag.basecallpid = t.pid AND ag.calldirection <> 3
        AND COALESCE(ag.talktimelong, 0) > 0 AND ag.talktimelong < 10
    )
  )::bigint AS f_o,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM icc.t_icc_ag_route_log ag
      WHERE ag.basecallpid = t.pid AND ag.calldirection <> 3
        AND COALESCE(ag.talktimelong, 0) > 0 AND COALESCE(ag.ringtimelong, 0) < 20
    )
  )::bigint AS f_q_qty,
  CASE WHEN COUNT(*) = 0 THEN NULL
       ELSE COUNT(*) FILTER (
         WHERE EXISTS (
           SELECT 1 FROM icc.t_icc_ag_route_log ag
           WHERE ag.basecallpid = t.pid AND ag.calldirection <> 3 AND COALESCE(ag.talktimelong, 0) > 0
         )
       )::numeric / COUNT(*)
  END AS answer_rate,
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
  )::bigint AS answered_lt_10s
FROM icc.t_icc_base_call_log t
WHERE t.mediaid = 1
  AND COALESCE(t.parentpid, -1) = -1
  AND t.calldirection = 1
  AND t.calltype = 1
GROUP BY 1, 2, 3, 4;

-- 坐席呼出 KPI（S_ICIP_RPT_A_OutgoTrafficKPT）。旧过程 join parentpid 在 ICC6 对不上，改为 base.pid=ag.basecallpid。
CREATE OR REPLACE VIEW icc.v_rpt_agent_outbound_kpi AS
SELECT
  date_trunc('day', COALESCE(t.createcalltime, t.begintime)) AS datestr,
  t.vdnid,
  COALESCE(t.agentgroupname, '全部') AS agentgroupname,
  COALESCE(t.agentname, '全部') AS agentname,
  COALESCE(t.workno, '全部') AS workno,
  COUNT(*)::bigint AS f_f,
  COUNT(*) FILTER (WHERE COALESCE(t.ringtimelong, 0) >= 0)::bigint AS f_g,
  COUNT(*) FILTER (WHERE COALESCE(base.talktimelong, t.talktimelong, 0) > 0)::bigint AS f_h,
  COUNT(*) FILTER (WHERE COALESCE(t.talktimelong, 0) > 0 AND COALESCE(base.talktimelong, 0) = 0)::bigint AS f_i,
  COUNT(*) FILTER (
    WHERE COALESCE(base.talktimelong, t.talktimelong, 0) > 0
      AND COALESCE(base.talktimelong, t.talktimelong) < 10
  )::bigint AS f_j,
  CASE WHEN COUNT(*) = 0 THEN NULL
       ELSE COUNT(*) FILTER (WHERE COALESCE(base.talktimelong, t.talktimelong, 0) > 0)::numeric / COUNT(*)
  END AS f_l,
  COALESCE(SUM(t.ringtimelong) FILTER (WHERE COALESCE(t.ringtimelong, 0) >= 0), 0) AS f_n_sec,
  COALESCE(SUM(COALESCE(base.talktimelong, t.talktimelong))
    FILTER (WHERE COALESCE(base.talktimelong, t.talktimelong, 0) > 0), 0) AS f_p_sec,
  COALESCE(SUM(t.aftertimelong) FILTER (WHERE COALESCE(t.aftertimelong, 0) > 0), 0) AS f_r_sec,
  COUNT(*) FILTER (WHERE COALESCE(t.aftertimelong, 0) > 0)::bigint AS f_s,
  COALESCE(SUM(t.hold_sec), 0) AS f_u_sec,
  COALESCE(SUM(t.hold_n), 0)::bigint AS f_v,
  (COALESCE(SUM(COALESCE(base.talktimelong, t.talktimelong))
      FILTER (WHERE COALESCE(base.talktimelong, t.talktimelong, 0) > 0), 0)
    + COALESCE(SUM(t.aftertimelong) FILTER (WHERE COALESCE(t.aftertimelong, 0) > 0), 0)) AS f_x_sec
FROM (
  SELECT t.*,
    COALESCE(h.hold_sec, 0) AS hold_sec,
    COALESCE(h.hold_n, 0)::bigint AS hold_n
  FROM icc.t_icc_ag_route_log t
  LEFT JOIN (
    SELECT agroutelogpid,
           SUM(statetime)::numeric AS hold_sec,
           COUNT(*)::bigint AS hold_n
    FROM icc.t_icc_ag_state_trk_record
    WHERE status = 512
    GROUP BY agroutelogpid
  ) h ON h.agroutelogpid = t.pid
  WHERE t.calldirection = 2 AND t.calltype = 4
) t
LEFT JOIN icc.t_icc_base_call_log base ON base.pid = t.basecallpid
GROUP BY 1, 2, 3, 4, 5;

-- 内部呼叫明细（S_ICIP_RPT_A_InterCallDetails）
CREATE OR REPLACE VIEW icc.v_rpt_agent_intercall_detail AS
SELECT
  ag_f.begintime,
  ag_f.endtime,
  ag_f.agentgroupname AS f_agentgroupname,
  ag_f.agentname AS f_agentname,
  ag_f.workno AS f_workno,
  base.callingno,
  ag_t.agentgroupname AS t_agentgroupname,
  ag_t.agentname AS t_agentname,
  ag_t.workno AS t_workno,
  base.calledno,
  ag_f.ringtimelong,
  ag_f.talktimelong,
  ag_f.vdnid,
  base.pid AS basepid
FROM icc.t_icc_base_call_log base
LEFT JOIN icc.t_icc_ag_route_log ag_f
  ON ag_f.basecallpid = base.parentpid AND ag_f.calldirection = 2
LEFT JOIN icc.t_icc_ag_route_log ag_t
  ON ag_t.basecallpid = base.parentpid AND ag_t.calldirection = 1
WHERE base.calldirection = 3
  AND base.calltype = 8
  AND COALESCE(base.parentpid, -1) <> -1
  AND ag_f.pid IS NOT NULL
  AND ag_t.pid IS NOT NULL
  AND ag_f.endtime >= ag_f.begintime;

-- 满意度（S_ICIP_RPT_A_Satisfaction）
CREATE OR REPLACE VIEW icc.v_rpt_agent_satisfaction AS
SELECT
  date_trunc('day', COALESCE(createcalltime, begintime)) AS datestr,
  vdnid,
  COALESCE(agentgroupname, '全部') AS agentgroupname,
  COALESCE(agentname, '全部') AS agentname,
  COALESCE(workno, '全部') AS workno,
  COUNT(*)::bigint AS callcount,
  COUNT(*) FILTER (WHERE satisficing = 1)::bigint AS pass1,
  COUNT(*) FILTER (WHERE satisficing = 2)::bigint AS pass2,
  COUNT(*) FILTER (WHERE satisficing = 3)::bigint AS pass3,
  COUNT(*) FILTER (WHERE satisficing = 4)::bigint AS pass4,
  COUNT(*) FILTER (WHERE satisficing = 5)::bigint AS pass5,
  COUNT(*) FILTER (WHERE COALESCE(satisficing, 0) = 0)::bigint AS pass0,
  CASE WHEN COUNT(*) = 0 THEN NULL
       ELSE COUNT(*) FILTER (WHERE satisficing BETWEEN 1 AND 5)::numeric / COUNT(*)
  END AS passlv
FROM icc.t_icc_ag_route_log
GROUP BY 1, 2, 3, 4, 5;

-- 线路呼入详单（S_ICIP_RPT_P_LineIncoming）：主话单 + 子话单 max(endtime)
CREATE OR REPLACE VIEW icc.v_rpt_line_incoming AS
SELECT
  t.pid,
  t.vdnid,
  t.vdnname,
  t.begintime,
  COALESCE(c.child_end, t.endtime) AS endtime,
  t.callingno,
  t.calledno,
  EXTRACT(EPOCH FROM (COALESCE(c.child_end, t.endtime) - t.begintime))::integer AS talktimelong
FROM icc.t_icc_base_call_log t
LEFT JOIN LATERAL (
  SELECT MAX(l1.endtime) AS child_end
  FROM icc.t_icc_base_call_log l1
  WHERE l1.parentpid = t.pid
    AND l1.calltype NOT IN (15, 16, 17)
) c ON true
WHERE t.mediaid = 1
  AND COALESCE(t.parentpid, -1) = -1
  AND t.calldirection = 1
  AND t.calltype = 1;

-- 坐席呼入工作量（S_ICIP_RPT_A_IncomingWorkload 关键列）
CREATE OR REPLACE VIEW icc.v_rpt_agent_incoming_workload AS
SELECT
  date_trunc('day', COALESCE(createcalltime, begintime)) AS datestr,
  vdnid,
  COALESCE(agentgroupname, '全部') AS agentgroupname,
  COALESCE(agentname, '全部') AS agentname,
  COALESCE(workno, '全部') AS workno,
  COUNT(*) FILTER (WHERE calldirection = 1 OR (calldirection = 2 AND calltype = 7))::bigint AS f_d,
  COUNT(*) FILTER (WHERE calldirection = 1 AND calltype = 8)::bigint AS f_f,
  COALESCE(SUM(talktimelong) FILTER (WHERE calldirection = 1 AND calltype = 8), 0) AS f_g_sec,
  COUNT(*) FILTER (WHERE calldirection = 2 AND calltype = 7)::bigint AS f_h,
  COUNT(*) FILTER (WHERE calldirection = 1 AND calltype IN (9, 10, 19, 20))::bigint AS f_j,
  COUNT(*) FILTER (WHERE calldirection = 1 AND releasecause = 8)::bigint AS f_k,
  COUNT(*) FILTER (WHERE calldirection = 1)::bigint AS f_m,
  COUNT(*) FILTER (
    WHERE calldirection = 1 AND COALESCE(talktimelong, 0) > 0
      AND calltype IN (1, 2, 3, 18, 23)
  )::bigint AS f_n,
  COUNT(*) FILTER (WHERE calldirection = 1 AND COALESCE(talktimelong, 0) > 0)::bigint AS f_p,
  COALESCE(SUM(talktimelong) FILTER (WHERE calldirection = 1 AND COALESCE(talktimelong, 0) > 0), 0) AS f_p_sec,
  COUNT(*) FILTER (WHERE calldirection = 1 AND COALESCE(talktimelong, 0) = 0)::bigint AS f_q
FROM icc.t_icc_ag_route_log
GROUP BY 1, 2, 3, 4, 5;

-- 坐席呼损（S_ICIP_RPT_C_AgentCallLoss）：ACD 有记录且坐席通话时长为 0
CREATE OR REPLACE VIEW icc.v_rpt_agent_call_loss AS
SELECT
  ag.begintime,
  ag.endtime,
  ag.agentgroupname,
  ag.agentname,
  ag.workno,
  ag.callingno,
  ag.calledno,
  1 AS f_i,
  ag.ringtimelong AS f_j,
  ag.vdnid,
  acd.pid AS acdpid,
  ag.pid AS agpid
FROM icc.t_icc_acd_route_log acd
INNER JOIN icc.t_icc_ag_route_log ag ON acd.pid = ag.acdroutepid
WHERE COALESCE(ag.talktimelong, 0) = 0;

-- 坐席呼出工作量（S_ICIP_RPT_A_OutgoingWorkload 关键列；join 用 base.pid）
CREATE OR REPLACE VIEW icc.v_rpt_agent_outgoing_workload AS
SELECT
  date_trunc('day', COALESCE(t.createcalltime, t.begintime)) AS datestr,
  t.vdnid,
  COALESCE(t.agentgroupname, '全部') AS agentgroupname,
  COALESCE(t.agentname, '全部') AS agentname,
  COALESCE(t.workno, '全部') AS workno,
  COUNT(*)::bigint AS f_f,
  COALESCE(SUM(COALESCE(b.talktimelong, t.talktimelong)), 0) AS f_tl_sec,
  COUNT(*) FILTER (WHERE COALESCE(b.talktimelong, t.talktimelong, 0) > 0)::bigint AS f_h,
  COUNT(*) FILTER (WHERE COALESCE(t.talktimelong, 0) > 0 AND COALESCE(b.talktimelong, 0) = 0)::bigint AS f_i,
  COUNT(*) FILTER (WHERE COALESCE(t.aftertimelong, 0) > 0)::bigint AS f_r,
  COALESCE(SUM(t.aftertimelong) FILTER (WHERE COALESCE(t.aftertimelong, 0) > 0), 0) AS f_s_sec
FROM icc.t_icc_ag_route_log t
LEFT JOIN icc.t_icc_base_call_log b ON b.pid = t.basecallpid
WHERE t.calldirection = 2 AND t.calltype = 4
GROUP BY 1, 2, 3, 4, 5;

-- 坐席工作量合计（S_ICIP_RPT_A_Workload）
CREATE OR REPLACE VIEW icc.v_rpt_agent_workload AS
SELECT
  date_trunc('day', COALESCE(createcalltime, begintime)) AS datestr,
  vdnid,
  COALESCE(agentgroupname, '全部') AS agentgroupname,
  COALESCE(agentname, '全部') AS agentname,
  COALESCE(workno, '全部') AS workno,
  COUNT(*) FILTER (WHERE COALESCE(talktimelong, 0) > 0 AND calldirection IN (1, 2))::bigint AS f_g,
  COUNT(*) FILTER (WHERE COALESCE(talktimelong, 0) > 0 AND calldirection = 1)::bigint AS f_h,
  COALESCE(SUM(talktimelong) FILTER (WHERE COALESCE(talktimelong, 0) > 0 AND calldirection = 1), 0) AS f_i_sec,
  COUNT(*) FILTER (WHERE COALESCE(talktimelong, 0) > 0 AND calldirection = 2)::bigint AS f_k,
  COALESCE(SUM(talktimelong) FILTER (WHERE COALESCE(talktimelong, 0) > 0 AND calldirection = 2), 0) AS f_l_sec
FROM icc.t_icc_ag_route_log
GROUP BY 1, 2, 3, 4, 5;

-- 坐席状态跟踪明细（S_ICIP_RPT_A_StatusTracking）
CREATE OR REPLACE VIEW icc.v_rpt_agent_status_tracking AS
SELECT
  a.id,
  a.agentid,
  a.begintime,
  a.endtime,
  COALESCE(a.agentname, '-') AS agentname,
  COALESCE(a.workno, '-') AS workno,
  COALESCE(a.statusname, '-') AS statusname,
  a.status,
  a.statetime,
  COALESCE(a.operatename, '-') AS operatename,
  a.operatetype,
  COALESCE(a.operateworkno, a.workno, '-') AS operateworkno,
  a.operatefailcause,
  COALESCE(a.logoutreasoncode, '-') AS logoutreasoncode,
  a.vdnid,
  a.vdnname,
  a.accessmediatype,
  a.agroutelogpid,
  a.basecallpid
FROM icc.t_icc_ag_state_trk_record a
WHERE UPPER(COALESCE(a.accessmediatype, '')) = 'TAS';

-- 签入签出明细
CREATE OR REPLACE VIEW icc.v_rpt_agent_login_detail AS
SELECT
  pid,
  vdnid,
  vdnname,
  agentid,
  COALESCE(agentname, '-') AS agentname,
  COALESCE(workno, '-') AS workno,
  logintime,
  logouttime,
  EXTRACT(EPOCH FROM (logouttime - logintime))::integer AS onlinelong,
  extension
FROM icc.t_icc_ag_login_log;

-- 坐席工效（S_ICIP_RPT_A_WorkEfficiency 关键列，时长为秒）
CREATE OR REPLACE VIEW icc.v_rpt_agent_work_efficiency AS
SELECT
  COALESCE(l.datestr, s.datestr, a.datestr) AS datestr,
  COALESCE(l.vdnid, s.vdnid, a.vdnid) AS vdnid,
  COALESCE(l.agentname, s.agentname, a.agentname, '全部') AS agentname,
  COALESCE(l.workno, s.workno, a.workno, '全部') AS workno,
  COALESCE(s.f_e, 0) AS f_e,
  l.f_f,
  l.f_g,
  COALESCE(l.f_h_sec, 0) AS f_h_sec,
  COALESCE(s.f_i, 0) AS f_i,
  COALESCE(s.f_j, 0) AS f_j,
  COALESCE(a.f_l, 0) AS f_l,
  COALESCE(a.f_n_sec, 0) AS f_n_sec,
  COALESCE(a.f_p, 0) AS f_p,
  COALESCE(a.f_r_sec, 0) AS f_r_sec,
  COALESCE(s.f_v, 0) AS f_v,
  COALESCE(s.f_v_sec, 0) AS f_v_sec,
  COALESCE(s.f_y, 0) AS f_y,
  COALESCE(s.f_y_sec, 0) AS f_y_sec,
  COALESCE(s.f_ac, 0) AS f_ac,
  COALESCE(s.f_ac_sec, 0) AS f_ac_sec,
  COALESCE(s.f_as_sec, 0) AS f_as_sec,
  COALESCE(a.f_ah, 0) AS f_ah,
  COALESCE(a.f_aj, 0) AS f_aj,
  COALESCE(a.f_al, 0) AS f_al,
  COALESCE(a.f_ao, 0) AS f_ao
FROM (
  SELECT
    date_trunc('day', logintime) AS datestr,
    vdnid,
    COALESCE(agentname, '全部') AS agentname,
    COALESCE(workno, '全部') AS workno,
    MIN(logintime) AS f_f,
    MAX(logouttime) AS f_g,
    SUM(EXTRACT(EPOCH FROM (logouttime - logintime)))
      FILTER (WHERE logouttime IS NOT NULL AND logintime IS NOT NULL) AS f_h_sec
  FROM icc.t_icc_ag_login_log
  GROUP BY 1, 2, 3, 4
) l
FULL JOIN (
  SELECT
    date_trunc('day', begintime) AS datestr,
    vdnid,
    COALESCE(agentname, '全部') AS agentname,
    COALESCE(workno, '全部') AS workno,
    COUNT(*) FILTER (WHERE UPPER(COALESCE(accessmediatype, '')) = 'TAS')::bigint AS f_e,
    COUNT(*) FILTER (WHERE operatetype = 36 AND UPPER(COALESCE(accessmediatype, '')) = 'TAS')::bigint AS f_i,
    COUNT(*) FILTER (WHERE operatetype IN (35, 37) AND UPPER(COALESCE(accessmediatype, '')) = 'TAS')::bigint AS f_j,
    COUNT(*) FILTER (WHERE status = 2 AND UPPER(COALESCE(accessmediatype, '')) = 'TAS')::bigint AS f_v,
    COALESCE(SUM(statetime) FILTER (WHERE status = 2 AND UPPER(COALESCE(accessmediatype, '')) = 'TAS'), 0) AS f_v_sec,
    COUNT(*) FILTER (WHERE status = 32 AND UPPER(COALESCE(accessmediatype, '')) = 'TAS')::bigint AS f_y,
    COALESCE(SUM(statetime) FILTER (WHERE status = 32 AND UPPER(COALESCE(accessmediatype, '')) = 'TAS'), 0) AS f_y_sec,
    COUNT(*) FILTER (WHERE status = 1024 AND UPPER(COALESCE(accessmediatype, '')) = 'TAS')::bigint AS f_ac,
    COALESCE(SUM(statetime) FILTER (WHERE status = 1024 AND UPPER(COALESCE(accessmediatype, '')) = 'TAS'), 0) AS f_ac_sec,
    COALESCE(SUM(statetime) FILTER (WHERE status = 16384 AND UPPER(COALESCE(accessmediatype, '')) = 'TAS'), 0) AS f_as_sec
  FROM icc.t_icc_ag_state_trk_record
  GROUP BY 1, 2, 3, 4
) s ON l.datestr = s.datestr
   AND l.vdnid IS NOT DISTINCT FROM s.vdnid
   AND l.workno IS NOT DISTINCT FROM s.workno
FULL JOIN (
  SELECT
    date_trunc('day', COALESCE(createcalltime, begintime)) AS datestr,
    vdnid,
    COALESCE(agentname, '全部') AS agentname,
    COALESCE(workno, '全部') AS workno,
    COUNT(*) FILTER (WHERE calldirection = 1 AND calltype IN (1, 2, 18, 23) AND COALESCE(ringtimelong, 0) > 0)::bigint AS f_l,
    COALESCE(SUM(ringtimelong) FILTER (WHERE calldirection = 1 AND calltype IN (1, 2, 18, 23) AND COALESCE(ringtimelong, 0) > 0), 0) AS f_n_sec,
    COUNT(*) FILTER (WHERE calldirection = 2 AND calltype = 4 AND COALESCE(talktimelong, 0) > 0)::bigint AS f_p,
    COALESCE(SUM(talktimelong) FILTER (WHERE calldirection = 2 AND calltype = 4 AND COALESCE(talktimelong, 0) > 0), 0) AS f_r_sec,
    COUNT(*) FILTER (WHERE calldirection = 1 AND calltype = 3 AND COALESCE(talktimelong, 0) > 0)::bigint AS f_ah,
    COUNT(*) FILTER (WHERE calldirection = 1 AND calltype = 8 AND COALESCE(talktimelong, 0) > 0)::bigint AS f_aj,
    COUNT(*) FILTER (WHERE calldirection = 2 AND calltype = 7 AND COALESCE(talktimelong, 0) > 0)::bigint AS f_al,
    COUNT(*) FILTER (WHERE calldirection = 1 AND calltype IN (9, 10, 12, 14, 19, 20, 21, 22) AND COALESCE(talktimelong, 0) > 0)::bigint AS f_ao
  FROM icc.t_icc_ag_route_log
  GROUP BY 1, 2, 3, 4
) a ON COALESCE(l.datestr, s.datestr) = a.datestr
   AND COALESCE(l.vdnid, s.vdnid) IS NOT DISTINCT FROM a.vdnid
   AND COALESCE(l.workno, s.workno) IS NOT DISTINCT FROM a.workno;

-- 线路呼出详单（S_ICIP_RPT_P_LineOutgoing）
CREATE OR REPLACE VIEW icc.v_rpt_line_outgoing AS
SELECT
  t.pid,
  t.vdnid,
  t.vdnname,
  t.begintime,
  COALESCE(c.child_end, t.endtime) AS endtime,
  t.callingno,
  t.calledno,
  EXTRACT(EPOCH FROM (COALESCE(c.child_end, t.endtime) - t.begintime))::integer AS talktimelong
FROM icc.t_icc_base_call_log t
LEFT JOIN LATERAL (
  SELECT MAX(l1.endtime) AS child_end
  FROM icc.t_icc_base_call_log l1
  WHERE l1.parentpid = t.pid
    AND l1.calltype NOT IN (15, 16, 17)
) c ON true
WHERE t.mediaid = 1
  AND COALESCE(t.parentpid, -1) = -1
  AND t.calldirection = 2;

-- 平台呼出 KPI（S_ICIP_RPT_P_OutgoingKPI）。旧过程 parentpid<>-1 在 ICC6 对不上，改为外线呼出主话单。
CREATE OR REPLACE VIEW icc.v_rpt_platform_outbound_kpi AS
SELECT
  date_trunc('day', t.begintime) AS datestr,
  t.vdnid,
  t.vdnname,
  COALESCE(t.callingno, '0') AS callingno,
  COUNT(*)::bigint AS f_d,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM icc.t_icc_ag_route_log ag
      WHERE ag.basecallpid = t.pid AND ag.calldirection = 2 AND ag.calltype = 4
        AND COALESCE(t.talktimelong, 0) > 0
    )
  )::bigint AS f_e,
  COUNT(*) FILTER (WHERE COALESCE(t.talktimelong, 0) > 0)::bigint AS f_g,
  COUNT(*) FILTER (WHERE COALESCE(t.talktimelong, 0) > 0 AND t.talktimelong < 10)::bigint AS f_i,
  COALESCE(SUM(t.talktimelong), 0) AS talk_sec,
  COALESCE(SUM(t.answertimelong), 0) AS ring_sec
FROM icc.t_icc_base_call_log t
WHERE t.mediaid = 1
  AND COALESCE(t.parentpid, -1) = -1
  AND t.calldirection = 2
  AND t.calltype = 1
GROUP BY 1, 2, 3, 4;

-- 电话详单（S_ICIP_RPT_P_PhoneCall）
CREATE OR REPLACE VIEW icc.v_rpt_phone_call AS
SELECT
  t.pid,
  t.vdnid,
  t.vdnname,
  t.callingno,
  t.calledno,
  t.begintime,
  COALESCE(c.child_end, t.endtime) AS endtime,
  (SELECT COUNT(*) FROM icc.t_icc_ivr_route_log ir WHERE ir.basecallpid = t.pid)::bigint AS ivrqty,
  COALESCE((SELECT SUM(ir.talktimelong) FROM icc.t_icc_ivr_route_log ir WHERE ir.basecallpid = t.pid), 0) AS ivrtimelong,
  (SELECT COUNT(*) FROM icc.t_icc_acd_route_log acd WHERE acd.basecallpid = t.pid)::bigint AS acdqty,
  COALESCE((SELECT SUM(acd.queuetimelong) FROM icc.t_icc_acd_route_log acd WHERE acd.basecallpid = t.pid), 0) AS acdtimelong,
  COALESCE((SELECT SUM(ag.ringtimelong) FROM icc.t_icc_ag_route_log ag
            WHERE ag.basecallpid = t.pid AND COALESCE(ag.acdroutepid, 0) <> 0), 0) AS ringtimelong,
  COALESCE((SELECT SUM(ag.talktimelong) FROM icc.t_icc_ag_route_log ag
            WHERE ag.basecallpid = t.pid AND COALESCE(ag.acdroutepid, 0) <> 0), 0) AS talktimelong,
  COALESCE((SELECT ag.talktimelong FROM icc.t_icc_ag_route_log ag
            WHERE ag.basecallpid = t.pid AND COALESCE(ag.talktimelong, 0) > 0 AND COALESCE(ag.acdroutepid, 0) <> 0
            ORDER BY ag.pid LIMIT 1), 0) AS firsttalktimelong,
  (SELECT COUNT(*) FROM icc.t_icc_ag_route_log ag
   WHERE ag.basecallpid = t.pid AND ag.calldirection = 1 AND ag.calltype IN (9, 10, 12, 14, 19, 20, 21, 22))::bigint AS zjtalkqty
FROM icc.t_icc_base_call_log t
LEFT JOIN LATERAL (
  SELECT MAX(l1.endtime) AS child_end
  FROM icc.t_icc_base_call_log l1
  WHERE l1.parentpid = t.pid AND l1.calltype NOT IN (15, 16, 17)
) c ON true
WHERE t.mediaid = 1
  AND COALESCE(t.parentpid, -1) = -1
  AND t.calldirection = 1
  AND t.calltype = 1;

-- 电话呼损统计（S_ICIP_RPT_C_PhoneCallLoss 关键列）
CREATE OR REPLACE VIEW icc.v_rpt_phone_call_loss AS
SELECT
  date_trunc('day', COALESCE(createcalltime, begintime)) AS datestr,
  vdnid,
  COALESCE(calledno, '0') AS calledno,
  COALESCE(agentgroupname, '全部') AS agentgroupname,
  COALESCE(agentname, '全部') AS agentname,
  COALESCE(workno, '全部') AS workno,
  COUNT(*) FILTER (WHERE calldirection = 1)::bigint AS f_g,
  COUNT(*) FILTER (WHERE calldirection = 1 AND COALESCE(talktimelong, 0) = 0)::bigint AS f_h,
  COUNT(*) FILTER (WHERE calldirection = 1 AND COALESCE(talktimelong, 0) = 0 AND COALESCE(ringtimelong, 0) > 0)::bigint AS f_j,
  COUNT(*) FILTER (WHERE calldirection = 1 AND COALESCE(talktimelong, 0) > 0)::bigint AS f_n,
  COUNT(*) FILTER (WHERE calldirection = 2)::bigint AS f_p,
  COUNT(*) FILTER (WHERE calldirection = 2 AND COALESCE(talktimelong, 0) = 0)::bigint AS f_q
FROM icc.t_icc_ag_route_log
GROUP BY 1, 2, 3, 4, 5, 6;

-- ACD 排队呼损（S_ICIP_RPT_C_ACDQueueCallLoss）：排队后未进坐席
CREATE OR REPLACE VIEW icc.v_rpt_acd_queue_call_loss AS
SELECT
  acd.begintime,
  acd.endtime,
  acd.agentgroupname,
  acd.callingno,
  acd.calledno,
  1 AS f_g,
  acd.queuetimelong AS f_h,
  acd.vdnid,
  acd.pid AS acdpid,
  acd.leftcauseid
FROM icc.t_icc_acd_route_log acd
LEFT JOIN icc.t_icc_ag_route_log ag ON acd.pid = ag.acdroutepid
WHERE ag.pid IS NULL;

-- IVR 接入总表（S_ICIP_RPT_I_IVRAccess）
CREATE OR REPLACE VIEW icc.v_rpt_ivr_access AS
SELECT
  date_trunc('day', t.begintime) AS datestr,
  t.vdnid,
  t.vdnname,
  COALESCE(t.callingno, '-') AS callingno,
  COALESCE(t.calledno, '-') AS calledno,
  COUNT(*)::bigint AS f_e,
  COUNT(*) FILTER (
    WHERE EXISTS (SELECT 1 FROM icc.t_icc_ivr_route_log ir WHERE ir.basecallpid = t.pid)
  )::bigint AS f_f,
  COALESCE(SUM((
    SELECT SUM(ir.talktimelong) FROM icc.t_icc_ivr_route_log ir WHERE ir.basecallpid = t.pid
  )), 0) AS f_i_sec,
  COUNT(*) FILTER (
    WHERE EXISTS (SELECT 1 FROM icc.t_icc_acd_route_log acd WHERE acd.basecallpid = t.pid)
  )::bigint AS f_l,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM icc.t_icc_ag_route_log ag
      WHERE ag.basecallpid = t.pid AND COALESCE(ag.talktimelong, 0) > 0
    )
  )::bigint AS f_n,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM icc.t_icc_ivr_route_log ir WHERE ir.basecallpid = t.pid AND ir.flowtype = 1
    )
  )::bigint AS f_p,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM icc.t_icc_ivr_route_log ir WHERE ir.basecallpid = t.pid AND ir.flowtype = 1
    )
    AND EXISTS (
      SELECT 1 FROM icc.t_icc_ag_route_log ag
      WHERE ag.basecallpid = t.pid AND COALESCE(ag.talktimelong, 0) > 0 AND COALESCE(ag.satisficing, 0) > 0
    )
  )::bigint AS f_q
FROM icc.t_icc_base_call_log t
WHERE t.mediaid = 1
  AND COALESCE(t.parentpid, -1) = -1
  AND t.calldirection = 1
  AND t.calltype = 1
GROUP BY 1, 2, 3, 4, 5;

-- IVR 业务分类（S_ICIP_RPT_I_BusinessCategory；无业务名字典时用 flowname/flowid）
CREATE OR REPLACE VIEW icc.v_rpt_ivr_business_category AS
SELECT
  date_trunc('day', t.begintime) AS datestr,
  t.vdnid,
  t.callingno,
  t.calledno,
  COALESCE(NULLIF(t.flowname, ''), 'flow:' || COALESCE(t.flowid::text, '-')) AS f_e,
  COUNT(*)::bigint AS f_f
FROM icc.t_icc_ivr_route_log t
WHERE EXISTS (
  SELECT 1 FROM icc.t_icc_base_call_log b
  WHERE b.pid = t.basecallpid
    AND b.mediaid = 1
    AND COALESCE(b.parentpid, -1) = -1
    AND b.calldirection = 1
    AND b.calltype = 1
)
GROUP BY 1, 2, 3, 4, 5;

-- 一次性解决率（S_ICIP_RPT_P_TimeResolution 简化：同主叫当天仅 1 通接通）
CREATE OR REPLACE VIEW icc.v_rpt_time_resolution AS
SELECT
  date_trunc('day', COALESCE(ag.createcalltime, ag.begintime)) AS datestr,
  ag.vdnid,
  COALESCE(ag.agentgroupname, '全部') AS agentgroupname,
  COALESCE(ag.agentname, '全部') AS agentname,
  COALESCE(ag.workno, '全部') AS workno,
  COUNT(*) FILTER (WHERE COALESCE(ag.talktimelong, 0) > 0)::bigint AS allpasscount,
  COUNT(*) FILTER (
    WHERE COALESCE(ag.talktimelong, 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM icc.t_icc_ag_route_log o
        WHERE o.callingno = ag.callingno
          AND o.pid <> ag.pid
          AND COALESCE(o.talktimelong, 0) > 0
          AND date_trunc('day', COALESCE(o.createcalltime, o.begintime))
            = date_trunc('day', COALESCE(ag.createcalltime, ag.begintime))
      )
  )::bigint AS oncepasscount,
  COALESCE(SUM(ag.talktimelong) FILTER (WHERE COALESCE(ag.talktimelong, 0) > 0), 0) AS talktimelong,
  CASE WHEN COUNT(*) FILTER (WHERE COALESCE(ag.talktimelong, 0) > 0) = 0 THEN NULL
       ELSE COUNT(*) FILTER (WHERE COALESCE(ag.satisficing, 0) > 0)::numeric
            / COUNT(*) FILTER (WHERE COALESCE(ag.talktimelong, 0) > 0)
  END AS satisfilv
FROM icc.t_icc_ag_route_log ag
WHERE ag.calldirection = 1
GROUP BY 1, 2, 3, 4, 5;

-- 交换 CDR（对照 S_icc_RPT_PLF_DT_CDR）
CREATE OR REPLACE VIEW icc.v_rpt_base_cdr AS
SELECT
  id,
  pid,
  consn,
  callsn,
  span,
  channel,
  trunkgroup,
  caller,
  called,
  initializetime,
  answertime,
  connecttime,
  releasetime,
  talkduration,
  answerduration,
  cause,
  callflag
FROM icc.t_icc_base_cdr;

-- 全媒体接入（对照 S_icc_RPT_P_FullMediaAccess；邮件/IM 本仓无表，记 0）
CREATE OR REPLACE VIEW icc.v_rpt_full_media_access AS
SELECT
  t.begintime AS occurred_at,
  t.vdnid,
  t.vdnname,
  'call_in'::varchar AS media,
  1::bigint AS qty
FROM icc.t_icc_base_call_log t
WHERE t.mediaid = 1 AND t.parentpid = -1 AND t.calldirection = 1 AND t.calltype = 1
UNION ALL
SELECT t.begintime, t.vdnid, t.vdnname, 'call_out', 1
FROM icc.t_icc_base_call_log t
WHERE t.mediaid = 1 AND t.parentpid <> -1 AND t.calldirection = 2
UNION ALL
SELECT f.time, f.vdnid, NULL, 'fax_in', 1
FROM icc.t_icc_faxs_recv f
UNION ALL
SELECT s.snddate, s.vdnid, NULL, 'fax_out', 1
FROM icc.t_icc_faxs_sndfax1001d s
WHERE s.sndstate = 3 AND s.snddate IS NOT NULL;

-- 中继利用率明细（对照 S_icc_RPT_P_RelayUtilization；通道数来自中继组配置）
CREATE OR REPLACE VIEW icc.v_rpt_relay_utilization AS
SELECT
  t.pid,
  t.begintime,
  t.endtime,
  t.vdnid,
  t.channelgroupid,
  t.channelgroupname,
  t.spanid,
  t.answertimelong,
  t.talktimelong,
  cg.endchannelid - cg.beginchannelid + 1 AS channelqty
FROM icc.t_icc_base_call_log t
LEFT JOIN icc.t_icc_base_channelgroup cg ON cg.id = t.channelgroupid
WHERE t.mediaid = 1 AND t.parentpid = -1;

-- 客户呼入地域（对照 S_icc_RPT_P_CustomerIByRegion）。无号段表，省/市固定「未知」；pom=1 手机 / 2 固话。
CREATE OR REPLACE VIEW icc.v_rpt_customer_by_region AS
SELECT
  t.begintime,
  t.vdnid,
  t.callingno,
  t.talktimelong,
  CASE WHEN t.callingno ~ '^1[3-9][0-9]{9}$' THEN '1' ELSE '2' END AS pom,
  '未知'::varchar AS province,
  '未知'::varchar AS city
FROM icc.t_icc_base_call_log t
WHERE t.calldirection = 1 AND t.parentpid = -1;

-- 预测外呼/排队工效事实（对照 V_SMC_RPT_PAEfficiency = ACD 左连首接坐席段）
CREATE OR REPLACE VIEW icc.v_rpt_pa_efficiency AS
SELECT
  acd.pid AS acdpid,
  ag.pid AS agpid,
  acd.basecallpid,
  acd.begintime,
  acd.endtime,
  acd.vdnid,
  acd.calledno,
  acd.agentgroupid,
  acd.agentgroupname,
  COALESCE(ag.workno, acd.workno) AS workno,
  COALESCE(ag.agentid, NULL) AS agentid,
  ag.agentname,
  acd.queuetimelong,
  acd.leftcauseid,
  ag.ringtimelong,
  ag.talktimelong,
  ag.aftertimelong,
  ag.releasecause
FROM icc.t_icc_acd_route_log acd
LEFT JOIN icc.t_icc_ag_route_log ag
  ON ag.acdroutepid = acd.pid AND ag.parentcallpid = -1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'icc_rpt_readonly') THEN
    CREATE ROLE icc_rpt_readonly NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'icc_rpt') THEN
    CREATE ROLE icc_rpt LOGIN PASSWORD 'IccReport2026!';
  END IF;
END
$$;

GRANT icc_rpt_readonly TO icc_rpt;
GRANT CONNECT ON DATABASE chatwoot_dev TO icc_rpt;
GRANT USAGE ON SCHEMA icc TO icc_rpt_readonly, icc_rpt;
GRANT SELECT ON ALL TABLES IN SCHEMA icc TO icc_rpt_readonly, icc_rpt;
ALTER DEFAULT PRIVILEGES IN SCHEMA icc GRANT SELECT ON TABLES TO icc_rpt_readonly, icc_rpt;
ALTER ROLE icc_rpt SET search_path = icc, public;
