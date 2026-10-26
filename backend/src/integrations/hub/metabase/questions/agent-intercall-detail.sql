-- 内部呼叫明细（对照 S_ICIP_RPT_A_InterCallDetails）
SELECT
  begintime,
  endtime,
  f_agentgroupname,
  f_agentname,
  f_workno,
  callingno,
  t_agentgroupname,
  t_agentname,
  t_workno,
  calledno,
  ringtimelong,
  talktimelong,
  vdnid,
  basepid
FROM icc.v_rpt_agent_intercall_detail
WHERE begintime >= {{start_date}}
  AND begintime < {{end_date}}
  [[AND vdnid = {{vdn_id}}]]
ORDER BY begintime DESC
LIMIT 5000;
