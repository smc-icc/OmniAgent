-- 样板 4：坐席呼出明细（对照 S_ICIP_RPT_A_OutgoingDetails）
SELECT
  basepid,
  agpid,
  typename,
  callingno,
  calledno,
  begintime,
  aftertime,
  agentgroupname,
  agentname,
  workno,
  ringtimelong,
  talktimelong,
  aftertimelong,
  vdnid,
  createcalltime
FROM icc.v_rpt_agent_outbound_detail
WHERE createcalltime >= {{start_date}}
  AND createcalltime < {{end_date}}
  [[AND vdnid = {{vdn_id}}]]
  [[AND workno = {{work_no}}]]
ORDER BY createcalltime DESC
LIMIT 5000;
