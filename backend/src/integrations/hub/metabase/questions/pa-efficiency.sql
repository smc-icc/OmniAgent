-- 排队/预测外呼工效事实（对照 S_ICIP_RPT_P_PAEfficiency / V_SMC_RPT_PAEfficiency）
SELECT *
FROM icc.v_rpt_pa_efficiency
WHERE begintime >= {{start_date}}
  AND begintime < {{end_date}}
  [[AND vdnid = {{vdn_id}}]]
ORDER BY begintime DESC
LIMIT 5000;
