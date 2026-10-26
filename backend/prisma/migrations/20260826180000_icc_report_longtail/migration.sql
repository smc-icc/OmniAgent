-- 长尾报表：中继组维表、传真事实表、四张对照视图。

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
