-- 坐席状态跟踪（对照 S_ICIP_RPT_A_StatusTracking）
SELECT *
FROM icc.v_rpt_agent_status_tracking
WHERE begintime >= {{start_date}}
  AND begintime < {{end_date}}
  [[AND vdnid = {{vdn_id}}]]
  [[AND workno = {{work_no}}]]
ORDER BY begintime DESC
LIMIT 5000;
