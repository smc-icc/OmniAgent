-- 样板 2：坐席呼入 KPI（对照 S_ICIP_RPT_A_IncomTrafficKPT）
-- 时长列为秒（旧报表是 /86400 的天小数）。f_w 来自 status=512 保持段。
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
  f_k,
  f_l,
  f_m,
  f_n_sec,
  f_o_sec,
  f_p_sec,
  f_q_sec,
  f_r_sec,
  f_s_sec,
  f_t_sec,
  f_u,
  f_v_sec,
  f_w_sec,
  f_x,
  f_y_sec,
  f_z_sec,
  f_aa_sec,
  f_ab_sec,
  f_ac
FROM icc.v_rpt_agent_inbound_kpi
WHERE datestr >= {{start_date}}
  AND datestr < {{end_date}}
  [[AND vdnid = {{vdn_id}}]]
  [[AND workno = {{work_no}}]]
ORDER BY datestr, workno;
