-- 中继利用率明细（对照 S_ICIP_RPT_P_RelayUtilization）
SELECT *
FROM icc.v_rpt_relay_utilization
WHERE begintime >= {{start_date}}
  AND begintime < {{end_date}}
  [[AND vdnid = {{vdn_id}}]]
ORDER BY begintime DESC
LIMIT 5000;
