-- 坐席工效（对照 S_ICIP_RPT_A_WorkEfficiency 关键列，时长为秒）
SELECT *
FROM icc.v_rpt_agent_work_efficiency
WHERE datestr >= {{start_date}}
  AND datestr < {{end_date}}
  [[AND vdnid = {{vdn_id}}]]
  [[AND workno = {{work_no}}]]
ORDER BY datestr, workno;
