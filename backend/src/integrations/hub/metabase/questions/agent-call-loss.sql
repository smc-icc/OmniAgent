-- 坐席呼损（对照 S_ICIP_RPT_C_AgentCallLoss；依赖 acd_route，现网可能为空）
SELECT
  begintime,
  endtime,
  agentgroupname,
  agentname,
  workno,
  callingno,
  calledno,
  f_i,
  f_j,
  vdnid,
  acdpid,
  agpid
FROM icc.v_rpt_agent_call_loss
WHERE begintime >= {{start_date}}
  AND begintime < {{end_date}}
  [[AND vdnid = {{vdn_id}}]]
ORDER BY begintime DESC
LIMIT 5000;
