-- 坐席呼出 KPI（对照 S_ICIP_RPT_A_OutgoTrafficKPT）
SELECT
  datestr,
  vdnid,
  agentgroupname,
  agentname,
  workno,
  f_f,
  f_g,
  f_h,
  f_i,
  f_j,
  f_l,
  f_n_sec,
  f_p_sec,
  f_r_sec,
  f_s,
  f_u_sec,
  f_v,
  f_x_sec
FROM icc.v_rpt_agent_outbound_kpi
WHERE datestr >= {{start_date}}
  AND datestr < {{end_date}}
  [[AND vdnid = {{vdn_id}}]]
  [[AND workno = {{work_no}}]]
ORDER BY datestr, workno;
