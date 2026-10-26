-- 坐席呼入工作量（对照 S_ICIP_RPT_A_IncomingWorkload 关键列）
SELECT
  datestr,
  vdnid,
  agentgroupname,
  agentname,
  workno,
  f_d,
  f_f,
  f_g_sec,
  f_h,
  f_j,
  f_k,
  f_m,
  f_n,
  f_p,
  f_p_sec,
  f_q
FROM icc.v_rpt_agent_incoming_workload
WHERE datestr >= {{start_date}}
  AND datestr < {{end_date}}
  [[AND vdnid = {{vdn_id}}]]
  [[AND workno = {{work_no}}]]
ORDER BY datestr, workno;
