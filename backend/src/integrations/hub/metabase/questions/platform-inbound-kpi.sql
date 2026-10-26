-- 样板 3：平台呼入 KPI（对照 S_ICIP_RPT_P_IncomingKPI）
-- f_d 接入量 / f_e 转人工 / f_g 接听 / f_i IVR放弃 / f_k 排队放弃 / f_m 振铃放弃
SELECT
  datestr,
  vdnid,
  vdnname,
  calledno,
  f_d,
  f_e,
  f_f,
  f_g,
  f_h,
  f_i,
  f_k,
  f_m,
  f_o,
  f_q_qty,
  answer_rate,
  offered,
  answered,
  answered_lt_10s
FROM icc.v_rpt_platform_inbound_kpi
WHERE datestr >= {{start_date}}
  AND datestr < {{end_date}}
  [[AND vdnid = {{vdn_id}}]]
ORDER BY datestr, vdnid, calledno;
